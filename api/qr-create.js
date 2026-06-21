import { hasSupabaseConfig, supabaseFetch } from './_supabase.js';

const QR_API_URL = process.env.QR_API_URL;
const QR_API_TOKEN = process.env.QR_API_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://infinity-black-rho.vercel.app';

async function createQrWithProvider({ customer, amount, paymentId }) {
  if (!QR_API_URL || !QR_API_TOKEN) {
    return {
      mode: 'pending_config',
      paymentId,
      message: 'Falta configurar QR_API_URL y QR_API_TOKEN.',
      qrImage: null,
      qrText: null
    };
  }

  const response = await fetch(QR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QR_API_TOKEN}`
    },
    body: JSON.stringify({
      amount,
      currency: 'BOB',
      reference: paymentId,
      customer: {
        name: customer.full_name,
        ci: customer.ci,
        phone: customer.phone
      },
      callback_url: `${PUBLIC_BASE_URL}/api/qr-webhook`
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error || 'No se pudo generar el QR.');
  }

  return {
    mode: 'provider',
    paymentId,
    providerResponse: data,
    qrImage: data.qrImage || data.qr_image || data.image || data.qr || null,
    qrText: data.qrText || data.qr_text || data.payload || null,
    expiresAt: data.expiresAt || data.expires_at || null
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  if (!hasSupabaseConfig()) {
    return res.status(503).json({ error: 'Falta conectar Supabase antes de generar QR real.' });
  }

  try {
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Falta customerId.' });

    const customers = await supabaseFetch(`customers?select=*&id=eq.${customerId}&limit=1`, {
      method: 'GET',
      prefer: ''
    });
    const customer = Array.isArray(customers) ? customers[0] : null;
    if (!customer) return res.status(404).json({ error: 'Cliente no encontrado.' });

    const amount = Number(customer.monthly_price || 0);
    if (!amount) return res.status(400).json({ error: 'El cliente no tiene mensualidad configurada.' });

    const payments = await supabaseFetch('payments', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customer.id,
        amount,
        method: 'QR API',
        status: 'pendiente',
        service_days: 30,
        extra_hours: 12
      })
    });
    const payment = Array.isArray(payments) ? payments[0] : payments;

    const qr = await createQrWithProvider({ customer, amount, paymentId: payment.id });

    await supabaseFetch(`payments?id=eq.${payment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        reference: qr.providerResponse?.reference || qr.providerResponse?.id || payment.id,
        qr_payload: qr
      })
    });

    return res.status(200).json({
      ok: true,
      paymentId: payment.id,
      amount,
      customerName: customer.full_name,
      qr
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
