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
{"grossSales":number,"netSales":number,"discounts":number,"taxes":number,"tips":number,"amountCollected":number,"itemsSold":number,"avgCheck":number,"periodStart":"string","periodEnd":"string","tenders":{"creditCard":number,"debitCard":number,"doorDash":number,"cash":number,"giftCard":number},"dailyData":[]}
Rules: All money = positive numbers. avgCheck = netSales/itemsSold. DoorDash may appear as DOORDASH/Door Dash/DD. Return ONLY the JSON, no markdown, no explanation.`,

    items: `Extract item/menu sales data from this POS CSV. Return ONLY valid JSON:
{"allItems":[{"name":"string","qty":number,"grossSales":number,"netSales":number,"category":"string"}],"categories":[{"name":"string","sales":number,"items":number}],"grossSales":number,"netSales":number,"totalItemsSold":number,"uniqueItems":number,"grossProfit":number,"grossProfitMargin":number}
Sort allItems by netSales desc. grossProfit=netSales*0.65 if unknown. Return ONLY JSON.`,

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

  const csvTruncated = csv.length > 8000 ? csv.substring(0, 8000) + '\n...' : csv;

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
        max_tokens: 1024,
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
    const cleaned = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
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
