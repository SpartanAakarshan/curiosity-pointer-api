const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;

const ipHits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const window = 60_000;
  const limit = 30;
  const hits = (ipHits.get(ip) ?? []).filter(t => now - t < window);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > limit;
}

const SYSTEM_PROMPT = `You are an ADHD-focused productivity assistant designed to close 'curiosity loops' instantly. Your mission is to satisfy the user's sudden urge for information so they don't open a new tab.

Strict Response Guidelines:

Length: Provide exactly two sentences. No more, no less.

Structure: The first sentence must define the concept clearly. The second sentence must explain its primary significance or 'why it matters.'

Tone: Factual, direct, and high-contrast. Do not use conversational filler (e.g., 'Sure thing,' 'Here is what you asked,' or 'I hope this helps').

Constraint: No bullet points, no bolding, and no links.

Your goal is to satisfy the itch of curiosity and immediately return the user's mental bandwidth to their original task.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Extension-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-extension-secret'] !== process.env.EXTENSION_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Wait a minute.' });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 2 || text.length > 2000) {
    return res.status(400).json({ error: 'Invalid text' });
  }

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\nText: ' + text }] }],
        generationConfig: { maxOutputTokens: 150, temperature: 0.3 }
      })
    });

    const data = await r.json();

    if (data.error) {
      return res.status(502).json({ error: `Gemini error: ${data.error.message}` });
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const result = parts.find(p => !p.thought)?.text?.trim();

    if (!result) return res.status(502).json({ error: 'No response from Gemini' });

    return res.status(200).json({ result });
  } catch (err) {
    console.error('[CuriosityPointer]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
