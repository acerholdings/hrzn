// ─────────────────────────────────────────────
// HRZN Global Data Layer
// Single source of truth for all pages
// ─────────────────────────────────────────────

// ── AUTH HELPERS ─────────────────────────────────────────────
function hrznGetToken() {
  return localStorage.getItem('hrzn_token');
}

function hrznIsLoggedIn() {
  return !!localStorage.getItem('hrzn_token');
}

function hrznIsDemo() {
  return new URLSearchParams(window.location.search).get('demo') === 'true';
}

function hrznSetupSidebar() {
  // In demo mode show demo branding, otherwise show real user info
  if (hrznIsDemo()) {
    document.querySelectorAll('.business-name').forEach(el => el.textContent = 'Demo Restaurant');
    const userNameEl = document.querySelector('.user-name');
    if (userNameEl) userNameEl.textContent = 'Demo Mode';
    const userRoleEl = document.querySelector('.user-role');
    if (userRoleEl) userRoleEl.innerHTML = 'Exploring HRZN &nbsp;<span style="font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);border:1px solid var(--border);padding:1px 6px;border-radius:10px;">Demo</span>';
    const avatarEl = document.querySelector('.user-avatar');
    if (avatarEl) avatarEl.textContent = 'D';
    const locEl = document.querySelector('.business-loc-text') || document.querySelector('.business-loc') || document.getElementById('s-biz-loc');
    if (locEl) locEl.textContent = 'Los Angeles, CA';
    return;
  }
  try {
    const user = hrznGetUser();
    const settings = JSON.parse(localStorage.getItem('hrzn-settings') || '{}');
    const bizName = settings.businessName || settings.bizName || 'My Restaurant';
    // Prefer saved owner name from settings, fall back to Supabase metadata
    const userName = settings.ownerName || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Owner';
    document.querySelectorAll('.business-name').forEach(el => el.textContent = bizName);
    // Settings page uses different element IDs
    const accountNameEl = document.getElementById('account-name');
    if (accountNameEl) accountNameEl.textContent = bizName;
    const userNameEl = document.querySelector('.user-name');
    if (userNameEl) userNameEl.textContent = userName;
    // Settings page uses account-name span
    const accountNameEl2 = document.getElementById('account-name');
    if (accountNameEl2) accountNameEl2.textContent = userName;
    const userRoleEl = document.querySelector('.user-role');
    if (userRoleEl) {
      const plan = settings.plan || 'trial';
      const planLabel = plan === 'pro' ? 'Pro' : plan === 'starter' ? 'Starter' : 'Trial';
      const planColor = plan === 'trial' ? 'rgba(201,168,76,0.6)' : '#C9A84C';
      userRoleEl.innerHTML = 'Owner &nbsp;<span style="font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:' + planColor + ';border:1px solid ' + planColor + ';padding:1px 6px;border-radius:10px;">' + planLabel + '</span>';
    }
    const avatarEl = document.querySelector('.user-avatar') || document.getElementById('s-avatar');
    if (avatarEl) avatarEl.textContent = userName.charAt(0).toUpperCase();
    const locEl = document.querySelector('.business-loc-text') || document.querySelector('.business-loc') || document.getElementById('s-biz-loc');
    if (locEl) locEl.textContent = settings.bizLocation || '—';
  } catch(e) {}
}

function hrznRequireAuth() {
  const authPages = ['login.html','signup.html','forgot.html'];
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  if (authPages.includes(currentPage)) return;
  // Check demo mode - look at current URL and also referrer
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === 'true') return;
  // Also check if demo param is in the hash
  if (window.location.hash.includes('demo=true')) return;
  if (!hrznIsLoggedIn()) {
    // Preserve demo mode if somehow lost
    window.location.href = 'login.html';
    return;
  }
}

function hrznNavigate(p) {
  const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';
  // Never carry demo param to settings, data, or auth pages
  const noDemo = ['settings.html','data.html','login.html','signup.html','pricing.html'];
  const stripDemo = noDemo.some(pg => p.includes(pg));
  window.location.href = isDemo && !p.includes('?') && !stripDemo ? p + '?demo=true' : p;
}

function hrznLogout() {
  // Clear auth
  localStorage.removeItem('hrzn_token');
  localStorage.removeItem('hrzn_refresh');
  localStorage.removeItem('hrzn_user');
  // Clear all user data so next user starts fresh
  const keysToKeep = [
    'hrzn-theme', 'hrzn-settings',
    'hrzn-data-csv', 'hrzn-sales-data',     // Sales Overview
    'hrzn-data-items',                       // Item Sales
    'hrzn-data-guests',                      // Guest Count
    'hrzn-data-employees',                   // Employee Sales
    'hrzn-data-orders',                      // Order Types
    'hrzn-data-discounts',                   // Discounts
    'hrzn-pl-data',                          // P&L expenses
  ]; // CSVs persist across logout — user responsibility to clear if needed
  // Collect keys first to avoid mutation during iteration
  const keysToRemove = Object.keys(localStorage).filter(key => !keysToKeep.includes(key));
  keysToRemove.forEach(key => localStorage.removeItem(key));
  window.location.href = 'login.html';
}

function hrznGetUser() {
  try { return JSON.parse(localStorage.getItem('hrzn_user') || '{}'); }
  catch(e) { return {}; }
}

// ── DATA STATE HELPERS ───────────────────────────────────────
function hrznHasData() {
  return !!(
    localStorage.getItem('hrzn-data-csv') ||
    localStorage.getItem('hrzn-sales-data')
  );
}

function hrznHasItems() {
  return !!localStorage.getItem('hrzn-data-items');
}

function hrznHasEmployees() {
  return !!localStorage.getItem('hrzn-data-employees');
}

function hrznIsNewUser() {
  // New user = logged in but no data uploaded
  return hrznIsLoggedIn() && !hrznIsDemo() && !hrznHasData();
}

// ── CLOUD SYNC ───────────────────────────────────────────────
async function hrznSyncToCloud(type, data) {
  const token = hrznGetToken();
  if (!token || hrznIsDemo()) return;
  try {
    await fetch('/api/sync-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ type, data })
    });
  } catch(e) { console.warn('Cloud sync failed:', e); }
}

async function hrznLoadFromCloud() {
  const token = hrznGetToken();
  if (!token || hrznIsDemo()) return false;
  try {
    const r = await fetch('/api/sync-data', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const { data } = await r.json();
    if (!data) return false;

    // Load sales data into localStorage
    if (data.salesData) {
      // Only restore if nothing local
      if (!localStorage.getItem('hrzn-data-csv')) {
        localStorage.setItem('hrzn-data-csv', JSON.stringify(data.salesData));
        localStorage.setItem('hrzn-sales-data', JSON.stringify(data.salesData));
      }
    }

    // Load menu data
    if (data.menuData) {
      // Only restore from cloud if nothing locally (don't overwrite uploaded CSV)
      if (!localStorage.getItem('hrzn-data-items')) {
        // Get original filename from: merged settings (just updated from cloud) or cached local
        const settingsNow = JSON.parse(localStorage.getItem('hrzn-settings') || '{}');
        const originalFilename = data.menuData._filename 
          || merged._cachedItemsFilename 
          || settingsNow._cachedItemsFilename 
          || null;
        const restored = {
          ...data.menuData,
          _filename: originalFilename || null,
          _restoredFromCloud: !originalFilename
        };
        localStorage.setItem('hrzn-data-items', JSON.stringify(restored));
      }
    }

    // Load labor data
    if (data.laborData) {
      const laborRestored = {
        ...data.laborData,
        _filename: data.laborData._filename || 'Employee Sales (cloud sync)',
        _restoredFromCloud: true
      };
      if (!localStorage.getItem('hrzn-data-employees')) {
        localStorage.setItem('hrzn-data-employees', JSON.stringify(laborRestored));
      }
    }

    // Load P&L data
    if (data.plData) {
      const plFormatted = {
        cogs: data.plData.food_cost,
        labor: data.plData.labor,
        rent: data.plData.rent,
        utilities: data.plData.utilities,
        insurance: data.plData.insurance,
        supplies: data.plData.supplies,
        marketing: data.plData.marketing,
        other: data.plData.other,
        debt: data.plData.debt,
        _filename: 'P&L Expenses (cloud sync)',
        _restoredFromCloud: true
      };
      if (!localStorage.getItem('hrzn-pl-data')) {
        localStorage.setItem('hrzn-pl-data', JSON.stringify(plFormatted));
      }
    }

    // Load settings — merge cloud into local, preserving locally-saved values
    const existing = JSON.parse(localStorage.getItem('hrzn-settings') || '{}');
    const merged = { ...existing };
    if (data.business) {
      // Only overwrite if local doesn't already have these set
      if (data.business.name) merged.businessName = merged.businessName || data.business.name;
      if (data.business.name) merged.bizName = merged.bizName || data.business.name;
      if (data.business.location) merged.bizLocation = merged.bizLocation || data.business.location;
    }
    if (data.settings) {
      // Restore items CSV filename if available
      if (data.settings.items_csv_filename) {
        merged._cachedItemsFilename = data.settings.items_csv_filename;
      }
      merged.targets = merged.targets || {};
      merged.targets.labor = merged.targets.labor || data.settings.target_labor_pct;
      merged.targets.food = merged.targets.food || data.settings.target_food_cost_pct;
      merged.targets.revenue = merged.targets.revenue || data.settings.target_weekly_revenue;
      merged.targets.check = merged.targets.check || data.settings.target_avg_check;
      merged.targets.doordash = merged.targets.doordash || data.settings.target_doordash_pct;
      merged.targets.discount = merged.targets.discount || data.settings.target_discount_pct || 5;
      // Also restore business info if synced
      if (data.settings.biz_name) merged.bizName = merged.bizName || data.settings.biz_name;
      if (data.settings.biz_name) merged.businessName = merged.businessName || data.settings.biz_name;
      if (data.settings.biz_location) merged.bizLocation = merged.bizLocation || data.settings.biz_location;
      if (data.settings.owner_name) merged.ownerName = merged.ownerName || data.settings.owner_name;
      if (data.settings.owner_email) merged.ownerEmail = merged.ownerEmail || data.settings.owner_email;
    }
    if (data.business || data.settings) {
      localStorage.setItem('hrzn-settings', JSON.stringify(merged));
    }

    // Restore full user settings if previously synced
    if (data.userSettings) {
      const current = JSON.parse(localStorage.getItem('hrzn-settings') || '{}');
      localStorage.setItem('hrzn-settings', JSON.stringify({ ...data.userSettings, ...current }));
    }

    return true;
  } catch(e) {
    console.warn('Cloud load failed:', e);
    return false;
  }
}

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
    period: 'Jan 1, 2025 12:00 AM - Dec 31, 2025 11:59 PM',
    periodDays: 365,
    periodStart: 'Jan 1, 2025',
    periodEnd: 'Dec 31, 2025',
    grossSales: 485000,
    discounts: 9700,
    discountPct: 2.0,
    netSales: 475300,
    taxes: 46300,
    tips: 71295,
    amountCollected: 592895,
    itemsSold: 32000,
    avgCheck: 14.85,
    tenders: {
      creditCard: 430000,
      debitCard:  110000,
      doorDash:   28000,
      cash:       24895,
      doorDashPct: 4.7,
      giftCard: 0
    }
  },


  // ── MASTER AI SYSTEM PROMPT ──────────────────
  // Single source of truth for all AI insights across every page.
  // Every page must use HRZN.getSystemPrompt(d) instead of writing its own.

  BENCHMARKS: {
    food:      { excellent: 28, healthy: [28, 35], warning: 35 },
    labor:     { excellent: 25, healthy: [25, 35], warning: 35 },
    discounts: { excellent: 3,  healthy: [3, 6],   warning: 6  },
    tips_net:  { strong: 15,    avg: [12, 15],      low: 12     },
    doordash:  { opportunity: 5, good: [5, 15],     high: 20    },
    rent:      { healthy: 8,    monitor: [8, 12],   problem: 12 },
    net_margin:{ healthy: [3, 9] }
  },

  getBenchmarkContext() {
    return `
RESTAURANT & BUSINESS INDUSTRY BENCHMARKS:

REVENUE HEALTH:
- Weekly revenue vs target: >15% below = critical, 5-15% below = warning, on target = healthy
- Revenue trend: improving week-over-week = positive signal, declining 2+ weeks = alert
- Monthly consistency: >20% variance between months = investigate seasonality or operations

COST STRUCTURE (Restaurant):
- Food Cost (COGS): <25% = excellent, 25-32% = healthy, 32-38% = monitor, >38% = problem
- Labor Cost: <25% = excellent, 25-32% = healthy, 32-38% = warning, >38% = critical
- Rent/Occupancy: <6% = excellent, 6-10% = healthy, 10-15% = monitor, >15% = problem
- Total Prime Cost (food + labor): <55% = excellent, 55-65% = healthy, >65% = problem

COST STRUCTURE (Retail):
- COGS: <50% = excellent, 50-65% = healthy, >65% = problem
- Labor: <15% = excellent, 15-25% = healthy, >25% = monitor
- Rent: <8% = healthy, >12% = problem

COST STRUCTURE (Service Business):
- COGS/Materials: <20% = excellent
- Labor: <40% = healthy (higher than restaurant due to skill premium)
- Overhead: <25% = healthy

DISCOUNTS & PROMOTIONS:
- <2% = excellent — strong pricing power, no discounting needed
- 2-4% = healthy — strategic discounting, well controlled
- 4-6% = monitor — approaching problematic levels
- >6% = problem — undermining brand value and margins
- NEVER flag discounts under 4% as a problem

TIPS & SERVICE QUALITY (always calculate vs NET SALES):
- >18% = exceptional — guests are extremely satisfied, luxury service level
- 15-18% = strong — above industry average, great service
- 12-15% = average — meeting expectations
- <12% = low — investigate service quality or average check size
- Tip rate declining = early warning sign for guest satisfaction issues

PAYMENT MIX & CHANNEL HEALTH:
- Credit card 60-80% = healthy digital mix
- Cash >15% = high — consider promoting digital, cash handling risk
- DoorDash/Delivery:
  * <3% = underutilized — growth opportunity
  * 3-8% = developing — room to grow
  * 8-20% = healthy mix
  * >25% = over-reliant — margin risk (platforms take 15-30% commission)
- Digital payments (credit + debit) >85% = excellent data quality for insights

PRICING POWER SIGNALS:
- Avg item price growing + discounts flat = strong pricing power
- Avg item price flat + discounts rising = pricing pressure, investigate
- Avg item price declining = customers trading down or menu mix shifting
- Price increase of 5-10% on high-margin items typically retains 90%+ of volume

PROFITABILITY:
- Net margin 8-15% = excellent restaurant
- Net margin 3-8% = healthy restaurant
- Net margin 0-3% = thin — vulnerable to cost increases
- Net margin negative = urgent action required
- Gross margin >70% = strong (before labor/overhead)
- Gross margin 60-70% = healthy
- Gross margin <55% = investigate food costs

CASH FLOW & DEBT:
- Debt service <8% of revenue = manageable
- Debt service 8-15% = monitor — limiting reinvestment
- Debt service >15% = critical — restructure immediately
- Monthly runway = cash / monthly burn (>6 months = healthy)

VOLUME & EFFICIENCY:
- Items/transaction: increasing = good upselling, decreasing = investigate
- Avg check increasing without volume loss = successful price increase
- Avg check decreasing = customers trading down or menu mix shift
- Revenue per labor dollar >$3.50 = efficient, <$2.50 = overstaffed

SEASONALITY CONTEXT:
- Q1 (Jan-Mar) = typically slowest for restaurants, adjust benchmarks -10-15%
- Q4 (Oct-Dec) = typically strongest, expect +15-20% vs annual avg
- Summer (Jun-Aug) = varies by market — beach/tourist markets peak, office areas slow
- Do not flag low revenue as a problem if it is historically a slow period

MULTI-LOCATION SIGNALS (if applicable):
- Revenue variance >20% between locations = investigate underperformer
- Labor variance >5% between locations = scheduling inefficiency somewhere
- Discount variance >2% between locations = inconsistent training or management

GROWTH OPPORTUNITIES (prioritize in this order):
1. Fix bleeding costs first (labor, food cost, debt)
2. Then optimize pricing (avg check, discount rate)
3. Then grow volume (covers, delivery, catering)
4. Then expand channels (new locations, catering, events)

CRITICAL ANALYSIS RULES — THESE OVERRIDE EVERYTHING ELSE:
1. Discounts 2.65% = EXCELLENT. NEVER flag this as "aggressive" or a problem. Label it: "✅ Excellent pricing discipline"
2. Tips 15.9% of net sales = STRONG. Label it: "✅ Strong tip performance"  
3. DoorDash 3.7% = growth opportunity to grow TO 10%, not a problem to cut
4. Credit card dominance is NOT a problem — do not suggest customers pay cash
5. MANDATORY: exactly 3 insights must start with ✅ (wins), exactly 3 with 🎯 (opportunities)
6. Tips % = tips / net_sales * 100. NEVER use total collected as the base
7. Every insight must have: exact dollar amount + benchmark comparison + one specific action
8. Do not suggest cutting DoorDash — suggest growing it
9. Do not suggest promoting cash payments — digital is better for tracking
10. Insights must reflect THIS business's actual strengths, not generic restaurant problems`;
  },

  getSystemPrompt(d) {
    const settings = typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem('hrzn-settings') || '{}')
      : {};
    const bizName = settings.businessName || 'this restaurant';
    const bizType = settings.businessType || 'restaurant';
    const isDemo = d._source === 'demo';

    // Use getMetrics for all calculations — single source of truth
    const _m = this.getMetrics(d);
    const { weeks, months, weekly, monthly, daily, avgPrice, itemsPerWeek,
            discPct, tipsPct, ddPct, cashPct, digitalPct, digitalTotal,
            weeklyGap, periodGap, annualGap, ddGapWeekly, ddGapAnnual,
            ddGapPeriod, priceGapPeriod, priceGapAnnual, combinedPeriod,
            laborExcessWeekly, periodLabel, periodDays } = _m;
    const t = d.tenders || {};

    // Performance signals
    const discLabel = parseFloat(discPct) < 2 ? '✅ EXCELLENT pricing discipline'
      : parseFloat(discPct) < 4 ? '✅ HEALTHY discount rate'
      : parseFloat(discPct) < 6 ? '⚠️ monitor — approaching warning threshold'
      : '🚨 HIGH — undermining margins';

    const tipsLabel = parseFloat(tipsPct) > 18 ? '✅ EXCEPTIONAL — luxury service level'
      : parseFloat(tipsPct) > 15 ? '✅ STRONG — above industry average'
      : parseFloat(tipsPct) > 12 ? 'average — meeting expectations'
      : '⚠️ LOW — investigate service quality';

    const ddLabel = parseFloat(ddPct) < 3 ? '🎯 underutilized — significant growth opportunity'
      : parseFloat(ddPct) < 8 ? '🎯 developing — room to grow'
      : parseFloat(ddPct) < 20 ? '✅ healthy delivery mix'
      : '⚠️ over-reliant — margin risk from platform fees';

    const cashLabel = cashPct > 15 ? '⚠️ HIGH cash % — handling risk, promote digital'
      : cashPct > 8 ? 'moderate cash use'
      : '✅ low cash — good digital adoption';

    // Targets from settings
    const targets = settings.targets || {};
    const laborTarget = targets.labor || 28;
    const revenueTarget = targets.revenue || 0;
    const checkTarget = targets.check || 0;
    const ddTarget = targets.doordash || 10;

    // Target comparison strings
    const revenueVsTarget = revenueTarget > 0
      ? `$${weekly.toLocaleString()} vs $${revenueTarget.toLocaleString()} target (${weekly >= revenueTarget ? '✅ above' : `⚠️ $${(revenueTarget-weekly).toLocaleString()} below`})`
      : `$${weekly.toLocaleString()}/week`;

    return `You are HRZN, an elite AI business operator for ${bizName}${isDemo ? ' (demo mode)' : ''}. Business type: ${bizType}.
${this.getBenchmarkContext()}

REAL BUSINESS DATA (${d._source === 'demo' ? 'Demo' : 'CSV Upload'}, ${d.periodStart ? d.periodStart + (d.periodEnd ? ' to ' + d.periodEnd : '') : 'reporting period'}):

REVENUE:
- Gross Sales: $${Math.round(d.grossSales||0).toLocaleString()}
- Discounts: -$${Math.round(d.discounts||0).toLocaleString()} (${discPct}% of gross — ${discLabel})
- Net Sales: $${Math.round(d.netSales||0).toLocaleString()}
- Tips: $${Math.round(d.tips||0).toLocaleString()} (${tipsPct}% of net sales — ${tipsLabel})
- Taxes & Fees: $${Math.round(d.taxes||0).toLocaleString()}
- Total Collected: $${Math.round(d.amountCollected||0).toLocaleString()}

VOLUME & PRICING:
- Items Sold: ${(d.itemsSold||0).toLocaleString()} (${Math.round(d.itemsSold/weeks)} items/week avg)
- Avg Item Price: $${(d.avgCheck||0).toFixed ? parseFloat(d.avgCheck||0).toFixed(2) : d.avgCheck|0}${checkTarget > 0 ? ' (target: $' + checkTarget + ')' : ''}

PERIOD & VELOCITY:
- Period: ${months.toFixed(1)} months (${Math.round(weeks)} weeks, ${periodDays} days)
- Weekly Avg Revenue: ${revenueVsTarget}
- Monthly Avg Revenue: $${monthly.toLocaleString()}
- Daily Avg Revenue: $${daily.toLocaleString()}

PAYMENT CHANNELS:
- Credit Card: $${Math.round(t.creditCard||0).toLocaleString()} (${d.amountCollected > 0 ? Math.round((t.creditCard||0)/d.amountCollected*100) : 0}%)
- Debit Card: $${Math.round(t.debitCard||0).toLocaleString()} (${d.amountCollected > 0 ? Math.round((t.debitCard||0)/d.amountCollected*100) : 0}%)
- DoorDash/Delivery: $${Math.round(t.doorDash||0).toLocaleString()} (${ddPct}% — ${ddLabel})
- Cash: $${Math.round(t.cash||0).toLocaleString()} (${cashPct}% — ${cashLabel})
- Digital payments total: ${digitalPct}% of revenue (${digitalPct > 85 ? '✅ excellent data quality' : digitalPct > 70 ? 'good' : '⚠️ high cash use'})

TARGETS (from operator settings):
- Labor target: ${laborTarget}%${targets.labor ? '' : ' (default — set in Settings)'}
- Weekly revenue target: ${revenueTarget > 0 ? '$' + revenueTarget.toLocaleString() : 'not set'}
- Avg check target: ${checkTarget > 0 ? '$' + checkTarget : 'not set'}
- DoorDash target: ${ddTarget}%`;
  },

  getInsightPrompt(type, extra) {
    const d = this.getData();
    const system = this.getSystemPrompt(d);
    const jsonFormat = 'Respond ONLY with a JSON array of exactly 6 objects. No markdown, no explanation. Each object: {"emoji":"...","title":"5-8 words","insight":"2-3 sentences with exact dollar amounts and one specific action."}';
    const mixRule = 'Include a mix: aim for 3 wins (✅) and 3 opportunities (🎯). Do not make every insight negative.';

    const prompts = {
      sales: `Analyze the sales and payment data. Identify what is performing well and what needs attention. ${mixRule} ${jsonFormat}`,
      pl: `Analyze the profit & loss data. Focus on cost structure vs industry benchmarks, margin health, and the single highest-impact action to improve profitability. ${mixRule} ${jsonFormat}`,
      operator: 'You are a real-time AI business advisor. Answer the user question directly using the business data provided. Be concise, specific, and actionable. Use exact numbers from the data.',
      reports: 'Generate a comprehensive business analysis using the data provided. Use exact numbers, compare against industry benchmarks, and provide prioritized recommendations.',
      alerts: `Identify the 3 most critical issues and 3 strongest wins from the business data. Be specific with dollar amounts. ${jsonFormat}`,
      menu: `Analyze menu performance and item mix. Identify top performers to promote, underperformers to cut or reprice, and pricing opportunities. ${mixRule} ${jsonFormat}`,
    };

    const basePrompt = prompts[type] || prompts.sales;
    const fullPrompt = extra ? basePrompt + '\n\nADDITIONAL CONTEXT: ' + extra : basePrompt;
    return { system, prompt: fullPrompt };
  },

  // ── GET ACTIVE SOURCE ────────────────────────
  getSource() {
    return localStorage.getItem(this.KEYS.SOURCE) || 'csv';
  },

  setSource(source) {
    localStorage.setItem(this.KEYS.SOURCE, source);
    window.dispatchEvent(new CustomEvent('hrzn-source-changed', { detail: { source } }));
  },


  // ── UNIVERSAL METRICS ─────────────────────────────────────────────────────
  // Single source of truth for ALL calculated values across every page.
  // Call HRZN.getMetrics() instead of computing inline.
  // All values verified against Sama Handroll LA Jan 1–May 28, 2026 baseline.
  getMetrics(data) {
    const d = data || this.getData();
    const t = d.tenders || {};

    // ── PERIOD ──
    const periodDays   = d.periodDays || 148;
    const weeks        = periodDays / 7;
    const months       = periodDays / 30.44;
    const periodStart  = d.periodStart || '';
    const periodEnd    = d.periodEnd   || '';
    const periodLabel  = (periodStart + (periodEnd ? ' – ' + periodEnd : ''))
                           .replace(/12:00 AM|11:59 PM/g,'').replace(/  /g,' ').trim();

    // ── RAW SALES ──
    const netSales     = d.netSales     || 0;
    const grossSales   = d.grossSales   || 0;
    const discounts    = d.discounts    || 0;
    const tips         = d.tips         || 0;
    const taxes        = d.taxes        || 0;
    const collected    = d.amountCollected || 0;
    const itemsSold    = d.itemsSold    || 0;

    // ── TENDERS ──
    const credit       = t.creditCard   || 0;
    const debit        = t.debitCard    || 0;
    const dd           = t.doorDash     || 0;
    const cash         = t.cash         || 0;

    // ── AVERAGES ──
    const weekly       = weeks  > 0 ? netSales / weeks  : 0;
    const monthly      = months > 0 ? netSales / months : 0;
    const daily        = weekly / 7;
    const avgPrice     = itemsSold > 0 ? netSales / itemsSold : 0;
    const itemsPerWeek = weeks  > 0 ? itemsSold / weeks  : 0;

    // ── TARGETS (from settings, with defaults) ──
    const settings       = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('hrzn-settings') || '{}') : {};
    const targetRevenue  = +(settings.targets?.revenue  || 12000);
    const targetCheck    = +(settings.targets?.check    || 15);
    const targetLabor    = +(settings.targets?.labor    || 28);
    const targetFood     = +(settings.targets?.food     || 25);
    const targetDoorDash = +(settings.targets?.doordash || 10);
    const targetDiscount = +(settings.targets?.discount || 5);

    // ── PERCENTAGES ──
    const discPct      = grossSales > 0 ? (discounts / grossSales * 100) : 0;
    const tipsPct      = netSales   > 0 ? (tips      / netSales   * 100) : 0;
    const ddPct        = collected  > 0 ? (dd        / collected  * 100) : 0;
    const cashPct      = collected  > 0 ? (cash      / collected  * 100) : 0;
    const creditPct    = collected  > 0 ? (credit    / collected  * 100) : 0;
    const debitPct     = collected  > 0 ? (debit     / collected  * 100) : 0;

    // ── DIGITAL PAYMENTS ──
    const digitalTotal = credit + debit + dd;
    const digitalPct   = collected > 0 ? (digitalTotal / collected * 100) : 0;

    // ── REVENUE GAPS ──
    const weeklyGap    = targetRevenue - weekly;
    const periodGap    = weeklyGap * weeks;
    const annualGap    = weeklyGap * 52;
    const monthlyGap   = weeklyGap * 52 / 12;

    // ── DOORDASH GAPS ──
    const ddTarget       = netSales * (targetDoorDash / 100);
    const ddGapPeriod    = ddTarget - dd;
    const ddGapWeekly    = weeks  > 0 ? ddGapPeriod / weeks  : 0;
    const ddGapAnnual    = months > 0 ? ddGapPeriod / months * 12 : 0;

    // ── PRICE GAPS ──
    const priceGapPerItem  = targetCheck - avgPrice;
    const priceGapPeriod   = priceGapPerItem * itemsSold;
    const priceGapAnnual   = months > 0 ? priceGapPeriod / months * 12 : 0;
    const priceGapWeekly   = weeks  > 0 ? priceGapPeriod / weeks  : 0;

    // ── COMBINED OPPORTUNITY ──
    const combinedPeriod   = periodGap + ddGapPeriod + priceGapPeriod;
    const combinedAnnual   = months > 0 ? combinedPeriod / months * 12 : 0;

    // ── LABOR (estimated until Gusto connects) ──
    const laborPct         = 32; // ⚠ Est.
    const laborExcessPct   = Math.max(0, laborPct - targetLabor);
    const laborExcessWeekly = weekly * (laborExcessPct / 100);

    // ── HEATMAP WEIGHTS (verified industry day weights) ──
    const dayWeights = {
      Mon: 0.1214, Tue: 0.1000, Wed: 0.1357,
      Thu: 0.1500, Fri: 0.2072, Sat: 0.1928, Sun: 0.1572
    };
    const LUNCH = 0.32;
    const DINNER = 0.68;

    return {
      // Period
      periodDays, weeks, months, periodStart, periodEnd, periodLabel,

      // Raw
      netSales, grossSales, discounts, tips, taxes, collected, itemsSold,
      credit, debit, dd, cash,

      // Averages
      weekly, monthly, daily, avgPrice, itemsPerWeek,

      // Targets
      targetRevenue, targetCheck, targetLabor, targetFood, targetDoorDash, targetDiscount,

      // Percentages
      discPct, tipsPct, ddPct, cashPct, creditPct, debitPct,

      // Digital
      digitalTotal, digitalPct,

      // Revenue gaps
      weeklyGap, periodGap, annualGap, monthlyGap,

      // DoorDash gaps
      ddTarget, ddGapPeriod, ddGapWeekly, ddGapAnnual,

      // Price gaps
      priceGapPerItem, priceGapPeriod, priceGapAnnual, priceGapWeekly,

      // Combined
      combinedPeriod, combinedAnnual,

      // Labor
      laborPct, laborExcessPct, laborExcessWeekly,

      // Helpers
      dayWeights, LUNCH, DINNER,

      // Source
      _source: d._source || 'csv',
      isDemo: d._source === 'demo',
    };
  },

  // ── GET ACTIVE DATA ──────────────────────────
  getData() {
    // If demo mode via URL param, always return demo data
    if (new URLSearchParams(window.location.search).get('demo') === 'true') {
      return { ...this.DEMO_DATA, _source: 'demo' };
    }
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
    const d = data || this.getData();
    // Use periodDays if available (most accurate)
    if (d.periodDays) return d.periodDays / 30.44;
    // Try period string
    const period = d.period || (d.periodStart ? d.periodStart + ' - ' + (d.periodEnd||'') : '');
    try {
      const parts = period.split(' - ');
      if (parts.length < 2) return 1;
      const s = new Date(parts[0].replace(/12:00 AM|11:59 PM/g,'').trim());
      const e = new Date(parts[1].replace(/12:00 AM|11:59 PM/g,'').trim());
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
      return Math.max(1, (e - s) / (1000 * 60 * 60 * 24 * 30.44));
    } catch(e) { return 1; }
  },

  // ── BUILD AI CONTEXT STRING ──────────────────
  getAIContext(data) {
    // Use master system prompt for consistency
    const d = data || this.getData();
    let ctx = this.getSystemPrompt(d) + this.getBenchmarkContext();
    // Inject dynamic item names from uploaded Item Sales CSV
    try {
      const itemsRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('hrzn-data-items') : null;
      if (itemsRaw) {
        const itemsData = JSON.parse(itemsRaw);
        const top10 = (itemsData.allItems || itemsData.items || [])
          .slice(0, 10)
          .map((i, idx) => (idx+1) + '. ' + i.name + ' (' + (i.category||'uncategorized') + '): ' + (i.sold||0).toLocaleString() + ' sold, $' + Math.round(i.netSales||0).toLocaleString() + ' revenue')
          .join('\n');
        if (top10) {
          ctx += '\n\nTOP PRODUCTS/ITEMS (from uploaded Item Sales CSV):\n' + top10;
        }
      }
    } catch(e) {}
    return ctx;
  },

  // ── SOURCE BADGE HTML ────────────────────────
  getSourceBadge() {
    const source = this.getSource();
    const d = this.getData();
    const configs = {
      api:  { color: 'var(--green)',  bg: 'rgba(76,175,125,0.1)',  border: 'rgba(76,175,125,0.2)',  dot: 'var(--green)',  type: 'Live API', detail: 'Clover · Real-time' },
      csv:  { color: 'var(--gold)',   bg: 'rgba(201,168,76,0.08)', border: 'rgba(201,168,76,0.2)',  dot: 'var(--gold)',   type: 'Sales Overview', detail: d._filename ? d._filename.replace('SAMA_HANDROLL_LA-','').replace(/_/g,' ').replace('.csv','') : (d._restoredFromCloud ? 'Cloud Sync' : 'CSV Upload') },
      demo: { color: 'var(--text-dim)', bg: 'rgba(128,128,128,0.08)', border: 'rgba(128,128,128,0.15)', dot: 'var(--text-dim)', type: 'Demo Data', detail: 'Sample data' },
    };
    const c = configs[source] || configs.demo;
    return `<div style="display:inline-flex;align-items:center;gap:6px;font-size:10px;color:${c.color};background:${c.bg};border:1px solid ${c.border};padding:4px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;" onclick="HRZN.openSourceSwitcher()" title="Click to switch data source">
      <span style="color:${c.dot};font-size:8px;">●</span>
      <span style="font-weight:500;">${c.type}</span>
      <span style="color:var(--text-dim);font-size:9px;">${c.detail}</span>
      <span style="color:var(--text-dim);font-size:9px;">▼</span>
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
            <button onclick="document.getElementById('hrzn-source-modal').remove();window.location.href='data.html'" style="font-size:11px;padding:7px 14px;background:transparent;border:1px solid var(--border-gold);color:var(--gold);border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif;">Go to Data Sources →</button>
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
    // Add/remove ?demo=true so hrznIsDemo() stays in sync with getSource()
    const url = new URL(window.location.href);
    if (source === 'demo') {
      url.searchParams.set('demo', 'true');
    } else {
      url.searchParams.delete('demo');
    }
    window.location.replace(url.toString());
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


// ── FLOATING AI BUTTON ───────────────────────────────────────────────────────
// Injected on every page except dashboard (which has the dashboard widget)
// and operator (which IS the AI page)

function hrznInjectFloatingAI() {
  // Don't inject on pages that already have AI front and center
  const page = window.location.pathname.split('/').pop();
  const skipPages = ['operator.html', 'dashboard.html', 'login.html', 'signup.html', 'pricing.html'];
  if (skipPages.includes(page)) return;
  // Don't inject twice
  if (document.getElementById('hrzn-float-ai')) return;

  const styles = `
    #hrzn-float-ai {
      position: fixed; bottom: 28px; right: 28px; z-index: 9000;
      display: flex; flex-direction: column; align-items: flex-end; gap: 0;
    }
    #hrzn-float-btn {
      width: 52px; height: 52px; border-radius: 50%;
      background: var(--gold, #C9A84C);
      box-shadow: 0 4px 24px rgba(201,168,76,0.4), 0 2px 8px rgba(0,0,0,0.5);
      border: none; cursor: pointer; display: flex; align-items: center;
      justify-content: center; transition: transform 0.2s, box-shadow 0.2s;
      animation: hrzn-float-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    @keyframes hrzn-float-in {
      from { transform: scale(0) rotate(-90deg); opacity: 0; }
      to   { transform: scale(1) rotate(0); opacity: 1; }
    }
    #hrzn-float-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 32px rgba(201,168,76,0.5), 0 2px 8px rgba(0,0,0,0.5);
    }
    #hrzn-float-btn svg { width: 22px; height: 22px; }
    #hrzn-float-panel {
      position: fixed; bottom: 92px; right: 28px;
      width: 360px; max-height: 480px;
      background: var(--surface, #0f0f0f);
      border: 1px solid rgba(201,168,76,0.3);
      border-radius: 12px;
      box-shadow: 0 -4px 48px rgba(0,0,0,0.6), 0 8px 32px rgba(0,0,0,0.4);
      display: flex; flex-direction: column; overflow: hidden;
      transform: scale(0.9) translateY(12px); opacity: 0; pointer-events: none;
      transform-origin: bottom right;
      transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease;
      z-index: 8999;
    }
    #hrzn-float-panel.open {
      transform: scale(1) translateY(0); opacity: 1; pointer-events: all;
    }
    #hrzn-panel-header {
      padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    #hrzn-panel-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 12px; font-weight: 500; color: var(--text, #e8e8e8);
      font-family: 'DM Sans', sans-serif;
    }
    .hrzn-pulse {
      width: 7px; height: 7px; border-radius: 50%;
      background: #4caf7d;
      box-shadow: 0 0 0 0 rgba(76,175,125,0.4);
      animation: hrzn-pulse 2s infinite;
    }
    @keyframes hrzn-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(76,175,125,0.4); }
      70%  { box-shadow: 0 0 0 5px rgba(76,175,125,0); }
      100% { box-shadow: 0 0 0 0 rgba(76,175,125,0); }
    }
    #hrzn-panel-close {
      background: rgba(128,128,128,0.1); border: none; border-radius: 4px;
      color: var(--text-dim, #666); cursor: pointer; width: 24px; height: 24px;
      font-size: 13px; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    #hrzn-panel-close:hover { background: rgba(128,128,128,0.2); }
    #hrzn-panel-msgs {
      flex: 1; overflow-y: auto; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 8px;
      scrollbar-width: thin;
    }
    .hrzn-msg-ai {
      background: rgba(255,255,255,0.04); border-radius: 8px;
      padding: 9px 12px; font-size: 12px; line-height: 1.6;
      color: var(--text-mid, #999); max-width: 92%; font-family: 'DM Sans', sans-serif;
    }
    .hrzn-msg-user {
      background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.2);
      border-radius: 8px; padding: 8px 12px; font-size: 12px;
      color: var(--text, #e8e8e8); align-self: flex-end; max-width: 88%;
      font-family: 'DM Sans', sans-serif;
    }
    .hrzn-msg-thinking {
      display: flex; gap: 4px; padding: 12px;
    }
    .hrzn-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--gold, #C9A84C); opacity: 0.5;
      animation: hrzn-dots 1.2s infinite;
    }
    .hrzn-dot:nth-child(2) { animation-delay: 0.2s; }
    .hrzn-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes hrzn-dots {
      0%,80%,100% { transform: scale(0.8); opacity: 0.4; }
      40% { transform: scale(1.2); opacity: 1; }
    }
    #hrzn-panel-chips {
      padding: 8px 14px 0; display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0;
    }
    .hrzn-chip {
      font-size: 10px; color: var(--text-dim, #666);
      background: rgba(128,128,128,0.06); border: 1px solid rgba(255,255,255,0.06);
      padding: 4px 10px; border-radius: 20px; cursor: pointer; white-space: nowrap;
      font-family: 'DM Sans', sans-serif; transition: all 0.15s;
    }
    .hrzn-chip:hover {
      color: var(--gold, #C9A84C); border-color: rgba(201,168,76,0.3);
      background: rgba(201,168,76,0.06);
    }
    #hrzn-panel-input-row {
      padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.06);
      display: flex; gap: 8px; align-items: center; flex-shrink: 0;
    }
    #hrzn-panel-input {
      flex: 1; background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 6px;
      padding: 7px 12px; font-size: 12px; color: var(--text, #e8e8e8);
      font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.2s;
    }
    #hrzn-panel-input:focus { border-color: rgba(201,168,76,0.4); }
    #hrzn-panel-send {
      background: var(--gold, #C9A84C); color: #000; border: none;
      width: 32px; height: 32px; border-radius: 6px; cursor: pointer;
      font-size: 14px; font-weight: 600; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0; transition: opacity 0.15s;
    }
    #hrzn-panel-send:hover { opacity: 0.85; }
    #hrzn-float-tooltip {
      position: fixed; bottom: 92px; right: 28px;
      background: var(--surface, #0f0f0f);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px; padding: 5px 10px;
      font-size: 11px; color: var(--text-dim, #666);
      font-family: 'DM Sans', sans-serif;
      white-space: nowrap; pointer-events: none;
      opacity: 0; transition: opacity 0.2s; z-index: 8998;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  const d = HRZN.getData();
  const settings = JSON.parse(localStorage.getItem('hrzn-settings') || '{}');
  const bizName = settings.businessName || settings.bizName || 'your business';
  const m = HRZN.getMetrics(d);
  const weekly = Math.round(m.weekly);

  const html = `
    <div id="hrzn-float-panel">
      <div id="hrzn-panel-header">
        <div id="hrzn-panel-title">
          <div class="hrzn-pulse"></div>
          HRZN AI Operator
        </div>
        <button id="hrzn-panel-close">✕</button>
      </div>
      <div id="hrzn-panel-msgs">
        <div class="hrzn-msg-ai">
          Analyzing ${bizName}. Revenue is <strong style="color:var(--text,#e8e8e8)">$${weekly.toLocaleString()}/week</strong>. What would you like to know?
        </div>
      </div>
      <div id="hrzn-panel-chips">
        <span class="hrzn-chip">What should I focus on?</span>
        <span class="hrzn-chip">Fix Tuesday labor</span>
        <span class="hrzn-chip">Grow DoorDash</span>
      </div>
      <div id="hrzn-panel-input-row">
        <input id="hrzn-panel-input" placeholder="Ask anything about your business..." />
        <button id="hrzn-panel-send">↑</button>
      </div>
    </div>
    <div id="hrzn-float-tooltip">Ask AI Operator</div>
    <button id="hrzn-float-btn" title="Ask HRZN AI">
      <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  `;

  const container = document.createElement('div');
  container.id = 'hrzn-float-ai';
  container.innerHTML = html;
  document.body.appendChild(container);

  // Wire up interactions
  let panelOpen = false;
  const panel = document.getElementById('hrzn-float-panel');
  const btn   = document.getElementById('hrzn-float-btn');
  const close = document.getElementById('hrzn-panel-close');
  const input = document.getElementById('hrzn-panel-input');
  const send  = document.getElementById('hrzn-panel-send');
  const msgs  = document.getElementById('hrzn-panel-msgs');
  const tooltip = document.getElementById('hrzn-float-tooltip');

  function togglePanel() {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
    if (panelOpen) setTimeout(() => input.focus(), 250);
  }

  btn.addEventListener('click', togglePanel);
  close.addEventListener('click', togglePanel);

  btn.addEventListener('mouseenter', () => { if (!panelOpen) tooltip.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });

  document.querySelectorAll('.hrzn-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent;
      sendMsg();
    });
  });

  send.addEventListener('click', sendMsg);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });

  // Close on outside click
  document.addEventListener('click', e => {
    if (panelOpen && !container.contains(e.target)) togglePanel();
  });

  async function sendMsg() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    // Add user message
    const userDiv = document.createElement('div');
    userDiv.className = 'hrzn-msg-user';
    userDiv.textContent = text;
    msgs.appendChild(userDiv);
    // Add thinking indicator
    const thinkDiv = document.createElement('div');
    thinkDiv.className = 'hrzn-msg-thinking';
    thinkDiv.innerHTML = '<div class="hrzn-dot"></div><div class="hrzn-dot"></div><div class="hrzn-dot"></div>';
    msgs.appendChild(thinkDiv);
    msgs.scrollTop = msgs.scrollHeight;
    // Call API
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          system: (typeof HRZN.getAIContext === 'function' ? HRZN.getAIContext(d) : HRZN.getSystemPrompt(d)) + '\nRespond concisely in 2-4 sentences. Be direct and specific with dollar amounts.',
          messages: [{ role: 'user', content: text }]
        })
      });
      const data = await r.json();
      const reply = data.content?.[0]?.text || 'Sorry, I couldn\'t process that.';
      thinkDiv.remove();
      const aiDiv = document.createElement('div');
      aiDiv.className = 'hrzn-msg-ai';
      aiDiv.textContent = reply;
      msgs.appendChild(aiDiv);
    } catch(e) {
      thinkDiv.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'hrzn-msg-ai';
      errDiv.textContent = 'Connection error. Try again.';
      msgs.appendChild(errDiv);
    }
    msgs.scrollTop = msgs.scrollHeight;
  }
}

// Auto-inject on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hrznInjectFloatingAI);
} else {
  hrznInjectFloatingAI();
}

// ─────────────────────────────────────────────
// HRZN Global Data Layer
// Single source of truth for all pages
// ── MOBILE RESPONSIVE ───────────────────────────────────────────────────────
function hrznInjectMobile() {
  // Inject CSS
  const mobileStyle = document.createElement('style');
  mobileStyle.id = 'hrzn-mobile-css';
  mobileStyle.textContent = '\n/* iOS TEXT SIZE ADJUST */\n* { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }\n\n@media (max-width: 768px) {\n\n  /* ── SIDEBAR ── */\n  .sidebar {\n    transform: translateX(-100%) !important;\n    transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);\n    z-index: 200;\n    box-shadow: 4px 0 24px rgba(0,0,0,0.5);\n  }\n  .sidebar.mobile-open { transform: translateX(0) !important; }\n\n  /* ── BODY / MAIN ── */\n  body {\n    overflow-x: hidden !important;\n    overflow-y: auto !important;\n    padding-bottom: env(safe-area-inset-bottom, 0px);\n  }\n  .main, .main-content {\n    margin-left: 0 !important;\n    width: 100% !important;\n    min-width: 0 !important;\n    overflow-x: hidden !important;\n    overflow-y: auto !important;\n    height: auto !important;\n  }\n  .content, .page-content {\n    padding: 12px !important;\n    overflow: visible !important;\n    height: auto !important;\n    min-height: 0 !important;\n  }\n\n  /* ── TOPBAR ── */\n  .topbar {\n    padding: 0 12px !important;\n    padding-top: env(safe-area-inset-top, 0px) !important;\n    gap: 6px !important;\n    flex-wrap: nowrap !important;\n    overflow: hidden !important;\n  }\n  .topbar-left {\n    min-width: 0 !important;\n    flex-shrink: 1 !important;\n    overflow: hidden !important;\n  }\n  .topbar-left h1 {\n    font-size: 14px !important;\n    white-space: nowrap !important;\n    overflow: hidden !important;\n    text-overflow: ellipsis !important;\n  }\n  .topbar-left p,\n  .topbar-subtitle,\n  .topbar-btn-ghost,\n  #page-data-sources,\n  #perf-date-label,\n  .date-label,\n  [id$="-date-label"] { display: none !important; }\n  .topbar-right {\n    flex-shrink: 0 !important;\n    gap: 4px !important;\n    overflow: visible !important;\n  }\n  #hrzn-source-badge > div {\n    max-width: 110px !important;\n    overflow: hidden !important;\n    text-overflow: ellipsis !important;\n    white-space: nowrap !important;\n  }\n\n  /* ── KPI GRIDS ── */\n  .kpi-grid, .kpi-row, .summary-row {\n    grid-template-columns: repeat(2,1fr) !important;\n    gap: 8px !important;\n  }\n  .kpi-card, .kpi, .summary-card {\n    padding: 12px !important;\n    min-width: 0 !important;\n  }\n  .kpi-value, .kpi-val, .s-value { font-size: 22px !important; }\n  .kpi-label, .kpi-sub, .s-label { font-size: 9px !important; }\n\n  /* ── MAIN GRID ── */\n  .main-grid, .dash-grid, .two-col {\n    grid-template-columns: 1fr !important;\n    gap: 10px !important;\n  }\n\n  /* ── CARDS ── */\n  .card, .panel, .dash-card {\n    overflow: visible !important;\n    min-width: 0 !important;\n  }\n  .card-header {\n    overflow: visible !important;\n    flex-wrap: wrap !important;\n    min-width: 0 !important;\n    gap: 6px !important;\n  }\n  .card-title {\n    min-width: 0 !important;\n    font-size: 12px !important;\n  }\n  .card-body {\n    overflow-x: auto !important;\n    -webkit-overflow-scrolling: touch !important;\n  }\n\n  /* ── TABLES ── */\n  table {\n    display: block !important;\n    overflow-x: auto !important;\n    -webkit-overflow-scrolling: touch !important;\n    max-width: 100% !important;\n  }\n\n  /* ── HEATMAP / CHARTS ── */\n  .heatmap-wrap, .chart-wrap,\n  .heatmap, .heatmap-grid, .heatmap-inner,\n  [class*="heatmap"], [class*="chart"] {\n    overflow-x: auto !important;\n    -webkit-overflow-scrolling: touch !important;\n    max-width: 100% !important;\n  }\n\n  /* ── AI OPERATOR ── */\n  .operator-layout { grid-template-columns: 1fr !important; }\n  .chat-area {\n    height: 60vh !important;\n    min-height: 300px;\n    border-right: none !important;\n    border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));\n  }\n  .right-panel { height: auto !important; max-height: 50vh; overflow-y: auto !important; }\n\n  /* ── FLOATING AI ── */\n  #hrzn-float-ai {\n    bottom: max(20px, env(safe-area-inset-bottom, 20px)) !important;\n    right: 16px !important;\n  }\n  #hrzn-float-panel {\n    width: calc(100vw - 24px) !important;\n    right: 12px !important;\n    bottom: calc(max(20px, env(safe-area-inset-bottom, 20px)) + 60px) !important;\n    max-height: 60vh !important;\n  }\n\n  /* ── TOPBAR: clean — only hamburger + title ── */\n  .topbar {\n    flex-wrap: nowrap !important;\n    height: 52px !important;\n    padding: 0 12px !important;\n    padding-top: env(safe-area-inset-top, 0px) !important;\n    align-items: center;\n    gap: 8px !important;\n  }\n  .topbar-left {\n    flex: 1 1 auto !important;\n    text-align: center !important;\n    overflow: hidden;\n    display: flex !important;\n    flex-direction: column !important;\n    align-items: center !important;\n  }\n  .topbar-left h1 {\n    font-size: 16px !important;\n    text-align: center !important;\n    white-space: nowrap !important;\n    overflow: hidden !important;\n    text-overflow: ellipsis !important;\n    margin: 0 !important;\n  }\n  .topbar-left p { display: none !important; }\n  .topbar-right { display: none !important; }\n  #page-data-sources { display: none !important; }\n  /* Info bar below topbar */\n  #hrzn-info-bar {\n    position: sticky !important;\n    top: 52px !important;\n    z-index: 49 !important;\n  }\n  #hrzn-info-bar #hrzn-source-badge > div {\n    max-width: 180px !important;\n    font-size: 10px !important;\n  }\n\n  /* ── VS-LAST-WEEK CARD: stack title above column headers ── */\n  .card-header { flex-direction: column !important; align-items: flex-start !important; gap: 4px !important; }\n  .card-header > div:last-child { width: 100% !important; }\n\n  /* ── MISC ── */\n  .dash-ai-chip { font-size: 10px !important; padding: 4px 8px !important; }\n  .nav-item { padding: 10px 20px !important; font-size: 13px !important; }\n  .card, .panel { border-radius: 8px !important; }\n  .trial-banner, .upgrade-banner { font-size: 10px !important; padding: 5px 12px !important; }\n  .main > div[style*="border-top"] { flex-shrink: 0 !important; height: auto !important; padding: 12px 16px !important; }\n\n  /* ── iOS AUTO-ZOOM FIX ── */\n  input, textarea, select { font-size: 16px !important; }\n}\n\n/* ── HAMBURGER ── */\n#hrzn-hamburger { display: none; }\n@media (max-width: 768px) {\n  #hrzn-hamburger {\n    display: flex !important;\n    align-items: center; justify-content: center;\n    width: 36px; height: 36px;\n    background: none;\n    border: 1px solid rgba(255,255,255,0.1);\n    border-radius: 6px; cursor: pointer;\n    flex-direction: column; padding: 9px 8px; flex-shrink: 0;\n    -webkit-tap-highlight-color: transparent;\n  }\n  #hrzn-hamburger span {\n    display: block; width: 100%; height: 1.5px;\n    background: var(--text-dim, #888); border-radius: 2px; transition: all 0.22s ease;\n  }\n  #hrzn-hamburger span+span { margin-top: 4px; }\n  #hrzn-hamburger.open span:nth-child(1) { transform: translateY(5.5px) rotate(45deg); }\n  #hrzn-hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }\n  #hrzn-hamburger.open span:nth-child(3) { transform: translateY(-5.5px) rotate(-45deg); }\n}\n\n/* ── OVERLAY ── */\n#hrzn-sidebar-overlay {\n  display: none; position: fixed; inset: 0;\n  background: rgba(0,0,0,0.55); z-index: 199;\n  -webkit-tap-highlight-color: transparent;\n  backdrop-filter: blur(2px);\n}\n';
  document.head.appendChild(mobileStyle);

  // Ensure viewport-fit=cover for iPhone notch
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && !meta.content.includes('viewport-fit')) {
    meta.content += ', viewport-fit=cover';
  }

  // Only wire up sidebar toggle on mobile
  // Use 1024 threshold to catch iPads and large iPhones
  const isMobile = window.innerWidth <= 1024 || ('ontouchstart' in window && window.innerWidth <= 1200);
  if (!isMobile) return;

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'hrzn-sidebar-overlay';
  document.body.appendChild(overlay);

  // Hamburger button
  const hamburger = document.createElement('button');
  hamburger.id = 'hrzn-hamburger';
  hamburger.setAttribute('aria-label', 'Menu');
  hamburger.innerHTML = '<span></span><span></span><span></span>';
  const topbarEl = document.querySelector('.topbar');
  if (topbarEl) topbarEl.insertBefore(hamburger, topbarEl.firstChild);

  function openSidebar() {
    sidebar.classList.add('mobile-open');
    overlay.style.display = 'block';
    hamburger.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.style.display = 'none';
    hamburger.classList.remove('open');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', () => {
    sidebar.classList.contains('mobile-open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', closeSidebar);
  });

  // ── INFO BAR: move CSV badge + date below topbar ──────────────────────────
  // Create info bar
  const infoBar = document.createElement('div');
  infoBar.id = 'hrzn-info-bar';
  infoBar.style.cssText = [
    'display:flex', 'align-items:center', 'gap:8px',
    'padding:6px 12px', 'background:var(--surface)',
    'border-bottom:1px solid var(--border)',
    'overflow:hidden', 'flex-wrap:nowrap',
    'min-height:32px'
  ].join(';');

  // Move source badge into info bar
  const badge = document.getElementById('hrzn-source-badge');
  if (badge) infoBar.appendChild(badge);

  // Move date label into info bar (various id patterns)
  const dateEl = document.getElementById('perf-date-label') ||
                 document.getElementById('page-date-label') ||
                 document.getElementById('dashboard-period') ||
                 document.getElementById('val-period') ||
                 document.getElementById('menu-period') ||
                 document.getElementById('cf-period') ||
                 document.getElementById('alerts-subtitle');
  if (dateEl) {
    dateEl.style.cssText = 'font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;';
    infoBar.appendChild(dateEl);
  }

  // Move page-data-sources into info bar
  const dataSources = document.getElementById('page-data-sources');
  if (dataSources) infoBar.appendChild(dataSources);

  // Insert info bar right after topbar
  const topbarEl2 = document.querySelector('.topbar');
  if (topbarEl2 && topbarEl2.parentNode && infoBar.children.length > 0) {
    topbarEl2.parentNode.insertBefore(infoBar, topbarEl2.nextSibling);
  }

  // Hide topbar-right entirely on mobile (content moved to info bar)
  const topbarRight = document.querySelector('.topbar-right');
  if (topbarRight) topbarRight.style.display = 'none';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hrznInjectMobile);
} else {
  hrznInjectMobile();
}
