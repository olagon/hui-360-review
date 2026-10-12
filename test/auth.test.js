import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccess, sessionCookie, sessionStaffId } from '../functions/lib/auth.js';
import { b64url } from '../functions/lib/http.js';

const TEAM = 'https://hui.cloudflareaccess.com';
const AUD = 'aud-123';
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256' };
globalThis.fetch = async (url) => {
  assert.equal(url, `${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }));
};

async function jwt(claims, header = { alg: 'RS256', kid: 'k1' }) {
  const body = `${enc(header)}.${enc({ aud: [AUD], iss: TEAM, email: 'noeau@example.org', exp: Date.now() / 1000 + 600, ...claims })}`;
  return `${body}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(body)))}`;
}
const req = (token, host = 'huimau.actionsmatter.com') =>
  new Request(`https://${host}/api/admin/me`, { headers: token ? { 'cf-access-jwt-assertion': token } : {} });
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, SESSION_SECRET: 's3cret' };

test('valid Access token returns the email', async () => {
  assert.equal(await verifyAccess(req(await jwt({})), env), 'noeau@example.org');
});

test('Access tokens that must be refused', async () => {
  const bad = {
    missing: null,
    'wrong audience': await jwt({ aud: ['other'] }),
    'wrong issuer': await jwt({ iss: 'https://evil.cloudflareaccess.com' }),
    expired: await jwt({ exp: Date.now() / 1000 - 5 }),
    'unknown key': await jwt({}, { alg: 'RS256', kid: 'nope' }),
    'alg none': await jwt({}, { alg: 'none', kid: 'k1' }),
    tampered: (await jwt({})).replace(/\.[^.]+\./, `.${enc({ aud: [AUD], iss: TEAM, email: 'mallory@example.org', exp: 9e9 })}.`),
    garbage: 'a.b.c',
  };
  for (const [name, token] of Object.entries(bad)) {
    await assert.rejects(() => verifyAccess(req(token), env), (e) => e.status === 401, name);
  }
});

test('dev bypass only works on localhost', async () => {
  const dev = { ...env, DEV_ADMIN_EMAIL: 'olin@example.org' };
  assert.equal(await verifyAccess(req(null, 'localhost:8790'), dev), 'olin@example.org');
  await assert.rejects(() => verifyAccess(req(null), dev), (e) => e.status === 401);
});

test('staff session cookie round trips and rejects tampering', async () => {
  const cookie = (await sessionCookie(env, 42)).split(';')[0];
  const r = (c) => new Request('https://x/', { headers: { cookie: c } });
  assert.equal(await sessionStaffId(r(cookie), env), 42);
  assert.equal(await sessionStaffId(r(cookie.replace('hui360_s=42', 'hui360_s=43')), env), null);
  assert.equal(await sessionStaffId(r(cookie), { SESSION_SECRET: 'other' }), null);
  assert.equal(await sessionStaffId(r('hui360_s=42.1.abc'), env), null, 'expired');
});

test('a public page can recognize an admin from the Access cookie, and only when asked', async () => {
  const cookieReq = (cookie) => new Request('https://huimau.actionsmatter.com/', { headers: { cookie } });
  const good = await jwt({});
  assert.equal(await verifyAccess(cookieReq(`other=1; CF_Authorization=${good}`), env, { cookie: true }), 'noeau@example.org');
  await assert.rejects(() => verifyAccess(cookieReq(`CF_Authorization=${good}`), env), (e) => e.status === 401, 'admin paths still need the Access header');
  const otherApp = await jwt({ aud: ['other'] });
  await assert.rejects(() => verifyAccess(cookieReq(`CF_Authorization=${otherApp}`), env, { cookie: true }), (e) => e.status === 401);
  await assert.rejects(() => verifyAccess(cookieReq('CF_Authorization=a.b.c'), env, { cookie: true }), (e) => e.status === 401);
});
