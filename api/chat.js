import { authenticate, requireRole } from './_auth.js';

export const config = {
  maxDuration: 30
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // ログイン済みユーザーのみ利用可（無認証の代理利用＝課金悪用を防ぐ）
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  const user = await authenticate(req, SUPABASE_URL, SUPABASE_SERVICE_KEY);
  if (!requireRole(res, user, ['admin', 'party_admin', 'candidate'])) return;

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  // 入力サイズの上限（暴走・コスト対策）
  if (messages.length > 30) {
    return res.status(400).json({ error: 'Too many messages' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: typeof system === 'string' ? system : '',
        messages: messages
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'タイムアウトしました。もう一度お試しください。' });
    }
    return res.status(500).json({ error: error.message });
  }
}
