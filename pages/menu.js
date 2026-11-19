import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { requireAccess } from '../lib/session';
import { prepare } from '../lib/photo';
import { rate } from '../components/Gauge';
import { addSaved, keepStorage } from '../lib/store';

export const getServerSideProps = requireAccess;

const COLS = [
  { key: 'carbs', label: 'Carbs', unit: 'g', cls: 'c1' },
  { key: 'sugars', label: 'Sugars', unit: 'g', cls: 'c2' },
  { key: 'calories', label: 'Calories', unit: 'kcal', cls: 'c3' },
  { key: 'protein', label: 'Protein', unit: 'g', cls: 'c4' },
];
const LABEL = { carbs: 'carbs', sugars: 'sugars', calories: 'calories', protein: 'protein' };

function Dish({ d, limit, saved, onSave }) {
  const r = d.carbs == null ? null : rate(d.carbs, d.sugars, limit, d.confidence === 'low');
  const missing = COLS.filter((c) => d[c.key] == null).map((c) => LABEL[c.key]);
  return (
    <div className="dish">
      <div className="dtop">
        <div className="dname"><b>{d.name}</b>{d.name_en && <small>{d.name_en}</small>}</div>
        {r && <span className={`spill l${r.lb}`}>{r.word}</span>}
      </div>
      <div className="dvals">
        {COLS.map((c) => (
          <div key={c.key} className={`dv ${c.cls}`}>
            <b>{d[c.key] == null ? '–' : Math.round(d[c.key])}</b>
            <small>{c.label}{d[c.key] == null ? '' : ` ${c.unit}`}</small>
          </div>
        ))}
      </div>
      <p className="note-line">
        Rough estimate for a typical serving{d.grams ? `, about ${Math.round(d.grams)} g` : ''}.{d.confidence === 'low' ? ' Not very sure about this one.' : ''}
        {missing.length > 0 && ` Not available: ${missing.join(', ')}.`}
        {!r && ' Not enough carb data to rate it.'}
      </p>
      <button className="btn s dsave" type="button" onClick={() => onSave(d, r)} disabled={saved}>{saved ? 'Saved on this device' : 'Save this dish'}</button>
    </div>
  );
}

export default function Menu() {
  const router = useRouter();
  const [stage, setStage] = useState('idle'); // idle | working | result | error
  const [photo, setPhoto] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [order, setOrder] = useState('printed'); // printed | carbs
  const [saved, setSaved] = useState({});
  const [limit, setLimit] = useState(45);

  useEffect(() => {
    try { const v = Number(localStorage.getItem('fc_limit')); if (v >= 10 && v <= 200) setLimit(v); } catch { /* default */ }
  }, []);

  async function run(p) {
    setStage('working');
    setError('');
    try {
      const res = await fetch('/api/menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: p.b64 }) });
      if (res.status === 401) { router.push('/unlock'); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
      setData(body);
      setSaved({});
      setOrder('printed');
      setStage('result');
    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.');
      setStage('error');
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const p = await prepare(file);
      setPhoto(p);
      run(p);
    } catch {
      setError('I could not open that photo. Try another one.');
      setStage('error');
    }
  }

  function save(d, r) {
    const record = {
      id: Date.now(), savedAt: new Date().toISOString(), source: 'menu',
      title: d.name, subtitle: d.name_en, confidence: d.confidence, mode: 'menu', portionG: d.grams ? Math.round(d.grams) : null,
      items: [],
      totals: { carbs: d.carbs == null ? null : Math.round(d.carbs), sugars: d.sugars == null ? null : Math.round(d.sugars), calories: d.calories == null ? null : Math.round(d.calories), protein: d.protein == null ? null : Math.round(d.protein) },
      verdict: r ? { word: r.word, level: r.lb } : null, limit, aiEstimate: true, hasPhoto: false,
    };
    try {
      addSaved(record);
      keepStorage();
      setSaved((s) => ({ ...s, [d.id]: true }));
    } catch {
      alert('This phone would not let the app save. Check that private browsing is off.');
    }
  }

  const dishes = data ? (order === 'carbs' ? [...data.dishes].sort((a, b) => (a.carbs ?? Infinity) - (b.carbs ?? Infinity)) : data.dishes) : [];

  return (
    <>
      <Head>
        <title>Scan a menu · Food Checker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <main className="wrap">
        <div className="bar">
          <Link href="/" className="round" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></Link>
          <h2>Scan a menu</h2>
          <span className="round ghost" />
        </div>

        {stage === 'idle' && (
          <>
            <section className="hero scanhero">
              <span className="lens"><svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2z" /><path d="M8 8h6M8 12h6" /></svg></span>
              <h1>Take a photo of the <em>menu</em></h1>
              <p className="lead">Or choose one from your photos.</p>
            </section>
            <label className="action snap" htmlFor="photo">
              <span className="ico"><svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 012-2h2l1.5-2h5L16 6h2a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><circle cx="12" cy="12.5" r="3.6" /></svg></span>
              <div><b>Take or choose a photo</b><p className="sub">Camera, photo library or files</p></div>
            </label>
            <input id="photo" className="file" type="file" accept="image/*" onChange={onFile} />
            <ul className="tipcards">
              <li className="t1"><span className="ti"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /></svg></span>One page at a time, with the whole page in the picture.</li>
              <li className="t2"><span className="ti"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.8" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></svg></span>Hold the phone straight on, in good light.</li>
              <li className="t3"><span className="ti"><svg viewBox="0 0 24 24"><path d="M3.5 9h17v6h-17z" /><path d="M7.5 9v2.5M11 9v3.5M14.5 9v2.5M18 9v3.5" /></svg></span>Spanish menus work. Names stay as printed.</li>
            </ul>
          </>
        )}

        {stage === 'working' && photo && (
          <>
            <div className="photo"><img src={photo.url} alt="Your photo" /></div>
            <div className="working" role="status"><span className="spin" />Reading the menu…</div>
            <p className="lead center">This usually takes 15 to 30 seconds.</p>
          </>
        )}

        {stage === 'error' && (
          <>
            <p className="err" role="alert">{error}</p>
            <button className="btn p" type="button" onClick={() => setStage('idle')}>Try again</button>
          </>
        )}

        {stage === 'result' && data && (
          <>
            <h1 className="title">{dishes.length} dish{dishes.length === 1 ? '' : 'es'} found</h1>
            <p className="note-line">Menus do not list portions, so these are rough estimates for a typical serving. If the restaurant prints its own numbers, trust those.</p>
            {data.readable !== 'good' && <p className="note-line"><b>{data.readable === 'poor' ? 'Hard to read.' : 'Some dishes may be missing.'}</b> {data.note || 'A closer, brighter photo can help.'}</p>}
            <div className="seg two" role="group" aria-label="Order of dishes">
              <button type="button" className={order === 'printed' ? 'on' : ''} onClick={() => setOrder('printed')}>As printed</button>
              <button type="button" className={order === 'carbs' ? 'on' : ''} onClick={() => setOrder('carbs')}>Lowest carbs first</button>
            </div>
            {dishes.map((d) => <Dish key={d.id} d={d} limit={limit} saved={!!saved[d.id]} onSave={save} />)}
            <div className="actions">
              {Object.keys(saved).length > 0 && <Link href="/saved" className="btn s linkbtn">Open saved results</Link>}
              <button className="btn s" type="button" onClick={() => { setData(null); setPhoto(null); setStage('idle'); }}>Scan another page</button>
            </div>
            <p className="legal">These are estimates. They are not medical advice and do not replace your care team. The rating uses carbs and sugars only, against your limit of {limit} g carbs per meal.</p>
          </>
        )}
      </main>
    </>
  );
}
