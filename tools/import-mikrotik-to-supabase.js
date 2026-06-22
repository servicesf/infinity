const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.import'));

const config = {
  mikrotikHost: process.env.MIKROTIK_HOST,
  mikrotikPort: Number(process.env.MIKROTIK_PORT || 8728),
  mikrotikUser: process.env.MIKROTIK_USER || 'sync_supabase',
  mikrotikPassword: process.env.MIKROTIK_PASSWORD,
  mikrotikTls: String(process.env.MIKROTIK_TLS || 'false').toLowerCase() === 'true',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  routerCode: process.env.ROUTER_CODE || 'rb4011-fibra',
  routerName: process.env.ROUTER_NAME || 'RB4011 Fibra',
  routerKind: process.env.ROUTER_KIND || 'fibra',
  setInitialDays: String(process.env.IMPORT_SET_INITIAL_DAYS || 'false').toLowerCase() === 'true',
  initialDays: Number(process.env.IMPORT_INITIAL_DAYS || 30)
};

const dryRun = process.argv.includes('--dry-run');

function requireEnv(name, value) {
  if (!value) throw new Error(`Falta ${name} en .env.import`);
}

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) {
    return Buffer.from([(length >> 24) | 0xe0, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
  }
  return Buffer.from([0xf0, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

class RouterOsApi {
  constructor(options) {
    this.options = options;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socketOptions = {
        host: this.options.host,
        port: this.options.port,
        rejectUnauthorized: false
      };

      this.socket = this.options.tls ? tls.connect(socketOptions) : net.connect(socketOptions);
      this.socket.setTimeout(12000);
      this.socket.once('connect', resolve);
      this.socket.once('secureConnect', resolve);
      this.socket.once('error', reject);
      this.socket.once('timeout', () => reject(new Error('Tiempo agotado conectando al MikroTik')));
      this.socket.on('data', chunk => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
      });
    });
  }

  close() {
    if (this.socket) this.socket.end();
  }

  async login() {
    await this.talk(['/login', `=name=${this.options.user}`, `=password=${this.options.password}`]);
  }

  writeSentence(words) {
    const chunks = [];
    for (const word of words) {
      const data = Buffer.from(String(word));
      chunks.push(encodeLength(data.length), data);
    }
    chunks.push(Buffer.from([0]));
    this.socket.write(Buffer.concat(chunks));
  }

  async readWord() {
    while (this.buffer.length < 1) await new Promise(resolve => setTimeout(resolve, 5));

    const first = this.buffer[0];
    let length = 0;
    let offset = 1;

    if ((first & 0x80) === 0x00) {
      length = first;
    } else if ((first & 0xc0) === 0x80) {
      while (this.buffer.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
      length = ((first & ~0xc0) << 8) + this.buffer[1];
      offset = 2;
    } else if ((first & 0xe0) === 0xc0) {
      while (this.buffer.length < 3) await new Promise(resolve => setTimeout(resolve, 5));
      length = ((first & ~0xe0) << 16) + (this.buffer[1] << 8) + this.buffer[2];
      offset = 3;
    } else if ((first & 0xf0) === 0xe0) {
      while (this.buffer.length < 4) await new Promise(resolve => setTimeout(resolve, 5));
      length = ((first & ~0xf0) << 24) + (this.buffer[1] << 16) + (this.buffer[2] << 8) + this.buffer[3];
      offset = 4;
    } else {
      while (this.buffer.length < 5) await new Promise(resolve => setTimeout(resolve, 5));
      length = (this.buffer[1] << 24) + (this.buffer[2] << 16) + (this.buffer[3] << 8) + this.buffer[4];
      offset = 5;
    }

    while (this.buffer.length < offset + length) await new Promise(resolve => setTimeout(resolve, 5));

    const word = this.buffer.slice(offset, offset + length).toString();
    this.buffer = this.buffer.slice(offset + length);
    return word;
  }

  async readSentence() {
    const words = [];
    while (true) {
      const word = await this.readWord();
      if (word === '') return words;
      words.push(word);
    }
  }

  async talk(words) {
    this.writeSentence(words);
    const replies = [];

    while (true) {
      const sentence = await this.readSentence();
      const type = sentence[0];
      if (type === '!trap' || type === '!fatal') throw new Error(sentence.join(' '));
      if (type === '!done') return replies;
      replies.push(sentence);
    }
  }
}

function parseSentence(sentence) {
  const parsed = {};
  for (const word of sentence) {
    if (!word.startsWith('=')) continue;
    const nextEq = word.indexOf('=', 1);
    if (nextEq === -1) continue;
    parsed[word.slice(1, nextEq)] = word.slice(nextEq + 1);
  }
  return parsed;
}

function planInfo(profile = '') {
  const clean = profile.trim();
  const plans = {
    'PLAN 7MB': { name: 'Fibra 7 Mbps', price: 95 },
    'PLAN 10MB': { name: 'Fibra 10 Mbps', price: 95 },
    'PLAN 20MB': { name: 'Fibra 20 Mbps', price: 120 },
    'PLAN 25MB': { name: 'Fibra 25 Mbps', price: 120 },
    'PLAN 40MB': { name: 'Fibra 40 Mbps', price: 150 },
    'PLAN 50MB': { name: 'Fibra 50 Mbps', price: 150 },
    'PLAN 100MB': { name: 'Fibra 100 Mbps', price: 200 },
    'PLAN 150MB': { name: 'Fibra 150 Mbps', price: 250 },
    'PLAN 200MB': { name: 'Fibra 200 Mbps', price: 300 }
  };

  return plans[clean] || { name: clean || 'Plan sin nombre', price: 0 };
}

async function listSecrets() {
  const api = new RouterOsApi({
    host: config.mikrotikHost,
    port: config.mikrotikPort,
    user: config.mikrotikUser,
    password: config.mikrotikPassword,
    tls: config.mikrotikTls
  });

  await api.connect();
  try {
    await api.login();
    const replies = await api.talk([
      '/ppp/secret/print',
      '?service=pppoe',
      '=.proplist=name,password,profile,disabled,service,comment,remote-address'
    ]);
    return replies.map(parseSentence).filter(item => item.name);
  } finally {
    api.close();
  }
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && data.message ? data.message : text;
    throw new Error(message || `Supabase ${response.status}`);
  }

  return data;
}

function initialPaidUntil(secret) {
  if (!config.setInitialDays || secret.disabled === 'true') return null;
  const date = new Date();
  date.setDate(date.getDate() + config.initialDays);
  date.setHours(date.getHours() + 12);
  return date.toISOString();
}

async function upsertRouter() {
  const rows = await supabase('routers?on_conflict=code', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: JSON.stringify([{
      name: config.routerName,
      code: config.routerCode,
      kind: config.routerKind,
      vpn_host: config.mikrotikHost,
      api_port: config.mikrotikPort,
      api_tls: config.mikrotikTls,
      active: true
    }])
  });

  return rows[0];
}

async function upsertCustomers(router, secrets) {
  let imported = 0;
  let skipped = 0;

  for (const secret of secrets) {
    const ci = String(secret.password || '').trim();
    if (!ci) {
      skipped += 1;
      continue;
    }

    const plan = planInfo(secret.profile);
    const paidUntil = initialPaidUntil(secret);
    const customer = {
      router_id: router.id,
      full_name: secret.name,
      ci,
      sector: config.routerKind,
      plan_name: plan.name,
      monthly_price: plan.price,
      pppoe_user: secret.name,
      queue_name: secret.name,
      ip_address: secret['remote-address'] || null,
      status: secret.disabled === 'true' ? 'cortado' : 'activo',
      updated_at: new Date().toISOString()
    };

    if (paidUntil) customer.paid_until = paidUntil;

    await supabase('customers?on_conflict=ci', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify([customer])
    });
    imported += 1;
  }

  return { imported, skipped };
}

async function main() {
  requireEnv('MIKROTIK_HOST', config.mikrotikHost);
  requireEnv('MIKROTIK_PASSWORD', config.mikrotikPassword);
  requireEnv('SUPABASE_URL', config.supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', config.supabaseKey);

  console.log(`Leyendo MikroTik ${config.routerName} (${config.mikrotikHost}:${config.mikrotikPort})...`);
  const secrets = await listSecrets();
  const enabled = secrets.filter(item => item.disabled !== 'true').length;
  const disabled = secrets.length - enabled;
  const withoutCi = secrets.filter(item => !String(item.password || '').trim()).length;

  console.log(`Encontrados: ${secrets.length} PPPoE | activos: ${enabled} | cortados: ${disabled} | sin CI/password: ${withoutCi}`);

  if (dryRun) {
    console.log('Modo prueba: no se escribio nada en Supabase.');
    return;
  }

  const router = await upsertRouter();
  const result = await upsertCustomers(router, secrets);
  console.log(`Importacion lista: ${result.imported} clientes guardados, ${result.skipped} omitidos.`);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
