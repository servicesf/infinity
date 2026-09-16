const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

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
  rechargeHours: Number(process.env.WORKER_RECHARGE_HOURS || 3),
  routerTimeoutMs: Number(process.env.WORKER_ROUTER_TIMEOUT_MS || 15000),
  supabaseTimeoutMs: Number(process.env.WORKER_SUPABASE_TIMEOUT_MS || 15000),
  queueCutLimit: String(process.env.WORKER_QUEUE_CUT_LIMIT || '10k/10k').trim(),
  radiusManagedAccounts: new Set(
    String(process.env.RADIUS_MANAGED_ACCOUNTS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ),
  radiusUsers: parseJsonObject(process.env.RADIUS_USERS_JSON),
  radiusAuthorizeFile: process.env.RADIUS_AUTHORIZE_FILE || '/etc/freeradius/3.0/mods-config/files/authorize'
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
    this.failure = null;
    this.closing = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socketOptions = { host: this.options.host, port: this.options.port, rejectUnauthorized: false };
      this.socket = this.options.tls ? tls.connect(socketOptions) : net.connect(socketOptions);
      this.socket.setTimeout(this.options.timeoutMs);
      this.socket.once(this.options.tls ? 'secureConnect' : 'connect', resolve);
      this.socket.on('error', error => {
        this.failure = error;
        reject(error);
      });
      this.socket.on('timeout', () => {
        const error = new Error(`Tiempo agotado comunicando con MikroTik ${this.options.host}`);
        this.failure = error;
        this.socket.destroy(error);
        reject(error);
      });
      this.socket.on('close', () => {
        if (!this.closing && !this.failure) {
          this.failure = new Error(`MikroTik ${this.options.host} cerro la conexion`);
        }
      });
      this.socket.on('data', chunk => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
      });
    });
  }

  close() {
    this.closing = true;
    if (this.socket) this.socket.destroy();
  }

  async login() {
    await this.talk(['/login', `=name=${this.options.user}`, `=password=${this.options.password}`]);
  }

  writeSentence(words) {
    if (!this.socket || this.socket.destroyed) {
      throw this.failure || new Error(`Conexion cerrada con MikroTik ${this.options.host}`);
    }
    const chunks = [];
    for (const word of words) {
      const data = Buffer.from(String(word));
      chunks.push(encodeLength(data.length), data);
    }
    chunks.push(Buffer.from([0]));
    this.socket.write(Buffer.concat(chunks));
  }

  async waitForBytes(length) {
    const deadline = Date.now() + this.options.timeoutMs;
    while (this.buffer.length < length) {
      if (this.failure) throw this.failure;
      if (!this.socket || this.socket.destroyed) {
        throw new Error(`Conexion cerrada con MikroTik ${this.options.host}`);
      }
      if (Date.now() >= deadline) {
        const error = new Error(`Tiempo agotado esperando respuesta de MikroTik ${this.options.host}`);
        this.failure = error;
        this.socket.destroy(error);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  async readWord() {
    await this.waitForBytes(1);
    const first = this.buffer[0];
    let length = 0;
    let offset = 1;
    if ((first & 0x80) === 0x00) {
      length = first;
    } else if ((first & 0xc0) === 0x80) {
      await this.waitForBytes(2);
      length = ((first & ~0xc0) << 8) + this.buffer[1];
      offset = 2;
    } else if ((first & 0xe0) === 0xc0) {
      await this.waitForBytes(3);
      length = ((first & ~0xe0) << 16) + (this.buffer[1] << 8) + this.buffer[2];
      offset = 3;
    } else if ((first & 0xf0) === 0xe0) {
      await this.waitForBytes(4);
      length = ((first & ~0xf0) << 24) + (this.buffer[1] << 16) + (this.buffer[2] << 8) + this.buffer[3];
      offset = 4;
    } else {
      await this.waitForBytes(5);
      length = (this.buffer[1] << 24) + (this.buffer[2] << 16) + (this.buffer[3] << 8) + this.buffer[4];
      offset = 5;
    }
    await this.waitForBytes(offset + length);
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
    signal: options.signal || AbortSignal.timeout(config.supabaseTimeoutMs),
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
    password: config.mikrotikPassword,
    timeoutMs: config.routerTimeoutMs
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

function normalizeRateLimit(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function normalizeIdentity(value = '') {
  return String(value || '').trim().toLocaleLowerCase('es');
}

function normalizeQueueTarget(value = '') {
  return String(value || '').trim().replace(/\/32$/, '');
}

function queueLimitFromPlan(planName = '') {
  const speed = Number(String(planName).match(/(\d+)\s*(?:mb|mbps)/i)?.[1] || 0);
  const knownLimits = new Map([
    [10, '5M/10M'],
    [25, '12M/25M'],
    [50, '15M/50M'],
    [100, '30M/100M'],
    [200, '60M/200M']
  ]);
  return knownLimits.get(speed) || '';
}

function isQueueCut(queue) {
  const maxLimit = normalizeRateLimit(queue?.['max-limit']);
  return maxLimit === '10k/10k'
    || maxLimit === '10000/10000'
    || maxLimit === '64k/64k'
    || maxLimit === '65536/65536';
}

function isRouterItemDisabled(item) {
  const value = String(item?.disabled ?? '').trim().toLowerCase();
  return item?.disabled === true || value === 'true' || value === 'yes' || value === '1';
}

function extractLimitMarker(comment = '') {
  const match = String(comment || '').match(/\[infinit-max-limit=([^\]]+)\]/);
  return match ? match[1] : '';
}

function removeLimitMarker(comment = '') {
  return String(comment || '').replace(/\s*\[infinit-max-limit=[^\]]+\]/g, '').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeRadiusValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isRadiusManagedAccount(router, username) {
  if (!username) return false;
  return config.radiusManagedAccounts.has(`${router.code}:${username}`)
    || config.radiusManagedAccounts.has(`${router.vpn_host}:${username}`);
}

function buildRadiusUserBlock(username, enabled) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(username)) {
    throw new Error(`Usuario RADIUS invalido: ${username}`);
  }

  const marker = escapeRadiusValue(username);
  if (!enabled) {
    return [
      `# BEGIN INFINIT MANAGED ${marker}`,
      `${username} Auth-Type := Reject`,
      `# END INFINIT MANAGED ${marker}`
    ].join('\n');
  }

  const settings = config.radiusUsers[username];
  const password = typeof settings === 'string' ? settings : settings?.password;
  if (!password) {
    throw new Error(`Falta password de ${username} en RADIUS_USERS_JSON`);
  }

  const group = typeof settings === 'object' ? settings.group : '';
  const rateLimit = typeof settings === 'object' ? settings.rateLimit : '';
  const replyAttributes = [
    '    Service-Type = Framed-User',
    '    Framed-Protocol = PPP'
  ];
  if (group) replyAttributes.push(`    Mikrotik-Group = "${escapeRadiusValue(group)}"`);
  if (rateLimit) replyAttributes.push(`    Mikrotik-Rate-Limit = "${escapeRadiusValue(rateLimit)}"`);

  return [
    `# BEGIN INFINIT MANAGED ${marker}`,
    `${username} Cleartext-Password := "${escapeRadiusValue(password)}"`,
    replyAttributes.join(',\n'),
    `# END INFINIT MANAGED ${marker}`
  ].join('\n');
}

function replaceRadiusUserBlock(content, username, block) {
  const escapedUser = escapeRegExp(username);
  const managedBlock = new RegExp(
    `^# BEGIN INFINIT MANAGED ${escapedUser}\\r?\\n[\\s\\S]*?^# END INFINIT MANAGED ${escapedUser}\\r?\\n?`,
    'gm'
  );
  const legacyStanza = new RegExp(
    `^${escapedUser}(?:[ \\t]+[^\\r\\n]*)?(?:\\r?\\n[ \\t]+[^\\r\\n]*)*\\r?\\n?`,
    'gm'
  );
  const cleaned = content
    .replace(managedBlock, '')
    .replace(legacyStanza, '')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');
  // FreeRADIUS procesa "files" en orden. Las cuentas concretas deben ir
  // antes de los bloques DEFAULT para que estos no detengan la búsqueda.
  return `${block}\n\n${cleaned}\n`;
}

function reloadRadius() {
  execFileSync('/usr/sbin/freeradius', ['-CX'], { stdio: 'pipe' });
  try {
    execFileSync('/usr/bin/systemctl', ['reload', 'freeradius'], { stdio: 'pipe' });
  } catch {
    execFileSync('/usr/bin/systemctl', ['restart', 'freeradius'], { stdio: 'pipe' });
  }
}

function setRadiusUserEnabled(username, enabled) {
  const filePath = config.radiusAuthorizeFile;
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo RADIUS: ${filePath}`);
  }

  const original = fs.readFileSync(filePath, 'utf8');
  const updated = replaceRadiusUserBlock(original, username, buildRadiusUserBlock(username, enabled));
  if (updated === original) return;

  const fileStat = fs.statSync(filePath);
  const mode = fileStat.mode;
  const tempPath = `${filePath}.infinit-${process.pid}.tmp`;
  fs.writeFileSync(tempPath, updated, { mode });
  fs.chownSync(tempPath, fileStat.uid, fileStat.gid);
  fs.renameSync(tempPath, filePath);

  try {
    reloadRadius();
  } catch (error) {
    fs.writeFileSync(filePath, original, { mode });
    try {
      reloadRadius();
    } catch {
      // El error original contiene la causa util para el registro del worker.
    }
    throw new Error(`No se pudo actualizar FreeRADIUS: ${error.message}`);
  }
}

function getRadiusUserEnabled(username) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(username)) {
    throw new Error(`Usuario RADIUS invalido: ${username}`);
  }

  const filePath = config.radiusAuthorizeFile;
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo RADIUS: ${filePath}`);
  }

  const escapedUser = escapeRegExp(username);
  const content = fs.readFileSync(filePath, 'utf8');
  const managedBlock = content.match(new RegExp(
    `^# BEGIN INFINIT MANAGED ${escapedUser}\\r?\\n[\\s\\S]*?^# END INFINIT MANAGED ${escapedUser}$`,
    'm'
  ));
  if (!managedBlock) return null;

  if (new RegExp(`^${escapedUser}\\s+Auth-Type\\s*:=\\s*Reject\\s*$`, 'mi').test(managedBlock[0])) {
    return false;
  }
  if (new RegExp(`^${escapedUser}\\s+Cleartext-Password\\s*:=`, 'mi').test(managedBlock[0])) {
    return true;
  }
  return null;
}

async function findQueueItems(api, name, ipAddress = '') {
  const cleanName = String(name || '').trim();
  if (!cleanName) return [];
  const replies = await api.talk([
    '/queue/simple/print',
    `?name=${cleanName}`,
    '=.proplist=.id,name,disabled,max-limit,comment,target'
  ]);
  const exact = replies.map(parseSentence).filter(item => item['.id']);
  if (exact.length) return exact;

  // Algunos registros antiguos quedaron con espacios o mayusculas diferentes.
  // La busqueda normalizada evita perder una recarga por esa diferencia visual.
  const allReplies = await api.talk([
    '/queue/simple/print',
    '=.proplist=.id,name,disabled,max-limit,comment,target'
  ]);
  const normalizedName = normalizeIdentity(cleanName);
  const normalizedIp = normalizeQueueTarget(ipAddress);
  return allReplies
    .map(parseSentence)
    .filter(item => item['.id'] && (
      normalizeIdentity(item.name) === normalizedName
      || (normalizedIp && normalizeQueueTarget(item.target) === normalizedIp)
    ));
}

async function cutQueueBySpeed(api, queueItems) {
  for (const queueItem of queueItems) {
    await api.talk([
      '/queue/simple/set',
      `=.id=${queueItem['.id']}`,
      '=disabled=false',
      `=max-limit=${config.queueCutLimit}`,
      `=comment=${removeLimitMarker(queueItem.comment)}`
    ]);
  }
}

async function restoreQueueSpeed(api, queueItems, planName) {
  for (const queueItem of queueItems) {
    const originalLimit = extractLimitMarker(queueItem.comment) || queueLimitFromPlan(planName);
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
  const pppoe = String(payload.pppoe || '').trim() || null;
  const queue = String(payload.queue || pppoe || '').trim() || null;
  const target = pppoe || queue;
  const radiusManaged = isRadiusManagedAccount(router, pppoe);
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
    const queueItems = await findQueueItems(api, queue, payload.ip);
    const queueIds = queueItems.map(item => item['.id']).filter(Boolean);
    if (!radiusManaged && !secretIds.length && !queueItems.length) {
      throw new Error(`No se encontro PPPoE/queue en MikroTik: ${target}`);
    }

    if (action === 'cut') {
      const activeIds = pppoe ? await findIds(api, '/ppp/active/print', 'name', pppoe) : [];
      if (radiusManaged) {
        setRadiusUserEnabled(pppoe, false);
        for (const id of activeIds) await api.talk(['/ppp/active/remove', `=.id=${id}`]);
        return;
      }
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
      if (radiusManaged) {
        setRadiusUserEnabled(pppoe, true);
        return;
      }
      for (const id of secretIds) await api.talk(['/ppp/secret/enable', `=.id=${id}`]);
      await restoreQueueSpeed(api, queueItems, payload.plan_name);
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
        body: JSON.stringify({ status: 'running', processed_at: new Date().toISOString() })
      });
      const result = await runCommand(action.routers, action.action, action.payload || {});
      if (result?.skipped) continue;
      await supabase(`router_actions?id=eq.${action.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done', processed_at: new Date().toISOString(), error: null })
      });
    } catch (error) {
      const attempts = Number(action.payload?.worker_attempts || 0) + 1;
      const retryable = /tiempo agotado|timed?\s*out|econnreset|econnrefused|socket|network/i.test(error.message);
      if (retryable && attempts < 4) {
        await supabase(`router_actions?id=eq.${action.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'pending',
            processed_at: null,
            error: `Intento ${attempts}/4: ${error.message}`,
            payload: { ...(action.payload || {}), worker_attempts: attempts }
          })
        });
        console.warn(`Accion ${action.id} se reintentara (${attempts}/4): ${error.message}`);
      } else {
        await supabase(`router_actions?id=eq.${action.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'error', processed_at: new Date().toISOString(), error: error.message })
        });
        console.error(`Accion ${action.id} fallo definitivamente: ${error.message}`);
      }
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
        ip: customer.ip_address,
        plan_name: customer.plan_name
      });
      if (result?.skipped) continue;
      if (config.dryRun) continue;

      await supabase(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'cortado',
          paid_until: null,
          updated_at: new Date().toISOString()
        })
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
      '=.proplist=.id,name,disabled,target,max-limit,comment'
    ]);
    const queues = replies.map(parseSentence).filter(item => item.name);
    for (const queue of queues) {
      const cleanComment = removeLimitMarker(queue.comment);
      if (cleanComment === String(queue.comment || '').trim()) continue;
      await api.talk([
        '/queue/simple/set',
        `=.id=${queue['.id']}`,
        `=comment=${cleanComment}`
      ]);
      queue.comment = cleanComment;
      console.log(`Comentario tecnico retirado de queue: ${queue.name}`);
    }
    return queues;
  } finally {
    api.close();
  }
}

async function syncRouterFromWinbox(router) {
  const secrets = await listRouterSecrets(router);
  const queues = await listRouterQueues(router);
  const secretByName = new Map(secrets.map(secret => [secret.name, secret]));
  const queueByName = new Map(queues.map(queue => [normalizeIdentity(queue.name), queue]));
  const customers = await supabase(
    `customers?select=*&router_id=eq.${router.id}`,
    { method: 'GET', prefer: '' }
  );

  for (const customer of customers || []) {
    const radiusManaged = isRadiusManagedAccount(router, customer.pppoe_user);
    const radiusEnabled = radiusManaged ? getRadiusUserEnabled(customer.pppoe_user) : null;
    const secret = customer.pppoe_user ? secretByName.get(customer.pppoe_user) : null;
    const queue = customer.queue_name ? queueByName.get(normalizeIdentity(customer.queue_name)) : null;
    const deviceItem = secret || queue;
    const target = customer.pppoe_user || customer.queue_name;
    if (!target) continue;
    if (config.onlyPppoe && target !== config.onlyPppoe) continue;
    if (radiusManaged && radiusEnabled === null) {
      console.warn(`No se pudo leer el estado RADIUS administrado de ${target}`);
      continue;
    }
    if (!radiusManaged && !deviceItem) continue;

  const mikrotikEnabled = radiusManaged
    ? radiusEnabled
    : !isRouterItemDisabled(deviceItem) && !isQueueCut(deviceItem);
    const panelCut = customer.status === 'cortado' && !customer.paid_until;

    if (config.syncWinboxRecharges && mikrotikEnabled && panelCut) {
      if (config.dryRun) {
        console.log(`[DRY_RUN] Posible recarga WinBox detectada: ${target}`);
        continue;
      }

      // La lectura inicial puede quedar vieja mientras una recarga del panel se
      // procesa. Se confirma nuevamente el estado para no registrar dos pagos.
      const currentRows = await supabase(
        `customers?select=status,paid_until&id=eq.${customer.id}&limit=1`,
        { method: 'GET', prefer: '' }
      );
      const current = currentRows?.[0];
      if (!current || current.status !== 'cortado' || current.paid_until) continue;
      const paidUntil = addDaysWithHours(new Date().toISOString());

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

    console.log(`Recarga WinBox sincronizada: ${target} hasta ${paidUntil}`);
      continue;
    }

    if (config.syncWinboxCuts && !mikrotikEnabled && (customer.status !== 'cortado' || customer.paid_until)) {
      if (config.dryRun) {
        console.log(`[DRY_RUN] Corte WinBox detectado: ${target}`);
        continue;
      }

      await supabase(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'cortado',
          paid_until: null,
          updated_at: new Date().toISOString()
        })
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
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabase(
    `router_actions?status=eq.running&processed_at=lt.${encodeURIComponent(staleBefore)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending', processed_at: null, error: 'Reintentando accion interrumpida.' })
    }
  );
  await processPendingActions();
  await processExpiredCustomers();
  await syncWinboxChanges();
}

async function recoverFailedPaymentActions() {
  const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const actions = await supabase(
    `router_actions?select=id,payload&status=eq.error&action=eq.payment&created_at=gte.${encodeURIComponent(recent)}&limit=20`,
    { method: 'GET', prefer: '' }
  );
  for (const action of actions || []) {
    if (!action.payload?.payment_id || action.payload?.worker_recovered) continue;
    await supabase(`router_actions?id=eq.${action.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'pending',
        processed_at: null,
        error: 'Reintentando pago fallido con el worker actualizado.',
        payload: { ...(action.payload || {}), worker_recovered: true }
      })
    });
    console.log(`Pago fallido recuperado para reintento: ${action.id}`);
  }
}

let tickRunning = false;

async function guardedTick() {
  if (tickRunning) {
    console.warn('Ciclo omitido: el ciclo anterior todavia esta trabajando.');
    return;
  }
  tickRunning = true;
  try {
    await tick();
  } finally {
    tickRunning = false;
  }
}

async function main() {
  requireEnv('SUPABASE_URL', config.supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', config.supabaseKey);
  requireEnv('MIKROTIK_PASSWORD', config.mikrotikPassword);

  console.log(`Worker iniciado. DRY_RUN=${config.dryRun ? 'si' : 'no'} intervalo=${config.intervalMs}ms ONLY_PPPOE=${config.onlyPppoe || 'todos'} QUEUE_CUT_LIMIT=${config.queueCutLimit} SYNC_WINBOX_RECHARGES=${config.syncWinboxRecharges ? 'si' : 'no'} RADIUS=${config.radiusManagedAccounts.size ? 'prueba limitada' : 'no'}`);
  await recoverFailedPaymentActions();
  await guardedTick();
  setInterval(() => guardedTick().catch(error => console.error(error.message)), config.intervalMs);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
