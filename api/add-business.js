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
    // 1) Resolve the user from their token.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Invalid token' });

    // 2) Read the OWNER'S entitlement from their profile. Entitlement lives at the
    //    owner level now (the whole point of the multi-business migration), so all
    //    of an owner's businesses share one subscription. This is what decides how
    //    many businesses they may create.
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=plan,subscription_status`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const [profile] = await profileRes.json();
    const plan = (profile?.plan || 'trial').toLowerCase();
    const status = (profile?.subscription_status || '').toLowerCase();

    // A cancelled/past-due account can't add businesses at all.
    const inactive = status === 'cancelled' || status === 'past_due';

    // 3) Tier limit on number of businesses:
    //    Pro (active)      → up to 3
    //    Starter / trial   → 1 (they already have their first from signup, so
    //                         adding another is blocked — this is the upsell point)
    //    cancelled/pastdue → 0 more
    let maxBusinesses;
    if (plan === 'pro' && !inactive) maxBusinesses = 3;
    else if ((plan === 'starter' || plan === 'trial') && !inactive) maxBusinesses = 1;
    else maxBusinesses = 0;

    // Count what they already have.
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${user.id}&select=id`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const owned = await countRes.json().catch(() => []);
    const currentCount = Array.isArray(owned) ? owned.length : 0;

    if (currentCount >= maxBusinesses) {
      // Tailor the message to WHY they're blocked so the frontend can prompt the
      // right next step (upgrade vs. fix billing vs. already at Pro's max of 3).
      let message;
      if (inactive) {
        message = 'Your subscription is not active. Update billing to manage businesses.';
      } else if (plan === 'pro') {
        message = 'Pro includes up to 3 businesses. You have reached that limit.';
      } else {
        message = 'Adding more businesses is a Pro feature. Upgrade to Pro to manage up to 3 businesses.';
      }
      return res.status(403).json({ error: message, code: 'business_limit', plan, limit: maxBusinesses, current: currentCount });
    }

    // 4) Create the business. Mirror setup-business.js: business_type is the owner's
    //    authoritative category pick; retry without the column if the schema lacks it.
    //    We ALSO stamp the owner's current plan/status onto the row (dual-write era)
    //    so any code still reading business-level plan sees a consistent value rather
    //    than an empty/trial default on a Pro owner's 2nd/3rd business.
    const bizBase = {
      owner_id: user.id,
      name,
      location: location || null,
      pos_system: pos || null,
      plan: profile?.plan || 'trial',
      subscription_status: profile?.subscription_status || null
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

    // 5) Create business settings. Same discipline as setup-business.js: only persist
    //    targets the owner actually entered; leaving one NULL lets the app fall back to
    //    the category's own benchmark. Never plant restaurant defaults on other types.
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
    let setRes = await createSettings({ business_type: businessType || 'restaurant' });
    if (!setRes.ok) {
      await createSettings({});
    }

    // 6) IMPORTANT: do NOT touch profiles.business_id here. The owner's ACTIVE
    //    business must stay whatever it was — creating a business is not the same
    //    as switching to it. The switcher (separate step) is what changes the
    //    active business. This prevents yanking the user into a brand-new, empty
    //    business the moment they create it.

    // 7) Return the new id so the frontend can offer to switch to it.
    return res.status(200).json({ ok: true, business_id: business.id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
