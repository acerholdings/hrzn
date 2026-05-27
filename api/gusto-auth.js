export default async function handler(req, res) {
  const CLIENT_ID = process.env.GUSTO_CLIENT_ID;
  const REDIRECT_URI = 'https://atlas-os-kappa.vercel.app/api/gusto-callback';
  
  const authUrl = `https://api.gusto-demo.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;
  
  res.redirect(authUrl);
}
