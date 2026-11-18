import { isAuthed } from '../../lib/session';
import { lookupFood } from '../../lib/nutrition';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Please enter your access code again.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (text.length < 2 || text.length > 120) return res.status(400).json({ error: 'Type a food, like "1 tbsp olive oil".' });
  try {
    return res.status(200).json({ item: await lookupFood(text) });
  } catch (e) {
    console.error('food lookup failed', e?.message);
    return res.status(502).json({ error: 'I could not look that up. Check the spelling, or try describing it another way.' });
  }
}
