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

    const extract = (label) => {
      const line = lines.find(l => l.startsWith(label));
      if (!line) return 0;
      const match = line.match(/\$?([\d,]+\.?\d*)/g);
      if (!match) return 0;
      return parseFloat(match[match.length - 1].replace(/[$,]/g, '')) || 0;
    };

    // Extract period
    const periodLine = lines[1] || '';
    const period = periodLine.replace(/"/g, '').trim();

    // Extract key metrics
    const grossSales = extract('Gross Sales');
    const discounts = extract('Discounts');
    const netSales = extract('Net Sales');
    const taxes = extract('Taxes & Fees');
    const tips = extract('Tips');
    const amountCollected = extract('Amount Collected');
    const refunds = extract('Refunds');

    // Extract tender types
    const doorDash = extract('DOORDASH');
    const cash = extract('Cash,');
    const creditCard = extract('Credit Card');
    const debitCard = extract('Debit Card');

    // Extract items sold from Revenue Classes
    const revLine = lines.find(l => l.startsWith('Total,') && l.includes('$'));
    let itemsSold = 0;
    if (revLine) {
      const firstNum = revLine.split(',')[1];
      itemsSold = parseInt(firstNum) || 0;
    }

    const avgCheck = itemsSold > 0 ? netSales / itemsSold : 0;
    const doorDashPct = amountCollected > 0 ? (doorDash / amountCollected * 100) : 0;
    const discountPct = grossSales > 0 ? (discounts / grossSales * 100) : 0;

    return res.status(200).json({
      period,
      grossSales,
      discounts,
      discountPct: Math.round(discountPct * 10) / 10,
      netSales,
      taxes,
      tips,
      amountCollected,
      refunds,
      itemsSold,
      avgCheck: Math.round(avgCheck * 100) / 100,
      tenders: {
        creditCard,
        debitCard,
        doorDash,
        cash,
        doorDashPct: Math.round(doorDashPct * 10) / 10
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
