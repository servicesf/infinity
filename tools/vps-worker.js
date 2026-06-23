const net = require('net');
const tls = require('tls');
const fs = require('fs');
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

loadEnvFile(path.resolve(process.cwd(), '.env.worker'));

const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  mikrotikUser: process.env.MIKROTIK_USER || 'api_wisp',
  mikrotikPassword: process.env.MIKROTIK_PASSWORD,
  dryRun: String(process.env.WORKER_DRY_RUN || 'true').toLowerCase() !== 'false',
  intervalMs: Number(process.env.WORKER_INTERVAL_MS || 30000)
};

function requireEnv(name, value) {
  if (!value) throw new Error(`Falta ${name} en .env.worker`);
}

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) return Buffer.from([(length >> 24) | 0xe0, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
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
      const socketOptions = { host: this.options.host, port: this.options.port, rejectUnauthorized: false };
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || text || `Supabase ${response.status}`);
  return data;
}

async function findIds(api, command, field, value) {
  if (!value) return [];
  const replies = await api.talk([command, `?${field}=${value}`, '=.proplist=.id,name,disabled']);
  return replies.map(parseSentence).map(item => item['.id']).filter(Boolean);
}

async function runCommand(router, action, payload) {
  const pppoe = payload.pppoe;
  const queue = payload.queue || pppoe;
  if (!pppoe) throw new Error('Accion sin usuario PPPoE.');

  if (config.dryRun) {
    console.log(`[DRY_RUN] ${router.name}: ${action} ${pppoe}`);
    return;
  }

  const api = new RouterOsApi({
    host: router.vpn_host,
    port: router.api_port || 8728,
    tls: router.api_tls === true,
    user: config.mikrotikUser,
    password: config.mikrotikPassword
  });
  await api.connect();
  try {
    await api.login();
    const secretIds = await findIds(api, '/ppp/secret/print', 'name', pppoe);
    const queueIds = await findIds(api, '/queue/simple/print', 'name', queue);

    if (action === 'cut') {
      const activeIds = await findIds(api, '/ppp/active/print', 'name', pppoe);
      for (const id of secretIds) await api.talk(['/ppp/secret/disable', `=.id=${id}`]);
      for (const id of activeIds) await api.talk(['/ppp/active/remove', `=.id=${id}`]);
      for (const id of queueIds) await api.talk(['/queue/simple/disable', `=.id=${id}`]);
      return;
    }

    if (action === 'enable' || action === 'payment') {
      for (const id of secretIds) await api.talk(['/ppp/secret/enable', `=.id=${id}`]);
      for (const id of queueIds) await api.talk(['/queue/simple/enable', `=.id=${id}`]);
      return;
    }

    throw new Error(`Accion no soportada: ${action}`);
  } finally {
    api.close();
  }
}

async function processPendingActions() {
  const actions = await supabase(
    'router_actions?select=*,routers(*)&status=eq.pending&order=created_at.asc&limit=20',
    { method: 'GET', prefer: '' }
  );

  for (const action of actions || []) {
    try {
      await supabase(`router_actions?id=eq.${action.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'running' })
      });
      await runCommand(action.routers, action.action, action.payload || {});
      await supabase(`router_actions?id=eq.${action.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done', processed_at: new Date().toISOString(), error: null })
      });
    } catch (error) {
      await supabase(`router_actions?id=eq.${action.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'error', processed_at: new Date().toISOString(), error: error.message })
      });
      console.error(`Accion ${action.id} fallo: ${error.message}`);
    }
  }
}

async function processExpiredCustomers() {
  const now = new Date().toISOString();
  const customers = await supabase(
    `customers?select=*,routers(*)&auto_cut_enabled=eq.true&status=neq.cortado&paid_until=lte.${encodeURIComponent(now)}&limit=20`,
    { method: 'GET', prefer: '' }
  );

  for (const customer of customers || []) {
    try {
      await runCommand(customer.routers, 'cut', {
        pppoe: customer.pppoe_user,
        queue: customer.queue_name || customer.pppoe_user
      });
      await supabase(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cortado', updated_at: new Date().toISOString() })
      });
      console.log(`Corte automatico listo: ${customer.pppoe_user}`);
    } catch (error) {
      console.error(`Corte automatico fallo ${customer.pppoe_user}: ${error.message}`);
    }
  }
}

async function tick() {
  await processPendingActions();
  await processExpiredCustomers();
}

async function main() {
  requireEnv('SUPABASE_URL', config.supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', config.supabaseKey);
  requireEnv('MIKROTIK_PASSWORD', config.mikrotikPassword);

  console.log(`Worker iniciado. DRY_RUN=${config.dryRun ? 'si' : 'no'} intervalo=${config.intervalMs}ms`);
  await tick();
  setInterval(() => tick().catch(error => console.error(error.message)), config.intervalMs);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
