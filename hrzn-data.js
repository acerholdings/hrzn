// ─────────────────────────────────────────────
// HRZN Global Data Layer
// Single source of truth for all pages
// ─────────────────────────────────────────────

const HRZN = {

  // Keys
  KEYS: {
    SOURCE:   'hrzn-data-source',   // "api" | "csv" | "demo"
    API:      'hrzn-data-api',      // Live integration data
    CSV:      'hrzn-data-csv',      // CSV upload data (was hrzn-sales-data)
    DEMO:     'hrzn-data-demo',     // Demo/default data
    PL:       'hrzn-pl-data',       // P&L expenses (always manual)
    THEME:    'hrzn-theme',         // "dark" | "light"
  },

  // ── DEMO DATA (hardcoded defaults) ──────────
  DEMO_DATA: {
    _source: 'demo',
    _filename: 'Demo Data',
    period: 'Jan 1, 2026 12:00 AM - May 28, 2026 11:59 PM',
    grossSales: 217613,
    discounts: 5769,
    discountPct: 2.6,
    netSales: 211844,
    taxes: 20657,
    tips: 33642,
    amountCollected: 268466,
    itemsSold: 15473,
    avgCheck: 13.69,
    tenders: {
      creditCard: 199893,
      debitCard:  48860,
      doorDash:   9807,
      cash:       9906,
      doorDashPct: 3.7
    }
  },

  // ── GET ACTIVE SOURCE ────────────────────────
  getSource() {
    return localStorage.getItem(this.KEYS.SOURCE) || 'csv';
  },

  setSource(source) {
    localStorage.setItem(this.KEYS.SOURCE, source);
    window.dispatchEvent(new CustomEvent('hrzn-source-changed', { detail: { source } }));
  },

  // ── GET ACTIVE DATA ──────────────────────────
  getData() {
    const source = this.getSource();
    try {
      if (source === 'api') {
        const d = localStorage.getItem(this.KEYS.API);
        if (d) return { ...JSON.parse(d), _source: 'api' };
      }
      if (source === 'csv') {
        // Support both old key (hrzn-sales-data) and new key
        const d = localStorage.getItem(this.KEYS.CSV) || localStorage.getItem('hrzn-sales-data');
        if (d) return { ...JSON.parse(d), _source: 'csv' };
      }
    } catch(e) {}
    return { ...this.DEMO_DATA, _source: 'demo' };
  },

  // ── SAVE DATA ────────────────────────────────
  saveCSV(data) {
    localStorage.setItem(this.KEYS.CSV, JSON.stringify({ ...data, _source: 'csv' }));
    // Migrate old key too for backward compatibility
    localStorage.setItem('hrzn-sales-data', JSON.stringify({ ...data, _source: 'csv' }));
    if (this.getSource() !== 'api') this.setSource('csv');
  },

  saveAPI(data) {
    localStorage.setItem(this.KEYS.API, JSON.stringify({ ...data, _source: 'api' }));
    this.setSource('api');
  },

  // ── GET MONTHS FROM PERIOD ───────────────────
  getMonths(data) {
    const period = (data || this.getData()).period || '';
    try {
      const parts = period.split(' - ');
      if (parts.length < 2) return 1;
      const s = new Date(parts[0].replace(/12:00 AM|11:59 PM/g,'').trim());
      const e = new Date(parts[1].replace(/12:00 AM|11:59 PM/g,'').trim());
      const m = (e - s) / (1000 * 60 * 60 * 24 * 30.44);
      return Math.max(1, Math.round(m * 10) / 10);
    } catch(e) { return 1; }
  },

  // ── BUILD AI CONTEXT STRING ──────────────────
  getAIContext() {
    const d = this.getData();
    const months = this.getMonths(d);
    const monthly = Math.round((d.netSales || 0) / months);
    const weekly  = Math.round(monthly / 4.33);
    const t = d.tenders || {};

    return `You are HRZN, an elite AI business operator for Sama Handroll LA, a high-end Japanese handroll restaurant in Los Angeles.

REAL BUSINESS DATA (${d._source === 'demo' ? 'Demo' : 'Clover POS'}, ${d.period || 'Jan–May 2026'}):
- Gross Sales: $${Math.round(d.grossSales||0).toLocaleString()}
- Discounts: $${Math.round(d.discounts||0).toLocaleString()} (${d.discountPct||0}% of gross)
- Net Sales: $${Math.round(d.netSales||0).toLocaleString()}
- Tips: $${Math.round(d.tips||0).toLocaleString()} (${d.netSales > 0 ? (d.tips/d.netSales*100).toFixed(1) : 0}% of net)
- Taxes & Fees: $${Math.round(d.taxes||0).toLocaleString()}
- Total Collected: $${Math.round(d.amountCollected||0).toLocaleString()}
- Items Sold: ${(d.itemsSold||0).toLocaleString()}
- Avg Check per Item: $${d.avgCheck||0}
- Monthly Average: ~$${monthly.toLocaleString()}/month
- Weekly Average: ~$${weekly.toLocaleString()}/week
- Period: ${d.period || 'N/A'} (${months.toFixed(1)} months)

PAYMENT METHODS:
- Credit Card: $${Math.round(t.creditCard||0).toLocaleString()} (${d.amountCollected > 0 ? ((t.creditCard||0)/d.amountCollected*100).toFixed(1) : 0}%)
- Debit Card: $${Math.round(t.debitCard||0).toLocaleString()}
- DoorDash: $${Math.round(t.doorDash||0).toLocaleString()} (${t.doorDashPct||0}% — industry avg is 15-20%)
- Cash: $${Math.round(t.cash||0).toLocaleString()}

LABOR: ~32% avg (target 28%). Tuesday overstaffed. ~21 staff total.
MENU: Toro Handroll, Salmon Handroll, Yellowtail, Spicy Tuna, Wagyu Handroll, Shrimp Handroll, Crab Handroll (low margin), Edamame (high margin upsell), Miso Soup.

Be specific, reference real numbers, give concrete actions.`;
  },

  // ── SOURCE BADGE HTML ────────────────────────
  getSourceBadge() {
    const source = this.getSource();
    const d = this.getData();
    const configs = {
      api:  { color: 'var(--green)',  bg: 'rgba(76,175,125,0.1)',  border: 'rgba(76,175,125,0.2)',  dot: 'var(--green)',  label: 'Live — Clover' },
      csv:  { color: 'var(--gold)',   bg: 'rgba(201,168,76,0.08)', border: 'rgba(201,168,76,0.2)',  dot: 'var(--gold)',   label: d._filename ? 'CSV — '+d._filename.replace('SAMA_HANDROLL_LA-','').replace('.csv','') : 'CSV Upload' },
      demo: { color: 'var(--text-dim)', bg: 'rgba(128,128,128,0.08)', border: 'rgba(128,128,128,0.15)', dot: 'var(--text-dim)', label: 'Demo Data' },
    };
    const c = configs[source] || configs.demo;
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:${c.color};background:${c.bg};border:1px solid ${c.border};padding:5px 10px;border-radius:20px;cursor:pointer;" onclick="HRZN.openSourceSwitcher()" title="Click to switch data source">
      <div style="width:5px;height:5px;border-radius:50%;background:${c.dot};${source==='api'?'animation:pulse 2s infinite;':''}"></div>
      ${c.label}
      <span style="opacity:0.5;font-size:9px;">▼</span>
    </div>`;
  },

  // ── SOURCE SWITCHER MODAL ────────────────────
  openSourceSwitcher() {
    // Remove existing modal
    document.getElementById('hrzn-source-modal')?.remove();

    const hasCSV = !!(localStorage.getItem(this.KEYS.CSV) || localStorage.getItem('hrzn-sales-data'));
    const hasAPI = !!localStorage.getItem(this.KEYS.API);
    const current = this.getSource();

    const modal = document.createElement('div');
    modal.id = 'hrzn-source-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:420px;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,0.5);">
        <div style="padding:20px 24px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:14px;font-weight:500;color:var(--text);">Data Source</div>
          <div onclick="document.getElementById('hrzn-source-modal').remove()" style="cursor:pointer;color:var(--text-dim);font-size:18px;">×</div>
        </div>
        <div style="padding:16px 24px;">
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:16px;">Choose which data source HRZN uses across all pages.</div>

          ${this._sourceOption('api', 'Live Integration', 'Real-time data from Clover POS', hasAPI ? '● Connected' : '○ Not connected', hasAPI, current === 'api')}
          ${this._sourceOption('csv', 'CSV Upload', hasCSV ? 'Using your uploaded Clover export' : 'No CSV uploaded yet', hasCSV ? '● Upload available' : '○ No upload', hasCSV, current === 'csv')}
          ${this._sourceOption('demo', 'Demo Data', 'Hardcoded sample data for testing', '● Always available', true, current === 'demo')}

          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Want to upload a new CSV?</div>
            <button onclick="document.getElementById('hrzn-source-modal').remove();window.location.href='sales.html'" style="font-size:11px;padding:7px 14px;background:transparent;border:1px solid var(--border-gold);color:var(--gold);border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif;">Go to Sales Report →</button>
          </div>
        </div>
      </div>`;

    modal.addEventListener('click', e => { if(e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  },

  _sourceOption(id, title, desc, status, available, active) {
    const color = active ? 'var(--gold)' : available ? 'var(--text)' : 'var(--text-dim)';
    const border = active ? '1px solid var(--border-gold)' : '1px solid var(--border)';
    const bg = active ? 'rgba(201,168,76,0.05)' : 'transparent';
    const cursor = available ? 'pointer' : 'not-allowed';
    const opacity = available ? '1' : '0.5';
    return `<div onclick="${available ? `HRZN.switchSource('${id}')` : ''}" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:${bg};border:${border};border-radius:8px;margin-bottom:8px;cursor:${cursor};opacity:${opacity};transition:all 0.15s;">
      <div style="width:18px;height:18px;border-radius:50%;border:2px solid ${active?'var(--gold)':'var(--border)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        ${active ? '<div style="width:8px;height:8px;border-radius:50%;background:var(--gold);"></div>' : ''}
      </div>
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:500;color:${color};margin-bottom:2px;">${title}</div>
        <div style="font-size:11px;color:var(--text-dim);">${desc}</div>
      </div>
      <div style="font-size:10px;color:${available?'var(--green)':'var(--text-dim)'};">${status}</div>
    </div>`;
  },

  switchSource(source) {
    this.setSource(source);
    document.getElementById('hrzn-source-modal')?.remove();
    // Hard reload to bypass cache
    window.location.replace(window.location.pathname + '?src=' + source + '&t=' + Date.now());
  },

  // ── INJECT BADGE INTO PAGE ───────────────────
  injectBadge(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = this.getSourceBadge();
  }
};

// Listen for source changes
window.addEventListener('hrzn-source-changed', () => {
  // Re-render badge if it exists
  const badge = document.getElementById('hrzn-source-badge');
  if (badge) badge.innerHTML = HRZN.getSourceBadge();
});
