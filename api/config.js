export default function handler(req, res) {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', 'https://speech-map-lime.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 環境変数からキーを返す
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    return res.status(500).json({ error: 'Environment variables not configured' });
  }

  res.status(200).json({ url, key });
}
