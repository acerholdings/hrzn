import { sendLifecycleEmail, sendFounderAlert } from './emails.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { token, name, location, pos, businessType, targets } = req.body;
  if (!token || !name) return res.status(400).json({ error: 'Missing required fields' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Get user from token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Invalid token' });

    // Idempotency guard: signup should only ever create the owner's FIRST business.
    // If they already have one (double-click, refresh, back-button, re-run), return it
    // instead of creating a duplicate. Deliberately adding more businesses later (Pro
    // multi-business) happens through a separate "add business" flow, not signup.
    // NOTE: keyed on owner_id, NOT name — different owners can share a business name
    // (e.g. same brand in different states), so name is not a safe uniqueness key.
    try {
      const existingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${user.id}&select=id&limit=1`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const existing = await existingRes.json();
      if (Array.isArray(existing) && existing[0]?.id) {
        return res.status(200).json({ ok: true, business_id: existing[0].id, existing: true });
      }
    } catch (e) { /* if the lookup fails, fall through and attempt creation */ }

    // Create business. business_type is the OWNER'S authoritative category pick —
    // persist it so the app's benchmarks/alerts/AI match the right category.
    // Defensive: if the businesses table doesn't have a business_type column yet,
    // retry WITHOUT it so signup can't break on a schema mismatch.
    const bizBase = {
      owner_id: user.id,
      name,
      location: location || null,
      pos_system: pos || null,
      plan: 'trial',
      // 14-day trial end date, set explicitly at signup so (a) the entitlement
      // checks in chat.js / sync-data.js have a real date to compare against and
      // (b) the lifecycle emails can count down to expiry. Without this the column
      // is NULL and a trial effectively never expires.
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    };
    const createBusiness = (extra) => fetch(`${SUPABASE_URL}/rest/v1/businesses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ ...bizBase, ...extra })
    });

    let bizRes = await createBusiness({ business_type: businessType || 'restaurant' });
    if (!bizRes.ok) {
      // Likely an unknown-column error — retry without business_type.
      bizRes = await createBusiness({});
    }
    const [business] = await bizRes.json();
    if (!business?.id) return res.status(500).json({ error: 'Failed to create business' });

    // Fire the welcome email (best-effort — never let it block or fail signup).
    // Stamp welcome_sent_at so a re-run of setup (refresh/back) can't double-send.
    try {
      if (user.email && process.env.RESEND_API_KEY) {
        const out = await sendLifecycleEmail({ type: 'welcome', to: user.email, name: name });
        if (out.ok) {
          await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${business.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
            body: JSON.stringify({ welcome_sent_at: new Date().toISOString() })
          });
        }
      }
    } catch (e) { /* swallow — signup must succeed regardless of email */ }

    // Founder alert — notify the founder of the new signup (best-effort, never blocks).
    try {
      if (process.env.RESEND_API_KEY) {
        await sendFounderAlert({
          businessName: name,
          email: user.email,
          category: businessType || 'restaurant'
        });
      }
    } catch (e) { /* swallow — signup must succeed regardless of alert */ }

    // Update profile with business_id
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      },
      body: JSON.stringify({ business_id: business.id, onboarded: true })
    });

    // Create business settings. CRITICAL: only persist targets the owner actually entered.
    // Leaving a target NULL lets the app fall back to the business type's own benchmark.
    // (Previously this wrote restaurant defaults — 28/30/15/10 — for EVERY category, planting
    // wrong targets on retail/online/service accounts. Same bug we removed from the frontend.)
    const num = (v) => { const n = parseFloat(v); return (v == null || v === '' || isNaN(n)) ? null : n; };
    const settingsRow = { business_id: business.id };
    const tl = num(targets?.labor);    if (tl != null) settingsRow.target_labor_pct = tl;
    const tf = num(targets?.food);     if (tf != null) settingsRow.target_food_cost_pct = tf;
    const tr = num(targets?.revenue);  if (tr != null) settingsRow.target_weekly_revenue = tr;
    const tc = num(targets?.check);    if (tc != null) settingsRow.target_avg_check = tc;
    const td = num(targets?.delivery); if (td != null) settingsRow.target_doordash_pct = td;

    const createSettings = (extra) => fetch(`${SUPABASE_URL}/rest/v1/business_settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      },
      body: JSON.stringify({ ...settingsRow, ...extra })
    });
    // Try to also store the category on the settings row; retry without it if the column is absent.
    let setRes = await createSettings({ business_type: businessType || 'restaurant' });
    if (!setRes.ok) {
      await createSettings({});
    }

    return res.status(200).json({ ok: true, business_id: business.id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
