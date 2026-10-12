import { HttpError, json, body, audit } from './http.js';
import { autoFill, assignmentHash } from './assign.js';
import { linkFor, createLink } from './auth.js';
import { completer, aiOn } from './ai.js';
import { CLAUDE_MODEL } from './config.js';
import { draftSummary, stripIdentity, section, answersDraft } from './summarize.js';
import systemPrompt from './prompts/summary-system.txt';
import userPrompt from './prompts/summary-user.txt';
import fixPrompt from './prompts/summary-fix.txt';
import teamSystem from './prompts/team-system.txt';
import teamUser from './prompts/team-user.txt';
import prepSystem from './prompts/prep-system.txt';
import prepUser from './prompts/prep-user.txt';
import prepFix from './prompts/prep-fix.txt';
import boardSystem from './prompts/board-system.txt';
import { signalsPrompt, parseSignals, calibrate } from './signals.js';
import { channels, directorEmail, route as via, send, sendEmails } from './notify.js';

// Seed questions, used when a cycle has no earlier cycle to copy from.
// prompt_haw is left empty on purpose: a fluent speaker should write those.
const DEFAULT_QUESTIONS = [
  // [audience, kind, required, five minute, prompt, linked value name]
  ['self', 'story', 1, 1, 'What are you most proud of from this year?'],
  ['self', 'story', 0, 0, "Tell me about a time this year you felt most connected to the ʻāina or to {hui}'s purpose."],
  ['self', 'story', 0, 0, 'What gifts did you bring this year, and how did they show in your work with {hui} and our community?', 'Gifts'],
  ['self', 'story', 0, 0, 'What was hardest this year, and what did you learn from it?'],
  ['self', 'story', 1, 1, 'Where do you want to grow next year?'],
  ['self', 'short', 0, 0, 'What does {hui} need to do better to support you?'],
  ['peer', 'mahalo', 1, 1, 'What are you grateful for about this person this year?'],
  ['peer', 'story', 1, 1, 'Tell me about a time this person showed up for the team or the ʻāina in a way that stuck with you.'],
  ['peer', 'story', 0, 0, 'Describe the gift(s) you appreciate in this person and how they show in their work with {hui} and our community.', 'Gifts'],
  ['peer', 'story', 0, 0, 'What is something this person does that you wish more of us did?'],
  ['peer', 'story', 0, 0, 'Where do you think this person could grow, and how could {hui} help?'],
  ['peer', 'short', 0, 0, 'Is there anything else {director} should know?'],
  ['upward', 'story', 0, 0, 'What does this leader do that helps you do your best work?'],
  ['upward', 'story', 0, 0, 'What is one thing you wish they did differently?'],
  ['upward', 'short', 0, 0, 'Is there something you need from leadership that you are not getting?'],
];

const STAFF_FIELDS = ['name', 'preferred_name', 'email', 'phone', 'role', 'team', 'start_date', 'active', 'lang', 'send_email'];
const VALUE_FIELDS = ['name_haw', 'name_en', 'olelo_noeau', 'olelo_noeau_meaning', 'description', 'ord'];
const QUESTION_FIELDS = ['prompt_en', 'prompt_haw', 'kind', 'required', 'five_min', 'value_id', 'audience'];
const CYCLE_FIELDS = ['name', 'opens_at', 'closes_at', 'values_set_id', 'upward'];

const all = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results);
const one = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();

function pick(src, fields) {
  const out = {};
  for (const f of fields) if (src[f] !== undefined) out[f] = src[f] === '' ? null : typeof src[f] === 'boolean' ? Number(src[f]) : src[f];
  return out;
}

async function update(env, table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE "${table}" SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(data), Number(id)).run();
}

async function insert(env, table, data) {
  const keys = Object.keys(data);
  const r = await env.DB.prepare(`INSERT INTO "${table}" (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...Object.values(data)).run();
  return r.meta.last_row_id;
}

async function getCycle(env, id) {
  const c = await one(env, 'SELECT * FROM cycles WHERE id = ?', Number(id));
  if (!c) throw new HttpError(404, 'Cycle not found');
  return c;
}

const settings = async (env) => Object.fromEntries((await all(env, 'SELECT key, value FROM settings')).map((r) => [r.key, r.value]));

const shuffle = (xs) => xs.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

// ---------- who ----------

export const whoami = ({ admin }) => json({ email: admin });

// ---------- staff ----------

export const listStaff = async ({ env }) => json({ staff: await all(env, 'SELECT * FROM staff ORDER BY active DESC, name') });

export async function createStaff({ env, request }) {
  const data = pick(await body(request), STAFF_FIELDS);
  if (!data.name) throw new HttpError(400, 'Name is required');
  return json({ id: await insert(env, 'staff', data) });
}

export async function updateStaff({ env, request, params }) {
  await update(env, 'staff', params.id, pick(await body(request), STAFF_FIELDS));
  return json({ ok: true });
}

// ---------- settings ----------

export const getSettings = async ({ env }) => json({ ...(await settings(env)), engine: env.ANTHROPIC_API_KEY ? CLAUDE_MODEL : 'llama' });

export async function putSettings({ env, request, admin }) {
  const data = await body(request);
  if ('ai' in data) await audit(env, admin, data.ai === 'off' ? 'ai_off' : 'ai_on', 'settings');
  await env.DB.batch(
    Object.entries(data).map(([k, v]) =>
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(k, String(v)),
    ),
  );
  return json({ ok: true });
}

// ---------- values ----------

export async function listValues({ env }) {
  const sets = await all(env, 'SELECT * FROM value_sets ORDER BY id');
  const values = await all(env, 'SELECT * FROM "values" ORDER BY ord, id');
  return json({ sets: sets.map((s) => ({ ...s, values: values.filter((v) => v.values_set_id === s.id) })) });
}

export async function createValueSet({ env, request }) {
  const { name, copy_from } = await body(request);
  const id = await insert(env, 'value_sets', { name: name || 'New values' });
  if (copy_from) {
    await env.DB.prepare(
      `INSERT INTO "values" (values_set_id, name_haw, name_en, olelo_noeau, olelo_noeau_meaning, description, ord)
       SELECT ?, name_haw, name_en, olelo_noeau, olelo_noeau_meaning, description, ord FROM "values" WHERE values_set_id = ?`,
    ).bind(id, Number(copy_from)).run();
  }
  return json({ id });
}

export async function updateValueSet({ env, request, params }) {
  await update(env, 'value_sets', params.id, pick(await body(request), ['name']));
  return json({ ok: true });
}

export async function createValue({ env, request }) {
  const b = await body(request);
  return json({ id: await insert(env, 'values', { values_set_id: Number(b.values_set_id), name_haw: b.name_haw || 'New value', ...pick(b, VALUE_FIELDS) }) });
}

export async function updateValue({ env, request, params }) {
  await update(env, 'values', params.id, pick(await body(request), VALUE_FIELDS));
  return json({ ok: true });
}

export async function deleteValue({ env, params }) {
  await env.DB.prepare('DELETE FROM "values" WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}

// ---------- cycles ----------

export async function listCycles({ env }) {
  return json({
    cycles: await all(
      env,
      `SELECT c.*, (SELECT COUNT(*) FROM assignments a WHERE a.cycle_id = c.id) AS assignments,
              (SELECT COUNT(*) FROM assignments a WHERE a.cycle_id = c.id AND a.status = 'done') AS done
       FROM cycles c ORDER BY c.id DESC`,
    ),
  });
}

async function copyQuestions(env, cycleId) {
  const prev = await one(
    env,
    'SELECT id FROM cycles WHERE id < ? AND name != ? AND EXISTS (SELECT 1 FROM questions WHERE cycle_id = cycles.id) ORDER BY id DESC LIMIT 1',
    cycleId,
    SAMPLE_NAME,
  );
  if (prev) {
    await env.DB.prepare(
      `INSERT INTO questions (cycle_id, audience, ord, prompt_en, prompt_haw, kind, required, five_min, value_id)
       SELECT ?, audience, ord, prompt_en, prompt_haw, kind, required, five_min, value_id FROM questions WHERE cycle_id = ?`,
    ).bind(cycleId, prev.id).run();
    await relinkValues(env, cycleId);
  } else {
    await insertDefaultQuestions(env, cycleId);
  }
  return prev?.id ?? null;
}

async function insertDefaultQuestions(env, cycleId) {
  const set = await one(env, 'SELECT values_set_id FROM cycles WHERE id = ?', cycleId);
  const names = await settings(env);
  const fill = (q) => q.replaceAll('{hui}', names.hui_name || 'the Hui').replaceAll('{director}', names.director_name || 'your director');
  const values = await all(env, 'SELECT id, name_haw FROM "values" WHERE values_set_id = ?', set?.values_set_id ?? 0);
  await env.DB.batch(
    DEFAULT_QUESTIONS.map(([audience, kind, required, five, prompt, value], i) =>
      env.DB.prepare('INSERT INTO questions (cycle_id, audience, ord, prompt_en, kind, required, five_min, value_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(cycleId, audience, i, fill(prompt), kind, required, five, values.find((v) => v.name_haw === value)?.id ?? null),
    ),
  );
}

// Point each question's value at the value with the same name in the cycle's current set.
const relinkValues = (env, cycleId) =>
  env.DB.prepare(
    `UPDATE questions SET value_id = (
       SELECT nv.id FROM "values" ov JOIN "values" nv ON nv.name_haw = ov.name_haw
       WHERE ov.id = questions.value_id AND nv.values_set_id = (SELECT values_set_id FROM cycles WHERE id = ?))
     WHERE cycle_id = ? AND value_id IS NOT NULL`,
  ).bind(cycleId, cycleId).run();

export async function createCycle({ env, request }) {
  const data = pick(await body(request), CYCLE_FIELDS);
  if (!data.name) throw new HttpError(400, 'Name is required');
  data.values_set_id ??= (await one(env, 'SELECT id FROM value_sets ORDER BY id DESC LIMIT 1'))?.id ?? null;
  const id = await insert(env, 'cycles', data);
  await copyQuestions(env, id);
  // Everyone active starts in the review. Admin unchecks anyone who sits this one out.
  await env.DB.prepare('INSERT INTO cycle_people (cycle_id, staff_id) SELECT ?, id FROM staff WHERE active = 1').bind(id).run();
  return json({ id });
}

export async function getCycle_({ env, params }) {
  const cycle = await getCycle(env, params.id);
  const [questions, staff, assignments, summaries, counts, people] = await Promise.all([
    all(env, 'SELECT * FROM questions WHERE cycle_id = ? ORDER BY audience, ord, id', cycle.id),
    all(
      env,
      'SELECT id, name, preferred_name, email, phone, role, team, active, send_email FROM staff WHERE active = 1 OR id IN (SELECT staff_id FROM cycle_people WHERE cycle_id = ?) ORDER BY name',
      cycle.id,
    ),
    all(env, 'SELECT id, reviewer_id, reviewee_id, kind, status FROM assignments WHERE cycle_id = ?', cycle.id),
    all(env, 'SELECT id, reviewee_id, status, shared_at FROM summaries WHERE cycle_id = ?', cycle.id),
    all(env, 'SELECT reviewee_id, COUNT(*) AS n FROM responses WHERE cycle_id = ? GROUP BY reviewee_id', cycle.id),
    all(env, 'SELECT staff_id FROM cycle_people WHERE cycle_id = ?', cycle.id),
  ]);
  return json({
    cycle,
    questions,
    staff,
    people: people.map((p) => p.staff_id),
    assignments,
    summaries,
    responses: Object.fromEntries(counts.map((c) => [c.reviewee_id, c.n])),
  });
}

export async function updateCycle({ env, request, params }) {
  const data = pick(await body(request), CYCLE_FIELDS);
  await update(env, 'cycles', params.id, data);
  if (data.values_set_id !== undefined) await relinkValues(env, Number(params.id));
  if (data.upward !== undefined) await syncUpward(env, Number(params.id));
  return json({ ok: true });
}

export async function setStatus({ env, request, params, admin, waitUntil }) {
  const cycle = await getCycle(env, params.id);
  const { status } = await body(request);
  if (!['draft', 'open', 'closed', 'published'].includes(status)) throw new HttpError(400, 'Unknown status');
  if (status === 'open') {
    const other = await one(env, "SELECT name FROM cycles WHERE status = 'open' AND id != ?", cycle.id);
    if (other) throw new HttpError(409, `Close "${other.name}" first. Only one cycle can be open at a time.`);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO assignments (cycle_id, reviewer_id, reviewee_id, kind) SELECT cycle_id, staff_id, staff_id, 'self' FROM cycle_people WHERE cycle_id = ?",
    ).bind(cycle.id).run();
    await syncUpward(env, cycle.id);
  }
  // Classify answers in the background once a review closes, for early signals and reviewer tone.
  if (status === 'closed' && (await aiOn(env))) waitUntil?.(analyze(env, cycle.id).catch((e) => console.error('analyze', e)));
  await env.DB.prepare(`UPDATE cycles SET status = ?${status === 'published' ? ", published_at = datetime('now')" : ''} WHERE id = ?`).bind(status, cycle.id).run();
  await audit(env, admin, `cycle_${status}`, `cycle:${cycle.id}`);
  return json({ ok: true });
}

export async function deleteCycle({ env, request, params, admin }) {
  const cycle = await getCycle(env, params.id);
  const { confirm } = await body(request);
  if ((confirm || '').trim() !== cycle.name.trim()) throw new HttpError(400, 'Type the cycle name exactly to confirm');
  await purgeCycle(env, cycle.id);
  await audit(env, admin, 'delete_cycle', `cycle:${cycle.id} ${cycle.name}`);
  return json({ ok: true });
}

async function purgeCycle(env, id) {
  await env.DB.batch(
    [
      'DELETE FROM response_link WHERE response_id IN (SELECT id FROM responses WHERE cycle_id = ?)',
      'DELETE FROM response_signals WHERE response_id IN (SELECT id FROM responses WHERE cycle_id = ?)',
      'DELETE FROM responses WHERE cycle_id = ?',
      'DELETE FROM employee_reflection WHERE summary_id IN (SELECT id FROM summaries WHERE cycle_id = ?)',
      'DELETE FROM summaries WHERE cycle_id = ?',
      'DELETE FROM assignments WHERE cycle_id = ?',
      'DELETE FROM community_voices WHERE cycle_id = ?',
      'UPDATE goals SET cycle_id = NULL WHERE cycle_id = ?',
      'DELETE FROM questions WHERE cycle_id = ?',
      'DELETE FROM cycle_people WHERE cycle_id = ?',
      'DELETE FROM team_reports WHERE cycle_id = ?',
      'DELETE FROM cycles WHERE id = ?',
    ].map((sql) => env.DB.prepare(sql).bind(id)),
  );
  await deletePrefix(env, `audio/${id}/`);
  let cursor;
  do {
    const page = await env.KV.list({ prefix: `mlx:${id}:`, cursor });
    for (const k of page.keys) {
      const token = await env.KV.get(k.name);
      if (token) await env.KV.delete(`ml:${token}`);
      await env.KV.delete(k.name);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

async function deletePrefix(env, prefix) {
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix, cursor });
    if (page.objects.length) await env.MEDIA.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
}

// ---------- questions ----------

// Closed and published reviews are a record. Reopen in Setup to change them.
async function editable(env, cycleId) {
  const c = await getCycle(env, cycleId);
  if (c.status === 'closed' || c.status === 'published') throw new HttpError(409, 'This review is closed, so it is locked. Reopen it in Setup to make changes.');
  return c;
}
const questionCycle = async (env, qid) => (await one(env, 'SELECT cycle_id FROM questions WHERE id = ?', Number(qid)))?.cycle_id;

export async function createQuestion({ env, request, params }) {
  await editable(env, params.id);
  const b = pick(await body(request), QUESTION_FIELDS);
  const max = await one(env, 'SELECT COALESCE(MAX(ord), 0) AS m FROM questions WHERE cycle_id = ?', Number(params.id));
  const id = await insert(env, 'questions', { cycle_id: Number(params.id), ord: max.m + 1, audience: 'peer', prompt_en: 'New question', ...b });
  return json({ id });
}

export async function updateQuestion({ env, request, params }) {
  await editable(env, await questionCycle(env, params.id));
  await update(env, 'questions', params.id, pick(await body(request), QUESTION_FIELDS));
  return json({ ok: true });
}

export async function deleteQuestion({ env, params }) {
  await editable(env, await questionCycle(env, params.id));
  const used = await one(env, 'SELECT COUNT(*) AS n FROM responses WHERE question_id = ?', Number(params.id));
  if (used.n) throw new HttpError(409, 'People have already answered this question, so it cannot be deleted');
  await env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}

export async function orderQuestions({ env, request, params }) {
  await editable(env, params.id);
  const { ids } = await body(request);
  await env.DB.batch(ids.map((qid, i) => env.DB.prepare('UPDATE questions SET ord = ? WHERE id = ? AND cycle_id = ?').bind(i, Number(qid), Number(params.id))));
  return json({ ok: true });
}

export async function reuseQuestions({ env, params }) {
  const cycle = await editable(env, params.id);
  const used = await one(env, 'SELECT COUNT(*) AS n FROM responses WHERE cycle_id = ?', cycle.id);
  if (used.n) throw new HttpError(409, 'This cycle already has answers, so its questions cannot be replaced');
  await env.DB.prepare('DELETE FROM questions WHERE cycle_id = ?').bind(cycle.id).run();
  return json({ from: await copyQuestions(env, cycle.id) });
}

// ---------- upward reviews: everyone reviews the director, and their own team's lead ----------

async function syncUpward(env, cycleId) {
  const c = await getCycle(env, cycleId);
  if (!c.upward) {
    await env.DB.prepare("DELETE FROM assignments WHERE cycle_id = ? AND kind = 'upward' AND status = 'not_started'").bind(c.id).run();
    return;
  }
  if (c.status === 'draft' || c.status === 'open') {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO assignments (cycle_id, reviewer_id, reviewee_id, kind)
       SELECT ?, r.id, l.id, 'upward' FROM cycle_people pr JOIN staff r ON r.id = pr.staff_id
       JOIN cycle_people pl ON pl.cycle_id = pr.cycle_id JOIN staff l ON l.id = pl.staff_id
       WHERE pr.cycle_id = ? AND r.id != l.id AND (l.role = 'admin' OR (l.role = 'lead' AND l.team IS NOT NULL AND l.team = r.team))`,
    ).bind(c.id, c.id).run();
  }
}

// ---------- who is in a review ----------

export async function setParticipant({ env, request, params }) {
  const cycle = await editable(env, params.id);
  const { staff_id, on } = await body(request);
  const sid = Number(staff_id);
  if (on) {
    await env.DB.prepare('INSERT OR IGNORE INTO cycle_people (cycle_id, staff_id) VALUES (?, ?)').bind(cycle.id, sid).run();
    if (cycle.status === 'open') {
      await env.DB.prepare("INSERT OR IGNORE INTO assignments (cycle_id, reviewer_id, reviewee_id, kind) VALUES (?, ?, ?, 'self')").bind(cycle.id, sid, sid).run();
    }
  } else {
    const started = await one(
      env,
      "SELECT COUNT(*) AS n FROM assignments WHERE cycle_id = ? AND (reviewer_id = ? OR reviewee_id = ?) AND status != 'not_started'",
      cycle.id,
      sid,
      sid,
    );
    if (started.n) throw new HttpError(409, 'This person already has answers in this review, so they stay in it');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM assignments WHERE cycle_id = ? AND (reviewer_id = ? OR reviewee_id = ?)').bind(cycle.id, sid, sid),
      env.DB.prepare('DELETE FROM cycle_people WHERE cycle_id = ? AND staff_id = ?').bind(cycle.id, sid),
    ]);
  }
  await syncUpward(env, cycle.id);
  return json({ ok: true });
}

// ---------- assignments ----------

export async function toggleAssignment({ env, request, params }) {
  const cycleId = (await editable(env, params.id)).id;
  const { reviewer_id, reviewee_id, on, kind = 'peer' } = await body(request);
  if (reviewer_id === reviewee_id) throw new HttpError(400, 'Self reflections are added automatically');
  if (on) {
    await env.DB.prepare('INSERT OR IGNORE INTO assignments (cycle_id, reviewer_id, reviewee_id, kind) VALUES (?, ?, ?, ?)')
      .bind(cycleId, Number(reviewer_id), Number(reviewee_id), kind).run();
  } else {
    const a = await one(env, 'SELECT * FROM assignments WHERE cycle_id = ? AND reviewer_id = ? AND reviewee_id = ? AND kind = ?', cycleId, Number(reviewer_id), Number(reviewee_id), kind);
    if (a && a.status !== 'not_started') throw new HttpError(409, 'This reviewer has already started, so the assignment stays');
    if (a) await env.DB.prepare('DELETE FROM assignments WHERE id = ?').bind(a.id).run();
  }
  return json({ ok: true });
}

export async function autofill({ env, request, params }) {
  const cycleId = (await editable(env, params.id)).id;
  const { target = 2 } = await body(request);
  const staffIds = (await all(env, 'SELECT staff_id FROM cycle_people WHERE cycle_id = ?', cycleId)).map((s) => s.staff_id);
  const existing = (await all(env, "SELECT reviewer_id, reviewee_id FROM assignments WHERE cycle_id = ? AND kind = 'peer'", cycleId)).map((a) => ({
    reviewer: a.reviewer_id,
    reviewee: a.reviewee_id,
  }));
  const prev = await one(env, "SELECT id FROM cycles WHERE id < ? AND status != 'draft' ORDER BY id DESC LIMIT 1", cycleId);
  const lastPairs = new Set(
    prev ? (await all(env, "SELECT reviewer_id, reviewee_id FROM assignments WHERE cycle_id = ? AND kind = 'peer'", prev.id)).map((a) => `${a.reviewer_id}:${a.reviewee_id}`) : [],
  );
  const added = autoFill({ staffIds, existing, lastPairs, target: Math.min(3, Math.max(1, Number(target))) });
  if (added.length) {
    await env.DB.batch(
      added.map((p) => env.DB.prepare("INSERT OR IGNORE INTO assignments (cycle_id, reviewer_id, reviewee_id, kind) VALUES (?, ?, ?, 'peer')").bind(cycleId, p.reviewer, p.reviewee)),
    );
  }
  return json({ added: added.length });
}

// ---------- links ----------

export async function links({ env, params, url }) {
  const cycle = await getCycle(env, params.id);
  const people = await all(
    env,
    'SELECT DISTINCT s.id, s.name, s.preferred_name, s.phone, s.email, s.send_email FROM staff s JOIN assignments a ON a.reviewer_id = s.id WHERE a.cycle_id = ? ORDER BY s.name',
    cycle.id,
  );
  for (const p of people) p.link = await linkFor(env, url.origin, p.id, cycle.id);
  return json({ people });
}

// A sign in link for one person any time of year. In an open review it opens their list, otherwise their page.
export async function staffLink({ env, params, url, admin }) {
  const id = Number(params.id);
  const cycle = await one(env, "SELECT c.id FROM cycles c JOIN cycle_people p ON p.cycle_id = c.id WHERE c.status = 'open' AND p.staff_id = ?", id);
  const link = await linkFor(env, url.origin, id, cycle?.id ?? 0);
  await audit(env, admin, 'link', `staff:${id}`);
  return json({ link });
}

export async function newLink({ env, params, url, admin }) {
  const link = await createLink(env, url.origin, Number(params.staff), Number(params.id));
  await audit(env, admin, 'new_link', `cycle:${params.id} staff:${params.staff}`);
  return json({ link });
}

// ---------- after close: raw, draft, share ----------

export async function raw({ env, params, admin }) {
  const cycle = await getCycle(env, params.id);
  if (!['closed', 'published'].includes(cycle.status)) throw new HttpError(409, 'Raw responses open after the cycle closes');
  await audit(env, admin, 'read_raw', `cycle:${cycle.id} staff:${params.staff}`);
  const { groups, linkOf } = await rawGroups(env, cycle, Number(params.staff));
  // Reviewer tone, as a count for this person only. A tag on each answer would let the admin
  // line up one reviewer's answers across questions and people, which undoes the shuffle.
  const tags = await toneTags(env, cycle.id);
  const tones = { generous: 0, critical: 0 };
  for (const hash of new Set(Object.values(linkOf))) if (tags[hash]) tones[tags[hash]]++;
  return json({ groups, tones });
}

// Every answer about one person, grouped by question and shuffled within each, plus outside voices,
// the year's mahalo, and the feedback they asked for.
async function rawGroups(env, cycle, staffId) {
  const rows = await all(
    env,
    `SELECT r.id, r.question_id, q.prompt_en, q.audience, q.ord, q.kind AS question_kind, r.body, r.audio_key, r.transcript, r.language, r.signed_name
     FROM responses r JOIN questions q ON q.id = r.question_id
     WHERE r.cycle_id = ? AND r.reviewee_id = ? ORDER BY q.audience = 'self' DESC, q.audience, q.ord`,
    cycle.id,
    staffId,
  );
  const linkOf = Object.fromEntries((await all(env, 'SELECT l.response_id, l.assignment_hash FROM response_link l JOIN responses r ON r.id = l.response_id WHERE r.cycle_id = ? AND r.reviewee_id = ?', cycle.id, staffId)).map((l) => [l.response_id, l.assignment_hash]));
  const groups = [];
  for (const r of rows) {
    let g = groups.find((x) => x.question_id === r.question_id);
    if (!g) groups.push((g = { question_id: r.question_id, prompt: r.prompt_en, audience: r.audience, kind: r.question_kind, responses: [] }));
    g.responses.push({ id: r.id, body: r.body, audio_key: r.audio_key, transcript: r.transcript, language: r.language, signed_name: r.signed_name });
  }
  const voices = await all(env, 'SELECT question, response, who FROM community_voices WHERE cycle_id = ? AND reviewee_id = ? AND response IS NOT NULL', cycle.id, staffId);
  for (const v of voices) {
    let g = groups.find((x) => x.audience === 'community' && x.prompt === v.question);
    if (!g) groups.push((g = { question_id: `voice:${groups.length}`, prompt: v.question, audience: 'community', kind: 'story', responses: [] }));
    g.responses.push({ id: null, body: v.response, who: v.who });
  }
  // The year's mahalo and the feedback they asked for. The letter can quote these, so the director sees them too.
  // Both carry names by design: a mahalo shows its sender unless sent without a name, and feedback is asked of a named coworker.
  const mahalo = await all(env, "SELECT m.body, f.name, f.preferred_name FROM mahalo m LEFT JOIN staff f ON f.id = m.from_id WHERE m.to_id = ? AND m.created_at > datetime('now', '-1 year') ORDER BY m.id", staffId);
  if (mahalo.length) groups.push({ question_id: 'mahalo', prompt: 'Mahalo sent during the year', audience: 'mahalo', kind: 'mahalo', responses: mahalo.map((m) => ({ id: null, body: m.body, signed_name: m.preferred_name || m.name || null })) });
  const asks = await all(env, "SELECT f.id, f.prompt, f.response, s.name, s.preferred_name FROM feedback_requests f JOIN staff s ON s.id = f.to_id WHERE f.from_id = ? AND f.response IS NOT NULL AND f.created_at > datetime('now', '-1 year') ORDER BY f.id", staffId);
  for (const f of asks) groups.push({ question_id: `ask:${f.id}`, prompt: `Feedback they asked for: ${f.prompt}`, audience: 'feedback', kind: 'story', responses: [{ id: null, body: f.response, who: f.preferred_name || f.name }] });
  // Shuffle within each question so position never lines up across questions.
  for (const g of groups) g.responses = shuffle(g.responses);
  return { groups, linkOf };
}

export async function getSummary({ env, params }) {
  const s = await one(
    env,
    `SELECT s.*, r.body AS reflection, r.created_at AS reflection_at FROM summaries s LEFT JOIN employee_reflection r ON r.summary_id = s.id
     WHERE s.cycle_id = ? AND s.reviewee_id = ?`,
    Number(params.id),
    Number(params.staff),
  );
  const person = await one(env, 'SELECT id, name, preferred_name, lang, email, send_email FROM staff WHERE id = ?', Number(params.staff));
  const cycle = await one(env, 'SELECT id, name, status FROM cycles WHERE id = ?', Number(params.id));
  return json({ summary: s, person, cycle });
}

export async function draft({ env, params, admin }) {
  const cycle = await getCycle(env, params.id);
  const person = await one(env, 'SELECT * FROM staff WHERE id = ?', Number(params.staff));
  if (!person) throw new HttpError(404, 'Not found');
  const rows = await all(
    env,
    `SELECT q.prompt_en AS prompt, r.kind AS audience, r.body, r.signed_name, l.assignment_hash AS reviewer_key
     FROM responses r JOIN questions q ON q.id = r.question_id LEFT JOIN response_link l ON l.response_id = r.id
     WHERE r.cycle_id = ? AND r.reviewee_id = ? ORDER BY q.audience, q.ord`,
    cycle.id,
    person.id,
  );
  const extra = await yearExtras(env, cycle.id, person.id);
  if (!rows.length && !extra.length) throw new HttpError(409, 'There are no answers about this person yet');
  const { responses, signers } = stripIdentity([...rows, ...extra]);
  const values = await all(env, 'SELECT * FROM "values" WHERE values_set_id = ? ORDER BY ord', cycle.values_set_id ?? 0);
  const last = await one(
    env,
    "SELECT cycle_id, shared_body FROM summaries WHERE reviewee_id = ? AND cycle_id != ? AND status = 'shared' ORDER BY shared_at DESC LIMIT 1",
    person.id,
    cycle.id,
  );
  const goals = last ? await all(env, 'SELECT body, status FROM goals WHERE staff_id = ? AND cycle_id = ?', person.id, last.cycle_id) : [];
  const lastYear = [
    last && section(last.shared_body, 'Themes') && `Themes:\n${section(last.shared_body, 'Themes')}`,
    goals.length && `Goals:\n${goals.map((g) => `- ${g.body} (${g.status})`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const names = await settings(env);

  const { markdown, notes } = await draftSummary({
    input: { name: person.preferred_name || person.name, cycle: cycle.name, lang: person.lang, huiName: names.hui_name, director: names.director_name, values, responses, signers, lastYear },
    templates: { system: systemPrompt, user: userPrompt, fix: fixPrompt },
    complete: completer(env),
  });
  await env.DB.prepare(
    `INSERT INTO summaries (cycle_id, reviewee_id, draft) VALUES (?, ?, ?)
     ON CONFLICT (cycle_id, reviewee_id) DO UPDATE SET draft = excluded.draft, edited = NULL`,
  ).bind(cycle.id, person.id, markdown).run();
  await audit(env, admin, 'draft_summary', `cycle:${cycle.id} staff:${person.id}`);
  return json({ draft: markdown, notes });
}

// A draft with no AI: every answer about the person, word for word, for the director to rewrite.
// With { empty: true } it starts blank instead (Add as quote uses that).
export async function blankSummary({ env, params, request, admin }) {
  const cycle = await getCycle(env, params.id);
  const person = await one(env, 'SELECT * FROM staff WHERE id = ?', Number(params.staff));
  if (!person) throw new HttpError(404, 'Not found');
  let text = '';
  if (!(await body(request)).empty && ['closed', 'published'].includes(cycle.status)) {
    const { groups } = await rawGroups(env, cycle, person.id);
    text = answersDraft(person.preferred_name || person.name, (await settings(env)).hui_name || 'the Hui', groups);
    await audit(env, admin, 'draft_from_answers', `cycle:${cycle.id} staff:${person.id}`);
  }
  // Fills an empty draft (prep may have made the row already), never one with words in it.
  await env.DB.prepare(
    `INSERT INTO summaries (cycle_id, reviewee_id, draft) VALUES (?, ?, ?)
     ON CONFLICT (cycle_id, reviewee_id) DO UPDATE SET draft = excluded.draft WHERE TRIM(COALESCE(summaries.edited, summaries.draft, '')) = ''`,
  ).bind(cycle.id, person.id, text).run();
  return json({ ok: true });
}


// Community voices for this review, plus mahalo and feedback answers from the past year.
async function yearExtras(env, cycleId, personId) {
  const voices = await all(env, 'SELECT id, question, response FROM community_voices WHERE cycle_id = ? AND reviewee_id = ? AND response IS NOT NULL', cycleId, personId);
  const mahalo = await all(env, "SELECT id, body FROM mahalo WHERE to_id = ? AND created_at > datetime('now', '-1 year')", personId);
  const asks = await all(env, "SELECT id, prompt, response FROM feedback_requests WHERE from_id = ? AND response IS NOT NULL AND created_at > datetime('now', '-1 year')", personId);
  return [
    ...voices.map((v) => ({ prompt: v.question, audience: 'community', body: v.response, signed_name: null, reviewer_key: `voice:${v.id}` })),
    ...mahalo.map((m) => ({ prompt: 'A mahalo sent during the year', audience: 'mahalo', body: m.body, signed_name: null, reviewer_key: `mahalo:${m.id}` })),
    ...asks.map((f) => ({ prompt: `Feedback they asked for: ${f.prompt}`, audience: 'feedback', body: f.response, signed_name: null, reviewer_key: `ask:${f.id}` })),
  ];
}

// Talk story prep: openers, something to celebrate, a tension, a question, last year's goals.
export async function draftPrep({ env, params, admin }) {
  const cycle = await getCycle(env, params.id);
  const person = await one(env, 'SELECT * FROM staff WHERE id = ?', Number(params.staff));
  if (!person) throw new HttpError(404, 'Not found');
  const rows = await all(
    env,
    `SELECT q.prompt_en AS prompt, r.kind AS audience, r.body, NULL AS signed_name, l.assignment_hash AS reviewer_key
     FROM responses r JOIN questions q ON q.id = r.question_id LEFT JOIN response_link l ON l.response_id = r.id
     WHERE r.cycle_id = ? AND r.reviewee_id = ? ORDER BY q.audience, q.ord`,
    cycle.id,
    person.id,
  );
  const { responses } = stripIdentity([...rows, ...(await yearExtras(env, cycle.id, person.id))]);
  if (!responses.length) throw new HttpError(409, 'There are no answers about this person yet');
  const goals = await all(env, 'SELECT body, status FROM goals WHERE staff_id = ? AND (cycle_id IS NULL OR cycle_id != ?)', person.id, cycle.id);
  const n = await settings(env);
  const { markdown } = await draftSummary({
    input: {
      name: person.preferred_name || person.name,
      cycle: cycle.name,
      lang: person.lang,
      huiName: n.hui_name,
      director: n.director_name,
      values: await all(env, 'SELECT * FROM "values" WHERE values_set_id = ? ORDER BY ord', cycle.values_set_id ?? 0),
      responses,
      signers: {},
      lastYear: goals.length ? `Goals:\n${goals.map((g) => `- ${g.body} (${g.status})`).join('\n')}` : '',
    },
    templates: { system: prepSystem, user: prepUser, fix: prepFix },
    complete: completer(env),
  });
  await env.DB.prepare(
    `INSERT INTO summaries (cycle_id, reviewee_id, talk_story_prep) VALUES (?, ?, ?)
     ON CONFLICT (cycle_id, reviewee_id) DO UPDATE SET talk_story_prep = excluded.talk_story_prep`,
  ).bind(cycle.id, person.id, markdown).run();
  await audit(env, admin, 'draft_prep', `cycle:${cycle.id} staff:${person.id}`);
  return json({ prep: markdown });
}

export async function saveSummary({ env, request, params }) {
  const b = pick(await body(request), ['edited', 'status']);
  if (b.status && !['draft', 'ready'].includes(b.status)) throw new HttpError(400, 'Use share to share');
  await update(env, 'summaries', params.id, b);
  return json({ ok: true });
}

export async function share({ env, request, params, admin }) {
  const { shared_body } = await body(request);
  if (!shared_body?.trim()) throw new HttpError(400, 'Nothing to share');
  await env.DB.prepare("UPDATE summaries SET shared_body = ?, status = 'shared', shared_at = datetime('now') WHERE id = ?").bind(shared_body, Number(params.id)).run();
  await audit(env, admin, 'share_summary', `summary:${params.id}`);
  return json({ ok: true });
}

// ---------- logo ----------

const LOGO_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function putLogo({ env, request, admin }) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!LOGO_TYPES.includes(type)) throw new HttpError(415, 'Use an SVG, PNG, JPG, WebP, or GIF');
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) throw new HttpError(413, 'Keep the logo under 2 MB');
  await env.MEDIA.put('branding/logo', bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('logo_v', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(String(Date.now())).run();
  await audit(env, admin, 'logo_upload', type);
  return json({ ok: true });
}

export async function deleteLogo({ env, admin }) {
  await env.MEDIA.delete('branding/logo');
  await env.DB.prepare("DELETE FROM settings WHERE key = 'logo_v'").run();
  await audit(env, admin, 'logo_delete', '');
  return json({ ok: true });
}

// ---------- team report: the whole review, no names ----------

async function participation(env, cycleId) {
  const people = await one(env, 'SELECT COUNT(*) AS n FROM cycle_people WHERE cycle_id = ?', cycleId);
  const a = await one(env, "SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM assignments WHERE cycle_id = ?", cycleId);
  const pct = a.total ? Math.round((100 * (a.done || 0)) / a.total) : 0;
  return { people: people.n, done: a.done || 0, total: a.total, pct };
}

export async function getTeam({ env, params }) {
  const cycle = await getCycle(env, params.id);
  return json({
    report: await one(env, 'SELECT * FROM team_reports WHERE cycle_id = ?', cycle.id),
    stats: await participation(env, cycle.id),
  });
}

export async function draftTeam({ env, params, admin }) {
  const cycle = await getCycle(env, params.id);
  if (!['closed', 'published'].includes(cycle.status)) throw new HttpError(409, 'The team report opens after the review closes');
  const rows = await all(
    env,
    `SELECT q.prompt_en AS prompt, r.kind AS audience, r.body, NULL AS signed_name, l.assignment_hash AS reviewer_key
     FROM responses r JOIN questions q ON q.id = r.question_id LEFT JOIN response_link l ON l.response_id = r.id
     WHERE r.cycle_id = ? ORDER BY q.audience, q.ord`,
    cycle.id,
  );
  if (!rows.length) throw new HttpError(409, 'There are no answers in this review yet');
  const { responses } = stripIdentity(rows);
  const names = (await all(env, 'SELECT s.name, s.preferred_name FROM staff s JOIN cycle_people p ON p.staff_id = s.id WHERE p.cycle_id = ? AND s.role != \'admin\'', cycle.id))
    .flatMap((s) => [s.name, s.preferred_name, s.name.split(' ')[0]])
    .filter(Boolean);
  const values = await all(env, 'SELECT * FROM "values" WHERE values_set_id = ? ORDER BY ord', cycle.values_set_id ?? 0);
  const n = await settings(env);
  const st = await participation(env, cycle.id);
  const { markdown, notes } = await draftSummary({
    input: {
      name: n.hui_name || 'the Hui',
      cycle: cycle.name,
      huiName: n.hui_name,
      director: n.director_name,
      values,
      responses,
      signers: {},
      forbid: names,
      facts: `${st.people} people took part. ${st.done} of ${st.total} reviews were finished.`,
    },
    templates: { system: teamSystem, user: teamUser, fix: fixPrompt },
    complete: completer(env),
  });
  await env.DB.prepare(
    `INSERT INTO team_reports (cycle_id, draft) VALUES (?, ?)
     ON CONFLICT (cycle_id) DO UPDATE SET draft = excluded.draft, edited = NULL`,
  ).bind(cycle.id, markdown).run();
  await audit(env, admin, 'draft_team', `cycle:${cycle.id}`);
  return json({ draft: markdown, notes });
}

export async function saveTeam({ env, request, params }) {
  const cycle = await getCycle(env, params.id);
  const { edited } = await body(request);
  await env.DB.prepare(
    'INSERT INTO team_reports (cycle_id, edited) VALUES (?, ?) ON CONFLICT (cycle_id) DO UPDATE SET edited = excluded.edited',
  ).bind(cycle.id, String(edited ?? '')).run();
  return json({ ok: true });
}

export async function shareTeam({ env, request, params, admin }) {
  const cycle = await getCycle(env, params.id);
  const { shared } = await body(request);
  await env.DB.prepare(`UPDATE team_reports SET shared_at = ${shared ? "datetime('now')" : 'NULL'} WHERE cycle_id = ?`).bind(cycle.id).run();
  await audit(env, admin, shared ? 'share_team' : 'unshare_team', `cycle:${cycle.id}`);
  return json({ ok: true });
}

export async function draftBoard({ env, params, admin }) {
  const cycle = await getCycle(env, params.id);
  if (!['closed', 'published'].includes(cycle.status)) throw new HttpError(409, 'The board report opens after the review closes');
  const rows = await all(
    env,
    `SELECT q.prompt_en AS prompt, r.kind AS audience, r.body, NULL AS signed_name, l.assignment_hash AS reviewer_key
     FROM responses r JOIN questions q ON q.id = r.question_id LEFT JOIN response_link l ON l.response_id = r.id WHERE r.cycle_id = ?`,
    cycle.id,
  );
  if (!rows.length) throw new HttpError(409, 'There are no answers in this review yet');
  const names = (await all(env, 'SELECT s.name, s.preferred_name FROM staff s JOIN cycle_people p ON p.staff_id = s.id WHERE p.cycle_id = ? AND s.role != \'admin\'', cycle.id))
    .flatMap((s) => [s.name, s.preferred_name, s.name.split(' ')[0]])
    .filter(Boolean);
  const n = await settings(env);
  const st = await participation(env, cycle.id);
  const { markdown, notes } = await draftSummary({
    input: {
      name: n.hui_name || 'the Hui',
      cycle: cycle.name,
      huiName: n.hui_name,
      director: n.director_name,
      values: await all(env, 'SELECT * FROM "values" WHERE values_set_id = ? ORDER BY ord', cycle.values_set_id ?? 0),
      responses: stripIdentity(rows).responses,
      signers: {},
      forbid: names,
      facts: `${st.people} people took part. ${st.done} of ${st.total} reviews were finished (${st.pct}%).`,
    },
    templates: { system: boardSystem, user: teamUser, fix: fixPrompt },
    complete: completer(env),
  });
  // The board report never quotes anyone, so remove any quote the model slipped in.
  const clean = markdown.replace(/\s*["“][^"“”\n]{12,}["”]/g, '');
  await env.DB.prepare(
    `INSERT INTO team_reports (cycle_id, board_draft) VALUES (?, ?)
     ON CONFLICT (cycle_id) DO UPDATE SET board_draft = excluded.board_draft, board_edited = NULL`,
  ).bind(cycle.id, clean).run();
  await audit(env, admin, 'draft_board', `cycle:${cycle.id}`);
  return json({ draft: clean, notes });
}

export async function saveBoard({ env, request, params }) {
  const cycle = await getCycle(env, params.id);
  await env.DB.prepare('INSERT INTO team_reports (cycle_id, board_edited) VALUES (?, ?) ON CONFLICT (cycle_id) DO UPDATE SET board_edited = excluded.board_edited')
    .bind(cycle.id, String((await body(request)).edited ?? '')).run();
  return json({ ok: true });
}


// ---------- early signals and reviewer tone ----------

async function analyze(env, cycleId) {
  const todo = await all(
    env,
    "SELECT r.id, r.body FROM responses r LEFT JOIN response_signals s ON s.response_id = r.id WHERE r.cycle_id = ? AND s.response_id IS NULL AND TRIM(COALESCE(r.body, '')) != '' LIMIT 400",
    cycleId,
  );
  const complete = completer(env);
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const { system, user } = signalsPrompt(batch.map((r) => r.body));
    const out = parseSignals(await complete(system, user), batch.length);
    if (!out) continue; // unreadable reply: leave these unchecked so the next run tries again
    await env.DB.batch(
      batch.map((r, k) => env.DB.prepare('INSERT OR REPLACE INTO response_signals (response_id, label, tone) VALUES (?, ?, ?)').bind(r.id, out[k].label, out[k].tone)),
    );
  }
  return todo.length;
}

async function signalCounts(env, cycleId) {
  const rows = await all(
    env,
    "SELECT s.label, COUNT(*) AS n FROM response_signals s JOIN responses r ON r.id = s.response_id WHERE r.cycle_id = ? AND s.label != 'none' GROUP BY s.label",
    cycleId,
  );
  const checked = await one(env, 'SELECT COUNT(*) AS n FROM response_signals s JOIN responses r ON r.id = s.response_id WHERE r.cycle_id = ?', cycleId);
  const total = await one(env, "SELECT COUNT(*) AS n FROM responses WHERE cycle_id = ? AND TRIM(COALESCE(body, '')) != ''", cycleId);
  return { counts: Object.fromEntries(rows.map((r) => [r.label, r.n])), checked: checked.n, total: total.n };
}

export const getSignals = async ({ env, params }) => json(await signalCounts(env, (await getCycle(env, params.id)).id));

export async function runSignals({ env, params, admin }) {
  const cycle = await getCycle(env, params.id);
  await analyze(env, cycle.id);
  await audit(env, admin, 'signals', `cycle:${cycle.id}`);
  return json(await signalCounts(env, cycle.id));
}

// Tone tags per assignment hash. The server links a reviewer's assignments with the
// pepper, compares their average tone to the group, and only the tag leaves.
async function toneTags(env, cycleId) {
  const toned = await all(
    env,
    "SELECT l.assignment_hash AS hash, s.tone FROM response_signals s JOIN response_link l ON l.response_id = s.response_id JOIN responses r ON r.id = s.response_id WHERE r.cycle_id = ? AND r.kind = 'peer'",
    cycleId,
  );
  if (!toned.length) return {};
  const owner = {};
  for (const a of await all(env, "SELECT id, reviewer_id FROM assignments WHERE cycle_id = ? AND kind = 'peer'", cycleId)) {
    owner[await assignmentHash(a.id, env.HASH_PEPPER, cycleId)] = { reviewer: a.reviewer_id, review: a.id };
  }
  const rows = toned.filter((t) => owner[t.hash]).map((t) => ({ ...owner[t.hash], tone: t.tone }));
  const byReviewer = calibrate(rows);
  return Object.fromEntries(Object.entries(owner).map(([hash, o]) => [hash, byReviewer[o.reviewer] || null]).filter(([, v]) => v));
}

// ---------- optional sending (email, text) ----------

export async function getChannels({ env }) {
  const n = await settings(env);
  return json({ ...channels(env), reply_to: await directorEmail(env), auto: n.auto_remind === '1', cron: !!env.CRON_SECRET });
}

export async function sendMessage({ env, request, admin }) {
  const b = await body(request);
  const person = await one(env, 'SELECT * FROM staff WHERE id = ?', Number(b.staff_id));
  if (!person) throw new HttpError(404, 'Not found');
  const to = via(env, person);
  if (!to) throw new HttpError(400, `${person.preferred_name || person.name} has no email, or Send email is unchecked in People.`);
  await send(env, to.to, String(b.message || '').slice(0, 4000), to.channel, b.subject || 'A message from your review');
  await audit(env, admin, `send_${to.channel}`, `staff:${person.id}`);
  return json({ ok: true, channel: to.channel });
}

// Email many people at once. Only people with an email and Send email checked get one.
// The rest come back by name so the director can copy their messages instead.
export async function emailMany({ env, request, admin }) {
  if (!channels(env).email) throw new HttpError(400, 'Email is not set up yet. Copy the messages instead.');
  const messages = (await body(request)).messages || [];
  const people = Object.fromEntries((await all(env, 'SELECT * FROM staff')).map((p) => [p.id, p]));
  const out = [];
  const skipped = [];
  for (const m of messages) {
    const p = people[Number(m.staff_id)];
    if (!p) continue;
    if (p.email && p.send_email) out.push({ to: p.email, subject: String(m.subject || 'A message from your review').slice(0, 200), text: String(m.message || '').slice(0, 4000) });
    else skipped.push(p.preferred_name || p.name);
  }
  await sendEmails(env, out);
  await audit(env, admin, 'email_many', `${out.length} sent`);
  return json({ sent: out.length, skipped });
}

// ---------- mahalo board moderation ----------

export async function listMahalo({ env }) {
  return json({
    mahalo: await all(
      env,
      'SELECT m.id, m.body, m.public, m.created_at, t.name AS to_name, f.name AS from_name FROM mahalo m JOIN staff t ON t.id = m.to_id LEFT JOIN staff f ON f.id = m.from_id WHERE m.public = 1 ORDER BY m.id DESC LIMIT 200',
    ),
  });
}

export async function removeMahalo({ env, params, admin }) {
  await env.DB.prepare('DELETE FROM mahalo WHERE id = ?').bind(Number(params.id)).run();
  await audit(env, admin, 'remove_mahalo', `mahalo:${params.id}`);
  return json({ ok: true });
}

// ---------- files, export, audit ----------

export async function file({ env, url, admin }) {
  const key = url.searchParams.get('key') || '';
  if (!/^(audio|exports)\//.test(key)) throw new HttpError(400, 'Bad key');
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new HttpError(404, 'Not found');
  if (key.startsWith('exports/')) await audit(env, admin, 'download_export', key);
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, no-store',
      ...(key.startsWith('exports/') ? { 'content-disposition': `attachment; filename="${key.split('/').pop()}"` } : {}),
    },
  });
}

const EXPORT_TABLES = [
  'staff', 'value_sets', 'values', 'cycles', 'questions', 'assignments', 'responses', 'summaries',
  'cycle_people', 'team_reports', 'response_signals', 'employee_reflection', 'goals', 'mahalo', 'feedback_requests', 'kuleana', 'community_voices', 'settings', 'audit',
];

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'item';

export function exportMarkdown(data) {
  const files = {};
  const staff = new Map(data.staff.map((s) => [s.id, s]));
  const qs = new Map(data.questions.map((q) => [q.id, q]));
  files['values.md'] = data.value_sets
    .map((set) => `# ${set.name}\n\n` + data.values.filter((v) => v.values_set_id === set.id)
      .map((v) => `## ${v.name_haw}${v.name_en ? ` (${v.name_en})` : ''}\n\n${v.olelo_noeau ? `"${v.olelo_noeau}" ${v.olelo_noeau_meaning || ''}\n\n` : ''}${v.description || ''}\n`).join('\n'))
    .join('\n');
  for (const c of data.cycles) {
    const ids = [...new Set(data.responses.filter((r) => r.cycle_id === c.id).map((r) => r.reviewee_id).concat(data.summaries.filter((s) => s.cycle_id === c.id).map((s) => s.reviewee_id)))];
    for (const id of ids) {
      const person = staff.get(id);
      const sum = data.summaries.find((s) => s.cycle_id === c.id && s.reviewee_id === id);
      const refl = sum && data.employee_reflection.find((r) => r.summary_id === sum.id);
      const byQ = new Map();
      for (const r of data.responses.filter((r) => r.cycle_id === c.id && r.reviewee_id === id)) {
        if (!byQ.has(r.question_id)) byQ.set(r.question_id, []);
        byQ.get(r.question_id).push(r);
      }
      let md = `# ${person?.name ?? id}, ${c.name}\n\n`;
      if (sum) md += `## Summary (${sum.status})\n\n${sum.edited ?? sum.draft ?? ''}\n\n`;
      if (sum?.shared_body) md += `## Shared on ${sum.shared_at}\n\n${sum.shared_body}\n\n`;
      if (refl) md += `## Their reflection\n\n${refl.body}\n\n`;
      md += '## Responses\n\n';
      for (const [qid, rs] of byQ) {
        md += `### ${qs.get(qid)?.prompt_en ?? 'Question'} (${qs.get(qid)?.audience ?? ''})\n\n`;
        md += rs.map((r) => `- ${(r.body || '').replace(/\n+/g, ' ')}${r.signed_name ? ` (signed: ${r.signed_name})` : ''}`).join('\n') + '\n\n';
      }
      files[`${slug(c.name)}/${slug(person?.name ?? id)}.md`] = md;
    }
  }
  return files;
}

export async function exportAll({ env, admin }) {
  const data = {};
  for (const t of EXPORT_TABLES) data[t] = await all(env, `SELECT * FROM "${t}"`);
  const prefix = `exports/${new Date().toISOString().replace(/[:.]/g, '-')}/`;
  const files = {
    'hui360.json': JSON.stringify({ exported_at: new Date().toISOString(), note: 'response_link is left out on purpose so exports never carry the reviewer hash.', tables: data }, null, 2),
    ...exportMarkdown(data),
  };
  for (const [name, content] of Object.entries(files)) {
    await env.MEDIA.put(prefix + name, content, { httpMetadata: { contentType: name.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8' } });
  }
  await audit(env, admin, 'export', prefix);
  return json({ prefix, files: Object.keys(files).map((n) => prefix + n) });
}

export async function listExports({ env }) {
  const page = await env.MEDIA.list({ prefix: 'exports/', limit: 1000 });
  return json({ files: page.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })) });
}

export const listAudit = async ({ env }) => json({ audit: await all(env, 'SELECT * FROM audit ORDER BY id DESC LIMIT 300') });

// ---------- sample review, so a director can see the finished product ----------

const SAMPLE_NAME = 'Sample review (example)';
const SAMPLE_EMAIL = '%@sample.example';

export async function loadSample({ env, admin }) {
  if (await one(env, 'SELECT id FROM cycles WHERE name = ?', SAMPLE_NAME)) throw new HttpError(409, 'The sample is already loaded');
  const set = await one(env, 'SELECT id FROM value_sets ORDER BY id DESC LIMIT 1');
  const vals = await all(env, 'SELECT name_haw FROM "values" WHERE values_set_id = ? ORDER BY ord, id', set?.id ?? 0);
  const [v1, v2] = [vals[0]?.name_haw || 'Working together', vals[1]?.name_haw || 'Learning by doing'];
  const names = await settings(env);
  const director = names.director_name || 'your director';

  const person = async (name, preferred, email) => insert(env, 'staff', { name, preferred_name: preferred, email, team: 'Sample', active: 0, send_email: 0 }); // made up people are never emailed
  const kainoa = await person('Sample Kainoa', 'Kainoa', 'kainoa@sample.example');
  const lei = await person('Sample Lei', 'Lei', 'lei@sample.example');
  const keoni = await person('Sample Keoni', 'Keoni', 'keoni@sample.example');

  const cid = await insert(env, 'cycles', { name: SAMPLE_NAME, opens_at: '2026-01-05', closes_at: '2026-01-30', status: 'published', values_set_id: set?.id ?? null });
  await env.DB.prepare("UPDATE cycles SET published_at = datetime('now') WHERE id = ?").bind(cid).run();
  await insertDefaultQuestions(env, cid);
  await env.DB.batch([kainoa, lei, keoni].map((s) => env.DB.prepare('INSERT INTO cycle_people (cycle_id, staff_id) VALUES (?, ?)').bind(cid, s)));
  const qs = await all(env, 'SELECT id, audience FROM questions WHERE cycle_id = ? ORDER BY ord', cid);
  const self = qs.filter((q) => q.audience === 'self');
  const peer = qs.filter((q) => q.audience === 'peer');

  const answers = [
    [kainoa, 'self', self, [
      'Getting the new loʻi section planted with the summer keiki.',
      'Opening the water back into the loʻi after the storm. Everyone came.',
      'Patience. I like teaching.',
      'Saying yes to everything. I was tired by October.',
      'Planning the season so I am not always catching up.',
      'More help with grant reports.',
    ]],
    [lei, 'peer', peer, [
      'Kainoa always shows up early to open the gate and has the coffee going before anyone else.',
      'When the storm took out the water line at the loʻi, he was there at 5am with the pipe fittings and stayed until the water ran again.',
      'His gift is patience. He teaches keiki how to plant kalo like he has all the time in the world.',
      'He listens to the kūpuna before he makes a plan.',
      'He takes on too much and does not ask for help.',
      'He is ready to lead the education program if we support him.',
    ], 'Lei'],
    [keoni, 'peer', peer, [
      'Mahalo for always making time to teach the new volunteers. You never make anyone feel slow.',
      'At the workday he stayed until dark fixing the ʻauwai with me.',
      'He makes everyone feel welcome, even on hard days.',
      'He asks for the manaʻo of the kūpuna first.',
      'He could say no more often. He carries a lot by himself.',
      '',
    ]],
  ];
  for (const [reviewer, kind, questions, texts, signer] of answers) {
    const aid = await insert(env, 'assignments', { cycle_id: cid, reviewer_id: reviewer, reviewee_id: kainoa, kind, status: 'done' });
    const hash = await assignmentHash(aid, env.HASH_PEPPER, cid);
    const stmts = [];
    texts.forEach((text, i) => {
      if (!text || !questions[i]) return;
      const id = crypto.randomUUID();
      stmts.push(
        env.DB.prepare('INSERT INTO responses (id, cycle_id, reviewee_id, question_id, kind, body, language, signed_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, cid, kainoa, questions[i].id, kind, text, 'en', i === 0 && signer ? signer : null),
        env.DB.prepare('INSERT INTO response_link (response_id, assignment_hash) VALUES (?, ?)').bind(id, hash),
      );
    });
    await env.DB.batch(stmts);
  }

  const letter = `Kainoa, mahalo for this year. Your coworkers wrote about the same thing first: you show up before anyone else, and you make room for people to learn. That steadiness carried the team through a hard season.

## Mahalo

"Kainoa always shows up early to open the gate and has the coffee going before anyone else." (Lei)

"Mahalo for always making time to teach the new volunteers. You never make anyone feel slow."

## Values

### ${v1}

Your patience is a gift to everyone around you. "He teaches keiki how to plant kalo like he has all the time in the world."

### ${v2}

You listen before you plan. Two coworkers named it in their own words, including "He listens to the kūpuna before he makes a plan."

## Themes

**Steady when things break.** When the water line failed, "he was there at 5am with the pipe fittings and stayed until the water ran again."

**A natural teacher.** You wrote "Patience. I like teaching." Your coworkers see the same thing.

**Ready for more.** One coworker wrote that you are "ready to lead the education program if we support him."

## Growth

Two coworkers said the same thing in different words: you carry too much by yourself. You named it too: "Saying yes to everything. I was tired by October." The patience you give the keiki is the same patience you can give yourself. Let us plan the season together so you are not always catching up.

## Questions for your huli

- What would you hand off first if you had help?
- What would your first 90 days leading the education program look like?
- Which part of next season do you want planned before it starts?`;
  const sumId = await insert(env, 'summaries', {
    cycle_id: cid, reviewee_id: kainoa, draft: letter, edited: letter, status: 'shared', shared_body: letter,
  });
  await env.DB.prepare("UPDATE summaries SET shared_at = datetime('now') WHERE id = ?").bind(sumId).run();
  await insert(env, 'employee_reflection', {
    summary_id: sumId,
    body: `Mahalo, ${director}. This landed. I want to get better at saying no and asking for help before I am tired. I would love to talk about the education program.`,
  });
  const hui = names.hui_name || 'the Hui';
  const report = `This year the team grew in patience and in care for each other. What people thanked each other for most was simply showing up: early mornings, late workdays, and time spent teaching.

## What we do well

**We show up when it counts.** Most reviews named a moment someone came early or stayed late, like the morning the water line broke after the storm.

**We teach with patience.** Several people wrote about coworkers who make new volunteers and keiki feel welcome. "You never make anyone feel slow."

**We listen before we plan.** Asking the kūpuna first came up in more than one review.

## Our values in practice

### ${v1}

People named patience and teaching as the gifts they see most in each other.

### ${v2}

Care for one another showed up in small, daily ways, from coffee before sunrise to staying until dark.

## Where we struggle

**Too much on too few.** The most common concern was saying yes to everything and running out of energy by the end of the season.

**Asking for help.** Several reviews said coworkers carry a lot alone and do not ask for help.

## What people asked of ${hui}

More help with grant reports, and a plan for the season before it starts.

## Ideas for next year

- Plan the season together in January, so no one is always catching up.
- Pair up on grant reports so the writing does not fall on one person.
- Make it normal to say no: name one thing each person can hand off.`;
  await env.DB.prepare("INSERT INTO team_reports (cycle_id, draft, edited, shared_at) VALUES (?, ?, ?, datetime('now'))").bind(cid, report, report).run();
  await audit(env, admin, 'sample_load', `cycle:${cid}`);
  return json({ id: cid, person: kainoa });
}

export async function removeSample({ env, admin }) {
  const c = await one(env, 'SELECT id FROM cycles WHERE name = ?', SAMPLE_NAME);
  if (c) await purgeCycle(env, c.id);
  await env.DB.prepare('DELETE FROM staff WHERE email LIKE ?').bind(SAMPLE_EMAIL).run();
  await audit(env, admin, 'sample_remove', c ? `cycle:${c.id}` : '');
  return json({ ok: true });
}
