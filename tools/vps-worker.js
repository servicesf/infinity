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
  intervalMs: Number(process.env.WORKER_INTERVAL_MS || 30000),
  onlyPppoe: String(process.env.WORKER_ONLY_PPPOE || '').trim(),
  syncWinboxRecharges: String(process.env.WORKER_SYNC_WINBOX_RECHARGES || 'false').toLowerCase() === 'true',
  syncWinboxCuts: String(process.env.WORKER_SYNC_WINBOX_CUTS || 'false').toLowerCase() === 'true',
  rechargeDays: Number(process.env.WORKER_RECHARGE_DAYS || 30),
  rechargeHours: Number(process.env.WORKER_RECHARGE_HOURS || 6)
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

function addDaysWithHours(baseDate, days = config.rechargeDays, hours = config.rechargeHours) {
  const date = new Date(baseDate || Date.now());
  if (Number.isNaN(date.getTime())) date.setTime(Date.now());
  date.setDate(date.getDate() + Number(days || 0));
  date.setHours(date.getHours() + Number(hours || 0));
  return date.toISOString();
}

async function getMikrotikApi(router) {
  const api = new RouterOsApi({
    host: router.vpn_host,
    port: router.api_port || 8728,
    tls: router.api_tls === true,
    user: config.mikrotikUser,
    password: config.mikrotikPassword
  });
  await api.connect();
  await api.login();
  return api;
}

async function findIds(api, command, field, value) {
  if (!value) return [];
  const replies = await api.talk([command, `?${field}=${value}`, '=.proplist=.id,name,disabled']);
  return replies.map(parseSentence).map(item => item['.id']).filter(Boolean);
}

function isQueueCut(queue) {
  return String(queue?.['max-limit'] || '').toLowerCase() === '64k/64k';
}

function appendLimitMarker(comment = '', maxLimit = '') {
  const clean = String(comment || '').replace(/\s*\[infinit-max-limit=[^\]]+\]/g, '').trim();
  return `${clean ? `${clean} ` : ''}[infinit-max-limit=${maxLimit || '0/0'}]`;
}

function extractLimitMarker(comment = '') {
  const match = String(comment || '').match(/\[infinit-max-limit=([^\]]+)\]/);
  return match ? match[1] : '';
}

function removeLimitMarker(comment = '') {
  return String(comment || '').replace(/\s*\[infinit-max-limit=[^\]]+\]/g, '').trim();
}

async function findQueueItems(api, name) {
  if (!name) return [];
  const replies = await api.talk([
    '/queue/simple/print',
    `?name=${name}`,
    '=.proplist=.id,name,disabled,max-limit,comment,target'
  ]);
  return replies.map(parseSentence).filter(item => item['.id']);
}

async function cutQueueBySpeed(api, queueItems) {
  for (const queueItem of queueItems) {
    const comment = appendLimitMarker(queueItem.comment, queueItem['max-limit']);
    await api.talk([
      '/queue/simple/set',
      `=.id=${queueItem['.id']}`,
      '=disabled=false',
      '=max-limit=64k/64k',
      `=comment=${comment}`
    ]);
  }
}

async function restoreQueueSpeed(api, queueItems) {
  for (const queueItem of queueItems) {
    const originalLimit = extractLimitMarker(queueItem.comment);
    const words = [
      '/queue/simple/set',
      `=.id=${queueItem['.id']}`,
      '=disabled=false'
    ];
    if (originalLimit) words.push(`=max-limit=${originalLimit}`);
    words.push(`=comment=${removeLimitMarker(queueItem.comment)}`);
    await api.talk(words);
  }
}

async function runCommand(router, action, payload) {
  const pppoe = payload.pppoe;
  const queue = payload.queue || pppoe;
  const target = pppoe || queue;
  if (!target) throw new Error('Accion sin PPPoE ni queue.');
  if (config.onlyPppoe && target !== config.onlyPppoe) {
    console.log(`Omitido por WORKER_ONLY_PPPOE=${config.onlyPppoe}: ${target}`);
    return { skipped: true };
  }

  if (config.dryRun) {
    console.log(`[DRY_RUN] ${router.name}: ${action} ${target}`);
    return { dryRun: true };
  }

  const api = await getMikrotikApi(router);
  try {
    const secretIds = pppoe ? await findIds(api, '/ppp/secret/print', 'name', pppoe) : [];
    const queueItems = await findQueueItems(api, queue);
    const queueIds = queueItems.map(item => item['.id']).filter(Boolean);
    if (!secretIds.length && !queueItems.length) {
      throw new Error(`No se encontro PPPoE/queue en MikroTik: ${target}`);
    }

    if (action === 'cut') {
      const activeIds = pppoe ? await findIds(api, '/ppp/active/print', 'name', pppoe) : [];
      for (const id of secretIds) await api.talk(['/ppp/secret/disable', `=.id=${id}`]);
      for (const id of activeIds) await api.talk(['/ppp/active/remove', `=.id=${id}`]);
      if (pppoe) {
        for (const id of queueIds) await api.talk(['/queue/simple/disable', `=.id=${id}`]);
      } else {
        await cutQueueBySpeed(api, queueItems);
      }
      return;
    }

    if (action === 'enable' || action === 'payment') {
      for (const id of secretIds) await api.talk(['/ppp/secret/enable', `=.id=${id}`]);
      await restoreQueueSpeed(api, queueItems);
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
      if (config.dryRun) {
        await runCommand(action.routers, action.action, action.payload || {});
        continue;
      }

      await supabase(`router_actions?id=eq.${action.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'running' })
      });
      const result = await runCommand(action.routers, action.action, action.payload || {});
      if (result?.skipped) continue;
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
      const result = await runCommand(customer.routers, 'cut', {
        pppoe: customer.pppoe_user,
        queue: customer.queue_name || customer.pppoe_user,
        ip: customer.ip_address
      });
      if (result?.skipped) continue;
      if (config.dryRun) continue;

      await supabase(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cortado', updated_at: new Date().toISOString() })
      });
      console.log(`Corte automatico listo: ${customer.pppoe_user || customer.queue_name}`);
    } catch (error) {
      console.error(`Corte automatico fallo ${customer.pppoe_user || customer.queue_name}: ${error.message}`);
    }
  }
}

async function listRouterSecrets(router) {
  const api = await getMikrotikApi(router);
  try {
    const replies = await api.talk([
      '/ppp/secret/print',
      '?service=pppoe',
      '=.proplist=name,disabled'
    ]);
    return replies.map(parseSentence).filter(item => item.name);
  } finally {
    api.close();
  }
}

async function listRouterQueues(router) {
  const api = await getMikrotikApi(router);
  try {
    const replies = await api.talk([
      '/queue/simple/print',
      '=.proplist=name,disabled,target,max-limit'
    ]);
    return replies.map(parseSentence).filter(item => item.name);
  } finally {
    api.close();
  }
}

async function syncRouterFromWinbox(router) {
  const secrets = await listRouterSecrets(router);
  const queues = await listRouterQueues(router);
  const secretByName = new Map(secrets.map(secret => [secret.name, secret]));
  const queueByName = new Map(queues.map(queue => [queue.name, queue]));
  const customers = await supabase(
    `customers?select=*&router_id=eq.${router.id}`,
    { method: 'GET', prefer: '' }
  );

  for (const customer of customers || []) {
    const secret = customer.pppoe_user ? secretByName.get(customer.pppoe_user) : null;
    const queue = customer.queue_name ? queueByName.get(customer.queue_name) : null;
    const deviceItem = secret || queue;
    const target = customer.pppoe_user || customer.queue_name;
    if (!deviceItem || !target) continue;
    if (config.onlyPppoe && target !== config.onlyPppoe) continue;

    const mikrotikEnabled = deviceItem.disabled !== 'true' && !isQueueCut(deviceItem);
    const panelCut = customer.status === 'cortado' || customer.status === 'vencido';

    if (config.syncWinboxRecharges && mikrotikEnabled && panelCut) {
      const paidUntil = addDaysWithHours(new Date().toISOString());
      if (config.dryRun) {
        console.log(`[DRY_RUN] Recarga WinBox detectada: ${target} hasta ${paidUntil}`);
        continue;
      }

      await supabase('payments', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customer.id,
          amount: Number(customer.monthly_price || 0),
          method: 'winbox',
          reference: 'Recarga detectada por PPPoE habilitado en WinBox',
          status: 'confirmado',
          paid_at: new Date().toISOString(),
          service_days: config.rechargeDays,
          extra_hours: config.rechargeHours
        })
      });

      await supabase(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'activo',
          paid_until: paidUntil,
          updated_at: new Date().toISOString()
        })
      });

      await runCommand(router, 'payment', {
        pppoe: customer.pppoe_user,
        queue: customer.queue_name || customer.pppoe_user,
        ip: customer.ip_address
      });

      console.log(`Recarga WinBox sincronizada: ${target} hasta ${paidUntil}`);
      continue;
    }

    if (config.syncWinboxCuts && !mikrotikEnabled && customer.status !== 'cortado') {
      if (config.dryRun) {
        console.log(`[DRY_RUN] Corte WinBox detectado: ${target}`);
        continue;
      }

      await supabase(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'cortado',
          updated_at: new Date().toISOString()
        })
      });

      await runCommand(router, 'cut', {
        pppoe: customer.pppoe_user,
        queue: customer.queue_name || customer.pppoe_user,
        ip: customer.ip_address
      });

      console.log(`Corte WinBox sincronizado: ${target}`);
    }
  }
}

async function syncWinboxChanges() {
  if (!config.syncWinboxRecharges && !config.syncWinboxCuts) return;
  const routers = await supabase('routers?select=*&active=eq.true', { method: 'GET', prefer: '' });
  for (const router of routers || []) {
    try {
      await syncRouterFromWinbox(router);
    } catch (error) {
      console.error(`Sync WinBox fallo ${router.name}: ${error.message}`);
    }
  }
}

async function tick() {
  await syncWinboxChanges();
  await processPendingActions();
  await processExpiredCustomers();
}

async function main() {
  requireEnv('SUPABASE_URL', config.supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', config.supabaseKey);
  requireEnv('MIKROTIK_PASSWORD', config.mikrotikPassword);

  console.log(`Worker iniciado. DRY_RUN=${config.dryRun ? 'si' : 'no'} intervalo=${config.intervalMs}ms ONLY_PPPOE=${config.onlyPppoe || 'todos'} SYNC_WINBOX_RECHARGES=${config.syncWinboxRecharges ? 'si' : 'no'}`);
  await tick();
  setInterval(() => tick().catch(error => console.error(error.message)), config.intervalMs);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
