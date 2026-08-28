import { requireAdmin } from './_adminAuth.js';
import { supabaseFetch } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Metodo no permitido' });
  if (!requireAdmin(req, res)) return;

  try {
    const id = String(req.body?.id || '').trim();
    const ci = String(req.body?.ci || '').trim();

    if (!id) return res.status(400).json({ ok: false, error: 'Falta el cliente.' });
    if (ci.length < 3 || ci.length > 30) {
      return res.status(400).json({ ok: false, error: 'El carnet debe tener entre 3 y 30 caracteres.' });
    }
    if (/^SIN-CI-/i.test(ci)) {
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
      body: JSON.stringify({ ci, updated_at: new Date().toISOString() })
    });

    return res.status(200).json({
      ok: true,
      customer: rows?.[0] || null,
      routerChanged: false
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
