export default async function handler(req, res) {
  const CLIENT_ID = process.env.GUSTO_CLIENT_ID;
  const CLIENT_SECRET = process.env.GUSTO_CLIENT_SECRET;
  const REDIRECT_URI = 'https://atlas-os-kappa.vercel.app/api/gusto-callback';

  const { code, type, token } = req.query;

  // If we have a token, fetch data directly
  if (type && token) {
    try {
      const BASE = 'https://api.gusto-demo.com';
      const HEADERS = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      if (type === 'companies') {
        const r = await fetch(`${BASE}/v1/me`, { headers: HEADERS });
        const data = await r.json();
        return res.status(200).json(data);
      }

      if (type === 'payrolls') {
        // Get company ID first
        const meRes = await fetch(`${BASE}/v1/me`, { headers: HEADERS });
        const me = await meRes.json();
        const companyId = me.roles?.payroll_admin?.companies?.[0]?.id;

        if (!companyId) return res.status(400).json({ error: 'No company found' });

        const r = await fetch(`${BASE}/v1/companies/${companyId}/payrolls?processed=true`, { headers: HEADERS });
        const data = await r.json();
        return res.status(200).json(data);
      }

      if (type === 'employees') {
        const meRes = await fetch(`${BASE}/v1/me`, { headers: HEADERS });
        const me = await meRes.json();
        const companyId = me.roles?.payroll_admin?.companies?.[0]?.id;

        if (!companyId) return res.status(400).json({ error: 'No company found' });

        const r = await fetch(`${BASE}/v1/companies/${companyId}/employees`, { headers: HEADERS });
        const data = await r.json();
        return res.status(200).json(data);
      }

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Exchange authorization code for token
  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  try {
    const tokenRes = await fetch('https://api.gusto-demo.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(400).json({ error: 'Failed to get token', details: tokenData });
    }

    // Fetch company info
    const meRes = await fetch('https://api.gusto-demo.com/v1/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const me = await meRes.json();
    const companyId = me.roles?.payroll_admin?.companies?.[0]?.id;

    // Fetch recent payrolls
    let payrolls = [];
    if (companyId) {
      const payrollRes = await fetch(`https://api.gusto-demo.com/v1/companies/${companyId}/payrolls?processed=true`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      payrolls = await payrollRes.json();
    }

    // Return success page with token and data
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>HRZN — Gusto Connected!</title>
        <style>
          body { font-family: sans-serif; background: #080808; color: #e8e8e8; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          .box { background: #0f0f0f; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 40px; max-width: 500px; text-align: center; }
          h1 { color: #C9A84C; margin-bottom: 8px; }
          p { color: #999; margin-bottom: 24px; }
          .token { background: #141414; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; word-break: break-all; color: #4caf7d; margin-bottom: 24px; }
          a { background: #C9A84C; color: #000; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>✓ Gusto Connected!</h1>
          <p>Successfully connected to Gusto. Save this access token to Vercel as GUSTO_ACCESS_TOKEN:</p>
          <div class="token">${accessToken}</div>
          <p style="font-size:12px;margin-bottom:24px;">Company ID: ${companyId || 'Not found'}</p>
          <a href="/dashboard.html">Go to Dashboard →</a>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
