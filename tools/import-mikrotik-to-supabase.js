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
  importSource: process.env.IMPORT_SOURCE || '',
  radiusManagedAccounts: new Set(
    String(process.env.IMPORT_RADIUS_MANAGED_ACCOUNTS || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  ),
  setInitialDays: String(process.env.IMPORT_SET_INITIAL_DAYS || 'false').toLowerCase() === 'true',
  initialDays: Number(process.env.IMPORT_INITIAL_DAYS || 30),
  initialHours: Number(process.env.IMPORT_INITIAL_HOURS || 3)
};

if (!config.importSource) {
  config.importSource = config.routerKind === 'inalambrico' ? 'queues' : 'pppoe';
}

const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(argument => argument.startsWith('--only='));
const onlyIdentity = onlyArg ? onlyArg.slice('--only='.length).trim().toLowerCase() : '';

function isRadiusManaged(identity) {
  const account = String(identity || '').trim().toLowerCase();
  const host = String(config.mikrotikHost || '').trim().toLowerCase();
  const routerCode = String(config.routerCode || '').trim().toLowerCase();
  return config.radiusManagedAccounts.has(account)
    || config.radiusManagedAccounts.has(`${host}:${account}`)
    || config.radiusManagedAccounts.has(`${routerCode}:${account}`);
}

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
  const clean = String(profile || '').trim();
  const normalized = clean.toUpperCase().replace(/\s+/g, ' ');
  const speedMatch = normalized.match(/(\d+)\s*(?:MBPS|MB)?\b/);
  const speed = speedMatch ? Number(speedMatch[1]) : 0;
  const prices = {
    7: 95,
    10: 95,
    20: 120,
    25: 120,
    40: 150,
    50: 150,
    100: 200,
    150: 250,
    200: 300
  };
  const prefix = config.routerKind === 'fibra' ? 'Fibra' : 'Inalambrico';

  return speed
    ? { name: `${prefix} ${speed} Mbps`, price: prices[speed] || 0 }
    : { name: clean || 'Plan sin nombre', price: 0 };
}

function speedToMbps(value = '') {
  const clean = String(value).trim().toLowerCase();
  if (!clean || clean === '0') return 0;
  const number = Number.parseFloat(clean.replace(/[a-z]/g, ''));
  if (!Number.isFinite(number)) return 0;
  if (clean.endsWith('k')) return Math.round(number / 1000);
  if (clean.endsWith('m')) return Math.round(number);
  if (number >= 1000000) return Math.round(number / 1000000);
  if (number >= 1000) return Math.round(number / 1000);
  return Math.round(number);
}

function queuePlanInfo(maxLimit = '') {
  const parts = String(maxLimit || '').split('/');
  const upload = speedToMbps(parts[0]);
  const download = speedToMbps(parts[1] || parts[0]);
  const speed = Math.max(upload, download);
  const prices = {
    10: 95,
    25: 120,
    40: 150,
    50: 150,
    100: 200,
    200: 300
  };
  return {
    name: speed ? `Inalambrico ${speed} Mbps` : 'Inalambrico',
    price: prices[speed] || 0
  };
}

function cleanQueueTarget(target = '') {
  return String(target)
    .split(',')[0]
    .trim()
    .replace(/\/\d+$/, '');
}

function looksLikeCi(value = '') {
  return /^\d{5,12}(?:-[0-9A-Za-z]{1,3})?$/.test(String(value).trim());
}

function syntheticCi(router, identity) {
  const cleanIdentity = String(identity || 'cliente')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `SIN-CI-${String(router.code).toUpperCase()}-${cleanIdentity || 'CLIENTE'}`;
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

async function listQueues() {
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
      '/queue/simple/print',
      '=.proplist=name,target,max-limit,disabled,comment'
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

async function findCustomerByIdentity(routerId, field, value) {
  if (!value) return null;
  const rows = await supabase(
    `customers?select=id,ci,router_id,pppoe_user,queue_name&router_id=eq.${encodeURIComponent(routerId)}&${field}=eq.${encodeURIComponent(value)}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function findCustomerByCi(ci) {
  if (!ci) return null;
  const rows = await supabase(
    `customers?select=id,ci,router_id,pppoe_user,queue_name&ci=eq.${encodeURIComponent(ci)}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function availableCi(router, identity, candidate, existing) {
  if (existing && existing.ci) {
    const legacyPasswordCi = config.routerKind !== 'fibra'
      && candidate
      && existing.ci === candidate;
    if (!legacyPasswordCi) return existing.ci;
  }

  if (looksLikeCi(candidate)) {
    const owner = await findCustomerByCi(candidate);
    if (!owner || (existing && owner.id === existing.id)) return candidate;
  }

  const base = syntheticCi(router, identity);
  const owner = await findCustomerByCi(base);
  if (!owner || (existing && owner.id === existing.id)) return base;
  return `${base}-${String(router.id).slice(0, 8).toUpperCase()}`;
}

async function saveCustomer(router, identityField, identity, candidateCi, customer) {
  const existing = await findCustomerByIdentity(router.id, identityField, identity);
  const ci = await availableCi(router, identity, candidateCi, existing);
  const { preserve_status: preserveStatus, ...values } = customer;
  const body = { ...values, ci };

  if (existing) {
    if (preserveStatus) {
      delete body.status;
      delete body.paid_until;
    }
    await supabase(`customers?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify(body)
    });
    return;
  }

  if (preserveStatus) {
    body.status = 'activo';
    body.paid_until = null;
  }
  await supabase('customers', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify([body])
  });
}

function initialPaidUntil(secret) {
  if (!config.setInitialDays || secret.disabled === 'true') return null;
  const date = new Date();
  date.setDate(date.getDate() + config.initialDays);
  date.setHours(date.getHours() + config.initialHours);
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
    const identity = String(secret.name || '').trim();
    if (!identity) {
      skipped += 1;
      continue;
    }

    const radiusManaged = isRadiusManaged(identity);
    const passwordCandidate = config.routerKind === 'fibra'
      ? String(secret.password || '').trim()
      : '';
    const plan = planInfo(secret.profile);
    const paidUntil = initialPaidUntil(secret);
    const customer = {
      router_id: router.id,
      full_name: secret.name,
      sector: config.routerKind,
      plan_name: plan.name,
      monthly_price: plan.price,
      pppoe_user: secret.name,
      queue_name: null,
      ip_address: secret['remote-address'] || null,
      status: secret.disabled === 'true' ? 'cortado' : 'activo',
      paid_until: secret.disabled === 'true' ? null : undefined,
      preserve_status: radiusManaged,
      updated_at: new Date().toISOString()
    };

    if (customer.status !== 'cortado' && paidUntil) customer.paid_until = paidUntil;

    await saveCustomer(router, 'pppoe_user', identity, passwordCandidate, customer);
    imported += 1;
  }

  return { imported, skipped };
}

async function upsertQueueCustomers(router, queues) {
  let imported = 0;
  let skipped = 0;

  for (const queue of queues) {
    const ip = cleanQueueTarget(queue.target);
    const identity = String(queue.name || '').trim();
    if (!identity) {
      skipped += 1;
      continue;
    }

    const ciCandidate = looksLikeCi(queue.comment) ? String(queue.comment).trim() : (ip || '');
    const plan = queuePlanInfo(queue['max-limit']);
    const paidUntil = initialPaidUntil(queue);
    const customer = {
      router_id: router.id,
      full_name: queue.name,
      sector: config.routerKind,
      plan_name: plan.name,
      monthly_price: plan.price,
      pppoe_user: null,
      queue_name: queue.name,
      ip_address: ip || null,
      status: queue.disabled === 'true' || String(queue['max-limit'] || '').toLowerCase() === '64k/64k' ? 'cortado' : 'activo',
      paid_until: queue.disabled === 'true' || String(queue['max-limit'] || '').toLowerCase() === '64k/64k' ? null : undefined,
      updated_at: new Date().toISOString()
    };

    if (customer.status !== 'cortado' && paidUntil) customer.paid_until = paidUntil;

    await saveCustomer(router, 'queue_name', identity, ciCandidate, customer);
    imported += 1;
  }

  return { imported, skipped };
}

async function main() {
  requireEnv('MIKROTIK_HOST', config.mikrotikHost);
  requireEnv('MIKROTIK_PASSWORD', config.mikrotikPassword);
  requireEnv('SUPABASE_URL', config.supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', config.supabaseKey);

  console.log(`Leyendo MikroTik ${config.routerName} (${config.mikrotikHost}:${config.mikrotikPort}) modo ${config.importSource}...`);
  const allItems = config.importSource === 'queues' ? await listQueues() : await listSecrets();
  const items = onlyIdentity
    ? allItems.filter(item => String(item.name || '').trim().toLowerCase() === onlyIdentity)
    : allItems;
  if (onlyIdentity && !items.length) {
    throw new Error(`No se encontro "${onlyIdentity}" en ${config.routerName}`);
  }
  const enabled = items.filter(item => item.disabled !== 'true').length;
  const disabled = items.length - enabled;
  const withoutCi = config.importSource === 'queues'
    ? items.filter(item => !cleanQueueTarget(item.target) && !item.name).length
    : 0;

  console.log(`Encontrados: ${items.length} ${config.importSource === 'queues' ? 'queues' : 'PPPoE'} | activos: ${enabled} | cortados: ${disabled} | sin CI/IP: ${withoutCi}`);

  if (dryRun) {
    console.log('Modo prueba: no se escribio nada en Supabase.');
    return;
  }

  const router = await upsertRouter();
  const result = config.importSource === 'queues'
    ? await upsertQueueCustomers(router, items)
    : await upsertCustomers(router, items);
  console.log(`Importacion lista: ${result.imported} clientes guardados, ${result.skipped} omitidos.`);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
