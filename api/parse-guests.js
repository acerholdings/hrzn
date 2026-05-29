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

    const cleanInt = s => {
      if (!s || s.trim() === '-' || s.trim() === '') return 0;
      return parseInt(s.replace(/[^0-9]/g,'')) || 0;
    };
    const cleanAmt = s => {
      if (!s || s.trim() === '-' || s.trim() === '') return 0;
      return parseFloat(s.replace(/[$",]/g,'').trim()) || 0;
    };

    // Find header
    const headerIdx = lines.findIndex(l => l.includes('Date') && (l.includes('Guest') || l.includes('Cover')));
    if (headerIdx === -1) return res.status(400).json({ error: 'Could not find guest count header' });

    const days = [];
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

      const date = parts[0]?.replace(/"/g,'').trim();
      if (!date) continue;

      days.push({
        date,
        guests: cleanInt(parts[1]),
        orders: cleanInt(parts[2]),
        revenue: cleanAmt(parts[3]),
      });
    }

    const totalGuests = days.reduce((s,d) => s+d.guests, 0);
    const totalOrders = days.reduce((s,d) => s+d.orders, 0);
    const avgPerDay = days.length > 0 ? Math.round(totalGuests/days.length) : 0;
    const avgPerWeek = Math.round(avgPerDay * 7);

    return res.status(200).json({
      period,
      days,
      totalGuests,
      totalOrders,
      avgGuestsPerDay: avgPerDay,
      avgGuestsPerWeek: avgPerWeek,
      avgGuestsPerOrder: totalOrders > 0 ? Math.round(totalGuests/totalOrders*10)/10 : 0,
    });

  } catch(error) {
    return res.status(500).json({ error: error.message });
  }
}
