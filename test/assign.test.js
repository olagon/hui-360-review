import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { assignmentHash, autoFill } from '../functions/lib/assign.js';
import { saveAnswer } from '../functions/lib/staff-api.js';

// Minimal D1 lookalike over node:sqlite, enough for the real handlers.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of ['0001_init.sql', '0002_seed.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of list) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const PEPPER = 'test-pepper';
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

test('assignment hash is stable, peppered, and needs the pepper', async () => {
  const h = await assignmentHash(77, PEPPER, 5);
  assert.equal(h, await assignmentHash(77, PEPPER, 5));
  assert.notEqual(h, await assignmentHash(77, 'other', 5));
  assert.notEqual(h, await sha('77:5'));
  assert.notEqual(h, await sha('775'));
  await assert.rejects(() => assignmentHash(77, '', 5));
});

test('no table join recovers who wrote an unsigned response', async () => {
  const DB = d1();
  const env = { DB, HASH_PEPPER: PEPPER };
  DB.raw.exec(`
    INSERT INTO staff (id, name, preferred_name) VALUES (11, 'Pua Reviewer', 'Pua'), (22, 'Kainoa Reviewee', NULL), (33, 'Other Person', NULL);
    INSERT INTO cycles (id, name, status) VALUES (5, '2026', 'open');
    INSERT INTO questions (id, cycle_id, audience, ord, prompt_en, kind) VALUES (101, 5, 'peer', 0, 'Mahalo?', 'mahalo'), (102, 5, 'peer', 1, 'Story?', 'story');
    INSERT INTO assignments (id, cycle_id, reviewer_id, reviewee_id, kind) VALUES (77, 5, 11, 22, 'peer'), (78, 5, 33, 22, 'peer');
  `);
  const pua = DB.raw.prepare('SELECT * FROM staff WHERE id = 11').get();
  const other = DB.raw.prepare('SELECT * FROM staff WHERE id = 33').get();

  await saveAnswer(env, pua, { assignment_id: 77, question_id: 102, body: 'First draft of a story.' });
  await saveAnswer(env, pua, { assignment_id: 77, question_id: 102, body: 'He fixed the fence with me.', signed: true });
  await saveAnswer(env, pua, { assignment_id: 77, question_id: 101, body: 'Mahalo for everything.', signed: true });
  await saveAnswer(env, other, { assignment_id: 78, question_id: 102, body: 'She plans the workdays well.' });
  await assert.rejects(() => saveAnswer(env, other, { assignment_id: 77, question_id: 102, body: 'not mine' }), /Not found/);

  const responses = DB.raw.prepare('SELECT * FROM responses').all();
  assert.equal(responses.length, 3, 'edits update in place');
  const story = responses.find((r) => r.body === 'He fixed the fence with me.');
  assert.equal(story.signed_name, null, 'only mahalo can be signed');
  assert.equal(responses.find((r) => r.question_id === 101).signed_name, 'Pua', 'signed mahalo keeps the name by choice');
  assert.match(story.id, /^[0-9a-f-]{36}$/);
  assert.match(story.created_at, /^\d{4}-\d{2}-\d{2}$/, 'date only, no write time');

  // Nothing stored next to an unsigned response points at its writer.
  const link = DB.raw.prepare('SELECT * FROM response_link WHERE response_id = ?').get(story.id);
  for (const v of [...Object.values(story), ...Object.values(link)]) {
    assert.ok(![11, 77, 'Pua', 'Pua Reviewer'].includes(v), `response data leaks ${v}`);
  }
  assert.equal(link.assignment_hash, await assignmentHash(77, PEPPER, 5));

  // The hash appears nowhere else in the database, so there is nothing to join it to.
  const tables = DB.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of tables.filter((t) => t !== 'response_link')) {
    for (const row of DB.raw.prepare(`SELECT * FROM "${t}"`).all()) {
      assert.ok(!Object.values(row).includes(link.assignment_hash), `hash found in ${t}`);
    }
  }

  const a = DB.raw.prepare('SELECT status FROM assignments WHERE id = 77').get();
  assert.equal(a.status, 'in_progress');
});

test('autoFill gives everyone reviewers without self pairs or repeats', () => {
  const staffIds = [1, 2, 3, 4, 5, 6];
  const added = autoFill({ staffIds, worksWith: { 1: [2] }, lastPairs: new Set(['3:4']), target: 2 });
  const pairs = added.map((p) => `${p.reviewer}:${p.reviewee}`);
  assert.equal(new Set(pairs).size, pairs.length);
  for (const id of staffIds) {
    assert.equal(added.filter((p) => p.reviewee === id).length, 2);
    assert.ok(added.filter((p) => p.reviewer === id).length <= 3);
  }
  assert.ok(added.every((p) => p.reviewer !== p.reviewee));
  const keep = autoFill({ staffIds: [1, 2, 3], existing: [{ reviewer: 2, reviewee: 1 }], target: 1 });
  assert.ok(!keep.some((p) => p.reviewee === 1), 'existing pairs count toward the target');
});
