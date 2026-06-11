// 共通認証ヘルパー（_接頭辞のためVercelの公開ルートにはならない）
// クライアントが送る Supabase Auth のアクセストークン(JWT)を検証し、
// DB上のロールを「正」として返す。ロール判定はクライアントを信用しない。

export async function authenticate(req, url, serviceKey) {
  const authz = req.headers.authorization || req.headers.Authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!token) return null;

  // 1) トークンの正当性を Supabase Auth に問い合わせて確認
  let authUser;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return null;
    authUser = await r.json();
  } catch {
    return null;
  }
  if (!authUser || !authUser.id) return null;

  // 2) auth_id から usersテーブルのロール等を取得（DBを正とする）
  try {
    const q = `${url}/rest/v1/users?select=id,role,party,active&auth_id=eq.${encodeURIComponent(authUser.id)}`;
    const ur = await fetch(q, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!ur.ok) return null;
    const rows = await ur.json();
    const dbUser = Array.isArray(rows) ? rows[0] : null;
    if (!dbUser || dbUser.active === false) return null;
    return { authId: authUser.id, id: dbUser.id, role: dbUser.role, party: dbUser.party };
  } catch {
    return null;
  }
}

// 指定ロールのいずれかを要求する。満たさなければ res にエラーを書いて false を返す。
export function requireRole(res, user, roles) {
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (roles && roles.length && !roles.includes(user.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}
