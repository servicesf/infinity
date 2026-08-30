import { getVapidPublicKey, listPushSubscriptions, pushEnabled } from './_push.js';
import { requireAdmin } from './_adminAuth.js';
import { supabaseFetch } from './_supabase.js';

export async function handlePushSubscribe(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, enabled: pushEnabled(), publicKey: getVapidPublicKey() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido.' });

  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Suscripcion de notificaciones invalida.' });
  }
  if (!pushEnabled()) return res.status(503).json({ error: 'Falta configurar VAPID en Vercel.' });

  try {
    const existing = await listPushSubscriptions();
    if (!existing.some(row => row.payload?.subscription?.endpoint === subscription.endpoint)) {
      await supabaseFetch('payment_webhook_events', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'web-push-subscription',
          processed: true,
          payload: { subscription, active: true, createdAt: new Date().toISOString() }
        })
      });
    }
    return res.status(200).json({ ok: true, subscribed: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
