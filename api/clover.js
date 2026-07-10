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
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=business_id,plan,subscription_status`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    const [profile] = await profileRes.json();
    if (!profile?.business_id) return { error: 'No business found for user', code: 400 };
    // plan/status now live at the OWNER level (profile) so all of an owner's
    // businesses share one subscription — carry them out for the Pro check.
    const plan = profile.plan, subscriptionStatus = profile.subscription_status;

    // Active-business resolution + ownership validation. If the client requests a
    // specific business (?business_id=… or body.businessId), verify it belongs to
    // this user before using it — never trust a client-supplied id blindly, or a
    // user could connect a POS under a business they don't own. No id → fall back
    // to the profile default (current single-business behaviour). Note: this only
    // affects the token-authed connect/status path; the OAuth callback resolves
    // business_id from state/merchant separately and is untouched.
    const requestedBusinessId = req.query?.business_id || req.body?.businessId || null;
    if (requestedBusinessId && requestedBusinessId !== profile.business_id) {
      const ownRes = await fetch(
        `${SUPABASE_URL}/rest/v1/businesses?id=eq.${requestedBusinessId}&owner_id=eq.${user.id}&select=id`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const ownRows = await ownRes.json().catch(() => []);
      if (!Array.isArray(ownRows) || ownRows.length === 0) {
        return { error: 'You do not have access to that business.', code: 403 };
      }
      return { businessId: requestedBusinessId, plan, subscriptionStatus };
    }
    return { businessId: profile.business_id, plan, subscriptionStatus };
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
      // ── ENTITLEMENT: live integrations are PRO-only ──────────────────
      // Connecting a POS is a Pro feature. Starter/trial/cancelled cannot connect.
      // Enforced server-side so the connect URL can't be obtained directly.
      // Read at the OWNER level (profile plan/status carried by getBusinessId).
      {
        const _plan = (b.plan || '').toLowerCase();
        const _status = (b.subscriptionStatus || '').toLowerCase();
        const _proActive = _plan === 'pro' && _status !== 'cancelled' && _status !== 'past_due';
        if (!_proActive) {
          return res.status(403).json({ error: 'Live integrations are available on the Pro plan.', code: 'pro_required' });
        }
      }

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
        `${SUPABASE_URL}/rest/v1/clover_connections?business_id=eq.${b.businessId}&select=merchant_id,token_expires_at,updated_at`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const [conn] = await connRes.json();
      if (!conn) return res.status(200).json({ connected: false });
      return res.status(200).json({ connected: true, merchant_id: conn.merchant_id, token_expires_at: conn.token_expires_at || null, updated_at: conn.updated_at || null });
    }

    // ── DISCONNECT: delete this business's stored Clover connection ─
    if (action === 'disconnect') {
      const b = await getBusinessId();
      if (b.error) return res.status(b.code).json({ error: b.error });
      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clover_connections?business_id=eq.${b.businessId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Prefer': 'return=minimal'
          }
        }
      );
      if (!delRes.ok && delRes.status !== 404) {
        const t = await delRes.text();
        console.error('clover disconnect delete failed:', delRes.status, t);
        return res.status(502).json({ error: 'Could not disconnect', detail: t });
      }
      return res.status(200).json({ ok: true, disconnected: true });
    }

    // ── SYNC: pull live data using this business's stored token ────
    // (Adapted from the original single-merchant clover.js — now multi-tenant:
    //  the token + merchant_id come from clover_connections, not env vars.)
    if (action === 'sync') {
      const b = await getBusinessId();
      if (b.error) return res.status(b.code).json({ error: b.error });
      const connRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clover_connections?business_id=eq.${b.businessId}&select=merchant_id,access_token,refresh_token,token_expires_at`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const [conn] = await connRes.json();
      if (!conn) return res.status(400).json({ error: 'Clover not connected' });

      // Clover's data API base must match the environment the merchant was
      // authorized in. Sandbox merchants live at apisandbox.dev.clover.com;
      // production merchants at api.clover.com. The OAuth base (CLOVER_BASE)
      // already tells us which environment we're in, so derive the API base
      // from it (overridable via CLOVER_API_BASE) to keep them in sync — a
      // sandbox OAuth that points at the production API silently 404s/401s
      // ("Clover fetch failed").
      const isSandbox = /sandbox\.dev\.clover\.com/i.test(CLOVER_BASE);
      const API_BASE = process.env.CLOVER_API_BASE
        || (isSandbox ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com');
      const MID = conn.merchant_id;
      const BASE = `${API_BASE}/v3/merchants/${MID}`;

      // Access token is mutable: Clover tokens expire in ~30 min, so we refresh
      // when stale or on a 401, then persist the new pair (refresh tokens are
      // single-use, so saving the new one is mandatory or the next refresh fails).
      let accessToken = conn.access_token;

      // Refresh the token pair via Clover's /oauth/v2/refresh and save it back.
      // Returns true on success, false if refresh isn't possible (caller decides).
      async function refreshToken() {
        if (!conn.refresh_token || !CLOVER_APP_ID) return false;
        const rr = await fetch(`${CLOVER_BASE}/oauth/v2/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: CLOVER_APP_ID, refresh_token: conn.refresh_token })
        });
        if (!rr.ok) { console.error('Clover refresh failed:', rr.status, await rr.text()); return false; }
        const t = await rr.json();
        if (!t.access_token) return false;
        accessToken = t.access_token;
        const newExpiry = t.access_token_expiration
          ? new Date(t.access_token_expiration * 1000).toISOString() : null;
        // Persist the new pair (and the new single-use refresh token).
        await fetch(`${SUPABASE_URL}/rest/v1/clover_connections?business_id=eq.${b.businessId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            access_token: t.access_token,
            refresh_token: t.refresh_token || conn.refresh_token,
            token_expires_at: newExpiry,
            updated_at: new Date().toISOString()
          })
        });
        conn.refresh_token = t.refresh_token || conn.refresh_token;
        return true;
      }

      // Proactive refresh: if we know the token is expired (or expires within
      // 60s), refresh before making any call.
      if (conn.token_expires_at) {
        const expMs = new Date(conn.token_expires_at).getTime();
        if (Number.isFinite(expMs) && expMs - Date.now() < 60 * 1000) {
          await refreshToken();
        }
      }

      // Wrapper around fetch that retries once after a refresh on a 401.
      async function cloverFetch(url) {
        let r = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
        if (r.status === 401) {
          const ok = await refreshToken();
          if (ok) r = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
        }
        return r;
      }

      const now = Date.now();
      // Configurable window: ?days=N (default 7). Clamp to a sane range so a
      // bad value can't ask Clover for everything-ever.
      let days = parseInt(req.query.days, 10);
      if (!Number.isFinite(days) || days < 1) days = 7;
      if (days > 365) days = 365;
      const windowStart = now - (days * 24 * 60 * 60 * 1000);
      const what = req.query.what || 'summary';

      // Whether an order should count toward revenue.
      // Production: real completed sales arrive as paymentState PAID.
      // Sandbox: the Virtual Terminal creates OPEN orders that never flip to
      //   PAID, so we also accept an order that carries genuine revenue line
      //   items (isRevenue, not a fee) and hasn't been refunded/voided.
      // Either way, refunded/voided orders and zero-revenue orders are excluded.
      const countsAsRevenue = (o) => {
        if (o.state === 'voided' || o.refunded === true) return false;
        if (o.paymentState === 'PAID') return true;
        const lis = o.lineItems?.elements || [];
        return lis.some(li => li.isRevenue !== false && li.isOrderFee !== true && !li.refunded);
      };

      if (what === 'summary') {
        // Revenue counts PAID orders plus sandbox revenue-bearing OPEN orders
        // (see countsAsRevenue). Built on orders + lineItems so it needs only
        // the Orders permission. All money fields are in cents.
        const r = await cloverFetch(`${BASE}/orders?filter=createdTime>=${windowStart}&filter=createdTime<${now}&limit=500&expand=lineItems`);
        if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'Clover fetch failed', status: r.status, detail: t }); }
        const data = await r.json();

        // Keep only orders that count as revenue.
        const paid = (data.elements || []).filter(countsAsRevenue);

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
          revenueRule: 'paid_or_revenue_lineitems',
          merchant_id: MID
        });
      }
      if (what === 'orders')   { const r = await cloverFetch(`${BASE}/orders?filter=createdTime>=${windowStart}&limit=500&expand=lineItems`); return res.status(r.status).json(await r.json()); }
      if (what === 'payments') { const r = await cloverFetch(`${BASE}/payments?filter=createdTime>=${windowStart}&limit=500`); return res.status(r.status).json(await r.json()); }
      if (what === 'items')    { const r = await cloverFetch(`${BASE}/items?limit=200`); return res.status(r.status).json(await r.json()); }
      if (what === 'merchant') { const r = await cloverFetch(`${BASE}`); return res.status(r.status).json(await r.json()); }

      // ── PILLARS: map Clover orders → HRZN's universal pillar shape ──
      // This is the live-data equivalent of a parsed CSV. It produces the same
      // revenue-pillar fields HRZN already consumes, so connected businesses use
      // live data first (CSV is the fallback when no Clover connection exists).
      // Only the revenue pillar is derivable from Clover orders/items; COGS,
      // labor, rent, marketing, recurring are not in POS data and stay sourced
      // from settings/CSV until those integrations exist.
      if (what === 'pillars') {
        // NOTE: we do NOT expand `payments` here. The app's granted permissions
        // (Orders, Inventory, Merchant, Customers, Employees) do not include
        // Payments, and expand=payments triggers a 403 "Invalid permissions for
        // expandable fields." Without it, per-tender data is unavailable, so the
        // payment-method breakdown below falls back to crediting the order total.
        // To get a real credit/debit/cash split, add the Payments read permission
        // to the Clover app and restore `,payments` to the expand.
        const r = await cloverFetch(`${BASE}/orders?filter=createdTime>=${windowStart}&filter=createdTime<${now}&limit=500&expand=lineItems`);
        if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'Clover fetch failed', status: r.status, detail: t }); }
        const data = await r.json();
        const paid = (data.elements || []).filter(countsAsRevenue);

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

        // Payment-method breakdown from each order's payments[].tender. Clover tender
        // labels vary ("Credit Card", "Debit Card", "Cash", "External Payment", etc.),
        // so we classify by label/labelKey text. Falls back to crediting the order
        // total to "credit" if no tender info, so payment totals still reconcile.
        const tenderCents = { credit: 0, debit: 0, cash: 0, other: 0 };
        for (const o of paid) {
          const pays = (o.payments && o.payments.elements) || [];
          if (!pays.length) continue;
          for (const pmt of pays) {
            const amt = typeof pmt.amount === 'number' ? pmt.amount : 0;
            if (amt <= 0) continue;
            const label = ((pmt.tender && (pmt.tender.label || pmt.tender.labelKey)) || '').toLowerCase();
            if (label.includes('cash')) tenderCents.cash += amt;
            else if (label.includes('debit')) tenderCents.debit += amt;
            else if (label.includes('credit') || label.includes('card')) tenderCents.credit += amt;
            else tenderCents.other += amt;
          }
        }
        const tenderedTotal = tenderCents.credit + tenderCents.debit + tenderCents.cash + tenderCents.other;
        if (tenderedTotal === 0 && revenueCents > 0) { tenderCents.credit = revenueCents; }
        const payments = {
          credit: Math.round(tenderCents.credit) / 100,
          debit: Math.round(tenderCents.debit) / 100,
          cash: Math.round(tenderCents.cash) / 100,
          other: Math.round(tenderCents.other) / 100
        };

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
          payments,
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

      // Upsert keyed on business_id (the unique constraint). on_conflict tells
      // PostgREST to UPDATE the existing row instead of failing with a 409
      // duplicate-key error. Without it, merge-duplicates has no target column.
      const conflictTarget = businessId ? 'business_id' : 'merchant_id';
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/clover_connections?on_conflict=${conflictTarget}`, {
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
