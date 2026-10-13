import { HttpError, body, json } from './http.js';
import { assignmentHash } from './assign.js';
import { detectLanguage } from './summarize.js';
import { transcribe, aiOn } from './ai.js';
import { MAX_AUDIO_BYTES } from './config.js';
import { channels } from './notify.js';
import { requireAdmin } from './auth.js';

const MINUTES = { story: 3, mahalo: 2, short: 1, scale: 0.5 };

async function ownAssignment(env, staff, id) {
  const a = await env.DB.prepare(
    `SELECT a.*, c.status AS cycle_status, c.name AS cycle_name, c.closes_at, c.values_set_id,
            s.name AS reviewee_name, s.preferred_name AS reviewee_preferred
     FROM assignments a JOIN cycles c ON c.id = a.cycle_id JOIN staff s ON s.id = a.reviewee_id
     WHERE a.id = ? AND a.reviewer_id = ?`,
  ).bind(Number(id), staff.id).first();
  if (!a) throw new HttpError(404, 'Not found');
  return a;
}

const questionsFor = (env, a) =>
  env.DB.prepare('SELECT * FROM questions WHERE cycle_id = ? AND audience = ? ORDER BY ord, id').bind(a.cycle_id, a.kind).all().then((r) => r.results);

const answersFor = (env, hash) =>
  env.DB.prepare(
    `SELECT r.id, r.question_id, r.body, r.audio_key, r.transcript, r.signed_name IS NOT NULL AS signed
     FROM responses r JOIN response_link l ON l.response_id = r.id WHERE l.assignment_hash = ?`,
  ).bind(hash).all().then((r) => r.results);

// Public: names the UI shows before anyone signs in.
export async function config({ env }) {
  const rows = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('hui_name', 'director_name', 'logo_v', 'moon_calendar', 'ai', 'hawaiian', 'app_name')").all();
  return json({ ...Object.fromEntries(rows.results.map((r) => [r.key, r.value])), email: (await channels(env)).email });
}

// Public: is the person looking at this page signed in as an admin? Only ever answers about themselves.
export async function adminStatus({ env, request }) {
  try {
    const email = await requireAdmin(request, env, { cookie: true });
    const me = await env.DB.prepare('SELECT id FROM staff WHERE active = 1 AND LOWER(email) = LOWER(?) LIMIT 1').bind(email).first();
    return json({ admin: true, email, staff: !!me });
  } catch {
    return json({ admin: false });
  }
}

// Public: screen text an admin translated in Settings, Translations. Read before anyone signs in.
export async function translationsFor({ env, params }) {
  if (params.lang !== 'haw') throw new HttpError(404, 'Not found');
  const rows = await env.DB.prepare('SELECT key, value FROM translations WHERE lang = ?').bind(params.lang).all().catch(() => ({ results: [] }));
  return json({ strings: Object.fromEntries(rows.results.map((r) => [r.key, r.value])) });
}

// Public: the organization's logo, uploaded by admin. Served as an image only, so an SVG
// can animate with CSS but can never run script on this origin.
export async function logo({ env }) {
  const obj = await env.MEDIA.get('branding/logo');
  if (!obj) throw new HttpError(404, 'No logo');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

export const logout = () =>
  json({ ok: true }, 200, { 'set-cookie': 'hui360_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });

export async function me({ env, staff }) {
  const cycle = await env.DB.prepare("SELECT id, name, opens_at, closes_at, status FROM cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1").first();
  const assignments = [];
  if (cycle) {
    const rows = await env.DB.prepare(
      `SELECT a.id, a.kind, a.status, a.reviewee_id, s.name, s.preferred_name FROM assignments a JOIN staff s ON s.id = a.reviewee_id
       WHERE a.cycle_id = ? AND a.reviewer_id = ?
       ORDER BY CASE a.kind WHEN 'self' THEN 0 WHEN 'peer' THEN 1 ELSE 2 END, s.name`,
    ).bind(cycle.id, staff.id).all();
    for (const a of rows.results) {
      const qs = await questionsFor(env, { ...a, cycle_id: cycle.id });
      const done = new Set((await answersFor(env, await assignmentHash(a.id, env.HASH_PEPPER, cycle.id))).map((r) => r.question_id));
      const quick = qs.filter((q) => q.five_min);
      assignments.push({
        id: a.id,
        kind: a.kind,
        status: a.status,
        reviewee: a.preferred_name || a.name,
        total: qs.length,
        answered: qs.filter((q) => done.has(q.id)).length,
        quick_total: quick.length,
        quick_answered: quick.filter((q) => done.has(q.id)).length,
        minutes: Math.ceil(qs.filter((q) => !done.has(q.id)).reduce((m, q) => m + (MINUTES[q.kind] || 2), 0)),
      });
    }
  }
  const shared = await env.DB.prepare("SELECT COUNT(*) AS n FROM summaries WHERE reviewee_id = ? AND status = 'shared'").bind(staff.id).first();
  const team = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM team_reports t JOIN cycle_people p ON p.cycle_id = t.cycle_id WHERE p.staff_id = ? AND t.shared_at IS NOT NULL',
  ).bind(staff.id).first();
  return json({
    staff: { id: staff.id, name: staff.preferred_name || staff.name, lang: staff.lang },
    cycle,
    assignments,
    summaries: shared.n,
    team: team.n,
    asks: (await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_requests WHERE to_id = ? AND response IS NULL').bind(staff.id).first()).n,
    lead: !!(await env.DB.prepare('SELECT 1 FROM staff WHERE reports_to = ? AND active = 1 LIMIT 1').bind(staff.id).first()), // supervises someone
  });
}

export async function assignment({ env, staff, params }) {
  const a = await ownAssignment(env, staff, params.id);
  const questions = await questionsFor(env, a);
  const values = await env.DB.prepare('SELECT id, name_haw, name_en, olelo_noeau, olelo_noeau_meaning FROM "values" WHERE values_set_id = ?')
    .bind(a.values_set_id ?? 0).all();
  const answers = await answersFor(env, await assignmentHash(a.id, env.HASH_PEPPER, a.cycle_id));
  return json({
    assignment: { id: a.id, kind: a.kind, status: a.status, reviewee: a.reviewee_preferred || a.reviewee_name, open: a.cycle_status === 'open' },
    cycle: { id: a.cycle_id, name: a.cycle_name, closes_at: a.closes_at },
    questions,
    values: values.results,
    answers: answers.map(({ id, ...rest }) => ({ ...rest, signed: !!rest.signed })),
  });
}

// Upsert one answer. The response row never gets the reviewer id or assignment id,
// only response_link gets the peppered hash.
export async function saveAnswer(env, staff, p) {
  const a = await ownAssignment(env, staff, p.assignment_id);
  if (a.cycle_status !== 'open') throw new HttpError(409, 'This review is closed');
  const q = await env.DB.prepare('SELECT * FROM questions WHERE id = ? AND cycle_id = ? AND audience = ?').bind(Number(p.question_id), a.cycle_id, a.kind).first();
  if (!q) throw new HttpError(400, 'Unknown question');
  const audioKey = p.audio_key && new RegExp(`^audio/${a.cycle_id}/[\\w-]+\\.\\w+$`).test(p.audio_key) ? p.audio_key : null;
  const text = String(p.body ?? '').slice(0, 20000);
  const signed = q.kind === 'mahalo' && p.signed ? staff.preferred_name || staff.name : null;

  const hash = await assignmentHash(a.id, env.HASH_PEPPER, a.cycle_id);
  const existing = await env.DB.prepare(
    'SELECT r.id FROM responses r JOIN response_link l ON l.response_id = r.id WHERE l.assignment_hash = ? AND r.question_id = ?',
  ).bind(hash, q.id).first();

  if (!text.trim() && !audioKey) {
    if (existing) await env.DB.prepare('DELETE FROM responses WHERE id = ?').bind(existing.id).run();
  } else {
    const lang = detectLanguage(text) || p.language || null;
    const transcript = p.transcript ? String(p.transcript).slice(0, 20000) : null;
    if (existing) {
      await env.DB.batch([
        env.DB.prepare('UPDATE responses SET body = ?, audio_key = ?, transcript = ?, language = ?, signed_name = ? WHERE id = ?')
          .bind(text, audioKey, transcript, lang, signed, existing.id),
        // The words changed, so any early signal read from the old words is stale.
        env.DB.prepare('DELETE FROM response_signals WHERE response_id = ?').bind(existing.id),
      ]);
    } else {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO responses (id, cycle_id, reviewee_id, question_id, kind, body, audio_key, transcript, language, signed_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(id, a.cycle_id, a.reviewee_id, q.id, a.kind, text, audioKey, transcript, lang, signed),
        env.DB.prepare('INSERT INTO response_link (response_id, assignment_hash) VALUES (?, ?)').bind(id, hash),
      ]);
    }
  }
  if (a.status === 'not_started') await env.DB.prepare("UPDATE assignments SET status = 'in_progress' WHERE id = ?").bind(a.id).run();
  return { ok: true };
}

export const answer = async ({ env, staff, request }) => json(await saveAnswer(env, staff, await body(request)));

export async function finish({ env, staff, params }) {
  const a = await ownAssignment(env, staff, params.id);
  if (a.cycle_status !== 'open') throw new HttpError(409, 'This review is closed');
  const done = new Set((await answersFor(env, await assignmentHash(a.id, env.HASH_PEPPER, a.cycle_id))).map((r) => r.question_id));
  const missing = (await questionsFor(env, a)).filter((q) => q.required && !done.has(q.id)).length;
  if (missing) return json({ ok: false, missing });
  await env.DB.prepare("UPDATE assignments SET status = 'done' WHERE id = ?").bind(a.id).run();
  return json({ ok: true });
}

export async function audio({ env, staff, request, url }) {
  const a = await ownAssignment(env, staff, url.searchParams.get('assignment'));
  if (a.cycle_status !== 'open') throw new HttpError(409, 'This review is closed');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new HttpError(413, 'Recording is too large');
  const type = (request.headers.get('content-type') || 'audio/webm').split(';')[0];
  const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  const key = `audio/${a.cycle_id}/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  // With AI off the recording is still kept (nothing is lost), just not turned into text.
  if (!(await aiOn(env))) return json({ key, transcript: '', language: null });
  try {
    const hint = `Mahalo. Aloha. ʻĀina, kuleana, laulima, pilina, kōkua, Hui. ${a.reviewee_preferred || a.reviewee_name}.`;
    const { text, language } = await transcribe(env, bytes, hint);
    return json({ key, transcript: text, language });
  } catch (e) {
    console.error('transcribe failed', e);
    return json({ key, transcript: '', language: null, error: 'transcribe' });
  }
}

export async function summaries({ env, staff }) {
  const rows = await env.DB.prepare(
    `SELECT s.id, c.name AS cycle, s.shared_body, s.shared_at, r.body AS reflection
     FROM summaries s JOIN cycles c ON c.id = s.cycle_id LEFT JOIN employee_reflection r ON r.summary_id = s.id
     WHERE s.reviewee_id = ? AND s.status = 'shared' ORDER BY s.shared_at DESC`,
  ).bind(staff.id).all();
  const team = await env.DB.prepare(
    `SELECT c.name AS cycle, COALESCE(t.edited, t.draft) AS body, t.shared_at FROM team_reports t
     JOIN cycles c ON c.id = t.cycle_id JOIN cycle_people p ON p.cycle_id = t.cycle_id
     WHERE p.staff_id = ? AND t.shared_at IS NOT NULL ORDER BY t.shared_at DESC`,
  ).bind(staff.id).all();
  return json({ summaries: rows.results, team: team.results });
}

export async function reflection({ env, staff, params, request }) {
  const s = await env.DB.prepare("SELECT id FROM summaries WHERE id = ? AND reviewee_id = ? AND status = 'shared'").bind(Number(params.id), staff.id).first();
  if (!s) throw new HttpError(404, 'Not found');
  const text = String((await body(request)).body || '').slice(0, 20000);
  await env.DB.prepare(
    `INSERT INTO employee_reflection (summary_id, body) VALUES (?, ?)
     ON CONFLICT (summary_id) DO UPDATE SET body = excluded.body, created_at = datetime('now')`,
  ).bind(s.id, text).run();
  return json({ ok: true });
}

export async function setLang({ env, staff, request }) {
  const { lang } = await body(request);
  if (!['en', 'haw', 'both'].includes(lang)) throw new HttpError(400, 'Unknown language');
  await env.DB.prepare('UPDATE staff SET lang = ? WHERE id = ?').bind(lang, staff.id).run();
  return json({ ok: true });
}
