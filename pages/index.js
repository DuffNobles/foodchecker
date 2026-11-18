import Head from 'next/head';
import Link from 'next/link';
import { requireAccess } from '../lib/session';

export const getServerSideProps = requireAccess;

export default function Home() {
  return (
    <>
      <Head>
        <title>Food Checker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <main className="wrap">
        <section className="hero">
          <span className="kicker"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>Food Checker</span>
          <h1>What are you <em>eating?</em></h1>
          <p className="lead">Take a photo to see the carbs, sugars, calories and protein.</p>
        </section>

        <Link href="/scan" className="action meal">
          <span className="ico"><svg viewBox="0 0 24 24"><path d="M3 11h18"/><path d="M5 11a7 7 0 0014 0"/><path d="M8 7c0-1.2.8-1.5.8-2.5M12 7c0-1.2.8-1.5.8-2.5M16 7c0-1.2.8-1.5.8-2.5"/></svg></span>
          <div><b>Scan a meal</b><p className="sub">Photo of your plate</p></div>
        </Link>

        <button className="action menu" type="button" aria-disabled="true">
          <span className="ico"><svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2z"/><path d="M8 8h6M8 12h6"/></svg></span>
          <div><b>Scan a menu</b><p className="sub">Photo of a menu</p><span className="soon">Coming soon</span></div>
        </button>

        <Link href="/saved" className="action saved">
          <span className="ico"><svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z" /></svg></span>
          <div><b>Saved results</b><p className="sub">Meals you kept</p></div>
        </Link>

        <p className="legal">Results are estimates, not medical advice. They do not replace your care team.</p>
      </main>
    </>
  );
}
