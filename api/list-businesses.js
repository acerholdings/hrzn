export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Token can come from the Authorization header (GET) or the body (POST) — accept both.
  const authHeader = req.headers.authorization || '';
  const headerToken = authHeader.replace('Bearer ', '').trim();
  const token = headerToken || req.body?.token;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    // Resolve the user from their token.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Invalid token' });

    // The active business is whatever profiles.business_id currently points at.
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=business_id`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const [profile] = await profileRes.json();
    const activeBusinessId = profile?.business_id || null;

    // All businesses this user owns. Ownership is enforced by owner_id — a user only
    // ever sees their own businesses. Ordered oldest-first so the list is stable.
    const bizRes = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${user.id}&select=id,name,location,business_type,pos_system&order=created_at.asc`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const businesses = await bizRes.json().catch(() => []);
    const list = Array.isArray(businesses) ? businesses : [];

    return res.status(200).json({
      ok: true,
      activeBusinessId,
      count: list.length,
      businesses: list
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
