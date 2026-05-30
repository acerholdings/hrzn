export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { token, name, location, pos, targets } = req.body;
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

    // Create business
    const bizRes = await fetch(`${SUPABASE_URL}/rest/v1/businesses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        owner_id: user.id,
        name,
        location: location || null,
        pos_system: pos || null,
        plan: 'trial'
      })
    });
    const [business] = await bizRes.json();
    if (!business?.id) return res.status(500).json({ error: 'Failed to create business' });

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

    // Create business settings with targets
    await fetch(`${SUPABASE_URL}/rest/v1/business_settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      },
      body: JSON.stringify({
        business_id: business.id,
        target_labor_pct: parseFloat(targets?.labor || 28),
        target_food_cost_pct: parseFloat(targets?.food || 30),
        target_weekly_revenue: parseFloat(targets?.revenue || 12000),
        target_avg_check: parseFloat(targets?.check || 15),
        target_doordash_pct: parseFloat(targets?.delivery || 10),
      })
    });

    return res.status(200).json({ ok: true, business_id: business.id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
