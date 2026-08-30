const RECEIPT_BUCKET = 'payment-receipts';
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export { RECEIPT_BUCKET };

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parseReceiptDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('El comprobante debe ser una imagen JPG, PNG o WEBP.');
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error('Formato de imagen no permitido.');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw new Error('La imagen del comprobante esta vacia.');
  if (buffer.length > 3 * 1024 * 1024) throw new Error('La imagen supera el limite de 3 MB.');
  const signature = buffer.subarray(0, 12).toString('hex');
  const valid = mimeType === 'image/jpeg'
    ? signature.startsWith('ffd8ff')
    : mimeType === 'image/png'
      ? signature.startsWith('89504e470d0a1a0a')
      : signature.startsWith('52494646') && buffer.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('El contenido no coincide con el formato de imagen indicado.');
  return { buffer, mimeType };
}

export function receiptExtension(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export function parseAiJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('La IA no devolvio datos estructurados.');
  return JSON.parse(text.slice(first, last + 1));
}

function recipientMatches(actual, expected) {
  const actualTokens = new Set(normalizeText(actual).split(' ').filter(token => token.length > 2));
  const expectedTokens = normalizeText(expected).split(' ').filter(token => token.length > 2);
  if (!expectedTokens.length) return false;
  const matches = expectedTokens.filter(token => actualTokens.has(token));
  return matches.length >= Math.max(2, Math.ceil(expectedTokens.length * 0.75))
    && actualTokens.has('lorenzo')
    && actualTokens.has('flores');
}

function isRecentDate(value, now = new Date()) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return false;
  const ageMs = now.getTime() - date.getTime();
  return ageMs >= -24 * 60 * 60 * 1000 && ageMs <= 7 * 24 * 60 * 60 * 1000;
}

export function evaluateReceipt(analysis, expectedAmount, expectedRecipient, now = new Date()) {
  const amount = Number(analysis?.amount);
  const checks = {
    receipt: analysis?.isReceipt === true,
    amount: Number.isFinite(amount) && Math.abs(amount - Number(expectedAmount || 0)) <= 0.01,
    recipient: recipientMatches(analysis?.recipient, expectedRecipient),
    recentDate: isRecentDate(analysis?.transactionDate, now),
    successful: analysis?.successful === true,
    confidence: Number(analysis?.confidence || 0) >= 0.7
  };
  return {
    checks,
    eligible: Object.values(checks).every(Boolean),
    requiresAdminConfirmation: true
  };
}

export function publicReceipt(payment) {
  const payload = payment?.qr_payload || {};
  const analysis = payload.analysis || {};
  const evaluation = payload.evaluation || {};
  return {
    id: payment.id,
    amount: Number(payment.amount || 0),
    status: payment.status,
    createdAt: payment.created_at || payment.paid_at,
    method: payment.method,
    reference: payment.reference || analysis.reference || '',
    bank: analysis.bank || '',
    transactionDate: analysis.transactionDate || '',
    statusText: analysis.statusText || '',
    analysisStatus: payload.analysisStatus || 'pendiente',
    eligible: evaluation.eligible === true,
    checks: evaluation.checks || {},
    observations: analysis.observations || payload.analysisError || ''
  };
}
