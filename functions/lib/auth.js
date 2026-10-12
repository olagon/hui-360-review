import { HttpError, b64url, fromB64url, randomToken } from './http.js';
import { LINK_TTL_DAYS, SESSION_DAYS } from './config.js';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

// ---- Admin: Cloudflare Access JWT, verified on every request ----

let jwks = null;
let jwksAt = 0;

async function accessKeys(team, force) {
  if (force || !jwks || Date.now() - jwksAt > 3600_000) {
    const res = await fetch(`${team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new HttpError(503, 'Could not load Access keys');
    jwks = (await res.json()).keys;
    jwksAt = Date.now();
  }
  return jwks;
}

// On admin paths Access adds the token as a header. Elsewhere on the site the browser still sends
// Access's CF_Authorization cookie, so { cookie: true } lets a public page ask "is this an admin?".
export async function verifyAccess(request, env, { cookie = false } = {}) {
  const host = new URL(request.url).hostname;
  if (env.DEV_ADMIN_EMAIL && (host === 'localhost' || host === '127.0.0.1')) return env.DEV_ADMIN_EMAIL;

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    (cookie ? (request.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([\w-]+\.[\w-]+\.[\w-]+)/)?.[1] : null);
  if (!token || !env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) throw new HttpError(401, 'Admin sign in required');
  const team = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, '');
  try {
    const [h, p, s] = token.split('.');
    const header = JSON.parse(dec(fromB64url(h)));
    const payload = JSON.parse(dec(fromB64url(p)));
    let jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await accessKeys(team, true)).find((k) => k.kid === header.kid);
    if (!jwk || header.alg !== 'RS256') throw 0;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), enc(`${h}.${p}`));
    const aud = [].concat(payload.aud);
    if (!ok || !aud.includes(env.ACCESS_AUD) || payload.iss !== team || payload.exp * 1000 < Date.now() || !payload.email) throw 0;
    return payload.email;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, 'Admin sign in is not valid');
  }
}

// ---- Staff: HMAC signed session cookie ----

const hmacKey = (env) =>
  crypto.subtle.importKey('raw', enc(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function sessionCookie(env, staffId) {
  const value = `${staffId}.${Date.now() + SESSION_DAYS * 86400_000}`;
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc(value)));
  return `hui360_s=${value}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export async function sessionStaffId(request, env) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)hui360_s=(\d+)\.(\d+)\.([\w-]+)/);
  if (!m || Number(m[2]) < Date.now()) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(m[3]), enc(`${m[1]}.${m[2]}`));
    return ok ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export async function requireStaff(request, env) {
  const id = await sessionStaffId(request, env);
  const staff = id && (await env.DB.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').bind(id).first());
  if (!staff) throw new HttpError(401, 'Please open your link again');
  return staff;
}

// ---- Magic links: random token in KV, reusable until it expires ----

export async function createLink(env, origin, staffId, cycleId) {
  const token = randomToken();
  const ttl = { expirationTtl: LINK_TTL_DAYS * 86400 };
  await env.KV.put(`ml:${token}`, JSON.stringify({ staff_id: staffId, cycle_id: cycleId }), ttl);
  await env.KV.put(`mlx:${cycleId}:${staffId}`, token, ttl);
  return `${origin}/m/${token}`;
}

export async function linkFor(env, origin, staffId, cycleId) {
  const token = await env.KV.get(`mlx:${cycleId}:${staffId}`);
  return token ? `${origin}/m/${token}` : createLink(env, origin, staffId, cycleId);
}

export const readLink = (env, token) => env.KV.get(`ml:${token}`, 'json');
