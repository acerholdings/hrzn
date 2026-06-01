import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
Return ONLY valid JSON with this exact structure (use 0 for missing values):
{
  "grossSales": number,
  "netSales": number,
  "discounts": number,
  "taxes": number,
  "tips": number,
  "amountCollected": number,
  "itemsSold": number,
  "avgCheck": number,
  "periodStart": "string (date range start or empty)",
  "periodEnd": "string (date range end or empty)",
  "tenders": {
    "creditCard": number,
    "debitCard": number,
    "doorDash": number,
    "cash": number,
    "giftCard": number
  },
  "dailyData": []
}
Rules:
- All money values must be positive numbers (no $ signs, no commas)
- avgCheck = netSales / itemsSold (or 0 if itemsSold is 0)
- Look for "Net Sold" or quantity fields for itemsSold
- DoorDash may appear as "DOORDASH", "Door Dash", "DoorDash", "DD" in tender types
- Return ONLY the JSON object, no explanation, no markdown`,

    items: `You are a data extraction expert. Extract item/menu sales data from this POS report CSV.
Return ONLY valid JSON:
{
  "allItems": [{"name": string, "qty": number, "grossSales": number, "netSales": number, "category": string}],
  "categories": [{"name": string, "sales": number, "items": number}],
  "grossSales": number,
  "netSales": number,
  "totalItemsSold": number,
  "uniqueItems": number,
  "grossProfit": number,
  "grossProfitMargin": number
}
Rules:
- Sort allItems by netSales descending
- Aggregate categories from items
- grossProfit = netSales * 0.65 if not available
- Return ONLY the JSON object, no explanation`,

    employees: `Extract employee/staff sales data from this POS CSV.
Return ONLY valid JSON:
{
  "employees": [{"name": string, "netSales": number, "tips": number}],
  "totalStaff": number,
  "totalNetSales": number,
  "totalTips": number
}
Return ONLY the JSON object, no explanation`,

    guests: `Extract guest count / covers data from this POS CSV.
Return ONLY valid JSON:
{
  "daily": [{"date": string, "guests": number}],
  "totalGuests": number,
  "avgPerDay": number
}
Return ONLY the JSON object, no explanation`,

    orders: `Extract order type breakdown from this POS CSV (dine-in, takeout, delivery etc).
Return ONLY valid JSON:
{
  "orderTypes": [{"name": string, "sales": number, "count": number}]
}
Return ONLY the JSON object, no explanation`,

    discounts: `Extract discount/promo data from this POS CSV.
Return ONLY valid JSON:
{
  "discounts": [{"name": string, "amount": number, "count": number}],
  "totalDiscounts": number
}
Return ONLY the JSON object, no explanation`
  };

  const prompt = prompts[type];
  if (!prompt) return res.status(400).json({ error: 'Unknown type: ' + type });

  // Truncate CSV if too long (keep first 8000 chars which covers most summary reports)
  const csvTruncated = csv.length > 8000 ? csv.substring(0, 8000) + '\n...' : csv;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `${prompt}\n\nCSV DATA:\n${csvTruncated}`
      }]
    });

    const responseText = message.content[0].text.trim();
    
    // Strip markdown code blocks if present
    const cleaned = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    
    // Add metadata
    parsed._source = 'csv';
    parsed._uploadedAt = Date.now();
    parsed.rowCount = csv.split('\n').length;

    return res.status(200).json(parsed);

  } catch (err) {
    // If AI parsing fails, return error with details
    return res.status(500).json({ 
      error: 'Failed to parse CSV: ' + err.message,
      hint: 'Make sure you uploaded the correct file type'
    });
  }
}
