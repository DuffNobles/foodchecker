// Throwaway risk test: do plate photos and Spanish menu photos give usable numbers?
// Usage: node run.mjs [meals|menus]   (images in images/meals and images/menus; truth in images/truth.csv)
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// .env loader: only DFT_* names, and the file wins over the shell.
const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(DFT_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) process.env[m[1]] = m[2];
  }
}
const ANTHROPIC_KEY = process.env.DFT_ANTHROPIC_API_KEY;
const USDA_KEY = process.env.DFT_USDA_API_KEY || 'DEMO_KEY';

// USD per million tokens (input, output). From third-party pages on 2026-11-17: verify before quoting.
const MODELS = {
  'claude-sonnet-5-5': { in: 2.0, out: 10.0 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 }, // rate for prompts up to 100K tokens
};

const FIELDS = '"carbs_g", "sugars_g", "calories", "protein_g" (numbers, or null when it cannot be estimated reasonably)';
const MEAL_PROMPT = `Estimate the nutrition of the meal in this photo, for a person in Panama who manages diabetes.
Return ONLY JSON: {"dish_es": string, "items": [{"name_es": string, "name_en": plain English food name suited to a USDA FoodData Central search, e.g. "rice, white, cooked", "portion_g": number (edible grams shown), "portion_text_es": string, "carbs_g", "sugars_g", "calories", "protein_g", "confidence": "high"|"medium"|"low"}], "totals": {${FIELDS.replaceAll('"', '')}}, "notes_es": string}.
Values are for the portion shown. Use null instead of guessing wildly. Do not invent hidden ingredients; mention likely ones in notes_es. Never mention insulin, medication or doses, and give no medical advice.`;
const MENU_PROMPT = `Read this restaurant menu photo (probably Spanish, Panama) for a person who manages diabetes.
Return ONLY JSON: {"readable": "good"|"partial"|"poor", "dishes": [{"name_es": string, "description_es": string, "price": string|null, "name_en": string, "typical_portion_g": number|null, "carbs_g", "sugars_g", "calories", "protein_g", "confidence": "high"|"medium"|"low"}], "unreadable_notes": string}.
Include every dish you can read and none you cannot. Estimate for a typical restaurant serving as described. Use null instead of guessing wildly. unreadable_notes is only about how legible the photo is. Never mention insulin, medication or doses, and give no medical advice.`;

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function loadImage(file) {
  // Same preparation the app will do on the phone: longest side 1568 px, JPEG.
  const buf = await sharp(file).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return buf.toString('base64');
}

function parseJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(a, b + 1));
}

async function ask(client, model, prompt, b64, maxTokens) {
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens, // hidden reasoning counts against this
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: prompt }] }],
    });
    const seconds = (Date.now() - t0) / 1000;
    const p = MODELS[model];
    const cost = (res.usage.input_tokens * p.in + res.usage.output_tokens * p.out) / 1e6;
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    last = { seconds, cost, usage: res.usage, stop: res.stop_reason };
    if (res.stop_reason === 'max_tokens') { last.error = 'hit max_tokens'; continue; }
    try { return { ...last, data: parseJson(text) }; } catch (e) { last.error = `bad JSON: ${e.message}`; last.raw = text.slice(0, 500); }
  }
  return last;
}

const N = { carbs_g: '205', sugars_g: '269', protein_g: '203' };
const pickCache = new Map();
let pickerCost = 0;

// Search USDA for up to 8 candidates, then a cheap model call picks the best one (or none).
async function usdaPick(client, it) {
  const key = `${it.name_en}|${it.name_es}`.toLowerCase();
  if (pickCache.has(key)) return pickCache.get(key);
  // The Survey (FNDDS) data type made USDA answer 400 about half the time, so it is left out.
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_KEY}&query=${encodeURIComponent(it.name_en)}&dataType=Foundation,SR%20Legacy&pageSize=8`;
  let res;
  for (let i = 0; i < 3; i++) { res = await fetch(url); if (res.ok) break; await new Promise((r) => setTimeout(r, 1500)); }
  let out;
  if (!res.ok) return { error: `USDA ${res.status}` }; // not cached, so a later item can retry
  else {
    const foods = (await res.json()).foods || [];
    out = { match: null };
    if (foods.length) {
      const list = foods.map((f, i) => `${i + 1}. ${f.description}`).join('\n');
      const r = await client.messages.create({
        model: 'claude-haiku-5-5', max_tokens: 2000, // hidden reasoning counts against this
        messages: [{ role: 'user', content: `Pick the USDA food that best matches "${it.name_en}" (${it.name_es}) as served on a plate. Reply ONLY JSON {"pick": number, or 0 if none is a good match}.\n${list}` }],
      });
      pickerCost += (r.usage.input_tokens * MODELS['claude-haiku-5-5'].in + r.usage.output_tokens * MODELS['claude-haiku-5-5'].out) / 1e6;
      let pick = 0;
      if (r.stop_reason === 'max_tokens') console.warn(`  picker hit max_tokens for "${it.name_en}"`);
      try { pick = parseJson(r.content.filter((b) => b.type === 'text').map((b) => b.text).join('')).pick; } catch { /* no pick */ }
      const food = foods[pick - 1];
      if (food) {
        const per100 = {};
        for (const [k, num] of Object.entries(N)) {
          const n = food.foodNutrients.find((x) => String(x.nutrientNumber).startsWith(num));
          per100[k] = n ? n.value : null;
        }
        const kcal = food.foodNutrients.find((x) => x.nutrientName === 'Energy' && x.unitName === 'KCAL')
          ?? food.foodNutrients.find((x) => ['208', '957', '958'].includes(String(x.nutrientNumber)));
        per100.calories = kcal ? kcal.value : null;
        out = { match: food.description, per100 };
      }
    }
  }
  pickCache.set(key, out);
  return out;
}

async function usdaLookup(client, it) {
  const p = await usdaPick(client, it);
  if (!p.per100) return p;
  const g = it.portion_g;
  const scaled = Object.fromEntries(Object.entries(p.per100).map(([k, v]) => [k, v == null || !g ? null : +(v * g / 100).toFixed(1)]));
  return { match: p.match, scaled };
}

async function usdaTotals(client, items) {
  const totals = { carbs_g: 0, sugars_g: 0, calories: 0, protein_g: 0 };
  const matches = [];
  let matched = 0;
  for (const it of items || []) {
    const r = await usdaLookup(client, it);
    matches.push({ item: it.name_en, usda: r.match ?? null, error: r.error });
    if (r.scaled) { matched++; for (const k of Object.keys(totals)) totals[k] += r.scaled[k] ?? 0; }
  }
  for (const k of Object.keys(totals)) totals[k] = +totals[k].toFixed(1);
  return { totals, matched, of: (items || []).length, matches };
}

function readTruth() {
  const f = path.join(here, 'images', 'truth.csv');
  if (!fs.existsSync(f)) return {};
  const rows = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(1);
  return Object.fromEntries(rows.map((r) => {
    const c = r.match(/("([^"]*)"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, ''));
    return [c[0], { carbs_g: num(c[1]), sugars_g: num(c[2]), calories: num(c[3]), protein_g: num(c[4]), hint: c[6] || null }];
  }));
}
const num = (s) => (s === undefined || s === '' ? null : Number(s));

function listImages(dir) {
  const d = path.join(here, 'images', dir);
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const f of fs.readdirSync(d).sort()) {
    if (MEDIA[path.extname(f).toLowerCase()]) out.push(f);
    else console.warn(`Skipping ${dir}/${f}: only JPG, PNG or WEBP (HEIC is not supported; export or screenshot it).`);
  }
  return out;
}

async function main() {
  if (!ANTHROPIC_KEY) throw new Error('Set DFT_ANTHROPIC_API_KEY in risk-test/.env');
  const only = process.argv[2];
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const truth = readTruth();
  const results = { meals: [], menus: [] };

  if (!only || only === 'meals') {
    for (const f of listImages('meals')) {
      const b64 = await loadImage(path.join(here, 'images', 'meals', f));
      for (const model of Object.keys(MODELS)) {
        console.log(`meal ${f} · ${model}`);
        const hint = truth[`meals/${f}`]?.hint;
        const prompt = hint ? `${MEAL_PROMPT}
The person says: "${hint}". Estimate for that portion.` : MEAL_PROMPT;
        const r = await ask(client, model, prompt, b64, 8000);
        if (r.data) r.usda = await usdaTotals(client, r.data.items);
        results.meals.push({ file: f, model, truth: truth[`meals/${f}`] ?? null, ...r });
      }
    }
  }
  if (!only || only === 'menus') {
    for (const f of listImages('menus')) {
      const b64 = await loadImage(path.join(here, 'images', 'menus', f));
      for (const model of Object.keys(MODELS)) {
        console.log(`menu ${f} · ${model}`);
        results.menus.push({ file: f, model, ...(await ask(client, model, MENU_PROMPT, b64, 16000)) });
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(here, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(outDir, `${stamp}.md`), summarize(results));
  console.log(`\nUSDA picker cost: $${pickerCost.toFixed(4)} (not included in the per-scan cost)`);
  console.log(`Wrote results/${stamp}.md and .json`);
}

function summarize(r) {
  const L = [`# Risk test ${new Date().toISOString()}`, ''];
  const f = (v) => (v == null ? '–' : v);
  if (r.meals.length) {
    L.push('## Meals: carbs in g (AI total / USDA-based total / true), error vs. true', '',
      '| Photo | Model | AI carbs | USDA carbs | True | AI err | USDA err | USDA items matched | Sugars AI/USDA/true | Cal AI/USDA/true | Protein AI/USDA/true | $ | s |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const m of r.meals) {
      if (!m.data) { L.push(`| ${m.file} | ${m.model} | FAILED: ${m.error} | | | | | | | | | ${m.cost?.toFixed(4)} | |`); continue; }
      const t = m.data.totals || {}, u = m.usda.totals, tr = m.truth || {};
      const err = (x) => (x == null || tr.carbs_g == null ? '–' : (x - tr.carbs_g).toFixed(1));
      const tri = (k) => `${f(t[k])} / ${f(u[k])} / ${f(tr[k])}`;
      L.push(`| ${m.file}${m.truth?.hint ? ' (hint)' : ''} | ${m.model} | ${f(t.carbs_g)} | ${u.carbs_g} | ${f(tr.carbs_g)} | ${err(t.carbs_g)} | ${err(u.carbs_g)} | ${m.usda.matched}/${m.usda.of} | ${tri('sugars_g')} | ${tri('calories')} | ${tri('protein_g')} | ${m.cost.toFixed(4)} | ${m.seconds.toFixed(1)} |`);
    }
    L.push('', '### What each model saw', '');
    for (const m of r.meals.filter((x) => x.data)) {
      L.push(`**${m.file} · ${m.model}:** ${m.data.dish_es}`);
      for (const it of m.data.items || []) L.push(`- ${it.name_es} (${it.portion_text_es}, ${it.portion_g} g, ${it.confidence}) → USDA: ${m.usda.matches.find((x) => x.item === it.name_en)?.usda ?? 'no match'}`);
      L.push('');
    }
  }
  if (r.menus.length) {
    L.push('## Menus', '');
    for (const m of r.menus) {
      if (!m.data) { L.push(`**${m.file} · ${m.model}:** FAILED: ${m.error}`, ''); continue; }
      L.push(`**${m.file} · ${m.model}:** readable ${m.data.readable}, ${m.data.dishes?.length ?? 0} dishes, $${m.cost.toFixed(4)}, ${m.seconds.toFixed(1)} s. ${m.data.unreadable_notes || ''}`);
      for (const d of m.data.dishes || []) L.push(`- ${d.name_es}${d.price ? ' (' + d.price + ')' : ''}: carbs ${f(d.carbs_g)}, sugars ${f(d.sugars_g)}, cal ${f(d.calories)}, protein ${f(d.protein_g)} [${d.confidence}]`);
      L.push('');
    }
  }
  return L.join('\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
