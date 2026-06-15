// Single Clover endpoint (Vercel Hobby has a 12-function cap, so connect +
// callback + status are consolidated here and routed by ?action=).
//   ?action=connect  → returns the Clover authorize URL (needs Bearer token)
//   ?action=callback → Clover redirects here after approval (no token; uses state)
//   ?action=status   → reports whether this business has a stored connection
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CLOVER_APP_ID = process.env.CLOVER_APP_ID;
  const CLOVER_APP_SECRET = process.env.CLOVER_APP_SECRET;
  const CLOVER_BASE = process.env.CLOVER_BASE_URL || 'https://sandbox.dev.clover.com';
  const APP_URL = process.env.APP_BASE_URL || 'https://atlas-os-kappa.vercel.app';

  // Clover appends ?code=&merchant_id=&state= to the redirect_uri (a bare path,
  // no action param — Clover validates the path as a Site URL subpath). So if a
  // `code` is present, this is the OAuth callback regardless of action.
  const action = req.query.code ? 'callback' : req.query.action;

  // Resolve business_id from a Supabase bearer token (shared by connect + status).
  async function getBusinessId() {
    const authHeader = req.headers.authorization;
    if (!authHeader) return { error: 'No token', code: 401 };
    const token = authHeader.replace('Bearer ', '');
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.id) return { error: 'Invalid token', code: 401 };
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=business_id`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    const [profile] = await profileRes.json();
    if (!profile?.business_id) return { error: 'No business found for user', code: 400 };
    return { businessId: profile.business_id };
  }

  try {
    // ── CONNECT: build the authorize URL ──────────────────────────
    if (action === 'connect') {
      if (!CLOVER_APP_ID) return res.status(500).json({ error: 'CLOVER_APP_ID not configured' });
      const b = await getBusinessId();
      if (b.error) return res.status(b.code).json({ error: b.error });
      const state = Buffer.from(JSON.stringify({ b: b.businessId, t: Date.now() })).toString('base64url');
      const redirectUri = `${APP_URL}/api/clover`;
      const url = `${CLOVER_BASE}/oauth/v2/authorize`
        + `?client_id=${encodeURIComponent(CLOVER_APP_ID)}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&response_type=code`
        + `&state=${encodeURIComponent(state)}`;
      return res.status(200).json({ ok: true, url });
    }

    // ── STATUS: is this business connected? (never returns tokens) ─
    if (action === 'status') {
      const b = await getBusinessId();
      if (b.error) return res.status(200).json({ connected: false });
      const connRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clover_connections?business_id=eq.${b.businessId}&select=merchant_id,token_expires_at`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const [conn] = await connRes.json();
      if (!conn) return res.status(200).json({ connected: false });
      return res.status(200).json({ connected: true, merchant_id: conn.merchant_id, token_expires_at: conn.token_expires_at || null });
    }

    // ── SYNC: pull live data using this business's stored token ────
    // (Adapted from the original single-merchant clover.js — now multi-tenant:
    //  the token + merchant_id come from clover_connections, not env vars.)
    if (action === 'sync') {
      const b = await getBusinessId();
      if (b.error) return res.status(b.code).json({ error: b.error });
      const connRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clover_connections?business_id=eq.${b.businessId}&select=merchant_id,access_token`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const [conn] = await connRes.json();
      if (!conn) return res.status(400).json({ error: 'Clover not connected' });

      // Clover's production API host (data lives here once a merchant is connected,
      // both sandbox-test and production merchants resolve via api base).
      const API_BASE = process.env.CLOVER_API_BASE || 'https://api.clover.com';
      const MID = conn.merchant_id;
      const BASE = `${API_BASE}/v3/merchants/${MID}`;
      const HEADERS = { 'Authorization': `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' };
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
      const what = req.query.what || 'summary';

      if (what === 'summary') {
        const r = await fetch(`${BASE}/payments?filter=createdTime>=${weekAgo}&filter=createdTime<${now}&limit=500`, { headers: HEADERS });
        if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'Clover fetch failed', status: r.status, detail: t }); }
        const data = await r.json();
        const payments = data.elements || [];
        const totalRevenue = payments.reduce((s, p) => s + (p.amount || 0), 0) / 100;
        const count = payments.length;
        return res.status(200).json({
          totalRevenue: Math.round(totalRevenue),
          totalTransactions: count,
          avgCheck: count > 0 ? Math.round((totalRevenue / count) * 100) / 100 : 0,
          merchant_id: MID
        });
      }
      if (what === 'orders')   { const r = await fetch(`${BASE}/orders?filter=createdTime>=${weekAgo}&limit=500&expand=lineItems`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }
      if (what === 'payments') { const r = await fetch(`${BASE}/payments?filter=createdTime>=${weekAgo}&limit=500`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }
      if (what === 'items')    { const r = await fetch(`${BASE}/items?limit=200`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }
      if (what === 'merchant') { const r = await fetch(`${BASE}`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }
      return res.status(400).json({ error: 'Invalid what. Use: summary, orders, payments, items, merchant' });
    }

    // ── CALLBACK: exchange code for tokens, store, redirect back ───
    if (action === 'callback') {
      const back = (status) => res.redirect(302, `${APP_URL}/data.html?clover=${status}`);
      if (!CLOVER_APP_ID || !CLOVER_APP_SECRET) return back('config_error');

      const { code, merchant_id, state } = req.query;
      if (!code || !merchant_id) return back('denied');

      let businessId = null;
      try {
        businessId = JSON.parse(Buffer.from(state, 'base64url').toString()).b;
      } catch (e) { return back('bad_state'); }
      if (!businessId) return back('bad_state');

      const tokenRes = await fetch(`${CLOVER_BASE}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLOVER_APP_ID, client_secret: CLOVER_APP_SECRET, code })
      });
      const tok = await tokenRes.json();
      if (!tokenRes.ok || !tok.access_token) {
        console.error('Clover token exchange failed:', tokenRes.status, tok);
        return back('token_failed');
      }

      const expiresAt = tok.access_token_expiration
        ? new Date(tok.access_token_expiration * 1000).toISOString() : null;

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
      if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        console.error('clover_connections write failed:', upsertRes.status, errText);
        return back('store_failed');
      }
      return back('connected');
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Clover endpoint error:', error);
    if (action === 'callback') return res.redirect(302, `${APP_URL}/data.html?clover=error`);
    return res.status(500).json({ error: error.message });
  }
}
