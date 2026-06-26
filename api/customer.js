import { hasSupabaseConfig, supabaseFetch } from './_supabase.js';

function normalizeCustomer(row, payments = []) {
  const isCut = row.status === 'cortado';
  return {
    id: row.id,
    nombre: row.full_name,
    ci: row.ci,
    telefono: row.phone,
    sector: row.sector,
    plan: row.plan_name,
    precio: Number(row.monthly_price || 0),
    estado: row.status,
    pagadoHasta: isCut ? '' : row.paid_until,
    autoCorte: row.auto_cut_enabled,
    pppoe: row.pppoe_user,
    ultimosPagos: payments.map(payment => ({
      id: payment.id,
      fecha: payment.paid_at,
      monto: Number(payment.amount || 0),
      metodo: payment.method,
      estado: payment.status,
      referencia: payment.reference
    }))
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo no permitido' });

  const ci = String(req.query.ci || '').trim();
  const phone = String(req.query.phone || '').trim();

  if (!ci && !phone) {
    return res.status(400).json({ error: 'Ingresa carnet o telefono.' });
  }

  if (!hasSupabaseConfig()) {
    return res.status(503).json({
      error: 'Portal en preparacion. Falta conectar Supabase en variables de entorno.'
    });
  }

  try {
    const filter = ci
      ? `ci=eq.${encodeURIComponent(ci)}`
      : `phone=eq.${encodeURIComponent(phone)}`;
    const customers = await supabaseFetch(`customers?select=*&${filter}&limit=1`, {
      method: 'GET',
      prefer: ''
    });

    const customer = Array.isArray(customers) ? customers[0] : null;
    if (!customer) return res.status(404).json({ error: 'Cliente no encontrado.' });

    const payments = await supabaseFetch(
      `payments?select=*&customer_id=eq.${customer.id}&order=paid_at.desc&limit=3`,
      { method: 'GET', prefer: '' }
    );

    return res.status(200).json({ ok: true, customer: normalizeCustomer(customer, payments || []) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
