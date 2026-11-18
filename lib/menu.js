// Server only: reads a menu photo with Claude. Menus give a dish name and description, not a portion,
// so every number here is the model's own estimate for a typical serving (no USDA lookup).
import Anthropic from '@anthropic-ai/sdk';
import { parseJson, textOf } from './nutrition';

const VISION_MODEL = 'claude-sonnet-5-5';

const PROMPT = `You are reading a restaurant menu photo for an adult who manages diabetes. The menu may be in Spanish. Write in English, but keep each dish name exactly as printed.
Return ONLY JSON:
{"readable": "good" | "partial" | "poor",
 "dishes": [{"name": dish name exactly as printed, "name_en": short English translation of the name, or null if the name is already English, "typical_portion_g": number or null, "carbs_g": number or null, "sugars_g": number or null, "calories": number or null, "protein_g": number or null, "confidence": "high" | "medium" | "low"}],
 "note": null or one short sentence saying what is hard to read}
Set readable to "good" when the whole menu is legible, "partial" only when some dishes are cut off, blurred or unreadable, and "poor" when most of it is unreadable. Set note to null when readable is "good".
Include every food dish you can read (at most 40) and none you cannot. Skip drinks. The four nutrient values are for one typical restaurant serving of the dish as described. Use null instead of guessing wildly. Never mention insulin, medication or doses, and give no medical advice.`;

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= 0 ? Number(v) : null);

export async function scanMenu({ b64 }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let data;
  for (let attempt = 1; attempt <= 2 && !data; attempt++) {
    const res = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 16000, // hidden reasoning counts against this
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: PROMPT }] }],
    });
    if (res.stop_reason === 'max_tokens') continue;
    try { data = parseJson(textOf(res)); } catch { /* retry once */ }
  }
  if (!data || !Array.isArray(data.dishes)) throw new Error('Could not read this menu.');

  const dishes = data.dishes
    .filter((d) => typeof d?.name === 'string' && d.name.trim())
    .slice(0, 40)
    .map((d, i) => ({
      id: i,
      name: d.name.trim(),
      name_en: typeof d.name_en === 'string' && d.name_en.trim() && d.name_en.trim().toLowerCase() !== d.name.trim().toLowerCase() ? d.name_en.trim() : null,
      grams: num(d.typical_portion_g),
      carbs: num(d.carbs_g), sugars: num(d.sugars_g), calories: num(d.calories), protein: num(d.protein_g),
      confidence: ['high', 'medium', 'low'].includes(d.confidence) ? d.confidence : 'medium',
    }));
  if (!dishes.length) throw new Error('No dishes found.');
  return { readable: data.readable || 'good', note: data.note || null, dishes };
}
