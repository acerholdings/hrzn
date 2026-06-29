export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, system, model, max_tokens } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  // ── ENTITLEMENT CHECK ──────────────────────────────────────────────
  // AI chat is a paid/trial feature. Require a valid token and an entitled
  // plan before spending any Anthropic API budget. This is both a security
  // gate (no anonymous access) and a cost control (lapsed users can't drain
  // the API budget). Demo / logged-out visitors never reach here — the
  // front-end gates the AI box behind sign-up for them.
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Sign in to use the AI Operator.' });
  }

  try {
    // 1) Resolve the user from their token.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
    });
    const user = await userRes.json();
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    // 2) Find the user's business row (carries plan + subscription_status).
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=business_id`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const [profile] = await profileRes.json();
    const businessId = profile?.business_id;
    if (!businessId) {
      return res.status(403).json({ error: 'No active business found for this account.' });
    }

    const bizRes = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&select=plan,subscription_status,trial_ends_at`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const [biz] = await bizRes.json();
    if (!biz) {
      return res.status(403).json({ error: 'No active business found for this account.' });
    }

    // 3) Decide entitlement.
    //    Allowed: active paid plan (starter/pro) that is NOT cancelled/past_due,
    //             OR a trial that has not yet expired.
    //    Blocked: cancelled, past_due, expired trial, unknown.
    const plan = (biz.plan || 'trial').toLowerCase();
    const status = (biz.subscription_status || '').toLowerCase();

    const paidActive =
      (plan === 'starter' || plan === 'pro') &&
      status !== 'cancelled' && status !== 'past_due';

    let trialActive = false;
    if (plan === 'trial') {
      if (biz.trial_ends_at) {
        trialActive = new Date(biz.trial_ends_at).getTime() > Date.now();
      } else {
        // No explicit trial end on the row — allow (trial just started / legacy row).
        trialActive = true;
      }
    }

    if (!paidActive && !trialActive) {
      return res.status(403).json({
        error: 'Your plan does not include the AI Operator. Upgrade to continue.',
        code: 'not_entitled'
      });
    }

    // ── ENTITLED — proceed to the Anthropic API ──────────────────────
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 1024,
        system: system || 'You are HRZN, an elite AI business operator.',
        messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: 'AI API error', detail: err.substring(0, 200) });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
