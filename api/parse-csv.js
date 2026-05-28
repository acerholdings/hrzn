export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: 'No CSV data provided' });

    const lines = csv.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Parse a dollar value from a CSV line by label
    const extractVal = (label) => {
      const line = lines.find(l => l.startsWith(label + ',') || l.startsWith('"' + label + '",'));
      if (!line) return 0;
      // Extract all numbers with decimals (handles negative, quoted, dollar signs)
      const numMatches = line.match(/[\d,]+\.\d{2}/g);
      if (!numMatches) return 0;
      // Get the last number on the line
      const last = numMatches[numMatches.length - 1].replace(/,/g, '');
      return parseFloat(last) || 0;
    };

    // Extract period from line 2
    const period = lines[1] ? lines[1].replace(/"/g, '').trim() : '';

    // SALES section
    const grossSales = extractVal('Gross Sales');
    const discounts = Math.abs(extractVal('Discounts'));
    const refunds = extractVal('Refunds');
    const netSales = extractVal('Net Sales');
    const taxes = extractVal('Taxes & Fees');
    const tips = extractVal('Tips');
    const largeParty = extractVal('Large Party');
    const amountCollected = extractVal('Amount Collected');

    // TENDER TYPES — find lines after "TENDER TYPES" header
    const tenderStart = lines.findIndex(l => l.startsWith('TENDER TYPES'));
    let creditCard = 0, debitCard = 0, doorDash = 0, cash = 0;
    if (tenderStart > -1) {
      for (let i = tenderStart + 1; i < Math.min(tenderStart + 10, lines.length); i++) {
        const l = lines[i];
        const amounts = l.match(/\$([\d,]+\.\d{2})/g);
        if (!amounts) continue;
        const val = parseFloat(amounts[0].replace(/[$,]/g, '')) || 0;
        if (l.startsWith('Credit Card')) creditCard = val;
        else if (l.startsWith('Debit Card')) debitCard = val;
        else if (l.startsWith('DOORDASH') || l.startsWith('DoorDash')) doorDash = val;
        else if (l.startsWith('Cash,')) cash = val;
      }
    }

    // CARD TYPES
    const cardStart = lines.findIndex(l => l.startsWith('SALES BY CARD TYPE'));
    let visa = 0, amex = 0, mastercard = 0, discover = 0;
    if (cardStart > -1) {
      for (let i = cardStart + 1; i < Math.min(cardStart + 10, lines.length); i++) {
        const l = lines[i];
        const amounts = l.match(/\$([\d,]+\.\d{2})/g);
        if (!amounts) continue;
        const val = parseFloat(amounts[0].replace(/[$,]/g, '')) || 0;
        if (l.startsWith('Visa')) visa = val;
        else if (l.startsWith('American Express')) amex = val;
        else if (l.startsWith('MasterCard') || l.startsWith('Mastercard')) mastercard = val;
        else if (l.startsWith('Discover')) discover = val;
      }
    }

    // REVENUE CLASSES — items sold is in Total row
    const revStart = lines.findIndex(l => l.startsWith('REVENUE CLASSES'));
    let itemsSold = 0;
    if (revStart > -1) {
      for (let i = revStart + 1; i < Math.min(revStart + 5, lines.length); i++) {
        const l = lines[i];
        if (l.startsWith('Total,')) {
          const parts = l.split(',');
          itemsSold = parseInt(parts[1]) || 0;
          break;
        }
      }
    }

    const avgCheck = itemsSold > 0 ? netSales / itemsSold : 0;
    const discountPct = grossSales > 0 ? (discounts / grossSales * 100) : 0;
    const doorDashPct = amountCollected > 0 ? (doorDash / amountCollected * 100) : 0;
    const tipsPct = netSales > 0 ? (tips / netSales * 100) : 0;

    // Card split percentages
    const cardTotal = visa + amex + mastercard + discover;
    const visaPct = cardTotal > 0 ? Math.round(visa / cardTotal * 100) : 0;
    const amexPct = cardTotal > 0 ? Math.round(amex / cardTotal * 100) : 0;
    const mcPct = cardTotal > 0 ? Math.round(mastercard / cardTotal * 100) : 0;
    const discoverPct = cardTotal > 0 ? Math.round(discover / cardTotal * 100) : 0;

    return res.status(200).json({
      period,
      grossSales: Math.round(grossSales * 100) / 100,
      discounts: Math.round(discounts * 100) / 100,
      discountPct: Math.round(discountPct * 10) / 10,
      refunds,
      netSales: Math.round(netSales * 100) / 100,
      taxes: Math.round(taxes * 100) / 100,
      tips: Math.round(tips * 100) / 100,
      tipsPct: Math.round(tipsPct * 10) / 10,
      largeParty: Math.round(largeParty * 100) / 100,
      amountCollected: Math.round(amountCollected * 100) / 100,
      itemsSold,
      avgCheck: Math.round(avgCheck * 100) / 100,
      tenders: {
        creditCard: Math.round(creditCard * 100) / 100,
        debitCard: Math.round(debitCard * 100) / 100,
        doorDash: Math.round(doorDash * 100) / 100,
        cash: Math.round(cash * 100) / 100,
        doorDashPct: Math.round(doorDashPct * 10) / 10,
      },
      cardSplit: { visa, amex, mastercard, discover, visaPct, amexPct, mcPct, discoverPct }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
