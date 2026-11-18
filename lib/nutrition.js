// Server only: reads a meal photo with Claude, then looks each food up in USDA FoodData Central.
import Anthropic from '@anthropic-ai/sdk';

const VISION_MODEL = 'claude-sonnet-5-5';
const PICK_MODEL = 'claude-haiku-5-5';
const NUMS = { carbs: '205', sugars: '269', protein: '203' };

const PROMPT = `You are estimating the nutrition of the meal in this photo for an adult who manages diabetes. Write everything in English.
Return ONLY JSON:
{"title": short dish name,
 "overall_confidence": "high" | "medium" | "low",
 "items": [{"name": plain food name as served, "usda_query": plain English name suited to a USDA FoodData Central search (for example "rice, white, cooked"), "portion_g": number (edible grams shown), "portion_text": short household measure such as "about 1 cup", "confidence": "high" | "medium" | "low", "carbs_g": number or null, "sugars_g": number or null, "calories": number or null, "protein_g": number or null}],
 "question": null or {"text": one short question about the biggest uncertainty, "options": [2 or 3 short answers]},
 "note": null or one short sentence about what is hard to see}
The four nutrient values are for the portion shown. Use one item per distinct food, and include sauces and drinks you can see. Use null instead of guessing wildly. Do not invent hidden ingredients; mention likely ones in note. Set question only when overall_confidence is low. Never mention insulin, medication or doses, and give no medical advice.`;

function parseJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(a, b + 1));
}
const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

const pickCache = new Map();
async function usdaPick(client, query, name) {
  const key = `${query}|${name}`.toLowerCase();
  if (pickCache.has(key)) return pickCache.get(key);
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}&query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy&pageSize=8`;
  let res;
  for (let i = 0; i < 3; i++) { res = await fetch(url); if (res.ok) break; await new Promise((r) => setTimeout(r, 1200)); }
  if (!res.ok) return null; // not cached: a later scan can retry
  const foods = (await res.json()).foods || [];
  let out = null;
  if (foods.length) {
    const list = foods.map((f, i) => `${i + 1}. ${f.description}`).join('\n');
    const r = await client.messages.create({
      model: PICK_MODEL, max_tokens: 2000,
      messages: [{ role: 'user', content: `Pick the USDA food that best matches "${query}" (${name}) as served on a plate. Reply ONLY JSON {"pick": number, or 0 if none is a good match}.\n${list}` }],
    });
    let pick = 0;
    try { pick = parseJson(textOf(r)).pick; } catch { /* no pick */ }
    const food = foods[pick - 1];
    if (food) {
      const per100 = {};
      for (const [k, num] of Object.entries(NUMS)) {
        const n = food.foodNutrients.find((x) => String(x.nutrientNumber).startsWith(num));
        per100[k] = n ? n.value : null;
      }
      const kcal = food.foodNutrients.find((x) => x.nutrientName === 'Energy' && x.unitName === 'KCAL')
        ?? food.foodNutrients.find((x) => ['208', '957', '958'].includes(String(x.nutrientNumber)));
      per100.calories = kcal ? kcal.value : null;
      out = { match: food.description, per100 };
    }
  }
  pickCache.set(key, out);
  return out;
}

export async function scanMeal({ b64, hint }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = hint ? `${PROMPT}\nThe person says: "${hint}". Use that, and set question to null.` : PROMPT;
  let data;
  for (let attempt = 1; attempt <= 2 && !data; attempt++) {
    const res = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 8000, // hidden reasoning counts against this
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: prompt }] }],
    });
    if (res.stop_reason === 'max_tokens') continue;
    try { data = parseJson(textOf(res)); } catch { /* retry once */ }
  }
  if (!data || !Array.isArray(data.items) || !data.items.length) throw new Error('Could not read this photo.');

  const items = await Promise.all(data.items.map(async (it, i) => {
    const grams = Number(it.portion_g) > 0 ? Number(it.portion_g) : null;
    const u = it.usda_query ? await usdaPick(client, it.usda_query, it.name).catch(() => null) : null;
    const est = { carbs: it.carbs_g, sugars: it.sugars_g, calories: it.calories, protein: it.protein_g };
    const perG = {};
    for (const k of ['carbs', 'sugars', 'calories', 'protein']) {
      if (u && u.per100[k] != null) perG[k] = u.per100[k] / 100;
      else perG[k] = grams && est[k] != null ? Number(est[k]) / grams : null;
    }
    const fromUsda = Object.fromEntries(['carbs', 'sugars', 'calories', 'protein'].map((k) => [k, !!(u && u.per100[k] != null)]));
    return { id: i, name: it.name, grams: grams || 0, portion_text: it.portion_text || '', confidence: it.confidence || 'medium', usda_match: u ? u.match : null, per_g: perG, from_usda: fromUsda };
  }));

  return { title: data.title || 'Your meal', confidence: data.overall_confidence || 'medium', question: data.question || null, note: data.note || null, items };
}
