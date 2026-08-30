import webpush from 'web-push';
import crypto from 'crypto';
import { supabaseFetch } from './_supabase.js';

const PROVIDER = 'web-push-subscription';

function derivedVapidKeys() {
  if (!process.env.ADMIN_SESSION_SECRET) return null;
  const ecdh = crypto.createECDH('prime256v1');
  let attempt = 0;
  while (attempt < 4) {
    const privateKey = crypto.createHash('sha256')
      .update(`infinit-vapid-v1:${attempt}:${process.env.ADMIN_SESSION_SECRET}`)
      .digest();
    try {
      ecdh.setPrivateKey(privateKey);
      return {
        privateKey: privateKey.toString('base64url'),
        publicKey: ecdh.getPublicKey(null, 'uncompressed').toString('base64url')
      };
    } catch {
      attempt += 1;
    }
  }
  return null;
}

function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  return derivedVapidKeys();
}

export function pushEnabled() {
  return Boolean(vapidKeys());
}

export function getVapidPublicKey() {
  return vapidKeys()?.publicKey || '';
}

function configureWebPush() {
  const keys = vapidKeys();
  if (!keys) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@infinit.bo',
    keys.publicKey,
    keys.privateKey
  );
  return true;
}

export async function listPushSubscriptions() {
  const rows = await supabaseFetch(
    `payment_webhook_events?select=id,payload,created_at&provider=eq.${PROVIDER}&order=created_at.desc&limit=200`,
    { method: 'GET', prefer: '' }
  );
  const seen = new Set();
  return (rows || []).filter(row => {
    const endpoint = row.payload?.subscription?.endpoint;
    if (!endpoint || row.payload?.active === false || seen.has(endpoint)) return false;
    seen.add(endpoint);
    return true;
  });
}

export async function sendReceiptNotification(amount) {
  if (!configureWebPush()) return { enabled: false, sent: 0 };
  const rows = await listPushSubscriptions();
  let sent = 0;
  await Promise.all(rows.map(async row => {
    try {
      await webpush.sendNotification(row.payload.subscription, JSON.stringify({
        title: 'Nuevo comprobante pendiente',
        body: `Pago reportado por Bs. ${Number(amount || 0).toFixed(0)}. Abre el panel para revisarlo.`,
        url: '/admin.html#receiptInbox'
      }), { TTL: 3600, urgency: 'high' });
      sent += 1;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await supabaseFetch(`payment_webhook_events?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ payload: { ...row.payload, active: false, disabledAt: new Date().toISOString() } })
        }).catch(() => {});
      }
    }
  }));
  return { enabled: true, sent };
}
