import crypto from 'crypto';

const COOKIE_NAME = 'infinit_admin';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(cookie => {
    const index = cookie.indexOf('=');
    if (index === -1) return ['', ''];
    return [cookie.slice(0, index).trim(), decodeURIComponent(cookie.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

export function hasAdminConfig() {
  return Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET);
}

export function createSessionCookie(username) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const payload = {
    username,
    exp: Date.now() + 8 * 60 * 60 * 1000
  };
  const body = base64url(JSON.stringify(payload));
  const token = `${body}.${sign(body, secret)}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function verifyAdmin(req) {
  if (!hasAdminConfig()) return false;
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token || !token.includes('.')) return false;

  const [body, signature] = token.split('.');
  const expected = sign(body, process.env.ADMIN_SESSION_SECRET);
  const sigBuffer = Buffer.from(signature || '');
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() && payload.username === process.env.ADMIN_USER;
  } catch {
    return false;
  }
}

export function requireAdmin(req, res) {
  if (!hasAdminConfig()) {
    res.status(503).json({
      ok: false,
      error: 'Falta configurar ADMIN_USER, ADMIN_PASSWORD y ADMIN_SESSION_SECRET en Vercel.'
    });
    return false;
  }

  if (!verifyAdmin(req)) {
    res.status(401).json({ ok: false, error: 'No autorizado.' });
    return false;
  }

  return true;
}
