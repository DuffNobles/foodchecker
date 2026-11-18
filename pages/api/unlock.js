import { codeMatches, newToken, cookieHeader } from '../../lib/session';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  await new Promise((r) => setTimeout(r, 1200)); // slows down guessing
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!codeMatches(code)) return res.status(401).json({ error: 'That code is not right.' });
  res.setHeader('Set-Cookie', cookieHeader(newToken()));
  return res.status(200).json({ ok: true });
}
