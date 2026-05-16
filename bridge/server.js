const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(__dirname, '.env');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    process.env[key] = value;
  }
}

loadEnvFile(envPath);

const config = {
  host: process.env.MIKROTIK_HOST || '192.168.88.1',
  port: Number(process.env.MIKROTIK_PORT || 8728),
  user: process.env.MIKROTIK_USER || 'api_wisp',
  password: process.env.MIKROTIK_PASSWORD || '',
  tls: String(process.env.MIKROTIK_TLS || 'false').toLowerCase() === 'true',
  bridgePort: Number(process.env.BRIDGE_PORT || 8787),
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || ''
};

const adminSessionToken = crypto.randomBytes(32).toString('hex');
const clientsStorePath = path.join(__dirname, 'clients-store.json');
let autoCutRunning = false;

function readClientsStore() {
  if (!fs.existsSync(clientsStorePath)) return [];
  try {
    const content = fs.readFileSync(clientsStorePath, 'utf8');
    const clients = JSON.parse(content || '[]');
    return Array.isArray(clients) ? clients : [];
  } catch {
    return [];
  }
}

function writeClientsStore(clients) {
  fs.writeFileSync(clientsStorePath, JSON.stringify(clients, null, 2));
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function isExpired(client) {
  const dueValue = client.dueAt || (client.pagadoHasta ? `${client.pagadoHasta}T23:59:59` : '');
  if (!dueValue) return false;
  return new Date(dueValue) < new Date();
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
      this.socket.setTimeout(10000);
      this.socket.once('connect', resolve);
      this.socket.once('secureConnect', resolve);
      this.socket.once('error', reject);
      this.socket.once('timeout', () => reject(new Error('Tiempo de espera agotado conectando al MikroTik')));
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
    while (this.buffer.length < 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

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

    while (this.buffer.length < offset + length) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

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
      if (type === '!trap' || type === '!fatal') {
        throw new Error(sentence.join(' '));
      }
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

async function findIds(api, command, field, value) {
  if (!value) return [];
  const replies = await api.talk([command, `?${field}=${value}`, '=.proplist=.id,name,disabled']);
  return replies.map(parseSentence).map(item => item['.id']).filter(Boolean);
}

async function disableItems(api, ids, command) {
  for (const id of ids) {
    await api.talk([command, `=.id=${id}`]);
  }
}

async function runMikrotikAction(payload) {
  const api = new RouterOsApi(config);
  await api.connect();

  try {
    await api.login();

    const pppoeUser = payload.pppoe || payload.nombre;
    const queueName = payload.queue || payload.pppoe || payload.nombre;

    if (payload.action === 'cut') {
      const secretIds = await findIds(api, '/ppp/secret/print', 'name', pppoeUser);
      const activeIds = await findIds(api, '/ppp/active/print', 'name', pppoeUser);
      const queueIds = await findIds(api, '/queue/simple/print', 'name', queueName);

      await disableItems(api, secretIds, '/ppp/secret/disable');
      await disableItems(api, activeIds, '/ppp/active/remove');
      await disableItems(api, queueIds, '/queue/simple/disable');

      return { ok: true, action: 'cut', secretIds, activeIds, queueIds };
    }

    if (payload.action === 'enable') {
      const secretIds = await findIds(api, '/ppp/secret/print', 'name', pppoeUser);
      const queueIds = await findIds(api, '/queue/simple/print', 'name', queueName);

      await disableItems(api, secretIds, '/ppp/secret/enable');
      await disableItems(api, queueIds, '/queue/simple/enable');

      return { ok: true, action: 'enable', secretIds, queueIds };
    }

    if (payload.action === 'payment') {
      return { ok: true, action: 'payment', message: 'Pago registrado en panel. No requiere comando MikroTik.' };
    }

    throw new Error('Accion no soportada');
  } finally {
    api.close();
  }
}

async function listMikrotikClients() {
  const api = new RouterOsApi(config);
  await api.connect();

  try {
    await api.login();
    const replies = await api.talk([
      '/ppp/secret/print',
      '?service=pppoe',
      '=.proplist=.id,name,profile,disabled,service,comment'
    ]);

    return replies.map(parseSentence).map(item => ({
      id: item['.id'],
      name: item.name,
      profile: item.profile,
      service: item.service,
      disabled: item.disabled === 'true',
      comment: item.comment || ''
    })).filter(item => item.name);
  } finally {
    api.close();
  }
}

async function autoCutExpiredClients() {
  if (autoCutRunning) return { ok: true, skipped: true };
  autoCutRunning = true;

  try {
    const clients = readClientsStore();
    const results = [];

    for (const client of clients) {
      const shouldCut = client.autoCutEnabled === true && client.estado !== 'cortado' && isExpired(client);
      if (!shouldCut) continue;

      try {
        await runMikrotikAction({ ...client, action: 'cut' });
        client.estado = 'cortado';
        client.historial = Array.isArray(client.historial) ? client.historial : [];
        client.historial.push({
          fecha: todayDateOnly(),
          tipo: 'corte',
          monto: 0,
          metodo: 'Automatico',
          nota: `Corte automatico por vencimiento ${client.dueAt || client.pagadoHasta}`
        });
        results.push({ id: client.id, pppoe: client.pppoe, ok: true });
      } catch (error) {
        results.push({ id: client.id, pppoe: client.pppoe, ok: false, error: error.message });
      }
    }

    if (results.length) writeClientsStore(clients);
    return { ok: true, checked: clients.length, cut: results.filter(item => item.ok).length, results };
  } finally {
    autoCutRunning = false;
  }
}

setInterval(() => {
  autoCutExpiredClients().catch(error => {
    console.error(`Auto corte fallo: ${error.message}`);
  });
}, 10 * 60 * 1000);

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(cookie => {
    const index = cookie.indexOf('=');
    if (index === -1) return ['', ''];
    return [cookie.slice(0, index).trim(), decodeURIComponent(cookie.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function isAuthenticated(req) {
  return parseCookies(req).infinit_admin === adminSessionToken;
}

function sendUnauthorized(res) {
  sendJson(res, 401, { ok: false, error: 'No autorizado' });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Payload demasiado grande'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  return types[ext] || 'application/octet-stream';
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/admin.html' : url.pathname);
  const filePath = path.resolve(rootDir, `.${pathname}`);

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.url.startsWith('/api/admin-status')) {
    sendJson(res, 200, { ok: true, authenticated: isAuthenticated(req) });
    return;
  }

  if (req.url.startsWith('/api/admin-login')) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Metodo no permitido' });
      return;
    }

    try {
      const payload = await readJson(req);
      const valid = payload.username === config.adminUser && payload.password === config.adminPassword;
      if (!valid) {
        sendJson(res, 401, { ok: false, error: 'Usuario o contraseña incorrectos' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `infinit_admin=${adminSessionToken}; HttpOnly; SameSite=Lax; Path=/`
      });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url.startsWith('/api/admin-logout')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'infinit_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url.startsWith('/api/clients')) {
    if (!isAuthenticated(req)) {
      sendUnauthorized(res);
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, clients: readClientsStore() });
      return;
    }

    if (req.method === 'POST') {
      try {
        const payload = await readJson(req);
        const clients = Array.isArray(payload) ? payload : payload.clients;
        if (!Array.isArray(clients)) {
          sendJson(res, 400, { ok: false, error: 'Lista de clientes invalida' });
          return;
        }

        writeClientsStore(clients);
        sendJson(res, 200, { ok: true, saved: clients.length });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return;
    }

    sendJson(res, 405, { error: 'Metodo no permitido' });
    return;
  }

  if (req.url.startsWith('/api/auto-cut')) {
    if (!isAuthenticated(req)) {
      sendUnauthorized(res);
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Metodo no permitido' });
      return;
    }

    try {
      const result = await autoCutExpiredClients();
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url.startsWith('/api/mikrotik-clients')) {
    if (!isAuthenticated(req)) {
      sendUnauthorized(res);
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Metodo no permitido' });
      return;
    }

    try {
      const clients = await listMikrotikClients();
      sendJson(res, 200, { ok: true, clients });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url.startsWith('/api/mikrotik-action')) {
    if (!isAuthenticated(req)) {
      sendUnauthorized(res);
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Metodo no permitido' });
      return;
    }

    try {
      const payload = await readJson(req);
      const result = await runMikrotikAction(payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(config.bridgePort, () => {
  console.log(`Panel local: http://localhost:${config.bridgePort}/admin.html`);
  console.log(`MikroTik: ${config.host}:${config.port} TLS=${config.tls ? 'si' : 'no'}`);
  console.log('Auto corte: cada 10 minutos para clientes con corte automatico activado');
  autoCutExpiredClients().catch(error => console.error(`Auto corte inicial fallo: ${error.message}`));
});
