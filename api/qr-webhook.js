import { addDaysWithHours, hasSupabaseConfig, supabaseFetch } from './_supabase.js';

const WEBHOOK_SECRET = process.env.QR_WEBHOOK_SECRET;

function isConfirmed(payload) {
  const value = String(payload.status || payload.estado || payload.payment_status || '').toLowerCase();
  return ['confirmado', 'confirmed', 'paid', 'pagado', 'success', 'successful'].includes(value);
}

function getPaymentId(payload) {
  return payload.paymentId || payload.payment_id || payload.reference || payload.referencia || payload.id;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Webhook-Secret');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Webhook no autorizado.' });
  }

  if (!hasSupabaseConfig()) {
    return res.status(503).json({ error: 'Falta conectar Supabase.' });
  }

  try {
    const payload = req.body || {};
    const paymentId = getPaymentId(payload);
    if (!paymentId) return res.status(400).json({ error: 'Falta referencia de pago.' });

    const payments = await supabaseFetch(`payments?select=*,customers(*)&id=eq.${paymentId}&limit=1`, {
      method: 'GET',
      prefer: ''
    });
    const payment = Array.isArray(payments) ? payments[0] : null;
    if (!payment) return res.status(404).json({ error: 'Pago no encontrado.' });

    await supabaseFetch('payment_webhook_events', {
      method: 'POST',
      body: JSON.stringify({
        payment_id: payment.id,
        provider: 'qr-api',
        payload,
        processed: false
      })
    });

    if (!isConfirmed(payload)) {
      await supabaseFetch(`payments?id=eq.${payment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ qr_payload: payload })
      });
      return res.status(200).json({ ok: true, ignored: true, reason: 'Pago aun no confirmado.' });
    }

    if (payment.status === 'confirmado') {
      return res.status(200).json({ ok: true, alreadyConfirmed: true });
    }

    const customer = payment.customers;
    const baseDate = customer?.paid_until && new Date(customer.paid_until) > new Date()
      ? customer.paid_until
      : new Date().toISOString();
    const serviceDays = payment.service_days ?? 30;
    const extraHours = payment.extra_hours ?? 3;
    const paidUntil = addDaysWithHours(baseDate, serviceDays, extraHours);

    await supabaseFetch(`payments?id=eq.${payment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'confirmado',
        paid_at: new Date().toISOString(),
        qr_payload: payload
      })
    });

    await supabaseFetch(`customers?id=eq.${payment.customer_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'activo',
        paid_until: paidUntil,
        updated_at: new Date().toISOString()
      })
    });

    await supabaseFetch('router_actions', {
      method: 'POST',
      body: JSON.stringify({
        router_id: customer?.router_id || null,
        customer_id: payment.customer_id,
        action: 'payment',
        status: 'pending',
        payload: {
          pppoe: customer?.pppoe_user || null,
          queue: customer?.queue_name || customer?.pppoe_user || null,
          ip: customer?.ip_address || null,
          payment_id: payment.id,
          paid_until: paidUntil,
          amount: payment.amount,
          source: 'qr-webhook'
        }
      })
    });

    await supabaseFetch(`payment_webhook_events?payment_id=eq.${payment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ processed: true })
    });

    return res.status(200).json({
      ok: true,
      customerId: payment.customer_id,
      paidUntil,
      action: 'queued'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
