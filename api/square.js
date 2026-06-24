// Single Square endpoint (Vercel Hobby 12-function cap → connect + callback +
// status + sync consolidated here, routed by ?action=). Mirrors api/clover.js.
//   ?action=connect  → returns the Square authorize URL (needs Bearer token)
//   ?action=callback → Square redirects here after approval (detected by ?code=)
//   ?action=status   → reports whether this business has a stored connection
//   ?action=sync&what=summary|pillars|orders|payments|location → live data
//
// Square specifics vs Clover:
//  - OAuth: /oauth2/authorize + /oauth2/token. Access tokens last 30 DAYS (not
//    30 min like Clover); code-flow refresh tokens DON'T expire and are reusable.
//  - Data is keyed by LOCATION (location_id), not merchant_id.
//  - Orders are fetched via POST /v2/orders/search (not a GET filter).
//  - Money is in cents at order.total_money.amount.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SQUARE_APP_ID = process.env.SQUARE_APP_ID;
  const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET;
  const SQUARE_BASE = process.env.SQUARE_BASE_URL || 'https://connect.squareupsandbox.com';
  const APP_URL = process.env.APP_BASE_URL || 'https://atlas-os-kappa.vercel.app';
  // Square requires an API version header on Connect v2 calls.
  const SQUARE_VERSION = process.env.SQUARE_VERSION || '2025-01-23';

  // Callback is detected by presence of ?code= (redirect_uri is the clean path
  // /api/square). Otherwise route by ?action=.
  const action = req.query.code ? 'callback' : req.query.action;

  // Resolve business_id from a Supabase bearer token (shared by connect + status + sync).
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
      if (!SQUARE_APP_ID) return res.status(500).json({ error: 'SQUARE_APP_ID not configured' });
      const b = await getBusinessId();
      if (b.error) return res.status(b.code).json({ error: b.error });
      const state = Buffer.from(JSON.stringify({ b: b.businessId, t: Date.now() })).toString('base64url');
      const redirectUri = `${APP_URL}/api/square`;
      // Scopes: read-only sales data for the pillar engine. Keep minimal.
      const scope = ['MERCHANT_PROFILE_READ', 'ORDERS_READ', 'PAYMENTS_READ', 'ITEMS_READ'].join('+');
      // NOTE: we intentionally omit `session=false`. With it, Square assumes an
      // existing logged-in session and shows a blank page when there isn't one
      // (the pre-sign-in friction). Omitting it lets Square present its own login
      // screen inline when the user isn't signed in — the seamless connect flow.
      const url = `${SQUARE_BASE}/oauth2/authorize`
        + `?client_id=${encodeURIComponent(SQUARE_APP_ID)}`
        + `&scope=${scope}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&state=${encodeURIComponent(state)}`;
      return res.status(200).json({ ok: true, url });
    }

    // ── STATUS: is this business connected? (never returns tokens) ─
    if (action === 'status') {
      const b = await getBusinessId();
      if (b.error) return res.status(200).json({ connected: false });
      const connRes = await fetch(
        `${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${b.businessId}&select=location_id,token_expires_at`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const [conn] = await connRes.json();
      if (!conn) return res.status(200).json({ connected: false });
      return res.status(200).json({ connected: true, location_id: conn.location_id, token_expires_at: conn.token_expires_at || null });
    }

    // ── DISCONNECT: delete this business's stored Square connection ─
    // Removes the row so status reports disconnected and sync stops. The
    // frontend separately reverts the local data source to CSV/demo.
    if (action === 'disconnect') {
      const b = await getBusinessId();
      if (b.error) return res.status(b.code).json({ error: b.error });
      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${b.businessId}`,
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
        console.error('square disconnect delete failed:', delRes.status, t);
        return res.status(502).json({ error: 'Could not disconnect', detail: t });
      }
      return res.status(200).json({ ok: true, disconnected: true });
    }

    // ── SYNC: pull live data using this business's stored token ────
    if (action === 'sync') {
      const b = await getBusinessId();
      if (b.error) return res.status(b.code).json({ error: b.error });
      const connRes = await fetch(
        `${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${b.businessId}&select=merchant_id,location_id,access_token,refresh_token,token_expires_at`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const [conn] = await connRes.json();
      if (!conn) return res.status(400).json({ error: 'Square not connected' });

      const LOCATION = conn.location_id;
      let accessToken = conn.access_token;

      // Refresh the token via Square's /oauth2/token (grant_type=refresh_token)
      // and save it back. Square access tokens last 30 days; code-flow refresh
      // tokens are reusable and don't expire, so we just store the new access
      // token (and refresh token if Square rotates it).
      async function refreshToken() {
        if (!conn.refresh_token || !SQUARE_APP_ID || !SQUARE_APP_SECRET) return false;
        const rr = await fetch(`${SQUARE_BASE}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_VERSION },
          body: JSON.stringify({
            client_id: SQUARE_APP_ID,
            client_secret: SQUARE_APP_SECRET,
            grant_type: 'refresh_token',
            refresh_token: conn.refresh_token
          })
        });
        if (!rr.ok) { console.error('Square refresh failed:', rr.status, await rr.text()); return false; }
        const t = await rr.json();
        if (!t.access_token) return false;
        accessToken = t.access_token;
        const newExpiry = t.expires_at || null; // Square returns ISO string
        await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${b.businessId}`, {
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

      // Proactive refresh if the token is expired or expires within 1 day
      // (Square tokens last 30 days, so this rarely fires).
      if (conn.token_expires_at) {
        const expMs = new Date(conn.token_expires_at).getTime();
        if (Number.isFinite(expMs) && expMs - Date.now() < 24 * 60 * 60 * 1000) {
          await refreshToken();
        }
      }

      // fetch wrapper: retry once after refresh on 401.
      async function sqFetch(url, opts) {
        const baseHeaders = { 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' };
        let r = await fetch(url, { ...(opts||{}), headers: { ...baseHeaders, 'Authorization': `Bearer ${accessToken}`, ...((opts&&opts.headers)||{}) } });
        if (r.status === 401) {
          const ok = await refreshToken();
          if (ok) r = await fetch(url, { ...(opts||{}), headers: { ...baseHeaders, 'Authorization': `Bearer ${accessToken}`, ...((opts&&opts.headers)||{}) } });
        }
        return r;
      }

      const now = Date.now();
      let days = parseInt(req.query.days, 10);
      if (!Number.isFinite(days) || days < 1) days = 7;
      if (days > 365) days = 365;
      const windowStartISO = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
      const nowISO = new Date(now).toISOString();
      const what = req.query.what || 'summary';

      // Square Orders are retrieved via POST /v2/orders/search with a location
      // filter and a date-time range on created_at. Completed sales have
      // state COMPLETED; we treat COMPLETED (or any order with a positive
      // total) as revenue.
      async function searchOrders() {
        const body = {
          location_ids: [LOCATION],
          query: {
            filter: {
              date_time_filter: { created_at: { start_at: windowStartISO, end_at: nowISO } }
              // No state_filter: we want OPEN + COMPLETED. Production sales are
              // COMPLETED; the Sandbox/API-created test orders are OPEN. The
              // countsAsRevenue() check below decides what actually counts.
            },
            sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' }
          },
          limit: 500
        };
        return sqFetch(`${SQUARE_BASE}/v2/orders/search`, { method: 'POST', body: JSON.stringify(body) });
      }

      // Revenue counts an order unless it's canceled. Production: real sales are
      // COMPLETED. Sandbox/API-created orders are OPEN but carry a real total, so
      // we count any non-canceled order with a positive total_money.
      const countsAsRevenue = (o) => {
        if (!o) return false;
        if (o.state === 'CANCELED') return false;
        const amt = o.total_money && typeof o.total_money.amount === 'number' ? o.total_money.amount : 0;
        return amt > 0;
      };

      if (what === 'summary') {
        const r = await searchOrders();
        if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'Square fetch failed', status: r.status, detail: t }); }
        const data = await r.json();
        const orders = (data.orders || []).filter(countsAsRevenue);
        const totalCents = orders.reduce((s, o) => s + ((o.total_money && o.total_money.amount) || 0), 0);
        const count = orders.length;
        return res.status(200).json({
          totalRevenue: Math.round((totalCents / 100) * 100) / 100,
          totalTransactions: count,
          avgCheck: count > 0 ? Math.round((totalCents / count)) / 100 : 0,
          windowDays: days,
          revenueRule: 'completed_or_positive_total',
          location_id: LOCATION
        });
      }

      if (what === 'orders')   { const r = await searchOrders(); return res.status(r.status).json(await r.json()); }
      if (what === 'payments') { const r = await sqFetch(`${SQUARE_BASE}/v2/payments?location_id=${encodeURIComponent(LOCATION)}&begin_time=${encodeURIComponent(windowStartISO)}&limit=100`); return res.status(r.status).json(await r.json()); }
      if (what === 'location') { const r = await sqFetch(`${SQUARE_BASE}/v2/locations/${encodeURIComponent(LOCATION)}`); return res.status(r.status).json(await r.json()); }

      // ── PILLARS: map Square orders → HRZN's universal pillar shape ──
      // Same output shape as clover.js so HRZN consumes it identically
      // (revenue pillar, dailyRevenue, items). Square line items carry
      // name, quantity (string), and base/total money in cents.
      if (what === 'pillars') {
        const r = await searchOrders();
        if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: 'Square fetch failed', status: r.status, detail: t }); }
        const data = await r.json();
        const paid = (data.orders || []).filter(countsAsRevenue);

        const revenueCents = paid.reduce((s, o) => s + ((o.total_money && o.total_money.amount) || 0), 0);

        // Per-day revenue keyed YYYY-MM-DD (from created_at ISO timestamps).
        const byDay = {};
        for (const o of paid) {
          const d = (o.created_at || '').slice(0, 10);
          if (!d) continue;
          byDay[d] = (byDay[d] || 0) + ((o.total_money && o.total_money.amount) || 0);
        }
        const dailyRevenue = Object.entries(byDay)
          .map(([date, cents]) => ({ date, revenue: Math.round(cents) / 100 }))
          .sort((a, b) => a.date.localeCompare(b.date));

        // Per-item rollup from order line_items. quantity is a string; revenue
        // uses total_money (gross_sales_money also available). Skip non-revenue.
        const itemMap = {};
        for (const o of paid) {
          for (const li of (o.line_items || [])) {
            const name = li.name || 'Unknown';
            const qty = parseFloat(li.quantity || '1') || 1;
            const cents = (li.total_money && typeof li.total_money.amount === 'number') ? li.total_money.amount
                        : (li.gross_sales_money && li.gross_sales_money.amount) || 0;
            if (!itemMap[name]) itemMap[name] = { name, qtySold: 0, revenue: 0 };
            itemMap[name].qtySold += qty;
            itemMap[name].revenue += cents;
          }
        }
        const items = Object.values(itemMap)
          .map(it => ({ name: it.name, qtySold: Math.round(it.qtySold * 1000) / 1000, revenue: Math.round(it.revenue) / 100 }))
          .sort((a, b) => b.revenue - a.revenue);

        // Payment-method breakdown from each order's tenders[]. Square tender.type is
        // CARD | CASH | SQUARE_GIFT_CARD | etc.; for CARD, card_details.card.card_brand
        // distinguishes credit vs debit isn't always present, so we bucket by entry:
        // DEBIT_* brands → debit, everything else card → credit. Cash → cash.
        const tenderCents = { credit: 0, debit: 0, cash: 0, other: 0 };
        for (const o of paid) {
          for (const t of (o.tenders || [])) {
            const amt = (t.amount_money && typeof t.amount_money.amount === 'number') ? t.amount_money.amount : 0;
            if (amt <= 0) continue;
            const type = t.type || '';
            if (type === 'CASH') { tenderCents.cash += amt; }
            else if (type === 'CARD') {
              const brand = (t.card_details && t.card_details.card && t.card_details.card.card_brand) || '';
              const isDebit = /DEBIT/i.test(brand) || (t.card_details && t.card_details.card && /DEBIT/i.test(t.card_details.card.card_type || ''));
              if (isDebit) tenderCents.debit += amt; else tenderCents.credit += amt;
            }
            else { tenderCents.other += amt; }
          }
        }
        // If an order had no tenders attached (e.g. some sandbox/API orders), fall back
        // to crediting the order total to "credit" so payment totals still reconcile
        // with revenue rather than showing all $0.
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
          source: 'square',
          windowDays: days,
          pillars: { revenue: Math.round(revenueCents) / 100 },
          metrics: {
            orderCount,
            avgCheck: orderCount > 0 ? Math.round(revenueCents / orderCount) / 100 : 0
          },
          dailyRevenue,
          items,
          payments,
          location_id: LOCATION
        });
      }

      return res.status(400).json({ error: 'Invalid what. Use: summary, pillars, orders, payments, location' });
    }

    // ── CALLBACK: exchange code for tokens, store, redirect back ───
    if (action === 'callback') {
      const back = (status) => res.redirect(302, `${APP_URL}/data.html?square=${status}`);
      if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) return back('config_error');

      const { code, state } = req.query;
      if (!code) return back('denied');

      let businessId = null;
      try {
        businessId = JSON.parse(Buffer.from(state, 'base64url').toString()).b;
      } catch (e) { return back('bad_state'); }
      if (!businessId) return back('bad_state');

      const tokenRes = await fetch(`${SQUARE_BASE}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_VERSION },
        body: JSON.stringify({
          client_id: SQUARE_APP_ID,
          client_secret: SQUARE_APP_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${APP_URL}/api/square`
        })
      });
      const tok = await tokenRes.json();
      if (!tokenRes.ok || !tok.access_token) {
        console.error('Square token exchange failed:', tokenRes.status, tok);
        return back('token_failed');
      }

      // Square returns merchant_id; resolve the seller's first location so sync
      // has a location to query. (A seller may have several; we take the first
      // active one for now — multi-location support can come later.)
      let locationId = null;
      let merchantId = tok.merchant_id || null;
      try {
        const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, {
          headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' }
        });
        const locData = await locRes.json();
        const locs = locData.locations || [];
        const active = locs.find(l => l.status === 'ACTIVE') || locs[0];
        if (active) locationId = active.id;
      } catch (e) { /* leave null; status will still show connected, sync will error clearly */ }

      const row = {
        business_id: businessId,
        merchant_id: merchantId,
        location_id: locationId,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token || null,
        token_expires_at: tok.expires_at || null,
        updated_at: new Date().toISOString()
      };

      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/square_connections?on_conflict=business_id`, {
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
        console.error('square_connections write failed:', upsertRes.status, errText);
        return back('store_failed');
      }
      return back('connected');
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Square endpoint error:', error);
    if (action === 'callback') return res.redirect(302, `${APP_URL}/data.html?square=error`);
    return res.status(500).json({ error: error.message });
  }
}
