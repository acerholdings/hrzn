// Clover redirects the merchant here after they approve the app, with a
// ?code=...&merchant_id=...&state=... query. We exchange the code for an
// access + refresh token pair (v2 OAuth) and upsert it into clover_connections,
// then bounce the user back to the Data Sources page.
export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CLOVER_APP_ID = process.env.CLOVER_APP_ID;
  const CLOVER_APP_SECRET = process.env.CLOVER_APP_SECRET;
  const CLOVER_BASE = process.env.CLOVER_BASE_URL || 'https://sandbox.dev.clover.com';
  const APP_URL = process.env.APP_BASE_URL || 'https://atlas-os-kappa.vercel.app';

  // Helper: send the user back to Data Sources with a status flag in the URL.
  const back = (status) => res.redirect(302, `${APP_URL}/data.html?clover=${status}`);

  if (!CLOVER_APP_ID || !CLOVER_APP_SECRET) {
    return back('config_error');
  }

  const { code, merchant_id, state } = req.query;
  if (!code || !merchant_id) return back('denied'); // merchant cancelled or missing params

  // Recover the business_id from state.
  let businessId = null;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    businessId = decoded.b;
  } catch (e) {
    return back('bad_state');
  }
  if (!businessId) return back('bad_state');

  try {
    // Exchange the authorization code for an expiring token pair.
    const tokenRes = await fetch(`${CLOVER_BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLOVER_APP_ID,
        client_secret: CLOVER_APP_SECRET,
        code
      })
    });
    const tok = await tokenRes.json();
    // v2 returns access_token + refresh_token; older flows return just access_token.
    if (!tokenRes.ok || !tok.access_token) {
      console.error('Clover token exchange failed:', tokenRes.status, tok);
      return back('token_failed');
    }

    const expiresAt = tok.access_token_expiration
      ? new Date(tok.access_token_expiration * 1000).toISOString()
      : null;

    // Upsert into clover_connections (unique on business_id → one connection per business).
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/clover_connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        business_id: businessId,
        merchant_id: String(merchant_id),
        access_token: tok.access_token,
        refresh_token: tok.refresh_token || null,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
    });
    // Don't let a failed write hide behind a redirect — log the real error.
    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('clover_connections write failed:', upsertRes.status, errText);
      return back('store_failed');
    }

    return back('connected');
  } catch (error) {
    console.error('Clover callback error:', error);
    return back('error');
  }
}
