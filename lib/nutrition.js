// Server only: reads a meal photo with Claude, then looks each food up in USDA FoodData Central.
import Anthropic from '@anthropic-ai/sdk';

const VISION_MODEL = 'claude-sonnet-5-5';
const PICK_MODEL = 'claude-haiku-5-5';
const NUMS = { carbs: '205', sugars: '269', protein: '203', fiber: '291' };
const KEYS = ['carbs', 'sugars', 'calories', 'protein', 'fiber'];

const PROMPT = `You are estimating the nutrition of the meal in this photo for an adult who manages diabetes. Write everything in English.
Return ONLY JSON:
{"title": short dish name,
 "overall_confidence": "high" | "medium" | "low",
 "scope": "plate" | "prep",
 "servings": number or null,
 "items": [{"name": plain food name as served, "usda_query": plain English name suited to a USDA FoodData Central search (for example "rice, white, cooked"), "brand_product": brand and product name as printed on the package, only for a packaged product whose label you can read, otherwise null, "portion_g": number (edible grams shown), "portion_text": short household measure, including the size for whole items (for example "about 1 cup" or "1 large apple"), "confidence": "high" | "medium" | "low", "carbs_g": number or null, "sugars_g": number or null, "calories": number or null, "protein_g": number or null, "fiber_g": number or null}],
 "question": null or {"text": one short question about the biggest uncertainty, "options": [2 or 3 short answers]},
 "note": null or one short sentence about what is hard to see}
The five nutrient values are for the portion shown. Use one item per distinct food, and include sauces and drinks you can see. Use null instead of guessing wildly. Do not invent hidden ingredients; mention likely ones in note. Set question only when overall_confidence is low. Set scope to "prep" when the photo shows raw or separate ingredients, containers, or clearly more food than one person eats in one meal; otherwise "plate". When scope is "prep", servings is how many typical single-person meals the whole quantity makes (a whole number from 2 to 8); otherwise null. Always give portion_g for everything shown in the photo; when a package weight is printed and the whole package is shown, use it. Never mention insulin, medication or doses, and give no medical advice.`;

export function parseJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(a, b + 1));
}
export const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

async function usdaSearch(query, types, size) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}&query=${encodeURIComponent(query)}&dataType=${types}&pageSize=${size}`;
  let res;
  for (let i = 0; i < 3; i++) { res = await fetch(url); if (res.ok) break; await new Promise((r) => setTimeout(r, 1200)); }
  return res.ok ? (await res.json()).foods || [] : null; // null: the lookup failed, so do not remember the result
}

// Values per 100 g from a search hit (Foundation, SR Legacy and Branded all use the same nutrient numbers).
function per100Of(food) {
  const per100 = {};
  for (const [k, num] of Object.entries(NUMS)) {
    const n = food.foodNutrients.find((x) => String(x.nutrientNumber).startsWith(num));
    per100[k] = n ? n.value : null;
  }
  const kcal = food.foodNutrients.find((x) => x.nutrientName === 'Energy' && x.unitName === 'KCAL')
    ?? food.foodNutrients.find((x) => ['208', '957', '958'].includes(String(x.nutrientNumber)));
  per100.calories = kcal ? kcal.value : null;
  return per100;
}

// Haiku picks from the candidates. Branded candidates show their brand, and the pick must be the same brand and
// product: a wrong brand is worse than the generic entry, so "0" falls through to the generic lookup.
async function pickFrom(client, foods, query, name, branded, grams) {
  if (!foods.length) return null;
  // the same product is often listed once per package size or recipe year, so show the serving size
  const serving = (f) => (/^(g|grm)$/i.test(f.servingSizeUnit || '') && f.servingSize ? ` (serving ${f.servingSize} g)` : '');
  const list = foods.map((f, i) => `${i + 1}. ${branded ? `${f.brandName || f.brandOwner || 'unknown brand'}: ` : ''}${f.description}${branded ? serving(f) : ''}`).join('\n');
  const ask = branded
    ? `Pick the packaged product that is exactly "${query}" (${name}): same brand and same flavor or variety.${grams ? ` The package in the photo is about ${Math.round(grams)} g; when the same product is listed more than once, prefer the one whose serving size matches.` : ''} Reply ONLY JSON {"pick": number, or 0 if that brand and product are not in the list}.`
    : `Pick the USDA food that best matches "${query}" (${name}) as served on a plate. Reply ONLY JSON {"pick": number, or 0 if none is a good match}.`;
  const r = await client.messages.create({ model: PICK_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: `${ask}\n${list}` }] });
  let pick = 0;
  try { pick = parseJson(textOf(r)).pick; } catch { /* no pick */ }
  const food = foods[pick - 1];
  if (!food) return null;
  const brand = food.brandName || food.brandOwner;
  return { match: branded && brand ? `${food.description} (${brand})` : food.description, per100: per100Of(food) };
}

const pickCache = new Map();
async function usdaPick(client, query, name, brandProduct, grams) {
  const key = `${query}|${name}|${brandProduct || ''}|${brandProduct && grams ? Math.round(grams) : ''}`.toLowerCase();
  if (pickCache.has(key)) return pickCache.get(key);
  let out = null, failed = false;
  if (brandProduct) {
    const foods = await usdaSearch(brandProduct, 'Branded', 15);
    if (!foods) failed = true;
    else out = await pickFrom(client, foods.filter((f) => { const p = per100Of(f); return p.carbs != null && p.calories != null; }), brandProduct, name, true, grams);
  }
  if (!out) {
    const foods = await usdaSearch(query, 'Foundation,SR%20Legacy', 8);
    if (!foods) failed = true;
    else out = await pickFrom(client, foods, query, name, false, null);
  }
  if (!failed || out) pickCache.set(key, out);
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
    const brandProduct = typeof it.brand_product === 'string' && it.brand_product.trim() ? it.brand_product.trim().slice(0, 120) : null;
    const u = it.usda_query ? await usdaPick(client, it.usda_query, it.name, brandProduct, grams).catch(() => null) : null;
    const est = { carbs: it.carbs_g, sugars: it.sugars_g, calories: it.calories, protein: it.protein_g, fiber: it.fiber_g };
    const perG = {};
    for (const k of KEYS) {
      if (u && u.per100[k] != null) perG[k] = u.per100[k] / 100;
      else perG[k] = grams && est[k] != null ? Number(est[k]) / grams : null;
    }
    const fromUsda = Object.fromEntries(KEYS.map((k) => [k, !!(u && u.per100[k] != null)]));
    return { id: i, name: it.name, grams: grams || 0, portion_text: it.portion_text || '', confidence: it.confidence || 'medium', usda_match: u ? u.match : null, per_g: perG, from_usda: fromUsda };
  }));

  const servings = Math.round(Number(data.servings));
  const prep = data.scope === 'prep' && servings >= 2 && servings <= 8;
  return { title: data.title || 'Your meal', scope: prep ? 'prep' : 'plate', servings: prep ? servings : null, confidence: data.overall_confidence || 'medium', question: data.question || null, note: data.note || null, items };
}
