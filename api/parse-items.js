export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: 'No CSV data provided' });

    const lines = csv.split('\n').map(l => l.trim());

    // Extract period from line 2
    const period = lines[1] ? lines[1].replace(/"/g, '').trim() : '';

    // Parse summary totals from header
    const parseAmt = (label) => {
      const line = lines.find(l => l.startsWith(label + ','));
      if (!line) return 0;
      const m = line.match(/\$?([\d,]+\.?\d*)/g);
      if (!m) return 0;
      return parseFloat(m[m.length-1].replace(/[$,]/g,'')) || 0;
    };

    const grossSales = parseAmt('Gross Sales');
    const netSales = parseAmt('Net Sales');
    const grossProfit = parseAmt('Gross Profit');
    const grossProfitMargin = parseFloat((lines.find(l=>l.startsWith('Gross Profit Margin'))||'').replace(/[^0-9.]/g,'')) || 0;

    // Parse items - format:
    // Category row: "CategoryName" (no leading comma)
    // Item row: ,ItemName,"$gross","$net",sold,refunded,...
    // Modifier row: ,,"...",... (empty name = modifier)
    // Total row: Total (Category),...

    const items = [];
    const categories = {};
    let currentCategory = null;

    const cleanAmt = (s) => {
      if (!s || s.trim() === '-' || s.trim() === ' ' || s.trim() === '') return 0;
      return parseFloat(s.replace(/[$",]/g,'').trim()) || 0;
    };

    const cleanInt = (s) => {
      if (!s || s.trim() === '-' || s.trim() === ' ' || s.trim() === '') return 0;
      return parseInt(s.replace(/[^0-9]/g,'')) || 0;
    };

    // Split CSV respecting quoted fields
    const parseCSVLine = (line) => {
      const result = [];
      let inQuote = false, current = '';
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { result.push(current); current = ''; }
        else { current += ch; }
      }
      result.push(current);
      return result;
    };

    for (let i = 7; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const parts = parseCSVLine(line);

      // Skip summary header rows
      const SKIP_ROWS = ['Gross Sales','Net Sales','COGS','Gross Profit','Gross Profit Margin','Category Name','TOTAL','Items Report','Filters','Categories','The report'];
      if (SKIP_ROWS.some(s => line.startsWith(s))) continue;

      // Category header - doesn't start with comma, not a Total row
      if (!line.startsWith(',') && !line.startsWith('Total') && !line.startsWith('"Total') && parts[0] && parts[0].trim() !== '') {
        currentCategory = parts[0].replace(/"/g,'').trim();
        if (!categories[currentCategory]) categories[currentCategory] = { name: currentCategory, grossSales: 0, netSales: 0, sold: 0, items: [] };
        continue;
      }

      // Total row - skip
      if (line.startsWith('Total') || line.startsWith('"Total')) continue;

      // Item row - starts with comma, has a name in col 1, has dollar amounts
      if (line.startsWith(',') && parts[1] && parts[1].trim() !== '' && parts[1].trim() !== ' ') {
        const name = parts[1].replace(/"/g,'').trim();
        if (!name || name === ' ') continue;

        const gross = cleanAmt(parts[2]);
        const net = cleanAmt(parts[3]);
        const sold = cleanInt(parts[4]);
        const refunded = cleanInt(parts[5]);
        const discounts = cleanAmt(parts[9]);
        // Calculate avg price from net sales / sold (more accurate than Clover's col 11)
        const avgItemSize = sold > 0 ? Math.round(cleanAmt(parts[3]) / sold * 100) / 100 : 0;
        const itemGrossProfit = cleanAmt(parts[13]);

        if (gross === 0 && net === 0 && sold === 0) continue; // skip empty/modifier-only rows

        const item = {
          name,
          category: currentCategory || 'Uncategorized',
          grossSales: gross,
          netSales: net,
          sold,
          refunded,
          discounts,
          avgPrice: avgItemSize,
          grossProfit: itemGrossProfit,
          profitMargin: gross > 0 ? Math.round(itemGrossProfit / gross * 100) : 0,
          pctOfNet: 0 // calculated after
        };

        items.push(item);
        if (currentCategory && categories[currentCategory]) {
          categories[currentCategory].grossSales += gross;
          categories[currentCategory].netSales += net;
          categories[currentCategory].sold += sold;
          categories[currentCategory].items.push(item);
        }
      }
    }

    // Calculate pct of net for each item
    items.forEach(item => {
      item.pctOfNet = netSales > 0 ? Math.round(item.netSales / netSales * 1000) / 10 : 0;
    });

    // Sort items by net sales descending
    items.sort((a, b) => b.netSales - a.netSales);

    // Top 20 items
    const top20 = items.slice(0, 20);

    // Category summary sorted by net sales
    const categorySummary = Object.values(categories)
      .map(c => ({
        name: c.name,
        grossSales: Math.round(c.grossSales * 100) / 100,
        netSales: Math.round(c.netSales * 100) / 100,
        sold: c.sold,
        itemCount: c.items.length,
        pctOfNet: netSales > 0 ? Math.round(c.netSales / netSales * 1000) / 10 : 0
      }))
      .sort((a, b) => b.netSales - a.netSales);

    // Best and worst performers
    const itemsWithMargin = items.filter(i => i.grossProfit > 0 && i.sold >= 5);
    const topMargin = [...itemsWithMargin].sort((a,b) => b.profitMargin - a.profitMargin).slice(0,5);
    const lowMargin = [...itemsWithMargin].sort((a,b) => a.profitMargin - b.profitMargin).slice(0,5);
    const topVolume = [...items].sort((a,b) => b.sold - a.sold).slice(0,5);
    const topRevenue = [...items].sort((a,b) => b.netSales - a.netSales).slice(0,5);

    return res.status(200).json({
      period,
      grossSales: Math.round(grossSales * 100) / 100,
      netSales: Math.round(netSales * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossProfitMargin,
      totalItemsSold: items.reduce((s,i) => s+i.sold, 0),
      uniqueItems: items.length,
      items: top20,
      allItems: items,
      categories: categorySummary,
      insights: {
        topMargin,
        lowMargin,
        topVolume,
        topRevenue
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
