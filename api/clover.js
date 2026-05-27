export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.CLOVER_API_TOKEN;
  const MID = process.env.CLOVER_MERCHANT_ID;
  const BASE = `https://api.clover.com/v3/merchants/${MID}`;
  const HEADERS = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

  const { type } = req.query;

  try {
    // Get date range — last 7 days
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

    if (type === 'orders') {
      // Fetch orders from last 7 days
      const r = await fetch(
        `${BASE}/orders?filter=createdTime>=${weekAgo}&filter=createdTime<${now}&limit=500&expand=lineItems`,
        { headers: HEADERS }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (type === 'payments') {
      // Fetch payments from last 7 days
      const r = await fetch(
        `${BASE}/payments?filter=createdTime>=${weekAgo}&filter=createdTime<${now}&limit=500`,
        { headers: HEADERS }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (type === 'items') {
      // Fetch menu items
      const r = await fetch(
        `${BASE}/items?limit=200`,
        { headers: HEADERS }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (type === 'summary') {
      // Fetch payments and compute summary stats
      const r = await fetch(
        `${BASE}/payments?filter=createdTime>=${weekAgo}&filter=createdTime<${now}&limit=500`,
        { headers: HEADERS }
      );
      const data = await r.json();
      const payments = data.elements || [];

      // Calculate totals
      const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0) / 100;
      const totalCount = payments.length;
      const avgCheck = totalCount > 0 ? totalRevenue / totalCount : 0;

      // Group by day
      const byDay = {};
      payments.forEach(p => {
        const date = new Date(p.createdTime);
        const day = date.toLocaleDateString('en-US', { weekday: 'short' });
        if (!byDay[day]) byDay[day] = { revenue: 0, count: 0 };
        byDay[day].revenue += (p.amount || 0) / 100;
        byDay[day].count += 1;
      });

      return res.status(200).json({
        totalRevenue: Math.round(totalRevenue),
        totalTransactions: totalCount,
        avgCheck: Math.round(avgCheck * 100) / 100,
        byDay,
        raw: payments.slice(0, 10) // sample for debugging
      });
    }

    if (type === 'merchant') {
      const r = await fetch(`${BASE}`, { headers: HEADERS });
      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Invalid type. Use: summary, orders, payments, items, merchant' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
