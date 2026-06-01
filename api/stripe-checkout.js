import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  starter: 'price_1Tdbd7LguiAxpd6pnYUm2tQV',
  pro: 'price_1TdbdNLguiAxpd6pdNBFwPM1',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, token } = req.body;
  if (!plan || !PRICE_IDS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BASE_URL = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://atlas-os-kappa.vercel.app';

  try {
    // Get user email from token
    let userEmail = null;
    let userId = null;
    if (token) {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY }
      });
      const user = await userRes.json();
      userEmail = user.email;
      userId = user.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      customer_email: userEmail || undefined,
      metadata: { userId: userId || '', plan },
      success_url: `${BASE_URL}/login.html?upgraded=true`,
      cancel_url: `${BASE_URL}/pricing.html?cancelled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
