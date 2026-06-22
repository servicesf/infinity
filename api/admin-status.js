import { hasAdminConfig, verifyAdmin } from './_adminAuth.js';
import { hasSupabaseConfig } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo no permitido' });

  return res.status(200).json({
    ok: true,
    configured: hasAdminConfig(),
    supabase: hasSupabaseConfig(),
    authenticated: verifyAdmin(req)
  });
}
