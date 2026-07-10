export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const authHeader = req.headers.authorization || '';
  const headerToken = authHeader.replace('Bearer ', '').trim();
  const token = headerToken || req.body?.token;
  const businessId = req.body?.businessId;
  if (!token) return res.status(401).json({ error: 'No token' });
  if (!businessId) return res.status(400).json({ error: 'Missing businessId' });

  try {
    // Resolve the user from their token.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Invalid token' });

    // OWNERSHIP VALIDATION (security-critical). Only switch to a business this user
    // actually owns. Filtering by BOTH id and owner_id means a row only comes back
    // if it exists AND belongs to this user — a user can never point their active
    // business at someone else's data.
    const ownRes = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&owner_id=eq.${user.id}&select=id,name`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const ownRows = await ownRes.json().catch(() => []);
    if (!Array.isArray(ownRows) || ownRows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to that business.', code: 'not_owner' });
    }

    // Point the profile's active business at the chosen one.
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY
        },
        body: JSON.stringify({ business_id: businessId })
      }
    );
    if (!patchRes.ok) {
      const detail = await patchRes.text().catch(() => '');
      return res.status(502).json({ error: 'Failed to switch business', detail });
    }

    return res.status(200).json({ ok: true, activeBusinessId: businessId, name: ownRows[0].name });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
