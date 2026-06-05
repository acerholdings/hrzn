export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Get user from token
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.replace('Bearer ', '');

  try {
    // Verify token and get user
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Invalid token' });

    // Get business_id for this user
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=business_id`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    const [profile] = await profileRes.json();
    const businessId = profile?.business_id;

    // ── GET: Load user's data from Supabase ──────────────────────
    if (req.method === 'GET') {
      const results = {};

      if (businessId) {
        // Load sales data
        const salesRes = await fetch(
          `${SUPABASE_URL}/rest/v1/sales_data?business_id=eq.${businessId}&order=created_at.desc&limit=1`,
          { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
        );
        const [sales] = await salesRes.json();
        if (sales) results.salesData = sales.raw_data;

        // Load menu data
        const menuRes = await fetch(
          `${SUPABASE_URL}/rest/v1/menu_data?business_id=eq.${businessId}&order=created_at.desc&limit=1`,
          { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
        );
        const [menu] = await menuRes.json();
        if (menu) {
          results.menuData = {
            grossProfitMargin: menu.gross_profit_margin,
            totalItemsSold: menu.total_items_sold,
            uniqueItems: menu.unique_items,
            grossSales: menu.gross_sales,
            netSales: menu.net_sales,
            grossProfit: menu.gross_profit,
            allItems: menu.items || [],
            items: menu.items || [],
            categories: menu.categories || [],
            _filename: menu.filename || null,
            _restoredFromCloud: true,
          };
        }

        // Load labor data
        const laborRes = await fetch(
          `${SUPABASE_URL}/rest/v1/labor_data?business_id=eq.${businessId}&order=created_at.desc&limit=1`,
          { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
        );
        const [labor] = await laborRes.json();
        if (labor) results.laborData = labor;

        // Load P&L data
        const plRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pl_data?business_id=eq.${businessId}&limit=1`,
          { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
        );
        const [pl] = await plRes.json();
        if (pl) results.plData = pl;

        // Load settings
        const settingsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/business_settings?business_id=eq.${businessId}&limit=1`,
          { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
        );
        const [settings] = await settingsRes.json();
        if (settings) results.settings = {
          ...settings,
          items_csv_filename: settings.items_csv_filename || null,
        };

        // Load business info
        const bizRes = await fetch(
          `${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&limit=1`,
          { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
        );
        const [biz] = await bizRes.json();
        if (biz) results.business = biz;
      }

      return res.status(200).json({ ok: true, data: results, businessId });
    }

    // ── POST: Save user's data to Supabase ───────────────────────
    if (req.method === 'POST') {
      const { type, data } = req.body;
      if (!type || !data) return res.status(400).json({ error: 'Missing type or data' });
      if (!businessId) return res.status(400).json({ error: 'No business found for user' });

      if (type === 'sales') {
        // Upsert sales data
        await fetch(`${SUPABASE_URL}/rest/v1/sales_data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            business_id: businessId,
            source: 'csv',
            period_start: data.periodStart || null,
            period_end: data.periodEnd || null,
            gross_sales: data.grossSales || 0,
            net_sales: data.netSales || 0,
            discounts: data.discounts || 0,
            taxes: data.taxes || 0,
            tips: data.tips || 0,
            amount_collected: data.amountCollected || 0,
            items_sold: data.itemsSold || 0,
            avg_item_price: data.avgCheck || 0,
            credit_card: data.tenders?.creditCard || 0,
            debit_card: data.tenders?.debitCard || 0,
            doordash: data.tenders?.doorDash || 0,
            cash: data.tenders?.cash || 0,
            raw_data: data
          })
        });
      }

      if (type === 'menu') {
        await fetch(`${SUPABASE_URL}/rest/v1/menu_data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY
          },
          body: JSON.stringify({
            business_id: businessId,
            source: 'csv',
            gross_sales: data.grossSales || 0,
            net_sales: data.netSales || 0,
            gross_profit: data.grossProfit || 0,
            gross_profit_margin: data.grossProfitMargin || 0,
            total_items_sold: data.totalItemsSold || 0,
            unique_items: data.uniqueItems || 0,
            items: data.allItems || data.items || [],
            categories: data.categories || [],
            filename: data._filename || null
          })
        });
      }

      if (type === 'labor') {
        await fetch(`${SUPABASE_URL}/rest/v1/labor_data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY
          },
          body: JSON.stringify({
            business_id: businessId,
            source: 'csv',
            total_staff: data.totalStaff || 0,
            total_net_sales: data.totalNetSales || 0,
            total_tips: data.totalTips || 0,
            employees: data.employees || []
          })
        });
      }

      if (type === 'pl') {
        // Upsert P&L (one per business)
        await fetch(`${SUPABASE_URL}/rest/v1/pl_data?business_id=eq.${businessId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
        });
        await fetch(`${SUPABASE_URL}/rest/v1/pl_data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY
          },
          body: JSON.stringify({
            business_id: businessId,
            food_cost: data.food_cost || 0,
            labor: data.labor || 0,
            rent: data.rent || 0,
            utilities: data.utilities || 0,
            insurance: data.insurance || 0,
            supplies: data.supplies || 0,
            marketing: data.marketing || 0,
            other: data.other || 0,
            debt: data.debt || 0
          })
        });
      }

      if (type === 'settings') {
        await fetch(`${SUPABASE_URL}/rest/v1/business_settings?business_id=eq.${businessId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY
          },
          body: JSON.stringify({
            target_labor_pct: data.labor || 28,
            target_food_cost_pct: data.food || 30,
            target_weekly_revenue: data.revenue || 12000,
            target_avg_check: data.check || 15,
            target_doordash_pct: data.doordash || 10,
            target_discount_pct: data.discount || 5,
            items_csv_filename: data.items_csv_filename || null,
          })
        });
      }

      return res.status(200).json({ ok: true });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
