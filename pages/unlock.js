import Head from 'next/head';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { isAuthed } from '../lib/session';

export function getServerSideProps({ req }) {
  if (isAuthed(req)) return { redirect: { destination: '/', permanent: false } };
  return { props: {} };
}

export default function Unlock() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      if (res.ok) { router.push('/'); return; }
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Something went wrong. Try again.');
    } catch {
      setError('Could not connect. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Food Checker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <main className="wrap">
        <h1>Food Checker</h1>
        <p className="lead">Enter your access code. You only need to do this once on each device.</p>
        <form onSubmit={submit}>
          <label className="lbl" htmlFor="code">Access code</label>
          <input id="code" className="field" type="password" autoComplete="current-password" autoCapitalize="none" autoCorrect="off" value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy || !code}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>
      </main>
    </>
  );
}
