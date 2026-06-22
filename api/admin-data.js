import { requireAdmin } from './_adminAuth.js';
import { supabaseFetch } from './_supabase.js';

function normalizeCustomer(row, payments = []) {
  return {
    id: row.id,
    nombre: row.full_name,
    ci: row.ci,
    telefono: row.phone || '',
    sector: row.sector,
    plan: row.plan_name,
    precio: Number(row.monthly_price || 0),
    pppoe: row.pppoe_user || '',
    queue: row.queue_name || '',
    ip: row.ip_address || '',
    estado: row.status,
    dueAt: row.paid_until,
    pagadoHasta: row.paid_until ? String(row.paid_until).slice(0, 10) : '',
    autoCutEnabled: row.auto_cut_enabled,
    routerId: row.router_id,
    router: row.routers ? {
      name: row.routers.name,
      code: row.routers.code,
      kind: row.routers.kind
    } : null,
    historial: payments.map(payment => ({
      id: payment.id,
      fecha: payment.paid_at,
      tipo: payment.method,
      monto: Number(payment.amount || 0),
      metodo: payment.method,
      estado: payment.status,
      nota: payment.reference || ''
    }))
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo no permitido' });
  if (!requireAdmin(req, res)) return;

  try {
    const customers = await supabaseFetch(
      'customers?select=*,routers(name,code,kind)&order=full_name.asc',
      { method: 'GET', prefer: '' }
    );
    const payments = await supabaseFetch(
      'payments?select=*&order=paid_at.desc&limit=500',
      { method: 'GET', prefer: '' }
    );

    const paymentsByCustomer = new Map();
    for (const payment of payments || []) {
      const list = paymentsByCustomer.get(payment.customer_id) || [];
      if (list.length < 3) list.push(payment);
      paymentsByCustomer.set(payment.customer_id, list);
    }

    return res.status(200).json({
      ok: true,
      clients: (customers || []).map(row => normalizeCustomer(row, paymentsByCustomer.get(row.id) || [])),
      payments: payments || []
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
