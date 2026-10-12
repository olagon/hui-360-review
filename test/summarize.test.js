import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  verifyQuotes, dropQuotes, draftSummary, stripIdentity, summaryPrompt, cleanText, lint, restoreSigners, section, detectLanguage, namesIn,
} from '../functions/lib/summarize.js';

const templates = Object.fromEntries(
  ['system', 'user', 'fix'].map((k) => [k, readFileSync(new URL(`../functions/lib/prompts/summary-${k}.txt`, import.meta.url), 'utf8')]),
);

const rows = [
  { prompt: 'What are you grateful for about this person this year?', audience: 'peer', body: 'Kainoa always shows up early to open the gate and has the coffee going before anyone else.', signed_name: 'Leilani', reviewer_key: 'h1' },
  { prompt: 'What are you grateful for about this person this year?', audience: 'peer', body: 'Mahalo for teaching the keiki how to plant kalo with so much patience.', signed_name: null, reviewer_key: 'h2' },
  { prompt: 'Tell me about a time this person showed up for the team.', audience: 'peer', body: 'At the workday in May at Waipā he stayed until dark fixing the ʻauwai with me.', signed_name: null, reviewer_key: 'h1' },
  { prompt: 'Where could this person grow?', audience: 'peer', body: 'Sometimes he takes on too much and does not ask for help.', signed_name: null, reviewer_key: 'h2' },
  { prompt: 'What are you most proud of?', audience: 'self', body: 'He aloha nō au i ka ʻāina a me koʻu mau hoa hana.', signed_name: null, reviewer_key: 'self-hash' },
];

const values = [{ name_haw: 'Laulima', name_en: 'Working together', olelo_noeau: 'ʻAʻohe hana nui ke alu ʻia.', olelo_noeau_meaning: 'No task is too big when done together by all.', description: 'Sharing the load.' }];

function input() {
  const { responses, signers } = stripIdentity(rows);
  return { name: 'Kainoa', cycle: '2026 review', lang: 'en', values, responses, signers, lastYear: '' };
}

test('stripIdentity never passes reviewer hashes or unsigned names to the model', () => {
  const { responses, signers } = stripIdentity(rows);
  const blob = JSON.stringify(responses);
  assert.ok(!blob.includes('h1') && !blob.includes('h2') && !blob.includes('self-hash'));
  assert.ok(!blob.includes('Leilani'), 'signed names are tokens, not names');
  assert.deepEqual(Object.values(signers), ['Leilani']);
  const letters = new Set(responses.filter((r) => r.audience !== 'self').map((r) => r.reviewer));
  assert.equal(letters.size, 2, 'two distinct reviewers keep two distinct letters');
  const { system, user } = summaryPrompt(input(), templates);
  assert.ok(!(system + user).includes('Leilani'));
  assert.ok(user.includes('[[signer1]]'));
});

test('verifyQuotes accepts exact quotes, case and okina differences, cuts and [brackets]', () => {
  const sources = rows.map((r) => r.body);
  const md = [
    'Someone wrote "Mahalo for teaching the keiki how to plant kalo with so much patience."',
    'Another said he "stayed until dark fixing the \'auwai with me".',
    'And "At [a workday] he stayed until dark fixing the ʻauwai with me."',
    'Also "always shows up early ... has the coffee going".',
    'Short "Laulima" words and "No task is too big when done together by all." are fine.',
  ].join('\n');
  assert.deepEqual(verifyQuotes(md, [...sources, values[0].olelo_noeau_meaning]), []);
});

test('verifyQuotes catches a fabricated quote', () => {
  const md = 'One coworker said "Kainoa is the best leader we have ever had at the Hui."';
  assert.deepEqual(verifyQuotes(md, rows.map((r) => r.body)), ['Kainoa is the best leader we have ever had at the Hui.']);
});

test('verifyQuotes catches a quote stitched from two different responses', () => {
  const md = '"opens the gate and teaches the keiki how to plant kalo"';
  assert.equal(verifyQuotes(md, rows.map((r) => r.body)).length, 1);
});

test('dropQuotes removes only the sentence that carries the bad quote', () => {
  const md = 'Good start. One said "this never happened at all." Another real line.\n\n> "also made up entirely here"\n\nEnd.';
  const out = dropQuotes(md, ['this never happened at all.', 'also made up entirely here']);
  assert.equal(out, 'Good start. Another real line.\n\nEnd.');
});

test('draftSummary retries once with the problems, then drops what still fails', async () => {
  const calls = [];
  const replies = [
    'Mahalo, Kainoa \u2014 truly.\n\n## Mahalo\n\n"Kainoa is the best leader we have ever had." ([[signer1]])\n\nWe leverage your gifts.',
    'Mahalo, Kainoa.\n\n## Mahalo\n\n"Kainoa always shows up early to open the gate" ([[signer1]])\n\nOne said "he invented a new kind of kalo last week." That is all.',
  ];
  const complete = async (system, user) => (calls.push({ system, user }), replies[calls.length - 1]);
  const { markdown, notes } = await draftSummary({ input: input(), templates, complete });

  assert.equal(calls.length, 2);
  assert.match(calls[1].user, /not word for word/);
  assert.match(calls[1].user, /leverage/);
  assert.ok(markdown.includes('"Kainoa always shows up early to open the gate" (Leilani)'), 'signed mahalo attributed after verification');
  assert.ok(!markdown.includes('invented a new kind of kalo'), 'fabricated quote dropped');
  assert.ok(!/[\u2014\u2013]/.test(markdown), 'no em or en dashes');
  assert.match(notes[0], /Removed 1 quote/);
});

test('lint flags banned words, reviewer letters, length', () => {
  const problems = lint(`Reviewer A says we should circle back. ${'word '.repeat(950)}`);
  assert.equal(problems.length, 3);
});

test('cleanText strips code fences and dashes', () => {
  assert.equal(cleanText('```markdown\nA \u2014 B \u2013 C\n```'), 'A, B - C');
});

test('restoreSigners drops unknown tokens', () => {
  assert.equal(restoreSigners('"x y z" ([[signer1]]) and "a b c" ([[signer9]])', { '[[signer1]]': 'Leilani' }), '"x y z" (Leilani) and "a b c"');
});

test('section pulls one heading out of a summary', () => {
  assert.equal(section('Hi\n\n## Themes\n\nOne\nTwo\n\n## Growth\n\nG', 'Themes'), 'One\nTwo');
  assert.equal(section('## Growth\n\nG', 'Themes'), '');
});

test('detectLanguage', () => {
  assert.equal(detectLanguage('He aloha nō au i ka ʻāina a me koʻu mau hoa hana.'), 'haw');
  assert.equal(detectLanguage('She always helps with the planting and keeps everyone laughing.'), 'en');
});

test('namesIn finds names, including Hawaiian ones, but not inside other words', () => {
  const md = 'A coworker said Pōmaikaʻi leads the oli. Kai said hi. Kainoa was there.';
  assert.deepEqual(namesIn(md, ['Pōmaikaʻi', 'Kai', 'Lei', 'Kainoa']).sort(), ['Kai', 'Kainoa', 'Pōmaikaʻi']);
  assert.deepEqual(namesIn('The leis were lovely.', ['Lei']), []);
});

test('team drafts retry when they name someone, and flag names that remain', async () => {
  const replies = ['Kainoa keeps everyone steady.', 'A coworker keeps everyone steady.'];
  let calls = 0;
  const { markdown, notes } = await draftSummary({
    input: { ...input(), forbid: ['Kainoa'] },
    templates,
    complete: async () => replies[calls++],
  });
  assert.equal(calls, 2);
  assert.equal(markdown, 'A coworker keeps everyone steady.');
  assert.deepEqual(notes, []);
});
