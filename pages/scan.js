import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { requireAccess } from '../lib/session';
import ResultView from '../components/ResultView';
import { prepare } from '../lib/photo';

export const getServerSideProps = requireAccess;

export default function Scan() {
  const router = useRouter();
  const [stage, setStage] = useState('idle'); // idle | working | result | error
  const [photo, setPhoto] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const [carry, setCarry] = useState(null); // typed values kept across a re-scan of the same photo
  const [carryAdded, setCarryAdded] = useState(null); // foods added by hand, kept the same way

  async function run(p, hint) {
    setStage('working');
    setError('');
    try {
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: p.b64, hint }) });
      if (res.status === 401) { router.push('/unlock'); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
      setData(body);
      setRound((n) => n + 1);
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
      setCarry(null);
      setCarryAdded(null);
      run(p, '');
    } catch {
      setError('I could not open that photo. Try another one.');
      setStage('error');
    }
  }

  return (
    <>
      <Head>
        <title>Scan a meal · Food Checker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <main className="wrap">
        <div className="bar">
          <Link href="/" className="round" aria-label="Back"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></Link>
          <h2>Scan a meal</h2>
          <span className="round ghost" />
        </div>

        {stage === 'idle' && (
          <>
            <section className="hero scanhero">
              <span className="lens"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8a2 2 0 012-2h2l1.5-2h5L16 6h2a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><circle cx="12" cy="12.5" r="3.6" /></svg></span>
              <h1>Take a photo of your <em>plate</em></h1>
              <p className="lead">Or choose one from your photos.</p>
            </section>
            <label className="action snap" htmlFor="photo">
              <span className="ico"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8a2 2 0 012-2h2l1.5-2h5L16 6h2a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><circle cx="12" cy="12.5" r="3.6" /></svg></span>
              <div><b>Take or choose a photo</b><p className="sub">Camera, photo library or files</p></div>
            </label>
            <input id="photo" className="file" type="file" accept="image/*" onChange={onFile} />
            <ul className="tipcards">
              <li className="t1"><span className="ti"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /></svg></span>Get the whole plate in the picture.</li>
              <li className="t2"><span className="ti"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.8" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></svg></span>Good light helps. Shoot from slightly above.</li>
              <li className="t3"><span className="ti"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 9h17v6h-17z" /><path d="M7.5 9v2.5M11 9v3.5M14.5 9v2.5M18 9v3.5" /></svg></span>A fork or your hand beside the plate shows the size.</li>
            </ul>
          </>
        )}

        {stage === 'working' && photo && (
          <>
            <div className="photo"><img src={photo.url} alt="Your photo" /></div>
            <div className="working" role="status"><span className="spin" />Looking at your plate…</div>
            <p className="lead center">This usually takes 10 to 20 seconds.</p>
          </>
        )}

        {stage === 'error' && (
          <>
            <p className="err" role="alert">{error}</p>
            <button className="btn p" type="button" onClick={() => setStage('idle')}>Try again</button>
          </>
        )}

        {stage === 'result' && data && photo && (
          <ResultView key={round} data={data} photoUrl={photo.url} carry={carry} carryAdded={carryAdded} onRescan={(hint, kept, keptAdded) => { setCarry(kept); setCarryAdded(keptAdded); run(photo, hint); }} onAgain={() => { setData(null); setPhoto(null); setStage('idle'); }} />
        )}
      </main>
    </>
  );
}
