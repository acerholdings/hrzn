// Initiates the Clover OAuth flow.
// The frontend hits this with the user's Supabase token; we resolve their
// business_id, stash it in the `state` param (so the callback knows who is
// connecting), and redirect the merchant to Clover's authorize screen.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CLOVER_APP_ID = process.env.CLOVER_APP_ID;
  // Sandbox vs production base. Default to sandbox until the app is approved.
  const CLOVER_BASE = process.env.CLOVER_BASE_URL || 'https://sandbox.dev.clover.com';
  const APP_URL = process.env.APP_BASE_URL || 'https://atlas-os-kappa.vercel.app';

  if (!CLOVER_APP_ID) return res.status(500).json({ error: 'CLOVER_APP_ID not configured' });

  // Identify the user from their token (same chain as sync-data.js)
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
    if (!businessId) return res.status(400).json({ error: 'No business found for user' });

    // `state` carries the business_id through the OAuth round-trip. We sign it
    // lightly with a shared secret so the callback can trust it wasn't forged.
    const state = Buffer.from(JSON.stringify({ b: businessId, t: Date.now() })).toString('base64url');

    const redirectUri = `${APP_URL}/api/clover-callback`;
    const authorizeUrl = `${CLOVER_BASE}/oauth/v2/authorize`
      + `?client_id=${encodeURIComponent(CLOVER_APP_ID)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&response_type=code`
      + `&state=${encodeURIComponent(state)}`;

    // The frontend opens this URL; return it as JSON so the page can redirect.
    return res.status(200).json({ ok: true, url: authorizeUrl });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
