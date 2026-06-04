export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { type, csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'No CSV data provided' });

  const prompts = {
    sales: `You are a data extraction expert. Extract financial data from this POS sales report CSV.
The CSV may be from any POS system (Clover, Square, Toast, Lightspeed, etc.) in any format.
Return ONLY a valid JSON object with this exact structure (use 0 for missing values, no $ signs, no commas in numbers):
{"grossSales":number,"netSales":number,"discounts":number,"taxes":number,"tips":number,"amountCollected":number,"itemsSold":number,"avgCheck":number,"periodStart":"string","periodEnd":"string","periodDays":number,"tenders":{"creditCard":number,"debitCard":number,"doorDash":number,"cash":number,"giftCard":number},"dailyData":[]}
Rules:
- All money = positive numbers (no $ signs, no commas)
- avgCheck = netSales/itemsSold (or 0)
- DoorDash may appear as DOORDASH/Door Dash/DD in tender types
- periodStart and periodEnd = the date range strings from the report header
- periodDays = EXACT number of days in the report period (calculate from start/end dates). This is critical - do NOT assume 30 days. Count the actual days between start and end dates.
- Return ONLY the JSON, no markdown, no explanation.`,

    items: `Extract item/product sales data from this POS CSV. Return ONLY valid JSON with no markdown.
IMPORTANT: Escape all special characters in string values. Replace apostrophes and quotes in item names with spaces if needed to ensure valid JSON.
{"allItems":[{"name":"string","sold":number,"grossSales":number,"netSales":number,"category":"string","avgPrice":number,"pctOfNet":number}],"categories":[{"name":"string","netSales":number,"sold":number,"itemCount":number,"pctOfNet":number}],"grossSales":number,"netSales":number,"totalItemsSold":number,"uniqueItems":number,"grossProfit":number,"grossProfitMargin":number}
Rules:
- Sort allItems by netSales descending
- grossProfit = netSales * 0.65 if not in CSV
- avgPrice = netSales/sold per item (0 if sold=0)
- pctOfNet = item netSales / total netSales * 100
- CRITICAL: item names must be valid JSON strings — escape or remove any quotes/backslashes
- Return ONLY the JSON object, absolutely no other text`,

    employees: `Extract employee sales data from this POS CSV. Return ONLY valid JSON:
{"employees":[{"name":"string","netSales":number,"tips":number}],"totalStaff":number,"totalNetSales":number,"totalTips":number}
Return ONLY JSON.`,

    guests: `Extract guest/covers count data from this POS CSV. Return ONLY valid JSON:
{"daily":[{"date":"string","guests":number}],"totalGuests":number,"avgPerDay":number}
Return ONLY JSON.`,

    orders: `Extract order type breakdown from this POS CSV. Return ONLY valid JSON:
{"orderTypes":[{"name":"string","sales":number,"count":number}]}
Return ONLY JSON.`,

    discounts: `Extract discount data from this POS CSV. Return ONLY valid JSON:
{"discounts":[{"name":"string","amount":number,"count":number}],"totalDiscounts":number}
Return ONLY JSON.`
  };

  const prompt = prompts[type];
  if (!prompt) return res.status(400).json({ error: 'Unknown type: ' + type });

  // For items CSV, allow more data since item lists can be long
  // For 'items' type: use deterministic CSV parser (handles all items, no token limits)
  if (type === 'items') {
    try {
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
  
    } catch(itemErr) {
      return res.status(500).json({ error: 'Failed to parse Item Sales CSV: ' + itemErr.message });
    }
  }

  const csvLimit = type === 'items' ? 30000 : 8000;
  const csvTruncated = csv.length > csvLimit ? csv.substring(0, csvLimit) + '\n...' : csv;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: type === 'items' ? 8192 : 2048,
        messages: [{
          role: 'user',
          content: `${prompt}\n\nCSV DATA:\n${csvTruncated}`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'AI API error: ' + err.substring(0, 200) });
    }

    const aiData = await response.json();
    const responseText = aiData.content[0].text.trim();

    // Strip markdown if present
    let cleaned = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Extract JSON object/array if wrapped in extra text
    const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]\}]/);
    if (jsonMatch) cleaned = jsonMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch(parseErr) {
      // Attempt to sanitize common issues: control chars, unescaped special chars
      const sanitized = cleaned
        .replace(/[\x00-\x1F\x7F]/g, ' ')  // remove control chars
        .replace(/([^\\])\\([^"\\/bfnrtu])/g, '$1 $2'); // fix bad escapes
      try {
        parsed = JSON.parse(sanitized);
      } catch(e2) {
        // Last resort: try to close truncated JSON by finding last complete item
        try {
          // Find last complete object in array (ends with })
          const lastComplete = sanitized.lastIndexOf('},');
          if (lastComplete > 100) {
            const truncFixed = sanitized.substring(0, lastComplete + 1) + ']}';
            // Try wrapping in expected structure
            const wrapped = sanitized.startsWith('{"allItems"') 
              ? sanitized.substring(0, lastComplete + 1) + '],"categories":[],"grossSales":0,"netSales":0,"totalItemsSold":0,"uniqueItems":0,"grossProfit":0,"grossProfitMargin":0}'
              : truncFixed;
            parsed = JSON.parse(wrapped);
          } else {
            return res.status(500).json({ error: 'Failed to parse CSV: ' + parseErr.message + '. Try re-exporting the CSV from Clover.' });
          }
        } catch(e3) {
          return res.status(500).json({ error: 'Failed to parse CSV: ' + parseErr.message + '. Try re-exporting the CSV from Clover.' });
        }
      }
    }
    parsed._source = 'csv';
    parsed._uploadedAt = Date.now();
    parsed.rowCount = csv.split('\n').length;

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to parse CSV: ' + err.message,
      hint: 'Make sure you uploaded the correct file type'
    });
  }
}
