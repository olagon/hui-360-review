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
});

test('signals parsing is forgiving and calibration needs two reviews', () => {
  assert.match(signalsPrompt(['a', 'b']).user, /^1\. a\n2\. b$/);
  assert.deepEqual(parseSignals('Sure: [{"label":"burnout","tone":-3},{"label":"weird"}]', 3), [
    { label: 'burnout', tone: -2 },
    { label: 'none', tone: 0 },
    { label: 'none', tone: 0 },
  ]);
  const rows = [
    { reviewer: 'kind', review: 1, tone: 2 }, { reviewer: 'kind', review: 2, tone: 2 },
    { reviewer: 'tough', review: 3, tone: -1 }, { reviewer: 'tough', review: 4, tone: -1 },
    { reviewer: 'mid', review: 5, tone: 1 }, { reviewer: 'mid', review: 6, tone: 0 },
    { reviewer: 'once', review: 7, tone: 2 },
  ];
  assert.deepEqual(calibrate(rows), { kind: 'generous', tough: 'critical' });
});

test('email goes only to people with Send email checked, in batches of 100', async () => {
  const env = { TWILIO_SID: 'AC1', TWILIO_TOKEN: 't', TWILIO_FROM: '+18085550000', RESEND_API_KEY: 'k', EMAIL_FROM: 'Hui <a@b.org>' };
  assert.deepEqual(route(env, { phone: '+1808', email: 'x@y.org', send_email: 1 }), { channel: 'email', to: 'x@y.org' });
  assert.deepEqual(route(env, { phone: '+1808', email: 'x@y.org', send_email: 0 }), { channel: 'sms', to: '+1808' });
  assert.equal(route({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.org' }, { email: 'x@y.org', send_email: 0 }), null);
  assert.equal(route({}, { phone: '1', email: 'x@y.org', send_email: 1 }), null);
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (calls.push([url, init]), new Response('{}'));
  await send(env, '+18085551234', 'hi', 'sms');
  await send(env, 'x@y.org', 'hi', 'email', 'Subject', 'director@b.org');
  await sendEmails(env, Array.from({ length: 150 }, (_, i) => ({ to: `p${i}@y.org`, subject: 's', text: 't' })), 'director@b.org');
  globalThis.fetch = real;
  assert.match(calls[0][0], /Accounts\/AC1\/Messages\.json$/);
  assert.equal(new URLSearchParams(calls[0][1].body).get('To'), '+18085551234');
  assert.deepEqual(JSON.parse(calls[1][1].body), [{ from: 'Hui <a@b.org>', to: ['x@y.org'], subject: 'Subject', text: 'hi', reply_to: 'director@b.org' }]);
  assert.deepEqual(calls.slice(2).map(([url, init]) => [url.split('.com')[1], JSON.parse(init.body).length]), [['/emails/batch', 100], ['/emails/batch', 50]]);

  // With the Cloudflare mailer bound, email goes through it instead of Resend.
  const sent = [];
  const cf = { EMAIL_FROM: 'Hui <a@b.org>', MAILER: { send: async (list) => sent.push(...list) } };
  assert.deepEqual(route(cf, { email: 'x@y.org', send_email: 1 }), { channel: 'email', to: 'x@y.org' });
  await send(cf, 'x@y.org', 'hi', 'email', 'Subject', 'director@b.org');
  assert.deepEqual(sent, [{ to: 'x@y.org', subject: 'Subject', text: 'hi', from: 'Hui <a@b.org>', replyTo: 'director@b.org' }]);
  assert.equal(route({ MAILER: {} }, { email: 'x@y.org', send_email: 1 }), null, 'off until EMAIL_FROM is set');
});
