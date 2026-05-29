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

    const cleanAmt = s => parseFloat((s||'').replace(/[$",]/g,'').trim()) || 0;
    const cleanInt = s => parseInt((s||'').replace(/[^0-9]/g,'')) || 0;

    const headerIdx = lines.findIndex(l => l.includes('Order Type') && l.includes('Net Sales'));
    if (headerIdx === -1) return res.status(400).json({ error: 'Could not find order types header' });

    const orderTypes = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.startsWith('Total')) continue;
      const parts = [];
      let inQuote = false, current = '';
      for (const ch of line) {
        if (ch === '"') inQuote = !inQuote;
        else if (ch === ',' && !inQuote) { parts.push(current); current = ''; }
        else current += ch;
      }
      parts.push(current);
      const name = parts[0]?.replace(/"/g,'').trim();
      if (!name) continue;
      orderTypes.push({ name, netSales: cleanAmt(parts[1]), orders: cleanInt(parts[2]) });
    }

    const total = orderTypes.reduce((s,o) => s+o.netSales, 0);
    orderTypes.forEach(o => { o.pctOfSales = total > 0 ? Math.round(o.netSales/total*1000)/10 : 0; });
    orderTypes.sort((a,b) => b.netSales - a.netSales);

    return res.status(200).json({ period, orderTypes, totalNetSales: Math.round(total*100)/100 });
  } catch(error) {
    return res.status(500).json({ error: error.message });
  }
}
