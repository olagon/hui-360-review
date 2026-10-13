import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moonFor, MOONS } from '../public/assets/moon.js';
import { layoutMeetings, buildICS } from '../public/assets/ics.js';
import { parseSignals, calibrate, signalsPrompt } from '../functions/lib/signals.js';
import { route, send, sendEmails } from '../functions/lib/notify.js';

test('moon calendar lands on known nights', () => {
  assert.equal(MOONS.length, 30);
  assert.equal(moonFor('2024-01-11').name, 'Hilo'); // new moon Jan 11, 2024
  assert.match(moonFor('2024-01-25').name, /^(Akua|Hoku|Māhealani)$/); // full moon Jan 25, 2024
  assert.match(moonFor('2025-10-06').name, /^(Akua|Hoku|Māhealani)$/); // full moon Oct 6, 2025 (Hawaiʻi)
  assert.match(moonFor('2025-09-21').name, /^(Muku|Hilo)$/); // new moon Sep 21, 2025
});

test('talk story meetings fill the blocks in order and report who did not fit', () => {
  const people = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
  const { meetings, unscheduled } = layoutMeetings(
    [{ date: '2026-12-02', start: '09:00', end: '11:00' }, { date: '2026-12-01', start: '13:00', end: '14:00' }],
    people,
    45,
    15,
  );
  assert.deepEqual(meetings.map((m) => m.person.name), ['A', 'B', 'C']);
  assert.equal(meetings[0].start.getDate(), 1);
  assert.deepEqual(unscheduled.map((p) => p.name), ['D']);
  const ics = buildICS(meetings.map((m) => ({ title: `Talk story with ${m.person.name}`, start: m.start, end: m.end })));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  const long = buildICS([{ title: 'Talk story', start: meetings[0].start, end: meetings[0].end, description: 'Kūkahi ʻōlelo '.repeat(20) }]);
  for (const l of long.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, `line too long: ${l}`);
  assert.match(long.replace(/\r\n /g, ''), /DESCRIPTION:(Kūkahi ʻōlelo ){20}/);
});

test('signals parsing is forgiving and calibration needs two reviews', () => {
  assert.match(signalsPrompt(['a', 'b']).user, /^1\. a\n2\. b$/);
  assert.deepEqual(parseSignals('Sure: [{"label":"burnout","tone":-3},{"label":"weird"}]', 2), [
    { label: 'burnout', tone: -2 },
    { label: 'none', tone: 0 },
  ]);
  assert.equal(parseSignals('[{"label":"burnout"}]', 3), null, 'a short reply could line labels up with the wrong answers');
  assert.equal(parseSignals('I cannot help with that.', 2), null);
  const rows = [
    { reviewer: 'kind', review: 1, tone: 2 }, { reviewer: 'kind', review: 2, tone: 2 },
    { reviewer: 'tough', review: 3, tone: -1 }, { reviewer: 'tough', review: 4, tone: -1 },
    { reviewer: 'mid', review: 5, tone: 1 }, { reviewer: 'mid', review: 6, tone: 0 },
    { reviewer: 'once', review: 7, tone: 2 },
  ];
  assert.deepEqual(calibrate(rows), { kind: 'generous', tough: 'critical' });
});

test('email goes only to people with Send email checked, in batches of 100', async () => {
  // Settings rows (none: email comes from the Cloudflare vars) and the person marked Director.
  const fakeDB = (settings = []) => ({ prepare: () => ({ all: async () => ({ results: settings }), first: async () => ({ email: 'director@b.org' }) }) });
  const DB = fakeDB();
  const env = { DB, RESEND_API_KEY: 'k', EMAIL_FROM: 'Hui <a@b.org>' };
  assert.deepEqual(await route(env, { phone: '+1808', email: 'x@y.org', send_email: 1 }), { channel: 'email', to: 'x@y.org' });
  assert.equal(await route(env, { phone: '+1808', email: 'x@y.org', send_email: 0 }), null, 'the app never texts, even with a phone number');
  assert.equal(await route({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.org' }, { email: 'x@y.org', send_email: 0 }), null);
  assert.equal(await route({}, { phone: '1', email: 'x@y.org', send_email: 1 }), null);
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (calls.push([url, init]), new Response('{}'));
  await assert.rejects(() => send(env, '+18085551234', 'hi', 'sms'), /Copy it and send it yourself/);
  await send(env, 'x@y.org', 'hi', 'email', 'Subject');
  await sendEmails(env, Array.from({ length: 150 }, (_, i) => ({ to: `p${i}@y.org`, subject: 's', text: 't' })));
  globalThis.fetch = real;
  assert.deepEqual(JSON.parse(calls[0][1].body), [{ from: 'Hui <a@b.org>', to: ['x@y.org'], subject: 'Subject', text: 'hi', reply_to: 'director@b.org' }]);
  assert.deepEqual(calls.slice(1).map(([url, init]) => [url.split('.com')[1], JSON.parse(init.body).length]), [['/emails/batch', 100], ['/emails/batch', 50]]);

  // With the Cloudflare mailer bound, email goes through it instead of Resend.
  const sent = [];
  const cf = { DB, EMAIL_FROM: 'Hui <a@b.org>', MAILER: { send: async (list) => sent.push(...list) } };
  assert.deepEqual(await route(cf, { email: 'x@y.org', send_email: 1 }), { channel: 'email', to: 'x@y.org' });
  await send(cf, 'x@y.org', 'hi', 'email', 'Subject');
  assert.deepEqual(sent, [{ to: 'x@y.org', subject: 'Subject', text: 'hi', from: 'Hui <a@b.org>', replyTo: 'director@b.org' }]);
  assert.equal(await route({ MAILER: {} }, { email: 'x@y.org', send_email: 1 }), null, 'off until a from address is set');

  // Chosen in Settings: Off wins over a bound mailer, and Cloudflare needs the mailer to be ready.
  const off = { DB: fakeDB([{ key: 'email_provider', value: 'off' }]), MAILER: {}, EMAIL_FROM: 'a@b.org' };
  assert.equal(await route(off, { email: 'x@y.org', send_email: 1 }), null);
  const noMailer = { DB: fakeDB([{ key: 'email_provider', value: 'cloudflare' }, { key: 'email_from', value: 'a@b.org' }]) };
  assert.equal(await route(noMailer, { email: 'x@y.org', send_email: 1 }), null, 'Cloudflare picked but the mailer Worker is not bound');
});

test('a pasted Anthropic key is sealed at rest and only opens with the same server secret', async () => {
  const { sealKey, openKey, anthropicKey } = await import('../functions/lib/ai.js');
  const env = { SESSION_SECRET: 'server-secret' };
  const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
  const sealed = await sealKey(env, key);
  assert.ok(!sealed.includes('sk-ant') && !sealed.includes('0123456789'), 'nothing readable is stored');
  assert.notEqual(sealed, await sealKey(env, key), 'a fresh nonce every time');
  assert.equal(await openKey(env, sealed), key);
  assert.equal(await openKey({ SESSION_SECRET: 'rotated' }, sealed), '', 'a changed secret means paste it again');
  const DB = { prepare: () => ({ first: async () => ({ value: sealed }) }) };
  assert.equal(await anthropicKey({ ...env, DB }), key);
  assert.equal(await anthropicKey({ ...env, DB, ANTHROPIC_API_KEY: 'sk-ant-from-secret' }), 'sk-ant-from-secret', 'a Cloudflare secret wins');
});

test('a dead or empty Anthropic key gets plain words, not an error code', async () => {
  const { keyTrouble } = await import('../functions/lib/ai.js');
  assert.match(keyTrouble({ status: 401 }), /stopped working.*expired.*Settings, AI/);
  assert.match(keyTrouble({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' }), /out of credit/);
  assert.equal(keyTrouble({ status: 529, message: 'Overloaded' }), '', 'anything else gets the generic try again');
});

test('a From address on a domain the email service does not know gets plain words', async () => {
  const { fromTrouble } = await import('../functions/lib/notify.js');
  assert.match(fromTrouble('E_SENDER_DOMAIN_NOT_AVAILABLE: domain not onboarded', 'Hui <a@gmail.com>'), /not on a domain set up.*Settings, Automated Emails/);
  assert.match(fromTrouble('{"statusCode":403,"message":"The gmail.com domain is not verified."}', 'a@gmail.com'), /a@gmail\.com/);
  assert.equal(fromTrouble('E_RATE_LIMIT_EXCEEDED', 'a@b.org'), '');
});

test('reading Claude\'s progress comment on an app request', async () => {
  const { readTracking } = await import('../functions/lib/changes.js');
  assert.deepEqual(readTracking('Claude Code is working… <img src="spinner.gif">'), { error: false, done: false, summary: null, branch: null });
  const done = readTracking(`**Claude finished @olagon's task in 6m 12s** | [View job](https://github.com/o/r/actions/runs/1) • [\`claude/issue-12-20261013-1830\`](https://github.com/o/r/tree/claude/issue-12-20261013-1830)

---
Moved Pahuhopu above Letters on My page.

For the director: On everyone's page, Pahuhopu now comes before Letters, so goals are the first thing people see.
 · [Branch](https://github.com/o/r/tree/claude/issue-12-20261013-1830)

[Create PR ➔](https://github.com/o/r/compare/main...claude/issue-12-20261013-1830)`);
  assert.equal(done.done, true);
  assert.equal(done.branch, 'claude/issue-12-20261013-1830');
  assert.equal(done.summary, "On everyone's page, Pahuhopu now comes before Letters, so goals are the first thing people see.");
  assert.equal(readTracking('Claude encountered an error after 2m').error, true);
});
