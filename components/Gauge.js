// Blood-sugar check: a fixed rule on the carbs (and sugars) of the portion, not a model opinion.
const NAMES = ['Best Choice', 'Good Option', 'Not Recommended', 'Avoid'];
const COLORS = ['var(--l0)', 'var(--l1)', 'var(--l2)', 'var(--l3)'];

export function position(carbs, sugars, limit) {
  const r = carbs / limit;
  let p = r <= 0.6 ? (r / 0.6) * 0.25 : r <= 1 ? 0.25 + ((r - 0.6) / 0.4) * 0.25 : r <= 1.5 ? 0.5 + ((r - 1) / 0.5) * 0.25 : Math.min(1, 0.75 + ((r - 1.5) / 0.75) * 0.25);
  const moved = sugars != null && sugars > 25;
  if (moved) p = Math.min(0.999, p + 0.25);
  return { p, moved };
}
const level = (p) => Math.min(3, Math.floor(p / 0.25));

// The rating for a portion. `range` is true for low confidence (carbs and sugars shown as a range).
export function rate(carbs, sugars, limit, range) {
  const lo = range ? carbs * 0.65 : carbs;
  const hi = range ? carbs * 1.35 : carbs;
  const sLo = sugars == null ? null : range ? sugars * 0.65 : sugars;
  const sHi = sugars == null ? null : range ? sugars * 1.35 : sugars;
  const a = position(lo, sLo, limit), b = position(hi, sHi, limit);
  const la = level(a.p), lb = level(b.p);
  const word = la === lb ? NAMES[la] : `${NAMES[la]} to ${NAMES[lb]}`;
  return { a, b, la, lb, word, lo, hi };
}

export default function Gauge({ carbs, sugars, limit, range, aiEstimate, onLimit }) {
  if (carbs == null) {
    return <div className="gauge"><div className="gcap">Blood-sugar check</div><p className="gwhy">Not enough carb data in this photo to rate it.</p></div>;
  }
  const { a, b, la, lb, word, lo, hi } = rate(carbs, sugars, limit, range);
  const spread = b.p - a.p > 0.02;
  const left = (p) => `calc(6px + (100% - 12px) * ${p.toFixed(3)})`;
  const carbText = range ? `${Math.round(lo)}–${Math.round(hi)} g carbs` : `${Math.round(carbs)} g carbs`;
  const sugarText = sugars == null ? '' : ` · ${Math.round(sugars)} g sugars`;

  return (
    <div className="gauge" role="group" aria-label={`Blood-sugar check: ${word}`}>
      <div className="gcap">Blood-sugar check</div>
      <div className="gbar">
        {COLORS.map((c, i) => <i key={i} style={{ background: c }} />)}
        {spread
          ? <span className="grng" style={{ left: left(a.p), width: `calc((100% - 12px) * ${(b.p - a.p).toFixed(3)})` }} />
          : <span className="gmk" style={{ left: left(a.p) }} />}
      </div>
      <div className="glbls">
        {NAMES.map((n, i) => <span key={n} className={i >= la && i <= lb ? 'on' : ''}>{n}</span>)}
      </div>
      <div className={`gverdict l${lb}`}>{word}</div>
      <div className="gwhy">{carbText}{sugarText}</div>
      <label className="glimit">Carb limit per meal
        <input type="number" inputMode="decimal" min="10" max="200" value={limit} onChange={(e) => onLimit(e.target.value)} aria-label="Carb limit per meal in grams" /> g
      </label>
      {(a.moved || b.moved) && <div className="gbasis">Sugars are over 25 g, so the rating is one step stricter.</div>}
      {aiEstimate && <div className="gbasis">Some numbers are AI estimates. Check them.</div>}
      <div className="gbasis">This looks only at carbs and sugars. Ask your care team what limit is right for you. Not medical advice.</div>
    </div>
  );
}
