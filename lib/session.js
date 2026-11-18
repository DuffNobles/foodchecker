// Access-code session: a signed, expiring cookie. Node runtime only.
import crypto from 'node:crypto';

export const COOKIE = 'fc_session';
const DAYS = 180;

function sign(exp) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(String(exp)).digest('hex');
}

export function newToken() {
  const exp = Date.now() + DAYS * 24 * 60 * 60 * 1000;
  return `${exp}.${sign(exp)}`;
}

export function cookieHeader(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 24 * 60 * 60}`;
}

export function isAuthed(req) {
  if (!process.env.SESSION_SECRET) return false;
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  const token = raw ? raw.slice(COOKIE.length + 1) : '';
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function codeMatches(input) {
  const code = process.env.ACCESS_CODE || '';
  if (!code) return false;
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(code).digest();
  return crypto.timingSafeEqual(a, b);
}

// Use in getServerSideProps of every page except /unlock.
export function requireAccess(ctx) {
  if (isAuthed(ctx.req)) return { props: {} };
  return { redirect: { destination: '/unlock', permanent: false } };
}
