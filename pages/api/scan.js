import { isAuthed } from '../../lib/session';
import { scanMeal } from '../../lib/nutrition';

export const config = { api: { bodyParser: { sizeLimit: '5mb' } }, maxDuration: 60 };

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Please enter your access code again.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b64 = req.body?.image;
  const hint = typeof req.body?.hint === 'string' ? req.body.hint.slice(0, 200) : '';
  if (typeof b64 !== 'string' || b64.length < 1000 || b64.length > 4_500_000) return res.status(400).json({ error: 'That photo could not be used. Try another one.' });
  try {
    return res.status(200).json(await scanMeal({ b64, hint }));
  } catch (e) {
    console.error('scan failed', e?.message);
    return res.status(502).json({ error: 'I could not read that photo. Try again, or take it a little closer and brighter.' });
  }
}
