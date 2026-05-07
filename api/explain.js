import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You are an ADHD-focused productivity assistant designed to close 'curiosity loops' instantly. Your mission is to satisfy the user's sudden urge for information so they don't open a new tab.

Strict Response Guidelines:

Length: Provide exactly two sentences. No more, no less.

Structure: The first sentence must define the concept clearly. The second sentence must explain its primary significance or 'why it matters.'

Tone: Factual, direct, and high-contrast. Do not use conversational filler (e.g., 'Sure thing,' 'Here is what you asked,' or 'I hope this helps').

Constraint: No bullet points, no bolding, and no links.

Your goal is to satisfy the itch of curiosity and immediately return the user's mental bandwidth to their original task.`;

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  prefix:  'cp:rl',
});

const FREE_LIMIT = 15;

async function getUser(token) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON
      }
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function checkAndIncrementUsage(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_usage_if_allowed`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user_id: userId, p_free_limit: FREE_LIMIT })
  });
  if (!res.ok) throw new Error(`Usage check failed: ${res.status}`);
  return res.json();
}

const ALLOWED_ORIGIN = 'chrome-extension://ankgmjlgbebilckcdgbmljahfdakgbgb';

export default async function handler(req, res) {
  const origin = req.headers.origin ?? '';
  if (origin !== ALLOWED_ORIGIN) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const user = await getUser(token);
  if (!user?.id) return res.status(401).json({ error: 'Invalid or expired session' });

  const { success } = await ratelimit.limit(user.id);
  if (!success) {
    return res.status(429).json({ error: 'Too many requests. Wait a minute.' });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 2 || text.length > 2000) {
    return res.status(400).json({ error: 'Invalid text' });
  }

  const usage = await checkAndIncrementUsage(user.id);
  if (!usage.allowed) {
    return res.status(402).json({
      error: 'UPGRADE_REQUIRED',
      message: `Free limit of ${FREE_LIMIT} searches reached. Upgrade for $5/month.`
    });
  }

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\nText: ' + text }] }],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    });

    const data = await r.json();
    if (data.error) return res.status(502).json({ error: `Gemini error: ${data.error.message}` });

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const result = parts.find(p => !p.thought)?.text?.trim();
    if (!result) return res.status(502).json({ error: 'No response from Gemini' });

    return res.status(200).json({ result, remaining: usage.remaining });
  } catch (err) {
    console.error('[CuriosityPointer]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
