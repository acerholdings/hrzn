// Single Clover endpoint (Vercel Hobby has a 12-function cap, so connect +
// callback + status are consolidated here and routed by ?action=).
//   ?action=connect  → returns the Clover authorize URL (needs Bearer token)
//   ?action=callback → Clover redirects here after approval (no token; uses state)
//   ?action=status   → reports whether this business has a stored connection
//   launch (App Market) → Clover sends ?merchant_id=&client_id= with no code and
//                         no action. We redirect into /oauth/v2/authorize to begin
//                         the OAuth handshake, carrying merchant_id in state.
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
  //
  // The App Market "Connect" launch hits this same bare path but sends only
  // ?merchant_id=&client_id= (no code, no action). Detect that and treat it as
  // a `launch` so we can kick off the OAuth handshake.
  let action = req.query.code ? 'callback' : req.query.action;
  if (!action && req.query.merchant_id && !req.query.code) {
    action = 'launch';
  }

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
    // ── LAUNCH: App Market "Connect" landed here with merchant_id only ─
    // No code yet, and no HRZN user/token in this browser hop. Redirect the
    // merchant into Clover's authorize screen; the merchant_id is stashed in
    // state so the callback can resolve which business this connection is for.
    if (action === 'launch') {
      if (!CLOVER_APP_ID) return res.status(500).json({ error: 'CLOVER_APP_ID not configured' });
      const merchantId = req.query.merchant_id;
      const state = Buffer.from(JSON.stringify({ m: merchantId, t: Date.now() })).toString('base64url');
      const redirectUri = `${APP_URL}/api/clover`;
      const url = `${CLOVER_BASE}/oauth/v2/authorize`
        + `?client_id=${encodeURIComponent(CLOVER_APP_ID)}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&response_type=code`
        + `&merchant_id=${encodeURIComponent(merchantId)}`
        + `&state=${encodeURIComponent(state)}`;
      return res.redirect(302, url);
    }

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
      // Configurable window: ?days=N (default 7). Clamp to a sane range so a
      // bad value can't ask Clover for everything-ever.
      let days = parseInt(req.query.days, 10);
      if (!Number.isFinite(days) || days < 1) days = 7;
      if (days > 365) days = 365;
      const windowStart = now - (days * 24 * 60 * 60 * 1000);
      const what = req.query.what || 'summary';

      if (what === 'summary') {
        // Revenue = PAID orders only (true revenue, per product decision).
        // Built on orders + lineItems so it works with the Orders permission
        // alone (no Payments scope needed). All money fields are in cents.
        const r = await fetch(`${BASE}/orders?filter=createdTime>=${windowStart}&filter=createdTime<${now}&limit=500&expand=lineItems`, { headers: HEADERS });
        if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'Clover fetch failed', status: r.status, detail: t }); }
        const data = await r.json();

        // Keep only orders Clover marks as paid.
        const paid = (data.elements || []).filter(o => o.paymentState === 'PAID');

        // Sum revenue from order.total (cents). order.total already reflects the
        // paid amount; line items are summarized separately for item-level use.
        const totalCents = paid.reduce((s, o) => s + (typeof o.total === 'number' ? o.total : 0), 0);
        const count = paid.length;

        // avgCheck computed in cents first, then converted once — so it can't
        // disagree with totalRevenue the way the old whole-dollar rounding did.
        const totalRevenue = totalCents / 100;
        const avgCheck = count > 0 ? Math.round((totalCents / count)) / 100 : 0;

        return res.status(200).json({
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalTransactions: count,
          avgCheck,
          windowDays: days,
          paymentState: 'PAID',
          merchant_id: MID
        });
      }
      if (what === 'orders')   { const r = await fetch(`${BASE}/orders?filter=createdTime>=${windowStart}&limit=500&expand=lineItems`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }
      if (what === 'payments') { const r = await fetch(`${BASE}/payments?filter=createdTime>=${windowStart}&limit=500`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }
      if (what === 'items')    { const r = await fetch(`${BASE}/items?limit=200`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }
      if (what === 'merchant') { const r = await fetch(`${BASE}`, { headers: HEADERS }); return res.status(r.status).json(await r.json()); }

      // ── PILLARS: map Clover orders → HRZN's universal pillar shape ──
      // This is the live-data equivalent of a parsed CSV. It produces the same
      // revenue-pillar fields HRZN already consumes, so connected businesses use
      // live data first (CSV is the fallback when no Clover connection exists).
      // Only the revenue pillar is derivable from Clover orders/items; COGS,
      // labor, rent, marketing, recurring are not in POS data and stay sourced
      // from settings/CSV until those integrations exist.
      if (what === 'pillars') {
        const r = await fetch(`${BASE}/orders?filter=createdTime>=${windowStart}&filter=createdTime<${now}&limit=500&expand=lineItems`, { headers: HEADERS });
        if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'Clover fetch failed', status: r.status, detail: t }); }
        const data = await r.json();
        const paid = (data.elements || []).filter(o => o.paymentState === 'PAID');

        // Revenue pillar (cents → dollars).
        const revenueCents = paid.reduce((s, o) => s + (typeof o.total === 'number' ? o.total : 0), 0);

        // Per-day revenue, keyed YYYY-MM-DD, for week/period comparisons.
        const byDay = {};
        for (const o of paid) {
          const d = new Date(o.createdTime).toISOString().slice(0, 10);
          byDay[d] = (byDay[d] || 0) + (typeof o.total === 'number' ? o.total : 0);
        }
        const dailyRevenue = Object.entries(byDay)
          .map(([date, cents]) => ({ date, revenue: Math.round(cents) / 100 }))
          .sort((a, b) => a.date.localeCompare(b.date));

        // Per-item rollup. Clover unitQty is fixed-point: 1000 = 1 unit, so the
        // real quantity is unitQty/1000. Only count line items flagged isRevenue.
        const itemMap = {};
        for (const o of paid) {
          for (const li of (o.lineItems?.elements || [])) {
            if (li.isRevenue === false || li.isOrderFee === true) continue;
            const name = li.name || 'Unknown';
            const qty = (typeof li.unitQty === 'number' && li.unitQty > 0) ? li.unitQty / 1000 : 1;
            const priceCents = typeof li.price === 'number' ? li.price : 0;
            if (!itemMap[name]) itemMap[name] = { name, qtySold: 0, revenue: 0 };
            itemMap[name].qtySold += qty;
            itemMap[name].revenue += priceCents;
          }
        }
        const items = Object.values(itemMap)
          .map(it => ({ name: it.name, qtySold: Math.round(it.qtySold * 1000) / 1000, revenue: Math.round(it.revenue) / 100 }))
          .sort((a, b) => b.revenue - a.revenue);

        const orderCount = paid.length;
        return res.status(200).json({
          source: 'clover',           // lets HRZN flag live vs CSV vs demo
          windowDays: days,
          pillars: {
            revenue: Math.round(revenueCents) / 100
            // cogs / labor / rent / marketing / recurring: not available from POS;
            // HRZN keeps sourcing these from settings/CSV.
          },
          metrics: {
            orderCount,
            avgCheck: orderCount > 0 ? Math.round(revenueCents / orderCount) / 100 : 0
          },
          dailyRevenue,
          items,
          merchant_id: MID
        });
      }

      return res.status(400).json({ error: 'Invalid what. Use: summary, pillars, orders, payments, items, merchant' });
    }

    // ── CALLBACK: exchange code for tokens, store, redirect back ───
    if (action === 'callback') {
      const back = (status) => res.redirect(302, `${APP_URL}/data.html?clover=${status}`);
      if (!CLOVER_APP_ID || !CLOVER_APP_SECRET) return back('config_error');

      const { code, merchant_id, state } = req.query;
      if (!code || !merchant_id) return back('denied');

      let businessId = null;
      let parsedState = null;
      try {
        parsedState = JSON.parse(Buffer.from(state, 'base64url').toString());
      } catch (e) { return back('bad_state'); }

      if (parsedState.b) {
        // Came from the in-app Connect button — business_id was in state.
        businessId = parsedState.b;
      } else if (parsedState.m) {
        // Came from the App Market launch — only merchant_id was known. Find the
        // business already linked to this merchant_id; if none exists yet, fall
        // back to a holding record keyed by merchant_id so the token isn't lost.
        const lookupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/clover_connections?merchant_id=eq.${parsedState.m}&select=business_id`,
          { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
        );
        const [existing] = await lookupRes.json();
        if (existing?.business_id) businessId = existing.business_id;
      }
      if (!businessId && !parsedState.m) return back('bad_state');

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

      // Build the row. If launch flow couldn't resolve a business_id (no prior
      // link for this merchant), write keyed on merchant_id only — the in-app
      // link step can attach business_id later.
      const row = {
        merchant_id: String(merchant_id),
        access_token: tok.access_token,
        refresh_token: tok.refresh_token || null,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      };
      if (businessId) row.business_id = businessId;

      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/clover_connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(row)
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
