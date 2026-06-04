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
{"allItems":[{"name":"string","qty":number,"grossSales":number,"netSales":number,"sold":number,"category":"string","avgPrice":number,"pctOfNet":number}],"categories":[{"name":"string","netSales":number,"sold":number,"itemCount":number,"pctOfNet":number}],"grossSales":number,"netSales":number,"totalItemsSold":number,"uniqueItems":number,"grossProfit":number,"grossProfitMargin":number}
Rules:
- Sort allItems by netSales descending
- grossProfit = netSales * 0.65 if not in CSV
- avgPrice = netSales/sold per item (0 if sold=0)
- pctOfNet = item netSales / total netSales * 100
- CRITICAL: item names must be valid JSON strings — escape or remove any quotes/backslashes
- Include MAX 50 items in allItems (top 50 by netSales) to keep response concise
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
  const csvLimit = type === 'items' ? 12000 : 8000;
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
        max_tokens: type === 'items' ? 4096 : 2048,
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
