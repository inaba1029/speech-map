export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', 'https://speech-map-lime.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { auth_id, new_password } = req.body || {};
  if (!auth_id || !new_password) {
    return res.status(400).json({ error: 'auth_id and new_password are required' });
  }

  try {
    // service_roleキーはこのサーバー側だけで使用（ブラウザには一切出さない）
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ password: new_password })
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: 'Auth update failed', detail });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
