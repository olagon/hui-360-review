// Year round, for staff: goals, mahalo, feedback requests, and
// a lead's view of their team's letters. Plus the public pages: community voice,
// asking for a fresh link, and the morning reminder run.
import { HttpError, body, json, randomToken } from './http.js';
import { linkFor } from './auth.js';
import { channels, emailOf, route, send } from './notify.js';

const all = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results);
const one = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const text = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const nameOf = (s) => s.preferred_name || s.name;
const settings = async (env) => Object.fromEntries((await all(env, 'SELECT key, value FROM settings')).map((r) => [r.key, r.value]));

// ---------- people ----------

export async function people({ env, staff }) {
  return json({ people: await all(env, 'SELECT id, name, preferred_name, team FROM staff WHERE active = 1 AND id != ? ORDER BY name', staff.id) });
}

// ---------- goals (my huli) ----------

export async function goals({ env, staff }) {
  return json({
    goals: await all(
      env,
      'SELECT g.id, g.body, g.status, g.cycle_id, c.name AS cycle FROM goals g LEFT JOIN cycles c ON c.id = g.cycle_id WHERE g.staff_id = ? ORDER BY g.id DESC',
      staff.id,
    ),
  });
}

export async function addGoal({ env, staff, request }) {
  const b = await body(request);
  if (!text(b.body)) throw new HttpError(400, 'Write the goal first');
  const latest = await one(env, "SELECT id FROM cycles WHERE status != 'draft' AND name != 'Sample review (example)' ORDER BY id DESC LIMIT 1");
  const r = await env.DB.prepare('INSERT INTO goals (staff_id, cycle_id, body) VALUES (?, ?, ?)').bind(staff.id, latest?.id ?? null, text(b.body, 1000)).run();
  return json({ id: r.meta.last_row_id });
}

export async function updateGoal({ env, staff, request, params }) {
  const b = await body(request);
  const g = await one(env, 'SELECT * FROM goals WHERE id = ? AND staff_id = ?', Number(params.id), staff.id);
  if (!g) throw new HttpError(404, 'Not found');
  const status = ['open', 'met', 'carried', 'dropped'].includes(b.status) ? b.status : g.status;
  await env.DB.prepare('UPDATE goals SET body = ?, status = ? WHERE id = ?').bind(b.body !== undefined ? text(b.body, 1000) : g.body, status, g.id).run();
  return json({ ok: true });
}

export async function deleteGoal({ env, staff, params }) {
  await env.DB.prepare('DELETE FROM goals WHERE id = ? AND staff_id = ?').bind(Number(params.id), staff.id).run();
  return json({ ok: true });
}

// ---------- mahalo ----------

const MAHALO_SQL = `SELECT m.id, m.body, m.public, m.created_at, m.to_id, m.from_id,
  t.name AS to_name, t.preferred_name AS to_preferred, f.name AS from_name, f.preferred_name AS from_preferred
  FROM mahalo m JOIN staff t ON t.id = m.to_id LEFT JOIN staff f ON f.id = m.from_id`;
const shape = (m) => ({
  id: m.id,
  body: m.body,
  public: !!m.public,
  created_at: m.created_at,
  to: m.to_preferred || m.to_name,
  from: m.from_id ? m.from_preferred || m.from_name : null,
});

export async function board({ env }) {
  return json({ mahalo: (await all(env, `${MAHALO_SQL} WHERE m.public = 1 ORDER BY m.id DESC LIMIT 200`)).map(shape) });
}

export async function myMahalo({ env, staff }) {
  const received = (await all(env, `${MAHALO_SQL} WHERE m.to_id = ? ORDER BY m.id DESC`, staff.id)).map(shape);
  const sent = (await all(env, `${MAHALO_SQL} WHERE m.from_id = ? ORDER BY m.id DESC`, staff.id)).map((m) => ({ ...shape(m), mine: true }));
  // Mahalo someone chose to sign in a review, once that review has closed.
  const signed = await all(
    env,
    `SELECT r.body, r.signed_name AS "from", c.name AS cycle FROM responses r JOIN cycles c ON c.id = r.cycle_id
     WHERE r.reviewee_id = ? AND r.signed_name IS NOT NULL AND c.status IN ('closed', 'published') ORDER BY r.cycle_id DESC`,
    staff.id,
  );
  return json({ received, sent, signed });
}

export async function sendMahalo({ env, staff, request }) {
  const b = await body(request);
  const to = await one(env, 'SELECT id FROM staff WHERE id = ? AND active = 1', Number(b.to_id));
  if (!to || to.id === staff.id) throw new HttpError(400, 'Pick a coworker');
  if (!text(b.body)) throw new HttpError(400, 'Write your mahalo first');
  await env.DB.prepare('INSERT INTO mahalo (from_id, to_id, body, public) VALUES (?, ?, ?, ?)')
    .bind(b.anonymous ? null : staff.id, to.id, text(b.body, 1000), b.public ? 1 : 0).run();
  return json({ ok: true });
}

export async function deleteMahalo({ env, staff, params }) {
  await env.DB.prepare('DELETE FROM mahalo WHERE id = ? AND from_id = ?').bind(Number(params.id), staff.id).run();
  return json({ ok: true });
}

// ---------- feedback requests ----------

export async function feedback({ env, staff }) {
  const asked = await all(
    env,
    `SELECT f.id, f.prompt, f.response, f.created_at, f.answered_at, s.name, s.preferred_name FROM feedback_requests f
     JOIN staff s ON s.id = f.to_id WHERE f.from_id = ? ORDER BY f.id DESC`,
    staff.id,
  );
  const forMe = await all(
    env,
    `SELECT f.id, f.prompt, f.response, f.created_at, f.answered_at, s.name, s.preferred_name FROM feedback_requests f
     JOIN staff s ON s.id = f.from_id WHERE f.to_id = ? ORDER BY f.response IS NOT NULL, f.id DESC`,
    staff.id,
  );
  const map = (f) => ({ id: f.id, prompt: f.prompt, response: f.response, created_at: f.created_at, answered_at: f.answered_at, person: nameOf(f) });
  return json({ asked: asked.map(map), forMe: forMe.map(map) });
}

export async function askFeedback({ env, staff, request, url }) {
  const b = await body(request);
  const to = await one(env, 'SELECT * FROM staff WHERE id = ? AND active = 1', Number(b.to_id));
  if (!to || to.id === staff.id) throw new HttpError(400, 'Pick a coworker');
  if (!text(b.prompt)) throw new HttpError(400, 'Write your question first');
  const today = await one(env, "SELECT COUNT(*) AS n FROM feedback_requests WHERE from_id = ? AND created_at > datetime('now', '-1 day')", staff.id);
  if (today.n >= 10) throw new HttpError(429, 'That is a lot of asks for one day. Try again tomorrow.');
  const prompt = text(b.prompt, 600);
  const r = await env.DB.prepare('INSERT INTO feedback_requests (from_id, to_id, prompt) VALUES (?, ?, ?)').bind(staff.id, to.id, prompt).run();
  // The coworker gets their own link by email when the app can send it. Otherwise the asker copies a message.
  const email = emailOf(env, to);
  let emailed = false;
  if (email) {
    const link = await linkFor(env, url.origin, to.id, 0);
    // The ask is saved either way, and their home page shows it, so a failed email only means the asker copies a message.
    emailed = await send(env, email, `Aloha ${nameOf(to)}, ${nameOf(staff)} asked for your feedback:\n\n"${prompt}"\n\nAnswer on your page, it takes a minute: ${link}\n\nMahalo!`, 'email', `${nameOf(staff)} asked for your feedback`)
      .then(() => true, () => false);
  }
  return json({ id: r.meta.last_row_id, emailed });
}

export async function answerFeedback({ env, staff, request, params }) {
  const f = await one(env, 'SELECT * FROM feedback_requests WHERE id = ? AND to_id = ?', Number(params.id), staff.id);
  if (!f) throw new HttpError(404, 'Not found');
  await env.DB.prepare("UPDATE feedback_requests SET response = ?, answered_at = datetime('now') WHERE id = ?").bind(text((await body(request)).response), f.id).run();
  return json({ ok: true });
}

// ---------- leads see their own team's shared letters ----------

export async function teamLetters({ env, staff }) {
  if (staff.role !== 'lead' || !staff.team) throw new HttpError(403, 'Only team leads see this');
  const rows = await all(
    env,
    `SELECT s.name, s.preferred_name, c.name AS cycle, m.shared_body, m.shared_at FROM summaries m
     JOIN staff s ON s.id = m.reviewee_id JOIN cycles c ON c.id = m.cycle_id
     WHERE m.status = 'shared' AND s.team = ? AND s.id != ? AND s.role = 'staff' AND s.active = 1 ORDER BY m.shared_at DESC`,
    staff.team,
    staff.id,
  );
  return json({ team: staff.team, letters: rows.map((r) => ({ person: nameOf(r), cycle: r.cycle, body: r.shared_body, shared_at: r.shared_at })) });
}

// ---------- community voice: one question, one answer, no account ----------

async function voiceFor(env, token) {
  const v = await one(
    env,
    `SELECT v.*, c.status, s.name, s.preferred_name FROM community_voices v JOIN cycles c ON c.id = v.cycle_id JOIN staff s ON s.id = v.reviewee_id WHERE v.token = ?`,
    String(token),
  );
  if (!v) throw new HttpError(404, 'This link is not valid');
  return v;
}

export async function voice({ env, params }) {
  const v = await voiceFor(env, params.token);
  const n = await settings(env);
  return json({ question: v.question, person: nameOf(v), hui: n.hui_name || 'the Hui', answered: !!v.response, open: ['draft', 'open'].includes(v.status) });
}

export async function answerVoice({ env, params, request }) {
  const v = await voiceFor(env, params.token);
  if (v.response) throw new HttpError(409, 'This link has already been used. Mahalo!');
  if (!['draft', 'open'].includes(v.status)) throw new HttpError(409, 'This review has closed. Mahalo for your time.');
  const b = await body(request);
  if (!text(b.response)) throw new HttpError(400, 'Write your answer first');
  await env.DB.prepare("UPDATE community_voices SET response = ?, who = ?, answered_at = datetime('now') WHERE id = ? AND response IS NULL")
    .bind(text(b.response, 6000), text(b.who, 200) || null, v.id).run();
  return json({ ok: true });
}

// ---------- asking for a fresh link from the landing page ----------

export async function requestLink({ env, request, url, waitUntil }) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = `rl:link:${ip}`;
  const count = Number((await env.KV.get(key)) || 0);
  if (count >= 5) throw new HttpError(429, 'Too many tries. Please ask your director for a link.');
  await env.KV.put(key, String(count + 1), { expirationTtl: 3600 });
  const n = await settings(env);
  // Lost links go out by email only. The phone number is just another way to find the person.
  if (!channels(env).email) return json({ manual: true });
  const contact = text((await body(request)).contact, 200).toLowerCase();
  const digits = contact.replace(/\D/g, '');
  const person = (await all(env, 'SELECT * FROM staff WHERE active = 1')).find(
    (s) => (s.email && s.email.toLowerCase() === contact) || (digits.length >= 7 && (s.phone || '').replace(/\D/g, '').endsWith(digits.slice(-10))),
  );
  const to = person && emailOf(env, person);
  // One email per person per 10 minutes, however many places ask for it.
  const cool = person && `rl:to:${person.id}`;
  if (to && !(await env.KV.get(cool))) {
    await env.KV.put(cool, '1', { expirationTtl: 600 });
    // In a review, the link opens their list. Between reviews it still opens their page: goals, mahalo, letters.
    const cycle = await one(env, "SELECT c.* FROM cycles c JOIN cycle_people p ON p.cycle_id = c.id WHERE c.status = 'open' AND p.staff_id = ?", person.id);
    const link = await linkFor(env, url.origin, person.id, cycle?.id ?? 0);
    const what = cycle ? `your link for ${cycle.name}` : 'your link to your page, with your goals, mahalo, and letters';
    // Sent after the reply, so the answer and its timing are the same whether or not anyone matched.
    waitUntil(send(env, to, `Aloha ${nameOf(person)}, here is ${what}: ${link}\n\nIt is yours alone, so please do not forward it. Mahalo!`, 'email', 'Your link').catch((e) => console.error('link not sent', e.message)));
  }
  // Same answer either way, so nobody can test who is on staff.
  return json({ sent: true });
}

// ---------- reminders, called Monday and Friday at 7am by the cron in workers/mailer ----------

export async function reminders({ env, request, url }) {
  if (!env.CRON_SECRET || request.headers.get('x-cron-secret') !== env.CRON_SECRET) throw new HttpError(401, 'Not allowed');
  const n = await settings(env);
  const cycle = await one(env, "SELECT * FROM cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  if (!cycle || n.auto_remind !== '1') return json({ sent: 0 });
  // No reminders after the close date, even if nobody has pressed Close yet. Dates are Hawaiʻi dates.
  const hawaiiToday = new Date(Date.now() - 10 * 3600000).toISOString().slice(0, 10);
  if (cycle.closes_at && cycle.closes_at < hawaiiToday) return json({ sent: 0, closed: true });
  const behind = await all(
    env,
    `SELECT DISTINCT s.* FROM assignments a JOIN staff s ON s.id = a.reviewer_id WHERE a.cycle_id = ? AND a.status != 'done' AND s.active = 1`,
    cycle.id,
  );
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const p of behind) {
    const key = `nudge:${cycle.id}:${p.id}:${today}`;
    const via = route(env, p);
    if (!via || (await env.KV.get(key))) continue;
    const link = await linkFor(env, url.origin, p.id, cycle.id);
    const until = cycle.closes_at ? ` until ${cycle.closes_at}` : '';
    try {
      await send(env, via.to, `Aloha ${nameOf(p)}, a gentle reminder that ${cycle.name} is open${until}. Even 5 minutes helps: ${link}`, via.channel, 'A gentle reminder');
    } catch (e) {
      console.error('reminder not sent', p.id, e.message); // one bad address never stops the rest
      continue;
    }
    await env.KV.put(key, '1', { expirationTtl: 172800 });
    sent++;
  }
  return json({ sent });
}

// Admin creates community voice links. Single use, and they stop working when the review closes.
export async function createVoice({ env, request, params, url }) {
  const cycleId = Number(params.id);
  const b = await body(request);
  const person = await one(env, 'SELECT * FROM staff WHERE id = ?', Number(b.reviewee_id));
  if (!person) throw new HttpError(400, 'Pick a person');
  const question = text(b.question, 600) || `You worked with ${nameOf(person)} recently. What stood out to you about them?`;
  const token = randomToken(18);
  await env.DB.prepare('INSERT INTO community_voices (cycle_id, reviewee_id, token, question) VALUES (?, ?, ?, ?)').bind(cycleId, person.id, token, question).run();
  return json({ link: `${url.origin}/voice/?t=${token}` });
}

export async function listVoices({ env, params, url }) {
  const rows = await all(
    env,
    `SELECT v.id, v.token, v.question, v.response IS NOT NULL AS answered, v.created_at, s.name, s.preferred_name
     FROM community_voices v JOIN staff s ON s.id = v.reviewee_id WHERE v.cycle_id = ? ORDER BY v.id DESC`,
    Number(params.id),
  );
  return json({ voices: rows.map((v) => ({ id: v.id, question: v.question, answered: !!v.answered, person: nameOf(v), link: `${url.origin}/voice/?t=${v.token}` })) });
}

export async function deleteVoice({ env, params }) {
  await env.DB.prepare('DELETE FROM community_voices WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}
