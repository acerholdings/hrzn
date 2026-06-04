const ADMIN_EMAILS = ['au@gmail.com']; // Add more admin emails here

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

  // Verify admin token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    // Verify user identity
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.email) return res.status(401).json({ error: 'Invalid token' });
    if (!ADMIN_EMAILS.includes(user.email)) return res.status(403).json({ error: 'Not authorized' });

    // ── GET: Fetch all users and business data ──
    if (req.method === 'GET') {
      // Get all businesses
      const bizRes = await fetch(
        `${SUPABASE_URL}/rest/v1/businesses?select=*&order=created_at.desc`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const businesses = await bizRes.json();

      // Get all profiles (user_id → business_id mapping)
      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=*`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const profiles = await profRes.json();

      // Get all auth users (email, created_at, last_sign_in)
      const authRes = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const authData = await authRes.json();
      const authUsers = authData.users || [];

      // Get sales data (to show if CSV uploaded)
      const salesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sales_data?select=business_id,net_sales,period_start,period_end,created_at`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const salesData = await salesRes.json();

      // Get menu data (to show if item sales uploaded)
      const menuRes = await fetch(
        `${SUPABASE_URL}/rest/v1/menu_data?select=business_id,created_at`,
        { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
      );
      const menuData = await menuRes.json();

      // Build user map
      const profileMap = {};
      profiles.forEach(p => { profileMap[p.id] = p.business_id; });

      const salesMap = {};
      salesData.forEach(s => { salesMap[s.business_id] = s; });

      const menuMap = {};
      menuData.forEach(m => { menuMap[m.business_id] = true; });

      // Build lookup maps
      const ownerMap = {};  // auth user id → business
      businesses.forEach(b => { if (b.owner_id) ownerMap[b.owner_id] = b; });

      const profileEmailMap = {}; // email → business_id
      profiles.forEach(p => { if (p.email && p.business_id) profileEmailMap[p.email] = p.business_id; });

      // Merge everything into user records
      const users = authUsers.map(u => {
        const bizId = profileMap[u.id]                          // profiles.id match
                   || profileEmailMap[u.email];                  // profiles.email match
        const biz = (bizId ? businesses.find(b => b.id === bizId) : null)
                 || ownerMap[u.id]                               // businesses.owner_id match
                 || {};
        const resolvedBizId = biz.id || bizId || null;
        const sales = salesMap[bizId] || null;
        const hasMenu = menuMap[bizId] || false;

        const createdAt = new Date(u.created_at);
        const trialEnd = new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
        const now = new Date();
        const daysLeft = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));

        return {
          id: u.id,
          email: u.email,
          createdAt: u.created_at,
          lastSignIn: u.last_sign_in_at,
          businessId: resolvedBizId || null,
          businessName: biz.name || '—',
          location: biz.location || '—',
          plan: biz.plan || 'trial',
          subscriptionStatus: biz.subscription_status || 'trialing',
          stripeCustomerId: biz.stripe_customer_id || null,
          daysLeftInTrial: daysLeft,
          salesUploaded: !!sales,
          salesPeriod: sales ? `${sales.period_start} – ${sales.period_end}` : null,
          netSales: sales?.net_sales || 0,
          menuUploaded: hasMenu,
        };
      });

      // Revenue summary
      const proUsers = users.filter(u => u.plan === 'pro');
      const trialUsers = users.filter(u => u.plan === 'trial');
      // Pricing: Starter=$99/mo, Pro=$299/mo
      const starterUsers = users.filter(u => u.plan === 'starter');
      const mrr = (proUsers.length * 299) + (starterUsers.length * 99);

      return res.status(200).json({
        ok: true,
        summary: {
          totalUsers: users.length,
          proUsers: proUsers.length,
          trialUsers: trialUsers.length,
          mrr,
          arr: mrr * 12,
        },
        users
      });
    }

    // ── POST: Admin actions ──
    if (req.method === 'POST') {
      console.log('POST body:', JSON.stringify(req.body));
    const { action, businessId, plan } = req.body || {};

      if (action === 'set_plan') {
        // Manually set a user's plan
        if (!businessId || businessId === 'undefined' || businessId === 'null') {
          return res.status(400).json({ error: 'Body: ' + JSON.stringify(req.body) });
        }
        const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ plan, subscription_status: plan === 'pro' ? 'active' : 'trialing' })
        });
        const patchText = await r.text();
        console.log('Supabase PATCH status:', r.status, 'body:', patchText);
        if (!r.ok) return res.status(500).json({ error: 'Supabase PATCH failed (' + r.status + '): ' + patchText });
        return res.status(200).json({ ok: true });
      }

      if (action === 'extend_trial') {
        // Extend trial by 7 days — we store this as a custom field
        const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ trial_extended: true, trial_extended_at: new Date().toISOString() })
        });
        return res.status(200).json({ ok: r.ok });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
