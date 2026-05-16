export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(501).json({
    ok: false,
    error: 'La sincronizacion real de MikroTik debe hacerse desde el bridge local: node bridge/server.js'
  });
}
