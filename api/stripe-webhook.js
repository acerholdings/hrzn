import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
export const config = { api: { bodyParser: false } };
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }
  // Update plan by user ID (extra = optional fields like stripe_customer_id)
  const updateByUserId = async (userId, plan, status, extra = {}) => {
    if (!userId) return false;
    // A null `plan` means "don't touch the tier" — used for status-only changes
    // (past_due / cancelled) so a failed payment never overwrites starter/pro.
    const patch = { subscription_status: status, ...extra };
    if (plan != null) patch.plan = plan;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      },
      body: JSON.stringify(patch)
    });
    return r.ok;
  };
  // Update plan by customer email (fallback)
  const updateByEmail = async (email, plan, status, extra = {}) => {
    if (!email) return false;
    // Find user in Supabase auth by email
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    const data = await r.json();
    const userId = data.users?.[0]?.id;
    if (!userId) return false;
    return updateByUserId(userId, plan, status, extra);
  };
  // Update by Stripe customer id — the PRECISE match. Status-change events
  // (updated/deleted/payment_failed) use this so an event for one customer can
  // never write to a different row that merely shares an email. Only touches the
  // row whose stripe_customer_id equals this event's customer. Returns false if
  // no row matches (e.g. first event before the id is stored — caller falls back).
  const updateByCustomerId = async (customerId, plan, status, extra = {}) => {
    if (!customerId) return false;
    const patch = { subscription_status: status, ...extra };
    if (plan != null) patch.plan = plan;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?stripe_customer_id=eq.${encodeURIComponent(customerId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(patch)
    });
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0; // false if no row matched
  };
  // ---- OWNER-LEVEL (profiles) DUAL-WRITE ----------------------------------
  // During the multi-business migration, subscription state is being moved from
  // the per-business row up to the per-owner profiles row. We write BOTH places
  // for now (dual-write) so nothing breaks mid-migration. profiles.id = auth
  // user id = businesses.owner_id. Same column discipline as above: a null plan
  // means "don't touch the tier".
  const updateProfileByUserId = async (userId, plan, status, extra = {}) => {
    if (!userId) return false;
    const patch = { subscription_status: status, ...extra };
    if (plan != null) patch.plan = plan;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      },
      body: JSON.stringify(patch)
    });
    return r.ok;
  };
  // Resolve a Stripe customer id to the owning user id via the businesses row
  // that carries it (businesses.stripe_customer_id → owner_id). Used by the
  // customer-id events, which don't carry a user id, so we can also write the
  // owner's profile. Returns null if no business carries this customer id yet.
  const ownerIdForCustomer = async (customerId) => {
    if (!customerId) return null;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=owner_id`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows[0] ? rows[0].owner_id : null;
  };
  // Mirror a customer-id-matched write to the owner's profile. Resolves the
  // owner first, then writes. No-op if the owner can't be resolved.
  const updateProfileByCustomerId = async (customerId, plan, status, extra = {}) => {
    const userId = await ownerIdForCustomer(customerId);
    if (!userId) return false;
    return updateProfileByUserId(userId, plan, status, extra);
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const email = session.customer_email || session.customer_details?.email;
        const plan = session.metadata?.plan || 'starter';
        const extra = {
          stripe_customer_id: session.customer || null,
          stripe_subscription_id: session.subscription || null
        };
        const updated = await updateByUserId(userId, plan, 'active', extra);
        if (!updated) await updateByEmail(email, plan, 'active', extra);
        // Dual-write to the owner's profile. Prefer the user id from metadata;
        // fall back to resolving via the customer id.
        if (userId) await updateProfileByUserId(userId, plan, 'active', extra);
        else if (session.customer) await updateProfileByCustomerId(session.customer, plan, 'active', extra);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        const plan = sub.metadata?.plan || 'starter';
        const status = sub.status === 'active' ? 'active' : sub.status;
        const extra = {
          stripe_customer_id: sub.customer || null,
          stripe_subscription_id: sub.id || null
        };
        // Match by customer id first (precise); fall back to email only if no row
        // carries this customer id yet.
        const done = await updateByCustomerId(sub.customer, plan, status, extra);
        if (!done) await updateByEmail(email, plan, status, extra);
        // Dual-write to the owner's profile (resolve owner via customer id).
        await updateProfileByCustomerId(sub.customer, plan, status, extra);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const extra = { stripe_customer_id: sub.customer || null };
        // Match ONLY by customer id — never fall back to email here. A cancel event
        // for one customer must not touch a row that merely shares an email (this is
        // the exact bug that locked out a live Starter subscriber). If no row carries
        // this customer id, do nothing.
        await updateByCustomerId(sub.customer, null, 'cancelled', extra);
        // Mirror to the owner's profile. Same discipline: null plan, so the tier
        // is never overwritten — only the status flips to cancelled.
        await updateProfileByCustomerId(sub.customer, null, 'cancelled', extra);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const extra = { stripe_customer_id: invoice.customer || null };
        // Match ONLY by customer id (same reasoning as subscription.deleted).
        await updateByCustomerId(invoice.customer, null, 'past_due', extra);
        // Mirror to the owner's profile (null plan → tier untouched, status only).
        await updateProfileByCustomerId(invoice.customer, null, 'past_due', extra);
        break;
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
