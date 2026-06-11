import { authenticate } from './_auth.js';

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', 'https://speech-map-lime.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // 認証：呼び出し元はログイン済みの管理者でなければならない
  const caller = await authenticate(req, SUPABASE_URL, SUPABASE_SERVICE_KEY);
  if (!caller) return res.status(401).json({ error: 'Unauthorized' });
  if (caller.role !== 'admin' && caller.role !== 'party_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { auth_id, new_password } = req.body || {};
  if (!auth_id || !new_password) {
    return res.status(400).json({ error: 'auth_id and new_password are required' });
  }
  if (typeof new_password !== 'string' || new_password.length < 6) {
    return res.status(400).json({ error: 'new_password must be at least 6 characters' });
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`
  };

  try {
    // 対象アカウントをDBで特定し、権限の範囲内かを確認
    const tq = `${SUPABASE_URL}/rest/v1/users?select=id,role,party&auth_id=eq.${encodeURIComponent(auth_id)}`;
    const tr = await fetch(tq, { headers: sbHeaders });
    const trows = tr.ok ? await tr.json() : [];
    const target = Array.isArray(trows) ? trows[0] : null;
    if (!target) return res.status(404).json({ error: 'Target user not found' });

    // 政党管理者は自分の政党のメンバーのみリセット可。総合管理者は他の管理者をリセット不可。
    if (caller.role === 'party_admin') {
      if (target.role === 'admin' || target.party !== caller.party) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // service_roleキーはこのサーバー側だけで使用（ブラウザには一切出さない）
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ password: new_password })
    });

    if (!r.ok) {
      // 内部エラー詳細はクライアントに返さない（情報漏えい防止）
      return res.status(502).json({ error: 'Auth update failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Internal error' });
  }
}
