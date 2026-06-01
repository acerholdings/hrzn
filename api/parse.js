export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { type, csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'No CSV data provided' });

  try {
    switch(type) {
      case 'sales': return res.status(200).json(parseSales(csv));
      case 'items': return res.status(200).json(parseItems(csv));
      case 'employees': return res.status(200).json(parseEmployees(csv));
      case 'guests': return res.status(200).json(parseGuests(csv));
      case 'orders': return res.status(200).json(parseOrders(csv));
      case 'discounts': return res.status(200).json(parseDiscounts(csv));
      default: return res.status(400).json({ error: 'Unknown type' });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

function parseCSVRows(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i] || '');
    return row;
  });
}

function parseMoney(val) {
  if (!val) return 0;
  return parseFloat(String(val).replace(/[$,]/g, '')) || 0;
}

function parseSales(csv) {
  const rows = parseCSVRows(csv);
  let grossSales=0, discounts=0, netSales=0, taxes=0, tips=0, amountCollected=0;
  let creditCard=0, debitCard=0, doorDash=0, cash=0, giftCard=0;
  let itemsSold=0;
  const dailyData = [];

  rows.forEach(row => {
    const date = row['Date'] || row['date'] || '';
    const gross = parseMoney(row['Gross Sales'] || row['gross_sales'] || 0);
    const net = parseMoney(row['Net Sales'] || row['net_sales'] || 0);
    const disc = parseMoney(row['Discounts'] || row['discounts'] || 0);
    const tax = parseMoney(row['Tax'] || row['taxes'] || 0);
    const tip = parseMoney(row['Tips'] || row['tips'] || 0);
    const collected = parseMoney(row['Amount Collected'] || row['amount_collected'] || 0);
    const items = parseInt(row['Items Sold'] || row['items_sold'] || 0);
    const cc = parseMoney(row['Credit Card'] || 0);
    const dc = parseMoney(row['Debit Card'] || 0);
    const dd = parseMoney(row['DoorDash'] || 0);
    const ca = parseMoney(row['Cash'] || 0);
    const gc = parseMoney(row['Gift Card'] || 0);

    grossSales += gross; netSales += net; discounts += disc;
    taxes += tax; tips += tip; amountCollected += collected;
    itemsSold += items; creditCard += cc; debitCard += dc;
    doorDash += dd; cash += ca; giftCard += gc;

    if (date) dailyData.push({ date, grossSales: gross, netSales: net, tips: tip });
  });

  return {
    grossSales, netSales, discounts, taxes, tips, amountCollected, itemsSold,
    avgCheck: itemsSold > 0 ? netSales / itemsSold : 0,
    tenders: { creditCard, debitCard, doorDash, cash, giftCard },
    dailyData,
    rowCount: rows.length
  };
}

function parseItems(csv) {
  const rows = parseCSVRows(csv);
  const items = [];
  let totalGross=0, totalNet=0, totalItems=0;

  rows.forEach(row => {
    const name = row['Item'] || row['Name'] || row['item'] || '';
    const qty = parseInt(row['Qty'] || row['Quantity'] || row['qty'] || 0);
    const gross = parseMoney(row['Gross Sales'] || row['gross'] || 0);
    const net = parseMoney(row['Net Sales'] || row['net'] || 0);
    const category = row['Category'] || row['category'] || 'Uncategorized';
    if (name) {
      items.push({ name, qty, grossSales: gross, netSales: net, category });
      totalGross += gross; totalNet += net; totalItems += qty;
    }
  });

  const categories = {};
  items.forEach(item => {
    if (!categories[item.category]) categories[item.category] = { name: item.category, sales: 0, items: 0 };
    categories[item.category].sales += item.netSales;
    categories[item.category].items += item.qty;
  });

  return {
    allItems: items.sort((a,b) => b.netSales - a.netSales),
    categories: Object.values(categories).sort((a,b) => b.sales - a.sales),
    grossSales: totalGross, netSales: totalNet, totalItemsSold: totalItems,
    uniqueItems: items.length,
    grossProfit: totalNet * 0.65,
    grossProfitMargin: 65
  };
}

function parseEmployees(csv) {
  const rows = parseCSVRows(csv);
  const employees = [];
  let totalSales=0, totalTips=0;

  rows.forEach(row => {
    const name = row['Employee'] || row['Name'] || row['employee'] || '';
    const sales = parseMoney(row['Net Sales'] || row['Sales'] || 0);
    const tips = parseMoney(row['Tips'] || row['tips'] || 0);
    if (name) {
      employees.push({ name, netSales: sales, tips });
      totalSales += sales; totalTips += tips;
    }
  });

  return { employees, totalStaff: employees.length, totalNetSales: totalSales, totalTips };
}

function parseGuests(csv) {
  const rows = parseCSVRows(csv);
  const daily = [];
  let total=0;
  rows.forEach(row => {
    const date = row['Date'] || row['date'] || '';
    const guests = parseInt(row['Guests'] || row['Count'] || row['guests'] || 0);
    if (date) { daily.push({ date, guests }); total += guests; }
  });
  return { daily, totalGuests: total, avgPerDay: daily.length > 0 ? total/daily.length : 0 };
}

function parseOrders(csv) {
  const rows = parseCSVRows(csv);
  const types = {};
  rows.forEach(row => {
    const type = row['Order Type'] || row['Type'] || row['type'] || 'Unknown';
    const sales = parseMoney(row['Net Sales'] || row['Sales'] || 0);
    if (!types[type]) types[type] = { name: type, sales: 0, count: 0 };
    types[type].sales += sales;
    types[type].count += 1;
  });
  return { orderTypes: Object.values(types) };
}

function parseDiscounts(csv) {
  const rows = parseCSVRows(csv);
  const discounts = [];
  let total=0;
  rows.forEach(row => {
    const name = row['Discount'] || row['Name'] || row['discount'] || '';
    const amount = parseMoney(row['Amount'] || row['amount'] || 0);
    const count = parseInt(row['Count'] || row['count'] || 0);
    if (name) { discounts.push({ name, amount, count }); total += amount; }
  });
  return { discounts, totalDiscounts: total };
}
