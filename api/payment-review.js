import { requireAdmin } from './_adminAuth.js';
import { createReceiptSignedUrl } from './_receiptStorage.js';
import { addDaysWithHours, supabaseFetch } from './_supabase.js';

function isUuid(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || ''));
}

async function getPayment(id) {
  const rows = await supabaseFetch(`payments?select=*,customers(*)&id=eq.${id}&limit=1`, {
    method: 'GET',
    prefer: ''
  });
  return rows?.[0] || null;
}

async function logReview(paymentId, payload, processed = true, error = null) {
  await supabaseFetch('payment_webhook_events', {
    method: 'POST',
    body: JSON.stringify({ payment_id: paymentId, provider: 'receipt-admin-review', payload, processed, error })
  }).catch(() => {});
}

async function queuePaymentOnce(customer, paymentId, paidUntil) {
  const actions = await supabaseFetch(
    `router_actions?select=id,payload&customer_id=eq.${customer.id}&action=eq.payment&order=created_at.desc&limit=100`,
    { method: 'GET', prefer: '' }
  );
  if ((actions || []).some(action => action.payload?.payment_id === paymentId)) return false;
  await supabaseFetch('router_actions', {
    method: 'POST',
    body: JSON.stringify({
      router_id: customer.router_id,
      customer_id: customer.id,
      action: 'payment',
      status: 'pending',
      payload: {
        pppoe: customer.pppoe_user,
        queue: customer.queue_name || customer.pppoe_user,
        ip: customer.ip_address,
        paid_until: paidUntil,
        payment_id: paymentId,
        source: 'admin-receipt'
      }
    })
  });
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAdmin(req, res)) return;

  const id = String(req.method === 'GET' ? req.query.id : req.body?.id || '');
  if (!isUuid(id)) return res.status(400).json({ error: 'Comprobante invalido.' });

  try {
    let payment = await getPayment(id);
    if (!payment || payment.qr_payload?.source !== 'customer-receipt') {
      return res.status(404).json({ error: 'Comprobante no encontrado.' });
    }
    if (req.method === 'GET') {
      const imageUrl = await createReceiptSignedUrl(payment.qr_payload.storagePath, 300);
      return res.status(200).json({ ok: true, payment, customer: payment.customers, imageUrl });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido.' });

    const decision = String(req.body?.decision || '');
    const note = String(req.body?.note || '').trim().slice(0, 300);
    if (!['confirm', 'reject'].includes(decision)) return res.status(400).json({ error: 'Decision invalida.' });
    const customer = payment.customers;
    if (!customer) return res.status(404).json({ error: 'Cliente no encontrado.' });

    if (decision === 'reject') {
      if (payment.status === 'confirmado') return res.status(409).json({ error: 'Este pago ya fue confirmado.' });
      const reviewedAt = new Date().toISOString();
      const qrPayload = {
        ...payment.qr_payload,
        review: { decision: 'rechazado', state: 'completed', reviewedAt, note }
      };
      await supabaseFetch(`payments?id=eq.${payment.id}&status=eq.pendiente`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rechazado', qr_payload: qrPayload })
      });
      await logReview(payment.id, { decision: 'rechazado', reviewedAt, note });
      return res.status(200).json({ ok: true, status: 'rechazado' });
    }

    if (payment.status === 'rechazado') return res.status(409).json({ error: 'Este pago fue rechazado.' });
    const previousReview = payment.qr_payload?.review || {};
    if (payment.status === 'confirmado' && previousReview.state === 'completed') {
      return res.status(200).json({ ok: true, status: 'confirmado', paidUntil: previousReview.paidUntil, alreadyProcessed: true });
    }

    let paidUntil = previousReview.paidUntil;
    if (!paidUntil) {
      const baseDate = customer.paid_until && new Date(customer.paid_until) > new Date()
        ? customer.paid_until
        : new Date().toISOString();
      paidUntil = addDaysWithHours(baseDate, 30, 3);
    }
    const reviewedAt = new Date().toISOString();
    const processingPayload = {
      ...payment.qr_payload,
      review: { decision: 'confirmado', state: 'processing', reviewedAt, paidUntil, note }
    };
    if (payment.status === 'pendiente') {
      const claimed = await supabaseFetch(`payments?id=eq.${payment.id}&status=eq.pendiente`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'confirmado', paid_at: reviewedAt, qr_payload: processingPayload })
      });
      if (!claimed?.length) payment = await getPayment(id);
      else payment = claimed[0];
    }

    const stablePaidUntil = payment.qr_payload?.review?.paidUntil || paidUntil;
    await supabaseFetch(`customers?id=eq.${customer.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'activo', paid_until: stablePaidUntil, updated_at: reviewedAt })
    });
    const queued = await queuePaymentOnce(customer, payment.id, stablePaidUntil);
    const completedPayload = {
      ...processingPayload,
      review: { ...processingPayload.review, state: 'completed', paidUntil: stablePaidUntil, completedAt: new Date().toISOString() }
    };
    await supabaseFetch(`payments?id=eq.${payment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmado', paid_at: reviewedAt, qr_payload: completedPayload })
    });
    await logReview(payment.id, {
      decision: 'confirmado',
      reviewedAt,
      paidUntil: stablePaidUntil,
      queued,
      serviceDays: 30,
      extraHours: 3,
      note
    });
    return res.status(200).json({ ok: true, status: 'confirmado', paidUntil: stablePaidUntil, queued });
  } catch (error) {
    await logReview(id, { decision: req.body?.decision || 'unknown' }, false, error.message);
    return res.status(500).json({ error: error.message });
  }
}
