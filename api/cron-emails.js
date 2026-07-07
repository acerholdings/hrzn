// ─────────────────────────────────────────────────────────────
// HRZN — Lifecycle Email Cron
// Runs once daily (see vercel.json). Scans the businesses table and fires:
//   • trial_expiry  — 3 days before trial_ends_at, and on expiry day
//   • reengagement  — mid-trial nudge (signed up, no data, ~day 7+) and
//                     post-lapse win-back (trial ended unpaid, a few days ago)
//
// Idempotency: each send stamps a tracking column so the same email never
// goes twice. Columns required on `businesses` (see SQL handed over separately):
//   welcome_sent_at, expiry_warn_sent_at, expiry_final_sent_at,
//   reengage_nudge_sent_at, reengage_winback_sent_at  (all timestamptz, nullable)
//
// Protected by EMAIL_SECRET (Vercel cron passes it via the Authorization header,
// configured in vercel.json). A public hit without the secret is rejected.
// ─────────────────────────────────────────────────────────────

import { sendLifecycleEmail } from './emails.js';

const DAY = 24 * 60 * 60 * 1000;

// Owner email lookup: businesses.owner_id → profiles → auth user email.
// We read the email from the auth admin endpoint using the service key.
async function getOwnerEmail(SUPABASE_URL, SERVICE_KEY, ownerId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${ownerId}`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.email || null;
  } catch { return null; }
}

// Has this business uploaded any sales data yet? Used for the mid-trial nudge.
async function hasSalesData(SUPABASE_URL, SERVICE_KEY, businessId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_data?business_id=eq.${businessId}&select=id&limit=1`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch { return true; } // on error, assume they have data (don't nudge wrongly)
}

async function stamp(SUPABASE_URL, SERVICE_KEY, businessId, column) {
  await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY
    },
    body: JSON.stringify({ [column]: new Date().toISOString() })
  });
}

export default async function handler(req, res) {
  // Auth: Vercel cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // when CRON_SECRET is set in the project. We also accept EMAIL_SECRET so the
  // endpoint can be triggered manually for testing with the same secret the
  // other email pieces use. Either matching value is accepted.
  const auth = req.headers['authorization'] || '';
  const provided = auth.replace(/^Bearer\s+/i, '');
  const ok = (process.env.CRON_SECRET && provided === process.env.CRON_SECRET) ||
             (process.env.EMAIL_SECRET && provided === process.env.EMAIL_SECRET);
  if (!ok) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const now = Date.now();
  const summary = { expiry_warn: 0, expiry_final: 0, nudge: 0, winback: 0, skipped: 0, errors: [] };

  try {
    // Pull all trial rows + recently-lapsed rows. Small dataset in beta, so one
    // fetch is fine; add pagination later if the table grows large.
    const sel = 'id,owner_id,name,plan,subscription_status,trial_ends_at,created_at,' +
      'welcome_sent_at,expiry_warn_sent_at,expiry_final_sent_at,reengage_nudge_sent_at,reengage_winback_sent_at';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?select=${sel}&plan=in.(trial,cancelled)`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows)) return res.status(500).json({ error: 'could not read businesses', detail: rows });

    for (const b of rows) {
      const name = b.name || '';
      const status = (b.subscription_status || '').toLowerCase();
      const plan = (b.plan || '').toLowerCase();
      const ends = b.trial_ends_at ? new Date(b.trial_ends_at).getTime() : null;
      const created = b.created_at ? new Date(b.created_at).getTime() : null;

      // ── TRIAL EXPIRY (plan still trial, has an end date) ──
      if (plan === 'trial' && ends) {
        const msLeft = ends - now;
        const daysLeft = Math.ceil(msLeft / DAY);

        // Expiry DAY (0 or already past today but not yet sent the final)
        if (daysLeft <= 0 && !b.expiry_final_sent_at) {
          const to = await getOwnerEmail(SUPABASE_URL, SERVICE_KEY, b.owner_id);
          if (to) {
            const out = await sendLifecycleEmail({ type: 'trial_expiry', to, name, daysLeft: 0 });
            if (out.ok) { await stamp(SUPABASE_URL, SERVICE_KEY, b.id, 'expiry_final_sent_at'); summary.expiry_final++; }
            else summary.errors.push(`final ${b.id}: ${out.error}`);
          } else summary.skipped++;
          continue;
        }
        // 3-days-before warning (fire once, when 1–3 days remain)
        if (daysLeft > 0 && daysLeft <= 3 && !b.expiry_warn_sent_at) {
          const to = await getOwnerEmail(SUPABASE_URL, SERVICE_KEY, b.owner_id);
          if (to) {
            const out = await sendLifecycleEmail({ type: 'trial_expiry', to, name, daysLeft });
            if (out.ok) { await stamp(SUPABASE_URL, SERVICE_KEY, b.id, 'expiry_warn_sent_at'); summary.expiry_warn++; }
            else summary.errors.push(`warn ${b.id}: ${out.error}`);
          } else summary.skipped++;
          continue;
        }
        // ── MID-TRIAL NUDGE (signed up ~7+ days ago, still in trial, no data) ──
        if (created && (now - created) >= 7 * DAY && daysLeft > 3 && !b.reengage_nudge_sent_at) {
          const hasData = await hasSalesData(SUPABASE_URL, SERVICE_KEY, b.id);
          if (!hasData) {
            const to = await getOwnerEmail(SUPABASE_URL, SERVICE_KEY, b.owner_id);
            if (to) {
              const out = await sendLifecycleEmail({ type: 'reengagement', to, name, variant: 'nudge' });
              if (out.ok) { await stamp(SUPABASE_URL, SERVICE_KEY, b.id, 'reengage_nudge_sent_at'); summary.nudge++; }
              else summary.errors.push(`nudge ${b.id}: ${out.error}`);
            } else summary.skipped++;
          }
          continue;
        }
      }

      // ── POST-LAPSE WIN-BACK (trial ended unpaid 3–10 days ago) ──
      // Fires for trials whose end date has passed without converting to paid,
      // a few days after expiry, once.
      if (plan === 'trial' && ends && !b.reengage_winback_sent_at && b.expiry_final_sent_at) {
        const sinceEnd = now - ends;
        if (sinceEnd >= 3 * DAY && sinceEnd <= 10 * DAY) {
          const to = await getOwnerEmail(SUPABASE_URL, SERVICE_KEY, b.owner_id);
          if (to) {
            const out = await sendLifecycleEmail({ type: 'reengagement', to, name, variant: 'winback' });
            if (out.ok) { await stamp(SUPABASE_URL, SERVICE_KEY, b.id, 'reengage_winback_sent_at'); summary.winback++; }
            else summary.errors.push(`winback ${b.id}: ${out.error}`);
          } else summary.skipped++;
        }
        continue;
      }
    }

    return res.status(200).json({ ok: true, ran: new Date().toISOString(), summary });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
