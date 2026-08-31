import { randomUUID } from 'crypto';
import { getSupabaseUrl, supabaseStorageFetch } from './_supabase.js';
import { RECEIPT_BUCKET, receiptExtension } from './_receipt.js';

function encodeStoragePath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}

export async function ensureReceiptBucket() {
  try {
    await supabaseStorageFetch(`bucket/${RECEIPT_BUCKET}`, { method: 'GET' });
  } catch (error) {
    if (Number(error.status) !== 404) throw error;
    try {
      await supabaseStorageFetch('bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: RECEIPT_BUCKET,
          name: RECEIPT_BUCKET,
          public: false,
          file_size_limit: 3145728,
          allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp']
        })
      });
    } catch (createError) {
      if (Number(createError.status) !== 409) throw createError;
    }
  }
}

export async function uploadReceipt(customerId, buffer, mimeType) {
  await ensureReceiptBucket();
  const date = new Date();
  const path = `${customerId}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${receiptExtension(mimeType)}`;
  await supabaseStorageFetch(`object/${RECEIPT_BUCKET}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=0',
      'x-upsert': 'false'
    },
    body: buffer
  });
  return path;
}

export async function deleteReceipt(path) {
  if (!path) return;
  await supabaseStorageFetch(`object/${RECEIPT_BUCKET}/${encodeStoragePath(path)}`, { method: 'DELETE' });
}

export async function createReceiptSignedUrl(path, expiresIn = 300) {
  const data = await supabaseStorageFetch(`object/sign/${RECEIPT_BUCKET}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn })
  });
  const signedPath = data?.signedURL || data?.signedUrl || '';
  if (!signedPath) throw new Error('No se pudo crear el acceso temporal al comprobante.');
  return signedPath.startsWith('http') ? signedPath : `${getSupabaseUrl()}/storage/v1${signedPath}`;
}
