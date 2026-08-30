import crypto from 'crypto';
import { evaluateReceipt, parseAiJson, parseReceiptDataUrl, publicReceipt } from './_receipt.js';
import { deleteReceipt, uploadReceipt } from './_receiptStorage.js';
import { sendReceiptNotification } from './_push.js';
import { hasSupabaseConfig, supabaseFetch } from './_supabase.js';

export const config = { maxDuration: 60 };

const EXPECTED_RECIPIENT = process.env.RECEIPT_EXPECTED_RECIPIENT || 'Lorenzo Martir Flores Alaya';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function analyzeReceipt(dataUrl, expectedAmount) {
  if (!process.env.GROQ_API_KEY) throw new Error('Analisis automatico no configurado.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analiza esta imagen como comprobante bancario boliviano. No inventes datos ilegibles. Devuelve UNICAMENTE JSON con esta forma exacta: {"isReceipt":boolean,"bank":string,"recipient":string,"amount":number|null,"transactionDate":string,"reference":string,"statusText":string,"successful":boolean,"confidence":number,"observations":string}. transactionDate debe ser ISO 8601 si aparece fecha y hora. successful solo puede ser true si la imagen muestra claramente una operacion exitosa/completada. El monto esperado es Bs. ${Number(expectedAmount || 0).toFixed(2)} y el destinatario esperado es ${EXPECTED_RECIPIENT}, pero transcribe lo que realmente ves.`
            },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }]
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Error de analisis ${response.status}`);
    return parseAiJson(data?.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timeout);
  }
}

async function logDecision(paymentId, provider, payload, processed = true, error = null) {
  await supabaseFetch('payment_webhook_events', {
    method: 'POST',
    body: JSON.stringify({ payment_id: paymentId, provider, payload, processed, error })
  }).catch(() => {});
}

export async function handlePaymentReceipt(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido.' });
  if (!hasSupabaseConfig()) return res.status(503).json({ error: 'El portal de pagos no esta configurado.' });

  let storagePath = '';
  let paymentId = '';
  try {
    const { customerId, ci, receiptDataUrl, method = 'QR bancario', declaredReference = '' } = req.body || {};
    const cleanCi = String(ci || '').trim();
    if (!isUuid(customerId) || !cleanCi || !receiptDataUrl) {
      return res.status(400).json({ error: 'Faltan los datos del cliente o el comprobante.' });
    }
    if (/^SIN-CI-/i.test(cleanCi)) return res.status(400).json({ error: 'Primero registra tu carnet real con Infinit.' });

    const customers = await supabaseFetch(
      `customers?select=*&id=eq.${customerId}&ci=eq.${encodeURIComponent(cleanCi)}&limit=1`,
      { method: 'GET', prefer: '' }
    );
    const customer = Array.isArray(customers) ? customers[0] : null;
    if (!customer) return res.status(404).json({ error: 'Cliente o carnet no encontrado.' });

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recentCustomerPayments = await supabaseFetch(
      `payments?select=id,qr_payload,created_at&customer_id=eq.${customer.id}&created_at=gte.${encodeURIComponent(tenMinutesAgo)}&order=created_at.desc&limit=20`,
      { method: 'GET', prefer: '' }
    );
    if ((recentCustomerPayments || []).filter(payment => payment.qr_payload?.source === 'customer-receipt').length >= 3) {
      return res.status(429).json({ error: 'Ya enviaste varios comprobantes. Espera 10 minutos antes de intentar otra vez.' });
    }

    const { buffer, mimeType } = parseReceiptDataUrl(receiptDataUrl);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const recent = await supabaseFetch(
      'payments?select=id,status,qr_payload&method=eq.comprobante&order=created_at.desc&limit=200',
      { method: 'GET', prefer: '' }
    );
    const duplicate = (recent || []).find(payment => payment.qr_payload?.sha256 === sha256);
    if (duplicate) {
      return res.status(409).json({ error: 'Este comprobante ya fue enviado anteriormente.', paymentId: duplicate.id });
    }

    storagePath = await uploadReceipt(customer.id, buffer, mimeType);
    const now = new Date().toISOString();
    const payload = {
      source: 'customer-receipt',
      storagePath,
      mimeType,
      sha256,
      uploadedAt: now,
      declaredMethod: String(method || '').slice(0, 60),
      declaredReference: String(declaredReference || '').trim().slice(0, 100),
      expectedAmount: Number(customer.monthly_price || 0),
      expectedRecipient: EXPECTED_RECIPIENT,
      analysisStatus: 'procesando'
    };
    const rows = await supabaseFetch('payments', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customer.id,
        amount: Number(customer.monthly_price || 0),
        method: 'comprobante',
        reference: payload.declaredReference || null,
        status: 'pendiente',
        paid_at: now,
        service_days: 30,
        extra_hours: 3,
        qr_payload: payload
      })
    });
    const payment = rows?.[0];
    if (!payment?.id) throw new Error('No se pudo registrar el pago pendiente.');
    paymentId = payment.id;
    await logDecision(payment.id, 'receipt-upload', {
      customerId: customer.id,
      amount: Number(customer.monthly_price || 0),
      storagePath,
      sha256
    });

    let analysis = null;
    let evaluation = null;
    let analysisError = '';
    try {
      analysis = await analyzeReceipt(receiptDataUrl, customer.monthly_price);
      evaluation = evaluateReceipt(analysis, customer.monthly_price, EXPECTED_RECIPIENT);
    } catch (error) {
      analysisError = error.name === 'AbortError' ? 'El analisis automatico tardo demasiado.' : error.message;
    }

    const finalPayload = {
      ...payload,
      analysisStatus: analysis ? 'completado' : 'no_disponible',
      analysis,
      evaluation,
      analysisError,
      analyzedAt: new Date().toISOString()
    };
    const updatedRows = await supabaseFetch(`payments?id=eq.${payment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        reference: analysis?.reference || payload.declaredReference || null,
        qr_payload: finalPayload
      })
    });
    await logDecision(payment.id, 'receipt-ai-analysis', {
      analysisStatus: finalPayload.analysisStatus,
      analysis,
      evaluation
    }, Boolean(analysis), analysisError || null);
    await sendReceiptNotification(customer.monthly_price).catch(() => {});

    return res.status(201).json({
      ok: true,
      message: evaluation?.eligible
        ? 'Comprobante recibido y listo para revision del administrador.'
        : 'Comprobante recibido. El administrador revisara las observaciones.',
      receipt: publicReceipt(updatedRows?.[0] || { ...payment, qr_payload: finalPayload }),
      customerName: customer.full_name,
      customerCi: customer.ci
    });
  } catch (error) {
    if (!paymentId && storagePath) await deleteReceipt(storagePath).catch(() => {});
    if (paymentId) await logDecision(paymentId, 'receipt-processing-error', {}, false, error.message);
    return res.status(500).json({ error: 'No se pudo procesar el comprobante. Intenta nuevamente.' });
  }
}
