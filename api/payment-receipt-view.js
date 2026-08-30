import { publicReceipt } from './_receipt.js';
import { createReceiptSignedUrl } from './_receiptStorage.js';
import { supabaseFetch } from './_supabase.js';

function isUuid(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || ''));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo no permitido.' });
  const id = String(req.query.id || '');
  const ci = String(req.query.ci || '').trim();
  if (!isUuid(id) || !ci) return res.status(400).json({ error: 'Faltan datos.' });

  try {
    const rows = await supabaseFetch(
      `payments?select=*,customers!inner(ci)&id=eq.${id}&customers.ci=eq.${encodeURIComponent(ci)}&limit=1`,
      { method: 'GET', prefer: '' }
    );
    const payment = rows?.[0];
    if (!payment || payment.qr_payload?.source !== 'customer-receipt') {
      return res.status(404).json({ error: 'Comprobante no encontrado.' });
    }
    const imageUrl = await createReceiptSignedUrl(payment.qr_payload.storagePath, 180);
    return res.status(200).json({ ok: true, imageUrl, receipt: publicReceipt(payment) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
