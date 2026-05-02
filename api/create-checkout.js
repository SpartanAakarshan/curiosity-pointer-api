const KEY_ID     = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const PLAN_ID    = process.env.RAZORPAY_PLAN_ID;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const r = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')
      },
      body: JSON.stringify({
        plan_id: PLAN_ID,
        total_count: 120,
        quantity: 1,
        notes: { email }
      })
    });

    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.description });

    return res.status(200).json({ subscription_id: data.id, key_id: KEY_ID });
  } catch (err) {
    console.error('[CuriosityPointer] checkout error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
