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
    const period = lines[1] ? lines[1].replace(/"/g,'').trim() : '';

    const cleanAmt = s => {
      if (!s || s.trim() === '-' || s.trim() === '') return 0;
      return parseFloat(s.replace(/[$",]/g,'').trim()) || 0;
    };
    const cleanInt = s => {
      if (!s || s.trim() === '-' || s.trim() === '') return 0;
      return parseInt(s.replace(/[^0-9]/g,'')) || 0;
    };

    // Find header row
    const headerIdx = lines.findIndex(l => l.includes('Employee') && l.includes('Gross Sales'));
    if (headerIdx === -1) return res.status(400).json({ error: 'Could not find employee data header' });

    const employees = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.startsWith('Total') || line.startsWith('"Total')) break;

      // Parse CSV line
      const parts = [];
      let inQuote = false, current = '';
      for (const ch of line) {
        if (ch === '"') inQuote = !inQuote;
        else if (ch === ',' && !inQuote) { parts.push(current); current = ''; }
        else current += ch;
      }
      parts.push(current);

      if (!parts[0] || !parts[0].trim()) continue;

      const name = parts[0].replace(/"/g,'').trim();
      if (!name || name === 'Employee') continue;

      employees.push({
        name,
        grossSales: cleanAmt(parts[1]),
        netSales: cleanAmt(parts[2]),
        refunds: cleanAmt(parts[3]),
        discounts: cleanAmt(parts[4]),
        itemsSold: cleanInt(parts[5]),
        tips: cleanAmt(parts[6]),
      });
    }

    // Sort by net sales
    employees.sort((a,b) => b.netSales - a.netSales);

    const totalNet = employees.reduce((s,e) => s+e.netSales, 0);
    const totalTips = employees.reduce((s,e) => s+e.tips, 0);

    employees.forEach(e => {
      e.pctOfSales = totalNet > 0 ? Math.round(e.netSales/totalNet*1000)/10 : 0;
      e.avgPerTransaction = e.itemsSold > 0 ? Math.round(e.netSales/e.itemsSold*100)/100 : 0;
    });

    return res.status(200).json({
      period,
      employees,
      totalStaff: employees.length,
      totalNetSales: Math.round(totalNet*100)/100,
      totalTips: Math.round(totalTips*100)/100,
      topPerformer: employees[0]?.name || null,
    });

  } catch(error) {
    return res.status(500).json({ error: error.message });
  }
}
