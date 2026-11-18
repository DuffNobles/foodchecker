import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { requireAccess } from '../lib/session';
import ResultView from '../components/ResultView';

export const getServerSideProps = requireAccess;

function prepare(file) {
  // Shrink on the phone first: longest side 1568 px, JPEG. Keeps the upload small and fast.
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      c.toBlob((blob) => {
        if (!blob) return reject(new Error('no blob'));
        const fr = new FileReader();
        fr.onload = () => resolve({ b64: String(fr.result).split(',')[1], url: URL.createObjectURL(blob) });
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = src;
  });
}

export default function Scan() {
  const router = useRouter();
  const [stage, setStage] = useState('idle'); // idle | working | result | error
  const [photo, setPhoto] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const [carry, setCarry] = useState(null); // typed values kept across a re-scan of the same photo

  async function run(p, hint) {
    setStage('working');
    setError('');
    try {
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: p.b64, hint }) });
      if (res.status === 401) { router.push('/unlock'); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong.');
      setData(body);
      setRound((n) => n + 1);
      setStage('result');
    } catch (e) {
      setError(e.message || 'Something went wrong.');
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
          <Link href="/" className="round" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></Link>
          <h2>Scan a meal</h2>
          <span className="round ghost" />
        </div>

        {stage === 'idle' && (
          <>
            <h1 className="title big">Take a photo of your plate</h1>
            <p className="lead">Or choose one from your photos.</p>
            <label className="btn p pick" htmlFor="photo">Take or choose a photo</label>
            <input id="photo" className="file" type="file" accept="image/*" onChange={onFile} />
            <ul className="tips">
              <li>Get the whole plate in the picture.</li>
              <li>Good light helps. Shoot from slightly above.</li>
              <li>A fork or your hand beside the plate shows the size.</li>
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
          <ResultView key={round} data={data} photoUrl={photo.url} carry={carry} onRescan={(hint, kept) => { setCarry(kept); run(photo, hint); }} onAgain={() => { setData(null); setPhoto(null); setStage('idle'); }} />
        )}
      </main>
    </>
  );
}
