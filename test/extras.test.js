import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moonFor, MOONS } from '../public/assets/moon.js';
import { layoutMeetings, buildICS } from '../public/assets/ics.js';
import { parseSignals, calibrate, signalsPrompt } from '../functions/lib/signals.js';
import { route, send } from '../functions/lib/notify.js';

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

test('sending routes by preference and builds the right requests', async () => {
  const env = { TWILIO_SID: 'AC1', TWILIO_TOKEN: 't', TWILIO_FROM: '+18085550000', RESEND_API_KEY: 'k', RESEND_FROM: 'Hui <a@b.org>' };
  assert.deepEqual(route(env, { phone: '+1808', email: 'x@y.org' }, 'email'), { channel: 'email', to: 'x@y.org' });
  assert.deepEqual(route(env, { email: 'x@y.org' }, 'sms'), { channel: 'email', to: 'x@y.org' });
  assert.equal(route({}, { phone: '1' }, 'sms'), null);
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (calls.push([url, init]), new Response('{}'));
  await send(env, '+18085551234', 'hi', 'sms');
  await send(env, 'x@y.org', 'hi', 'email');
  globalThis.fetch = real;
  assert.match(calls[0][0], /Accounts\/AC1\/Messages\.json$/);
  assert.equal(new URLSearchParams(calls[0][1].body).get('To'), '+18085551234');
  assert.equal(JSON.parse(calls[1][1].body).to[0], 'x@y.org');
});
