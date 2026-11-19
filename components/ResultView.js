import { useEffect, useState } from 'react';
import Link from 'next/link';
import Gauge, { rate } from './Gauge';
import { addSaved, updateSaved, savePhoto, thumbnail, keepStorage } from '../lib/store';

const METRICS = [
  { key: 'carbs', label: 'Total carbohydrates', unit: 'g', cls: 'c1' },
  { key: 'sugars', label: 'Total sugars', unit: 'g', cls: 'c2' },
  { key: 'calories', label: 'Calories', unit: 'kcal', cls: 'c3' },
  { key: 'protein', label: 'Protein', unit: 'g', cls: 'c4' },
];
// Fiber sits under the four main values as one slim block; it is part of the carbs total, not added to it.
const ALL = [...METRICS, { key: 'fiber', label: 'Fiber (part of the carbs)', unit: 'g', cls: 'c5 wide' }];
const MODE_LABEL = { serving: '1 serving', half: 'Half', all: 'All', more: 'More' };
const LEVEL = { high: 3, medium: 2, low: 1 };
const CONF = { high: ['Pretty sure.', 'The photo was clear.'], medium: ['Fairly sure.', 'Check the portion size.'], low: ['Not very sure.', 'Some details were hard to see.'] };

// USDA names are long ("Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained solids"): drop the brackets, keep the first three parts.
const shortName = (name) => name.replace(/\([^)]*\)/g, '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(', ');

function Icon({ d, extra }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} />{extra}</svg>;
}

// Number box that keeps what is being typed, and only reports valid numbers.
function NumField({ short, label, value, onCommit }) {
  const shown = value == null ? '' : String(Math.round(value * 10) / 10);
  const [text, setText] = useState(shown);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(shown); }, [shown, focus]);
  return (
    <label className="nf"><span>{short}</span>
      <input aria-label={label} type="number" inputMode="decimal" min="0" value={text} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={(e) => { setText(e.target.value); const v = Number(e.target.value); if (e.target.value !== '' && v >= 0) onCommit(v); }} />
    </label>
  );
}

export default function ResultView({ data, photoUrl, carry, carryAdded, onRescan, onAgain }) {
  const [grams, setGrams] = useState(() => Object.fromEntries([...data.items, ...(carryAdded || [])].map((i) => [i.id, i.grams])));
  const [removed, setRemoved] = useState({});
  // foods typed in by hand ("Add a food"); a re-scan keeps them
  const [added, setAdded] = useState(carryAdded || []);
  const items = [...data.items, ...added];
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState('');
  // typed carbs/sugars per food, kept as grams-per-gram so they follow the portion; a re-scan carries them over by food name
  const [edits, setEdits] = useState(() => {
    const start = {};
    const f0 = data.scope === 'prep' && data.servings >= 2 ? 1 / data.servings : 1;
    for (const i of data.items) {
      const c = carry?.[i.name.toLowerCase()];
      if (c && i.grams * f0 > 0) start[i.id] = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / (i.grams * f0)]));
    }
    for (const i of carryAdded || []) if (i.edits) start[i.id] = i.edits;
    return start;
  });
  const prep = data.scope === 'prep' && data.servings >= 2;
  const MODES = prep ? { serving: 1 / data.servings, half: 0.5, all: 1 } : { half: 0.5, all: 1, more: 1.5 };
  const [mode, setMode] = useState(prep ? 'serving' : 'all');
  const [showPortion, setShowPortion] = useState(prep);
  const [other, setOther] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [saved, setSaved] = useState(false);
  const [limit, setLimit] = useState(45);
  const [withPhoto, setWithPhoto] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    try { const v = Number(localStorage.getItem('fc_limit')); if (v >= 10 && v <= 200) setLimit(v); } catch { /* default */ }
  }, []);

  function changeLimit(raw) {
    const v = Number(raw);
    setLimit(raw === '' ? '' : v);
    if (v >= 10 && v <= 200) { try { localStorage.setItem('fc_limit', String(v)); } catch { /* ignore */ } }
  }

  const factor = MODES[mode];
  // grams actually eaten: photo foods follow the portion setting, foods you typed in are exactly what you typed
  const gOf = (i) => (Number(grams[i.id]) || 0) * (i.added ? 1 : factor);
  const active = items.filter((i) => !removed[i.id]);
  const totalG = active.reduce((s, i) => s + gOf(i), 0);

  const perG = (i, key) => edits[i.id]?.[key] ?? i.per_g[key];

  function setValue(i, key, value) {
    const g = gOf(i);
    if (g > 0) setEdits((e) => ({ ...e, [i.id]: { ...e[i.id], [key]: value / g } }));
  }

  const totals = Object.fromEntries(ALL.map(({ key }) => {
    let sum = 0, nullG = 0, usda = 0, est = 0, you = 0;
    for (const i of active) {
      const g = gOf(i);
      const v = perG(i, key);
      if (v == null) { nullG += g; continue; }
      sum += v * g;
      if (edits[i.id]?.[key] != null) you += 1; else if (i.from_usda[key]) usda += 1; else est += 1;
    }
    const na = totalG <= 0 || nullG / totalG > 0.3;
    const parts = [usda && 'USDA', est && 'my estimate', you && 'your value'].filter(Boolean).join(' + ') || 'USDA';
    const source = parts[0].toUpperCase() + parts.slice(1);
    return [key, { value: sum, na, source }];
  }));

  // any food whose carbs or sugars come from the model's own guess (not USDA, not typed by you)
  const aiEstimate = active.some((i) => ['carbs', 'sugars'].some((k) => perG(i, k) != null && !edits[i.id]?.[k] && !i.from_usda[k]));

  function fmt(key) {
    const t = totals[key];
    if (t.na) return null;
    if (data.confidence === 'low') return `${Math.round(t.value * 0.65)}–${Math.round(t.value * 1.35)}`;
    return String(Math.round(t.value));
  }

  function rescan(hint) {
    const kept = {};
    for (const i of active) {
      if (!edits[i.id] || i.added) continue;
      const g = gOf(i);
      kept[i.name.toLowerCase()] = Object.fromEntries(Object.entries(edits[i.id]).map(([k, v]) => [k, v * g]));
    }
    const keptAdded = active.filter((i) => i.added).map((i) => ({ ...i, grams: gOf(i), edits: edits[i.id] }));
    onRescan(hint, kept, keptAdded);
  }

  async function addFood(e) {
    e.preventDefault();
    const text = addText.trim();
    if (text.length < 2 || addBusy) return;
    setAddBusy(true);
    setAddErr('');
    try {
      const res = await fetch('/api/food', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (res.status === 401) { window.location.href = '/unlock'; return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'I could not look that up.');
      const id = Math.max(999, ...added.map((a) => a.id)) + 1;
      setAdded((a) => [...a, { ...body.item, id, added: true }]);
      setGrams((g) => ({ ...g, [id]: body.item.grams }));
      setAddText('');
      setAdding(false);
    } catch (err) {
      setAddErr(err.message || 'I could not look that up.');
    } finally {
      setAddBusy(false);
    }
  }

  async function save() {
    const lim = Number(limit) >= 10 ? Number(limit) : 45;
    const carbsKnown = !totals.carbs.na;
    // the verdict is kept as it was on the day, so changing the limit later does not rewrite old results
    const r = carbsKnown ? rate(totals.carbs.value, totals.sugars.na ? null : totals.sugars.value, lim, data.confidence === 'low') : null;
    const record = {
      id: Date.now(), savedAt: new Date().toISOString(), title: data.title, confidence: data.confidence, mode,
      items: active.map((i) => ({ name: i.name, grams: Math.round(gOf(i)) })),
      totals: Object.fromEntries(ALL.map(({ key }) => [key, totals[key].na ? null : Math.round(totals[key].value)])),
      verdict: r ? { word: r.word, level: r.lb } : null, limit: lim, aiEstimate, hasPhoto: false,
    };
    try {
      addSaved(record);
    } catch {
      alert('This phone would not let the app save. Check that private browsing is off.');
      return;
    }
    setSaved(true);
    keepStorage();
    if (withPhoto) {
      try {
        await savePhoto(record.id, await thumbnail(photoUrl));
        updateSaved(record.id, { hasPhoto: true });
      } catch {
        setPhotoFailed(true);
      }
    }
  }

  const level = LEVEL[data.confidence] || 2;
  const needsAsk = data.confidence === 'low' && data.question;

  return (
    <>
      <div className="photo"><img src={photoUrl} alt={data.title} /><span className="badge">Estimated from your photo</span></div>
      <h1 className="title">{data.title}</h1>
      <div className="portion">
        <span>Portion: about {Math.round(totalG)} g in total</span>
        <button className="link" type="button" onClick={() => setShowPortion((v) => !v)}>
          <Icon d="M12 20h9" extra={<path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />} />Change
        </button>
      </div>
      {showPortion && (
        <div className="seg" role="group" aria-label="How much did you eat?">
          {Object.keys(MODES).map((m) => (
            <button key={m} type="button" className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
          ))}
        </div>
      )}
      {prep && <p className="note-line">{mode === 'serving' ? `This looks like about ${data.servings} meals' worth. Showing 1 serving.` : mode === 'half' ? 'Showing half of everything in the photo.' : 'Showing everything in the photo.'}</p>}
      <div className="conf">
        <div className={`dots ${data.confidence === 'low' ? 'low' : ''}`}>{[1, 2, 3].map((n) => <i key={n} className={n <= level ? 'on' : ''} />)}</div>
        <span><b>{CONF[data.confidence][0]}</b> {CONF[data.confidence][1]}</span>
      </div>
      <Gauge
        carbs={totals.carbs.na ? null : totals.carbs.value}
        sugars={totals.sugars.na ? null : totals.sugars.value}
        limit={Number(limit) >= 10 ? Number(limit) : 45}
        range={data.confidence === 'low'}
        aiEstimate={aiEstimate}
        onLimit={changeLimit}
      />
      {data.note && <p className="note-line">{data.note}</p>}

      {needsAsk && (
        <div className="ask">
          <p>{data.question.text}</p>
          <div className="chips">
            {data.question.options.map((o) => <button key={o} type="button" className="chip" onClick={() => rescan(o)}>{o}</button>)}
            <button type="button" className="chip" onClick={() => setShowOther(true)}>Other…</button>
          </div>
          {showOther && (
            <form className="other" onSubmit={(e) => { e.preventDefault(); if (other.trim()) rescan(other.trim()); }}>
              <input className="field" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Tell me what it is" maxLength={120} aria-label="Tell me what it is" />
              <button className="btn" type="submit" disabled={!other.trim()}>Update</button>
            </form>
          )}
        </div>
      )}

      <div className="grid">
        {ALL.map((m) => {
          const t = totals[m.key];
          const v = fmt(m.key);
          return (
            <div key={m.key} className={`metric ${m.cls}`}>
              <small>{m.label}</small>
              {v == null ? <b className="na">Not available</b> : <b className={v.includes('–') ? 'rng' : ''}>{v}<span>{m.unit}</span></b>}
              <em>{v == null ? 'Not enough information' : data.confidence === 'low' ? `Rough range · ${t.source}` : m.key === 'fiber' ? t.source : `${t.source} · ${Math.round(totalG)} g portion`}</em>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>What I see</h3>
        {items.map((i) => {
          if (removed[i.id]) return null;
          const g = gOf(i);
          const kcal = perG(i, 'calories') == null ? null : Math.round(perG(i, 'calories') * g);
          const carbs = perG(i, 'carbs') == null ? null : perG(i, 'carbs') * g;
          const sugars = perG(i, 'sugars') == null ? null : perG(i, 'sugars') * g;
          const edited = !!edits[i.id];
          // the size the model saw, shown only while the grams still match the photo (otherwise it would be wrong)
          const measure = (i.added || factor === 1) && Math.round(Number(grams[i.id])) === Math.round(i.grams) && i.portion_text ? i.portion_text : null;
          return (
            <div className="row" key={i.id}>
              <div className="rtop">
                <span className="n">{i.name}{measure && <small className="meas">{i.added ? 'You added' : 'Looks like'} {measure}</small>}<small className="src">{edited ? 'Edited by you' : i.usda_match ? `Matched to: ${shortName(i.usda_match)}` : 'My estimate'} · {kcal == null ? 'calories not available' : `${kcal} kcal`}</small></span>
                <button className="x" type="button" aria-label={`Remove ${i.name}`} onClick={() => setRemoved({ ...removed, [i.id]: true })}><Icon d="M6 6l12 12M18 6L6 18" /></button>
              </div>
              <div className="fields">
                <NumField short="Grams" label={`Grams of ${i.name}`} value={g} onCommit={(v) => setGrams({ ...grams, [i.id]: v / (i.added ? 1 : factor) })} />
                <NumField short="Carbs (g)" label={`Carbs in ${i.name}, g`} value={carbs} onCommit={(v) => setValue(i, 'carbs', v)} />
                <NumField short="Sugars (g)" label={`Sugars in ${i.name}, g`} value={sugars} onCommit={(v) => setValue(i, 'sugars', v)} />
              </div>
            </div>
          );
        })}
        {!adding ? (
          <button className="link addfood" type="button" onClick={() => setAdding(true)}>
            <Icon d="M12 5v14M5 12h14" />Add a food
          </button>
        ) : (
          <form className="addform" onSubmit={addFood}>
            <label htmlFor="addfood">What did you add?</label>
            <input id="addfood" className="field" value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="For example: 1 tbsp olive oil" maxLength={120} autoFocus />
            {addErr && <p className="err" role="alert">{addErr}</p>}
            <div className="addbtns">
              <button className="btn" type="submit" disabled={addBusy || addText.trim().length < 2}>{addBusy ? 'Looking it up…' : 'Add'}</button>
              <button className="btn s" type="button" onClick={() => { setAdding(false); setAddErr(''); }}>Cancel</button>
            </div>
          </form>
        )}
        {Object.keys(removed).length > 0 && (
          <>
            <button className="link" type="button" onClick={() => setRemoved({})}>Put removed foods back</button>
            <button className="btn s recheck" type="button" onClick={() => rescan(`Only these foods are on the plate: ${active.map((i) => i.name).join(', ')}. Ignore anything else.`)}>Look at the photo again, using only these foods</button>
            <p className="note-line">Reads the photo again. Values you typed are kept for foods that are still there.</p>
          </>
        )}
      </div>

      <div className="actions">
        {!saved && (
          <label className="keepphoto">
            <input type="checkbox" checked={withPhoto} onChange={(e) => setWithPhoto(e.target.checked)} />
            <span>Save the photo too<small>Stays on this phone. You can delete it later and keep the result.</small></span>
          </label>
        )}
        <button className="btn p" type="button" onClick={save} disabled={saved}>{saved ? 'Saved on this device' : 'Save result'}</button>
        {saved && <Link href="/saved" className="btn s linkbtn">Open saved results</Link>}
        {photoFailed && <p className="err" role="alert">The result is saved, but the photo could not be.</p>}
        <button className="btn s" type="button" onClick={onAgain}>Scan something else</button>
      </div>
      <p className="legal">This is an estimate made from your photo. It is not medical advice and does not replace your care team.<br /><b>Source:</b> USDA FoodData Central, the US government's food database, where marked.</p>
    </>
  );
}
