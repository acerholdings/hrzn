// ─────────────────────────────────────────────────────────────
// HRZN — Lifecycle Email Sender
// Sends transactional/lifecycle emails via Resend.
//
// Usage (server-to-server only; protected by EMAIL_SECRET):
//   POST /api/emails
//   body: { secret, type, to, name, daysLeft }
//     type  : 'welcome' | 'trial_expiry' | 'reengagement'
//     to    : recipient email (required)
//     name  : recipient first name / business name (optional, personalizes copy)
//     daysLeft : for trial_expiry — number of days left (0 = expires today)
//     variant  : for reengagement — 'nudge' (mid-trial) | 'winback' (post-lapse)
//
// Env vars required (set in Vercel):
//   RESEND_API_KEY   — from resend.com
//   EMAIL_SECRET     — any long random string; the cron + signup pass it so the
//                      public can't trigger emails by hitting this endpoint.
//   APP_BASE_URL     — already set; used for links back into the app.
// ─────────────────────────────────────────────────────────────

const FROM = 'HRZN <hello@usehrzn.ai>';
const REPLY_TO = 'hello@usehrzn.ai';

// ── Shared dark+gold shell ───────────────────────────────────
// Inlined styles only — email clients strip <style> blocks and external CSS.
function shell(innerHtml, preheader) {
  const APP = process.env.APP_BASE_URL || 'https://atlas-os-kappa.vercel.app';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HRZN</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;font-size:1px;color:#0a0a0a;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader || ''}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#101010;border:1px solid rgba(201,168,76,0.18);border-radius:16px;overflow:hidden;">
      <!-- header -->
      <tr><td style="padding:28px 32px 0 32px;">
        <div style="font-size:20px;font-weight:600;letter-spacing:0.04em;color:#C9A84C;">HRZN</div>
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#666;margin-top:2px;">AI Business Operator</div>
      </td></tr>
      <!-- body -->
      <tr><td style="padding:24px 32px 8px 32px;color:#e6e6e6;font-size:15px;line-height:1.65;">
        ${innerHtml}
      </td></tr>
      <!-- footer -->
      <tr><td style="padding:24px 32px 28px 32px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:12px;color:#666;line-height:1.6;">
          You're receiving this because you have an HRZN account.<br>
          Questions? Just reply to this email — it reaches us at <a href="mailto:hello@usehrzn.ai" style="color:#C9A84C;text-decoration:none;">hello@usehrzn.ai</a>.
        </div>
        <div style="font-size:11px;color:#444;margin-top:12px;">© ${new Date().getFullYear()} HRZN · <a href="${APP}" style="color:#555;text-decoration:none;">${APP.replace(/^https?:\/\//,'')}</a></div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function button(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px 0;"><tr><td style="border-radius:8px;background:#C9A84C;">
    <a href="${href}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#0a0a0a;text-decoration:none;border-radius:8px;">${label}</a>
  </td></tr></table>`;
}

// ── Templates ────────────────────────────────────────────────
function tplWelcome(name, APP) {
  const hi = name ? `Welcome, ${name}` : 'Welcome to HRZN';
  return {
    subject: 'Welcome to HRZN — let’s find your first insight',
    preheader: 'Upload your sales data and HRZN reads it back in plain English.',
    html: shell(`
      <div style="font-size:20px;font-weight:500;color:#fff;margin-bottom:14px;">${hi}</div>
      <p style="margin:0 0 14px 0;">Your account is ready. HRZN turns your sales and cost data into plain-English insights, benchmarks, and clear recommendations — no spreadsheets, no analyst required.</p>
      <p style="margin:0 0 16px 0;">The fastest way to see what it does: upload one sales export. HRZN reads it back to you in about a minute.</p>
      ${button('Upload your first file →', APP + '/data.html')}
      <p style="margin:18px 0 0 0;font-size:13px;color:#999;">Your free trial is active for 14 days. If you get stuck, reply to this email and a real person answers.</p>
    `, 'Upload your sales data and HRZN reads it back in plain English.')
  };
}

function tplTrialExpiry(name, daysLeft, APP) {
  const today = (daysLeft === 0);
  const who = name ? `${name}, ` : '';
  const when = today ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  return {
    subject: today ? 'Your HRZN trial ends today' : `Your HRZN trial ends in ${daysLeft} days`,
    preheader: `Keep your dashboard, analytics, and AI operator — from $99/mo.`,
    html: shell(`
      <div style="font-size:20px;font-weight:500;color:#fff;margin-bottom:14px;">${today ? 'Your trial ends today' : `${daysLeft} days left in your trial`}</div>
      <p style="margin:0 0 14px 0;">${who}your free trial ends ${when}. After that, access to your dashboard, analytics, reports, and the AI operator pauses until you pick a plan.</p>
      <p style="margin:0 0 16px 0;">HRZN Starter is <strong style="color:#C9A84C;">$99/mo</strong> — your data, your insights, CSV uploads, and the full AI operator. Cancel anytime.</p>
      ${button('Keep my access →', APP + '/pricing.html?plan=starter')}
      <p style="margin:18px 0 0 0;font-size:13px;color:#999;">Your uploaded data stays safe either way. Questions about which plan fits? Just reply.</p>
    `, 'Keep your dashboard, analytics, and AI operator — from $99/mo.')
  };
}

function tplReengagement(name, variant, APP) {
  const winback = (variant === 'winback');
  const who = name ? `${name}, ` : '';
  if (winback) {
    return {
      subject: 'Your HRZN data is still here when you’re ready',
      preheader: 'Pick up where you left off — your insights are waiting.',
      html: shell(`
        <div style="font-size:20px;font-weight:500;color:#fff;margin-bottom:14px;">Still here when you’re ready</div>
        <p style="margin:0 0 14px 0;">${who}your trial wrapped up, but your account and any data you uploaded are still saved. Plenty of owners come back once month-end rolls around and they want a clear read on the numbers.</p>
        <p style="margin:0 0 16px 0;">Starter is <strong style="color:#C9A84C;">$99/mo</strong>, cancel anytime. Pick up exactly where you left off.</p>
        ${button('Reactivate HRZN →', APP + '/pricing.html?plan=starter')}
        <p style="margin:18px 0 0 0;font-size:13px;color:#999;">Not the right time? No worries — reply and tell us what would make HRZN more useful for you.</p>
      `, 'Pick up where you left off — your insights are waiting.')
    };
  }
  // mid-trial nudge (signed up, hasn't uploaded)
  return {
    subject: 'One upload away from your first HRZN insight',
    preheader: 'It takes about a minute — here’s how to start.',
    html: shell(`
      <div style="font-size:20px;font-weight:500;color:#fff;margin-bottom:14px;">You’re one file away</div>
      <p style="margin:0 0 14px 0;">${who}you set up HRZN but haven’t uploaded any data yet — so it hasn’t had a chance to show you anything useful. That’s the whole point, and it’s quick.</p>
      <p style="margin:0 0 16px 0;">Export a sales report from your POS (or any sales CSV), drop it in, and HRZN reads it back with benchmarks and recommendations in about a minute.</p>
      ${button('Upload a file →', APP + '/data.html')}
      <p style="margin:18px 0 0 0;font-size:13px;color:#999;">Not sure what file to use? Reply and tell us your POS — we’ll point you to the exact export.</p>
    `, 'It takes about a minute — here’s how to start.')
  };
}

function buildEmail(type, name, opts, APP) {
  if (type === 'welcome') return tplWelcome(name, APP);
  if (type === 'trial_expiry') return tplTrialExpiry(name, opts.daysLeft || 0, APP);
  if (type === 'reengagement') return tplReengagement(name, opts.variant || 'nudge', APP);
  return null;
}

// ── Resend send ──────────────────────────────────────────────
async function sendViaResend(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, to: [to], subject, html })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data?.message || `Resend error ${r.status}` };
  return { ok: true, id: data?.id };
}

// Exported so the cron function can send without an extra HTTP round-trip.
export async function sendLifecycleEmail({ type, to, name, daysLeft, variant }) {
  const APP = process.env.APP_BASE_URL || 'https://atlas-os-kappa.vercel.app';
  if (!to) return { ok: false, error: 'no recipient' };
  const email = buildEmail(type, name, { daysLeft, variant }, APP);
  if (!email) return { ok: false, error: 'unknown email type: ' + type };
  return sendViaResend(to, email.subject, email.html);
}

// Founder signup alert — emails YOU when a new business signs up, so you know
// immediately (esp. during beta outreach) without checking Supabase. Sends to
// FOUNDER_ALERT_EMAIL if set, else falls back to the hello@ inbox. Best-effort.
export async function sendFounderAlert({ businessName, email, category }) {
  const to = process.env.FOUNDER_ALERT_EMAIL || 'hello@usehrzn.ai';
  const subject = `🎉 New HRZN signup: ${businessName || 'Unknown'}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111;">
      <p><strong>New business just signed up on HRZN.</strong></p>
      <ul>
        <li><strong>Business:</strong> ${businessName || '—'}</li>
        <li><strong>Email:</strong> ${email || '—'}</li>
        <li><strong>Category:</strong> ${category || '—'}</li>
        <li><strong>When:</strong> ${new Date().toISOString()}</li>
      </ul>
      <p style="color:#666;font-size:13px;">Sent automatically by HRZN.</p>
    </div>`;
  return sendViaResend(to, subject, html);
}

// ── HTTP handler (used by signup welcome + manual testing) ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { secret, type, to, name, daysLeft, variant } = req.body || {};
  // Protect the endpoint: only callers who know EMAIL_SECRET may send.
  if (!process.env.EMAIL_SECRET || secret !== process.env.EMAIL_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!type || !to) return res.status(400).json({ error: 'type and to are required' });

  try {
    const result = await sendLifecycleEmail({ type, to, name, daysLeft, variant });
    if (!result.ok) return res.status(502).json({ error: result.error });
    return res.status(200).json({ ok: true, id: result.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
