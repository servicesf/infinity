import { requireAdmin } from './_adminAuth.js';
import { addDaysWithHours, supabaseFetch } from './_supabase.js';

async function getCustomer(id) {
  const rows = await supabaseFetch(`customers?select=*&id=eq.${id}&limit=1`, {
    method: 'GET',
    prefer: ''
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function queueAction(customer, action, payload = {}) {
  await supabaseFetch('router_actions', {
    method: 'POST',
    body: JSON.stringify({
      router_id: customer.router_id,
      customer_id: customer.id,
      action,
      status: 'pending',
      payload: {
        pppoe: customer.pppoe_user,
        queue: customer.queue_name || customer.pppoe_user,
        ip: customer.ip_address,
        ...payload
      }
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });
  if (!requireAdmin(req, res)) return;

  try {
    const { customerId, action, days = 30, hours = 6, amount, note = '', dueAt, autoCutEnabled = true } = req.body || {};
    if (!customerId || !action) return res.status(400).json({ ok: false, error: 'Faltan datos.' });

    const customer = await getCustomer(customerId);
    if (!customer) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });

    if (action === 'recharge') {
      const baseDate = customer.paid_until && new Date(customer.paid_until) > new Date()
        ? customer.paid_until
        : new Date().toISOString();
      const paidUntil = addDaysWithHours(baseDate, Number(days), Number(hours));
      const rechargeAmount = Number(amount ?? customer.monthly_price ?? 0);

      const paymentRows = await supabaseFetch('payments', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customer.id,
          amount: rechargeAmount,
          method: action === 'recharge' ? 'manual' : 'dias-manual',
          reference: note || `${action} admin ${days}d ${hours}h`,
          status: 'confirmado',
          paid_at: new Date().toISOString(),
          service_days: Number(days),
          extra_hours: Number(hours)
        })
      });

      await supabaseFetch(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'activo',
          paid_until: paidUntil,
          updated_at: new Date().toISOString()
        })
      });

      await queueAction(customer, 'payment', {
        paid_until: paidUntil,
        payment_id: paymentRows?.[0]?.id || null,
        source: 'admin'
      });

      return res.status(200).json({ ok: true, paidUntil, queued: 'payment' });
    }

    if (action === 'schedule-cut') {
      const scheduledDate = new Date(dueAt || '');
      if (Number.isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ ok: false, error: 'Fecha de corte invalida.' });
      }

      await supabaseFetch(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: scheduledDate <= new Date() ? 'vencido' : 'activo',
          paid_until: scheduledDate.toISOString(),
          auto_cut_enabled: Boolean(autoCutEnabled),
          updated_at: new Date().toISOString()
        })
      });

      return res.status(200).json({
        ok: true,
        paidUntil: scheduledDate.toISOString(),
        queued: false
      });
    }

    if (action === 'cut') {
      await supabaseFetch(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cortado', updated_at: new Date().toISOString() })
      });
      await queueAction(customer, 'cut', { source: 'admin' });
      return res.status(200).json({ ok: true, queued: 'cut' });
    }

    if (action === 'enable') {
      await supabaseFetch(`customers?id=eq.${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'activo', updated_at: new Date().toISOString() })
      });
      await queueAction(customer, 'enable', { source: 'admin' });
      return res.status(200).json({ ok: true, queued: 'enable' });
    }

    return res.status(400).json({ ok: false, error: 'Accion invalida.' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
