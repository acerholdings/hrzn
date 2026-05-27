// HRZN Shared App Logic

// ── DARK/LIGHT MODE ──────────────────────────────────────
const THEME_KEY = 'hrzn-theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme(theme) {
  const body = document.body;
  const track = document.getElementById('toggleTrack');
  const label = document.getElementById('toggleLabel');
  const logo = document.getElementById('sidebarLogo');

  if (theme === 'light') {
    body.classList.add('light');
    if (track) track.classList.add('on');
    if (label) label.textContent = 'Light mode';
    if (logo) logo.style.filter = 'brightness(0.15) saturate(0.5)';
  } else {
    body.classList.remove('light');
    if (track) track.classList.remove('on');
    if (label) label.textContent = 'Dark mode';
    if (logo) logo.style.filter = 'none';
  }
}

function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ── NAVIGATION ───────────────────────────────────────────
function navigate(page) {
  window.location.href = page;
}

// ── AI CHAT ──────────────────────────────────────────────
const RESTAURANT_CONTEXT = `
You are HRZN, an elite AI business operator for Sama Handroll, a high-end Japanese handroll restaurant in Los Angeles.
REVENUE: Weekly $48,240 (+14.2%). Best day: Friday dinner $9,840. Slowest: Tuesday. Avg check $26.12. Covers 1,847.
LABOR: Avg 32%. Tuesday hit 41% (overstaffed — target is 28%). Friday excellent at 24%. Savings from fixing Tuesday: $420-580/week.
MENU: Toro 68% margin $8,240. Wagyu 63% $3,120. Salmon 62% $6,120. Yellowtail 61% $4,980. Spicy Tuna 55% $4,210. Edamame 72% $1,240. Crab 34% $2,200. Miso Soup 30% $890.
ALERTS: Tuesday labor spike (41%). Salmon inventory depletes in 2 days. Toro undersold at lunch.
PERFORMANCE: Health score 87/100. Monthly revenue $156,480 vs $168,000 target (93%). Gross margin 68%.
Respond as HRZN — sharp, elite, concise. Use numbers. Max 3-4 sentences unless a breakdown is needed.
`;

let conversationHistory = [];

function initChat() {
  const sendBtn = document.getElementById('aiSend');
  const input = document.getElementById('aiInput');
  if (!sendBtn || !input) return;

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

  const askBtn = document.getElementById('askBtn');
  if (askBtn) {
    askBtn.addEventListener('click', () => {
      input.focus();
      input.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

function askQuestion(q) {
  const input = document.getElementById('aiInput');
  if (input) { input.value = q; sendMessage(); }
}

function addMessage(role, text) {
  const msgs = document.getElementById('aiMessages');
  if (!msgs) return;
  const msg = document.createElement('div');
  msg.className = 'ai-msg';
  msg.innerHTML = `
    <div class="ai-msg-label">${role === 'ai' ? 'HRZN AI' : 'You'}</div>
    <div class="ai-msg-text" style="${role === 'user' ? 'color:var(--text);font-size:12px;' : ''}">${text}</div>
  `;
  msgs.appendChild(msg);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTyping() {
  const msgs = document.getElementById('aiMessages');
  if (!msgs) return;
  const t = document.createElement('div');
  t.className = 'ai-msg'; t.id = 'typing';
  t.innerHTML = '<div class="ai-msg-label">HRZN AI</div><div class="ai-msg-text" style="color:var(--text-dim);">Analyzing your data...</div>';
  msgs.appendChild(t);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById('typing');
  if (t) t.remove();
}

async function sendMessage() {
  const input = document.getElementById('aiInput');
  const sendBtn = document.getElementById('aiSend');
  if (!input || !sendBtn) return;

  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendBtn.disabled = true;

  addMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });
  addTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: RESTAURANT_CONTEXT,
        messages: conversationHistory
      })
    });
    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Error: ' + JSON.stringify(data.error);
    conversationHistory.push({ role: 'assistant', content: reply });
    removeTyping();
    addMessage('ai', reply);
  } catch(e) {
    removeTyping();
    addMessage('ai', 'Connection error: ' + e.message);
  }

  sendBtn.disabled = false;
}

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getTheme());
  initChat();
});
