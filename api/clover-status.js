// Lightweight status check: does this business have a stored Clover connection?
// Returns { connected: bool, merchant_id?: string }. Never returns the tokens.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.replace('Bearer ', '');

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Invalid token' });

    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=business_id`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    const [profile] = await profileRes.json();
    const businessId = profile?.business_id;
    if (!businessId) return res.status(200).json({ connected: false });

    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clover_connections?business_id=eq.${businessId}&select=merchant_id,token_expires_at`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const [conn] = await connRes.json();
    if (!conn) return res.status(200).json({ connected: false });

    return res.status(200).json({
      connected: true,
      merchant_id: conn.merchant_id,
      token_expires_at: conn.token_expires_at || null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
