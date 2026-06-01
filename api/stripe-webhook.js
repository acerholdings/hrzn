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

  // Update plan by user ID
  const updateByUserId = async (userId, plan, status) => {
    if (!userId) return false;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      },
      body: JSON.stringify({ plan, subscription_status: status })
    });
    return r.ok;
  };

  // Update plan by customer email (fallback)
  const updateByEmail = async (email, plan, status) => {
    if (!email) return false;
    // Find user in Supabase auth by email
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    });
    const data = await r.json();
    const userId = data.users?.[0]?.id;
    if (!userId) return false;
    return updateByUserId(userId, plan, status);
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const email = session.customer_email || session.customer_details?.email;
        const plan = session.metadata?.plan || 'starter';
        const updated = await updateByUserId(userId, plan, 'active');
        if (!updated) await updateByEmail(email, plan, 'active');
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        const plan = sub.metadata?.plan || 'starter';
        const status = sub.status === 'active' ? 'active' : sub.status;
        await updateByEmail(email, plan, status);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        await updateByEmail(customer.email, 'cancelled', 'cancelled');
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customer = await stripe.customers.retrieve(invoice.customer);
        await updateByEmail(customer.email, 'past_due', 'past_due');
        break;
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
