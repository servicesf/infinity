import { requireAdmin } from './_adminAuth.js';
import { supabaseFetch } from './_supabase.js';

function payloadToRow(payload) {
  const row = {
    full_name: payload.nombre,
    ci: payload.ci,
    phone: payload.telefono || null,
    sector: payload.sector || 'fibra',
    plan_name: payload.plan,
    monthly_price: Number(payload.precio || 0),
    pppoe_user: payload.pppoe || null,
    queue_name: payload.queue || null,
    ip_address: payload.ip || null,
    status: payload.estado || 'activo',
    paid_until: payload.dueAt || payload.pagadoHasta || null,
    auto_cut_enabled: payload.autoCutEnabled !== false,
    updated_at: new Date().toISOString()
  };

  if (payload.routerId) row.router_id = payload.routerId;
  return row;
}

export default async function handler(req, res) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Metodo no permitido' });
  if (!requireAdmin(req, res)) return;

  try {
    const payload = req.body || {};

    if (req.method === 'PATCH' && payload.action === 'update-ci') {
      const id = String(payload.id || '').trim();
      const ci = String(payload.ci || '').trim();
      const nombre = String(payload.nombre || '').trim().replace(/\s+/g, ' ');

      if (!id) return res.status(400).json({ ok: false, error: 'Falta el cliente.' });
      if (nombre && (nombre.length < 3 || nombre.length > 100)) {
        return res.status(400).json({ ok: false, error: 'El nombre debe tener entre 3 y 100 caracteres.' });
      }
      if (ci.length < 3 || ci.length > 30) {
        return res.status(400).json({ ok: false, error: 'El carnet debe tener entre 3 y 30 caracteres.' });
      }
      if (/^SIN-CI-/i.test(ci) || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ci)) {
        return res.status(400).json({ ok: false, error: 'Ingresa el carnet real del cliente.' });
      }

      const currentRows = await supabaseFetch(
        `customers?select=id,full_name,ci&id=eq.${encodeURIComponent(id)}&limit=1`,
        { method: 'GET', prefer: '' }
      );
      const current = Array.isArray(currentRows) ? currentRows[0] : null;
      if (!current) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });

      const duplicateRows = await supabaseFetch(
        `customers?select=id,full_name&ci=eq.${encodeURIComponent(ci)}&id=neq.${encodeURIComponent(id)}&limit=1`,
        { method: 'GET', prefer: '' }
      );
      if (Array.isArray(duplicateRows) && duplicateRows.length) {
        return res.status(409).json({ ok: false, error: 'Ese carnet ya pertenece a otro cliente.' });
      }

      const rows = await supabaseFetch(`customers?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ full_name: nombre || current.full_name, ci, updated_at: new Date().toISOString() })
      });

      return res.status(200).json({
        ok: true,
        customer: rows?.[0] || null,
        routerChanged: false
      });
    }

    if (req.method === 'DELETE') {
      if (!payload.id) return res.status(400).json({ ok: false, error: 'Falta ID de cliente.' });

      const rows = await supabaseFetch(`customers?select=id,full_name,pppoe_user,router_id&id=eq.${payload.id}&limit=1`, {
        method: 'GET',
        prefer: ''
      });
      const customer = Array.isArray(rows) ? rows[0] : null;
      if (!customer) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });

      await supabaseFetch(`customers?id=eq.${payload.id}`, {
        method: 'DELETE',
        prefer: 'return=minimal'
      });
      return res.status(200).json({ ok: true, deleted: customer });
    }

    const row = payloadToRow(payload);

    if (!row.full_name || !row.ci || !row.plan_name) {
      return res.status(400).json({ ok: false, error: 'Faltan datos del cliente.' });
    }

    if (req.method === 'PATCH') {
      if (!payload.id) return res.status(400).json({ ok: false, error: 'Falta ID de cliente.' });
      const data = await supabaseFetch(`customers?id=eq.${payload.id}`, {
        method: 'PATCH',
        body: JSON.stringify(row)
      });
      return res.status(200).json({ ok: true, customer: data?.[0] || null });
    }

    const data = await supabaseFetch('customers', {
      method: 'POST',
      body: JSON.stringify(row)
    });
    return res.status(200).json({ ok: true, customer: data?.[0] || null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
