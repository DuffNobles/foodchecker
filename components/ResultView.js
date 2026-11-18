import { useState } from 'react';

const METRICS = [
  { key: 'carbs', label: 'Total carbohydrates', unit: 'g', cls: 'c1' },
  { key: 'sugars', label: 'Total sugars', unit: 'g', cls: 'c2' },
  { key: 'calories', label: 'Calories', unit: 'kcal', cls: 'c3' },
  { key: 'protein', label: 'Protein', unit: 'g', cls: 'c4' },
];
const MODES = { half: 0.5, all: 1, more: 1.5 };
const MODE_LABEL = { half: 'Half', all: 'All', more: 'More' };
const LEVEL = { high: 3, medium: 2, low: 1 };
const HINT = { high: 'Looks clear.', medium: 'Check the portion.', low: 'Missing data.' };

function Icon({ d, extra }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} />{extra}</svg>;
}

export default function ResultView({ data, photoUrl, onRescan, onSave, onAgain }) {
  const [grams, setGrams] = useState(() => Object.fromEntries(data.items.map((i) => [i.id, i.grams])));
  const [removed, setRemoved] = useState({});
  const [mode, setMode] = useState('all');
  const [showPortion, setShowPortion] = useState(false);
  const [other, setOther] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [saved, setSaved] = useState(false);

  const factor = MODES[mode];
  const active = data.items.filter((i) => !removed[i.id]);
  const totalG = active.reduce((s, i) => s + (Number(grams[i.id]) || 0) * factor, 0);

  const totals = Object.fromEntries(METRICS.map(({ key }) => {
    let sum = 0, nullG = 0, usda = 0, est = 0;
    for (const i of active) {
      const g = (Number(grams[i.id]) || 0) * factor;
      const v = i.per_g[key];
      if (v == null) { nullG += g; continue; }
      sum += v * g;
      if (i.from_usda[key]) usda += 1; else est += 1;
    }
    const na = totalG <= 0 || nullG / totalG > 0.3;
    const source = usda && est ? 'USDA + estimate' : est ? 'Estimate' : 'USDA';
    return [key, { value: sum, na, source }];
  }));

  function fmt(key) {
    const t = totals[key];
    if (t.na) return null;
    if (data.confidence === 'low') return `${Math.round(t.value * 0.65)}–${Math.round(t.value * 1.35)}`;
    return String(Math.round(t.value));
  }

  function save() {
    const record = {
      id: Date.now(), savedAt: new Date().toISOString(), title: data.title, confidence: data.confidence, mode,
      items: active.map((i) => ({ name: i.name, grams: Math.round((Number(grams[i.id]) || 0) * factor) })),
      totals: Object.fromEntries(METRICS.map(({ key }) => [key, totals[key].na ? null : Math.round(totals[key].value)])),
    };
    try {
      const list = JSON.parse(localStorage.getItem('fc_saved') || '[]');
      list.unshift(record);
      localStorage.setItem('fc_saved', JSON.stringify(list));
      setSaved(true);
      if (onSave) onSave(record);
    } catch {
      alert('This phone would not let the app save. Check that private browsing is off.');
    }
  }

  const level = LEVEL[data.confidence] || 2;
  const needsAsk = data.confidence === 'low' && data.question;
  const confWord = data.confidence[0].toUpperCase() + data.confidence.slice(1);

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
      <div className="conf">
        <div className={`dots ${data.confidence === 'low' ? 'low' : ''}`}>{[1, 2, 3].map((n) => <i key={n} className={n <= level ? 'on' : ''} />)}</div>
        <span><b>{confWord} confidence.</b> {HINT[data.confidence]}</span>
      </div>
      {data.note && <p className="note-line">{data.note}</p>}

      {needsAsk && (
        <div className="ask">
          <p>{data.question.text}</p>
          <div className="chips">
            {data.question.options.map((o) => <button key={o} type="button" className="chip" onClick={() => onRescan(o)}>{o}</button>)}
            <button type="button" className="chip" onClick={() => setShowOther(true)}>Other…</button>
          </div>
          {showOther && (
            <form className="other" onSubmit={(e) => { e.preventDefault(); if (other.trim()) onRescan(other.trim()); }}>
              <input className="field" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Tell me what it is" maxLength={120} aria-label="Tell me what it is" />
              <button className="btn" type="submit" disabled={!other.trim()}>Update</button>
            </form>
          )}
        </div>
      )}

      <div className="grid">
        {METRICS.map((m) => {
          const t = totals[m.key];
          const v = fmt(m.key);
          return (
            <div key={m.key} className={`metric ${m.cls}`}>
              <small>{m.label}</small>
              {v == null ? <b className="na">Not available</b> : <b className={v.includes('–') ? 'rng' : ''}>{v}<span>{m.unit}</span></b>}
              <em>{v == null ? 'Not enough data' : data.confidence === 'low' ? `Estimated range · ${t.source}` : `${t.source} · ${Math.round(totalG)} g portion`}</em>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>What I see</h3>
        {data.items.map((i) => removed[i.id] ? null : (
          <div className="row" key={i.id}>
            <span className="n">{i.name}<small className="src">{i.usda_match ? 'USDA' : 'Estimate'}</small></span>
            <label className="g-edit"><span className="sr">Grams of {i.name}</span>
              <input type="number" inputMode="decimal" min="0" value={grams[i.id]} onChange={(e) => setGrams({ ...grams, [i.id]: e.target.value })} /> g
            </label>
            <button className="x" type="button" aria-label={`Remove ${i.name}`} onClick={() => setRemoved({ ...removed, [i.id]: true })}><Icon d="M6 6l12 12M18 6L6 18" /></button>
          </div>
        ))}
        {Object.keys(removed).length > 0 && <button className="link" type="button" onClick={() => setRemoved({})}>Put removed items back</button>}
      </div>

      <div className="actions">
        <button className="btn p" type="button" onClick={save} disabled={saved}>{saved ? 'Saved on this device' : 'Save result'}</button>
        <button className="btn s" type="button" onClick={onAgain}>Scan something else</button>
      </div>
      <p className="legal">This is an estimate made from your photo. It is not medical advice and does not replace your care team.<br /><b>Source:</b> USDA FoodData Central where marked.</p>
    </>
  );
}
