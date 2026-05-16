const allowedActions = new Set(['cut', 'enable', 'payment']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  const payload = req.body || {};

  if (!allowedActions.has(payload.action)) {
    return res.status(400).json({ error: 'Accion invalida' });
  }

  /*
    Este endpoint queda como puente seguro para MikroTik.

    Recomendado para produccion:
    1. Vercel recibe la accion del panel.
    2. Guarda la accion en Firestore/Supabase con estado "pendiente".
    3. Un bridge dentro de tu red lee esa accion.
    4. El bridge ejecuta en MikroTik:
       - cut: disable PPP secret, remove PPP active, disable queue
       - enable: enable PPP secret, enable queue
       - payment: registrar pago y activar si corresponde

    Asi no expones el MikroTik directo a internet.
  */

  return res.status(200).json({
    ok: true,
    mode: 'queued',
    message: 'Accion recibida. Falta conectar el bridge real hacia MikroTik.',
    action: payload.action,
    clientId: payload.clientId
  });
}
