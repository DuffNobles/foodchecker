import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { requireAccess } from '../lib/session';
import { getSaved, removeSaved, updateSaved, getPhoto, deletePhoto, showValue } from '../lib/store';

export const getServerSideProps = requireAccess;

const METRICS = [
  { key: 'carbs', label: 'Total carbohydrates', unit: 'g', cls: 'c1' },
  { key: 'sugars', label: 'Total sugars', unit: 'g', cls: 'c2' },
  { key: 'calories', label: 'Calories', unit: 'kcal', cls: 'c3' },
  { key: 'protein', label: 'Protein', unit: 'g', cls: 'c4' },
];

// Fiber only exists on results saved after it was added; older ones simply do not show the block.
const ALL = [...METRICS, { key: 'fiber', label: 'Fiber (part of the carbs)', unit: 'g', cls: 'c5 wide' }];

const when = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

// Photo from the phone's own storage, shown through a temporary local address.
function usePhoto(id, has) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!has) { setUrl(null); return undefined; }
    let made = null, live = true;
    getPhoto(id).then((blob) => { if (live && blob) { made = URL.createObjectURL(blob); setUrl(made); } }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, has]);
  return url;
}

function Card({ r, onOpen }) {
  const url = usePhoto(r.id, r.hasPhoto);
  const t = r.totals;
  const conf = r.source === 'menu' ? 'medium' : r.confidence; // menu values are always single rough numbers
  return (
    <button type="button" className="scard" onClick={() => onOpen(r.id)}>
      <span className="sthumb">{url ? <img src={url} alt="" /> : <svg viewBox="0 0 24 24"><path d="M3 11h18" /><path d="M5 11a7 7 0 0014 0" /></svg>}</span>
      <span className="sbody">
        <b>{r.title}</b>
        {r.subtitle && <small>{r.subtitle}</small>}
        <small>{when(r.savedAt)}{r.source === 'menu' ? ' · Menu' : ''}</small>
        <small>{showValue(t.carbs, conf)} g carbs · {showValue(t.sugars, conf)} g sugars · {showValue(t.calories, conf)} kcal · {showValue(t.protein, conf)} g protein</small>
        {r.verdict && <span className={`spill l${r.verdict.level}`}>{r.verdict.word}</span>}
      </span>
    </button>
  );
}

function Detail({ r, onBack, onChange }) {
  const url = usePhoto(r.id, r.hasPhoto);
  const [confirm, setConfirm] = useState(false);
  const menu = r.source === 'menu';

  async function dropPhoto() {
    try { await deletePhoto(r.id); } catch { /* nothing stored */ }
    updateSaved(r.id, { hasPhoto: false });
    onChange();
  }
  async function dropResult() {
    try { await deletePhoto(r.id); } catch { /* nothing stored */ }
    removeSaved(r.id);
    onBack();
    onChange();
  }

  return (
    <>
      <div className="bar">
        <button type="button" className="round" aria-label="Back to saved results" onClick={onBack}><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
        <h2>Saved result</h2>
        <span className="round ghost" />
      </div>
      {url && <div className="photo"><img src={url} alt={r.title} /></div>}
      <h1 className="title">{r.title}</h1>
      {r.subtitle && <p className="note-line">{r.subtitle}</p>}
      <p className="note-line">Saved {when(r.savedAt)}. {menu ? `From a menu: a rough estimate for a typical serving${r.portionG ? ` of about ${r.portionG} g` : ''}` : `About ${r.items.reduce((s, i) => s + i.grams, 0)} g in total`}{!menu && r.confidence === 'low' ? '. Low confidence, so values are ranges' : ''}.</p>
      {r.verdict && (
        <div className="gauge">
          <div className="gcap">Blood-sugar check</div>
          <div className={`gverdict l${r.verdict.level}`}>{r.verdict.word}</div>
          <div className="gbasis">Rated against a limit of {r.limit} g carbs per meal on the day it was saved. Based on carbs and sugars only. Not medical advice.</div>
          {r.aiEstimate && <div className="gbasis">Some numbers were AI estimates.</div>}
        </div>
      )}
      <div className="grid">
        {ALL.filter((m) => r.totals[m.key] !== undefined && !(menu && m.key === 'fiber')).map((m) => {
          const v = showValue(r.totals[m.key], menu ? 'medium' : r.confidence);
          const na = r.totals[m.key] == null;
          return (
            <div key={m.key} className={`metric ${m.cls}`}>
              <small>{m.label}</small>
              {na ? <b className="na">Not available</b> : <b className={v.includes('–') ? 'rng' : ''}>{v}<span>{m.unit}</span></b>}
            </div>
          );
        })}
      </div>
      {!menu && (
        <div className="card">
          <h3>What was in it</h3>
          {r.items.map((i, n) => <div className="row" key={n}><span className="n">{i.name}<small className="src">{i.grams} g</small></span></div>)}
        </div>
      )}
      <div className="actions">
        {r.hasPhoto && <button className="btn s" type="button" onClick={dropPhoto}>Delete the photo, keep the result</button>}
        {!confirm
          ? <button className="btn s danger" type="button" onClick={() => setConfirm(true)}>Delete this result</button>
          : (
            <div className="askdel" role="alertdialog" aria-label="Delete this result?">
              <p>Delete this result{r.hasPhoto ? ' and its photo' : ''}? This cannot be undone.</p>
              <button className="btn danger solid" type="button" onClick={dropResult}>Yes, delete</button>
              <button className="btn s" type="button" onClick={() => setConfirm(false)}>Keep it</button>
            </div>
          )}
      </div>
      <p className="legal">This is an estimate. It is not medical advice and does not replace your care team.<br /><b>Source:</b> USDA FoodData Central where marked.</p>
    </>
  );
}

export default function Saved() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const refresh = () => setList(getSaved());
  useEffect(refresh, []);

  const current = list && open != null ? list.find((r) => r.id === open) : null;

  return (
    <>
      <Head>
        <title>Saved results · Food Checker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <main className="wrap">
        {current ? <Detail r={current} onBack={() => setOpen(null)} onChange={refresh} /> : (
          <>
            <div className="bar">
              <Link href="/" className="round" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></Link>
              <h2>Saved results</h2>
              <span className="round ghost" />
            </div>
            {list && list.length === 0 && (
              <>
                <p className="lead center">Nothing saved yet.</p>
                <Link href="/scan" className="btn p linkbtn">Scan a meal</Link>
              </>
            )}
            {list && list.map((r) => <Card key={r.id} r={r} onOpen={setOpen} />)}
            {list && list.length > 0 && <p className="legal">Saved on this phone only. Clearing Safari's website data removes them.</p>}
          </>
        )}
      </main>
    </>
  );
}
