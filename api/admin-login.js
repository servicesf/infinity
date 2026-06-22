import { createSessionCookie, hasAdminConfig } from './_adminAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  if (!hasAdminConfig()) {
    return res.status(503).json({
      ok: false,
      error: 'Falta configurar usuario administrador en Vercel.'
    });
  }

  const { username = '', password = '' } = req.body || {};
  const valid = username === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD;
  if (!valid) return res.status(401).json({ ok: false, error: 'Usuario o contrasena incorrectos.' });

  res.setHeader('Set-Cookie', createSessionCookie(username));
  return res.status(200).json({ ok: true });
}
