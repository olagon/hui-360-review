// Pure functions: plain data in, text out. The network call is passed in as
// `complete(system, user)` so all of this runs in tests without a model.

export const BANNED = ['leverage', 'synergy', 'synergies', 'stakeholder', 'impactful', 'circle back'];
export const MAX_WORDS = 900;

const MIN_QUOTE_WORDS = 3;
const wordCount = (s) => (s.match(/\S+/g) || []).length;

// Matching ignores case, spacing, curly vs straight quotes, and ʻokina vs apostrophe.
export const norm = (s) =>
  s.normalize('NFC').toLowerCase().replace(/[ʻ‘’`´']/g, "'").replace(/[“”„"]/g, '"').replace(/\s+/g, ' ').trim();

const trimPunct = (s) => s.replace(/^[\s.,;:!?'"()-]+|[\s.,;:!?'"()-]+$/g, '');

export function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

// Turn database rows into what the model is allowed to see: the text, the question,
// the audience, and an anonymous letter so it can count distinct reviewers.
// rows: { prompt, audience, body, signed_name, reviewer_key }
export function stripIdentity(rows) {
  const keys = [...new Set(rows.filter((r) => r.audience !== 'self').map((r) => r.reviewer_key))].sort(() => Math.random() - 0.5);
  const letter = new Map(keys.map((k, i) => [k, i < 26 ? String.fromCharCode(65 + i) : `R${i + 1}`]));
  const signers = {};
  const responses = rows
    .filter((r) => r.body && r.body.trim())
    .map((r) => {
      let signed = null;
      if (r.signed_name) {
        signed = `[[signer${Object.keys(signers).length + 1}]]`;
        signers[signed] = r.signed_name;
      }
      return { question: r.prompt, audience: r.audience, text: r.body.trim(), reviewer: r.audience === 'self' ? 'self' : letter.get(r.reviewer_key), signed };
    });
  return { responses, signers };
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const text = (s) => String(s).replace(/</g, '&lt;');

export function formatValues(values) {
  return values
    .map((v) => {
      const proverb = v.olelo_noeau ? ` ʻŌlelo noʻeau: "${v.olelo_noeau}" (${v.olelo_noeau_meaning || ''})` : '';
      return `- ${v.name_haw}${v.name_en ? ` (${v.name_en})` : ''}.${proverb} Looks like: ${v.description || ''}`;
    })
    .join('\n');
}

// Settings, About your organization. Read by AI as a frame, never quoted.
export function formatOrg(org = {}) {
  const parts = [['About', org.about], ['Mission', org.mission], ['Vision', org.vision], ['Goals', org.goals]].filter(([, v]) => v?.trim());
  return parts.map(([k, v]) => `${k}: ${text(v.trim())}`).join('\n\n') || 'None given.';
}

// The person's title and position description (their kuleana), from People.
export function formatPosition(p) {
  return [p?.title?.trim() && `Title: ${text(p.title.trim())}`, p?.responsibilities?.trim() && text(p.responsibilities.trim())].filter(Boolean).join('\n\n') || 'None given.';
}

export function formatResponses(responses) {
  const groups = new Map();
  for (const r of responses) {
    const k = `${r.audience}\u0000${r.question}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()]
    .map((rs) => {
      const items = rs.map((r) => `<response reviewer="${r.reviewer}"${r.signed ? ` signed_by="${r.signed}"` : ''}>${text(r.text)}</response>`);
      return `<question audience="${rs[0].audience}" text="${attr(rs[0].question)}">\n${items.join('\n')}\n</question>`;
    })
    .join('\n\n');
}

export function summaryPrompt(input, templates) {
  const vars = {
    hui_name: input.huiName || 'the Hui',
    director: input.director || 'the director',
    name: input.name,
    cycle: input.cycle,
    language_note:
      input.lang === 'en'
        ? 'Language: this person reads English only. After a Hawaiian quote you may add a short English gloss in square brackets after the closing quotation mark, only if you are sure of the meaning.'
        : 'Language: this person reads Hawaiian. Do not add English glosses.',
    values: formatValues(input.values || []),
    org: formatOrg(input.org),
    position: formatPosition(input.position),
    goals_word: input.goalsWord || 'goals',
    responses: formatResponses(input.responses),
    last_year: input.lastYear || 'None.',
    facts: input.facts || '',
  };
  return { system: renderPrompt(templates.system, vars), user: renderPrompt(templates.user, vars) };
}

// Every "double quoted" run of 3+ words, plus blockquote lines written without quote marks.
export function extractQuotes(md) {
  const quotes = [...md.matchAll(/["“]([^"“”\n]+)["”]/g)].map((m) => m[1]);
  for (const m of md.matchAll(/^>\s*(.+)$/gm)) {
    if (!/["“”]/.test(m[1])) quotes.push(m[1].replace(/\s+[-\u2013\u2014]\s+.*$|\s*\((?:from|said)\b[^)]*\)\s*$/i, ''));
  }
  return quotes.filter((q) => wordCount(q.replace(/\[[^\]]*\]/g, '')) >= MIN_QUOTE_WORDS);
}

// A quote passes if its words, minus [bracketed] replacements and "..." cuts,
// appear in order inside a single source text.
export function quoteMatches(quote, sources) {
  const segs = quote
    .split(/\[[^\]]*\]|\.{3}|…/)
    .map((s) => trimPunct(norm(s)))
    .filter(Boolean);
  if (!segs.length) return true;
  return sources.some((src) => {
    let i = 0;
    for (const seg of segs) {
      const j = src.indexOf(seg, i);
      if (j < 0) return false;
      i = j + seg.length;
    }
    return true;
  });
}

export function verifyQuotes(md, sourceTexts) {
  const sources = sourceTexts.filter(Boolean).map(norm);
  return extractQuotes(md).filter((q) => !quoteMatches(q, sources));
}

// Remove the sentence (or blockquote line) that carries each bad quote.
export function dropQuotes(md, bad) {
  let lines = md.split('\n');
  for (const q of bad) {
    lines = lines.flatMap((line) => {
      const i = line.indexOf(q);
      if (i < 0) return [line];
      if (/^\s*>/.test(line)) return [];
      const before = line.slice(0, i);
      const starts = [...before.matchAll(/[.!?]["”)]?\s+/g)];
      const s = starts.length ? starts.at(-1).index + starts.at(-1)[0].length : 0;
      const after = line.slice(i + q.length);
      const end = /[.!?]$/.test(q) && /^["”]/.test(after) ? after.match(/^["”][)]?\s*/) : after.match(/[.!?]["”)]?(\s+|$)/);
      const e = end ? i + q.length + end.index + end[0].length : line.length;
      const out = (line.slice(0, s) + line.slice(e)).trim();
      return out ? [out] : [];
    });
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function cleanText(md) {
  return md
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/m, '$1')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\u2013/g, '-')
    .trim();
}

// Names that must not appear, like everyone in the review for the team report.
export function namesIn(md, names = []) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...new Set(names.filter((n) => n && n.length > 1 && new RegExp(`(^|[^\\p{L}ʻ])${esc(n)}($|[^\\p{L}ʻ])`, 'iu').test(md)))];
}

export function lint(md, signers = {}, forbid = []) {
  const problems = [];
  const named = namesIn(md, forbid);
  if (named.length) problems.push(`It names people: ${named.join(', ')}. Say "a coworker" instead.`);
  const lower = md.toLowerCase();
  const banned = BANNED.filter((w) => lower.includes(w));
  if (banned.length) problems.push(`It uses words to avoid: ${banned.join(', ')}.`);
  if (wordCount(md) > MAX_WORDS) problems.push(`It is ${wordCount(md)} words. Keep it under ${MAX_WORDS}.`);
  if (/\b[Rr]eviewers? [A-Z]\b/.test(md)) problems.push('It mentions reviewer letters. Never name or label reviewers.');
  const unknown = [...md.matchAll(/\[\[signer\d+\]\]/g)].map((m) => m[0]).filter((t) => !signers[t]);
  if (unknown.length) problems.push(`It uses signer tokens that do not exist: ${[...new Set(unknown)].join(', ')}.`);
  return problems;
}

export function restoreSigners(md, signers) {
  return md.replace(/\s*\(?\[\[signer\d+\]\]\)?/g, (m) => {
    const token = m.match(/\[\[signer\d+\]\]/)[0];
    return signers[token] ? m.replace(token, signers[token]) : '';
  });
}

// Generate, check, retry once with the problems listed, then drop whatever quotes still fail.
export async function draftSummary({ input, templates, complete }) {
  const { system, user } = summaryPrompt(input, templates);
  const sources = [
    ...input.responses.map((r) => r.text),
    ...input.responses.map((r) => r.question),
    ...(input.values || []).flatMap((v) => [v.olelo_noeau, v.olelo_noeau_meaning]),
  ];
  const check = (md) => {
    const bad = verifyQuotes(md, sources);
    const problems = lint(md, input.signers, input.forbid);
    if (bad.length) problems.unshift(`These quotes are not word for word from any response: ${bad.map((q) => `"${q}"`).join('; ')}.`);
    return { bad, problems };
  };

  let md = cleanText(await complete(system, user));
  let result = check(md);
  if (result.problems.length) {
    const retry = renderPrompt(templates.fix, { original: user, draft: md, problems: result.problems.map((p) => `- ${p}`).join('\n') });
    md = cleanText(await complete(system, retry));
    result = check(md);
  }

  const notes = [];
  if (result.bad.length) {
    md = dropQuotes(md, result.bad);
    notes.push(`Removed ${result.bad.length} quote${result.bad.length > 1 ? 's' : ''} that did not match any response word for word.`);
  }
  notes.push(...lint(md, input.signers, input.forbid).filter((p) => !p.startsWith('It uses signer')));
  return { markdown: restoreSigners(md, input.signers || {}), notes };
}

export function section(md, heading) {
  const m = (md || '').match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  return m ? m[1].trim() : '';
}

// Rough guess for display and for the summarizer: mostly Hawaiian letters means Hawaiian.
export function detectLanguage(s) {
  const words = (s || '').toLowerCase().match(/[\p{L}ʻ'’]+/gu) || [];
  if (words.length < 3) return null;
  const haw = words.filter((w) => /^[aeiouāēīōūhklmnpwʻ'’]+$/u.test(w)).length / words.length;
  if (haw > 0.8) return 'haw';
  if (haw > 0.55 && /[ʻāēīōū]/.test(s)) return 'mixed';
  return 'en';
}

// A letter draft with no AI: every answer about the person, word for word, grouped for the director to rewrite.
export function answersDraft(name, hui, groups) {
  const sections = [
    ['self', `In ${name}'s own words`],
    ['peer', 'What coworkers said'],
    ['upward', 'What the team said about their leadership'],
    ['community', `From outside ${hui}`],
    ['mahalo', 'Mahalo during the year'],
    ['feedback', `Feedback ${name} asked for`],
  ];
  const answer = (r) => {
    const by = r.signed_name ? ` (from ${r.signed_name})` : r.who ? ` (${r.who})` : '';
    const words = (r.body || '').trim().replace(/\s*\n+\s*/g, ' ');
    return words ? `> ${words}${by}` : r.audio_key ? '> (A voice answer with no text. Listen to it in Raw.)' : '';
  };
  return sections
    .map(([audience, title]) => {
      const gs = groups.filter((g) => g.audience === audience);
      if (!gs.length) return '';
      const parts = gs.map((g) => {
        const answers = g.responses.map(answer).filter(Boolean);
        if (!answers.length) return '';
        const heading = audience === 'mahalo' ? '' : `### ${g.prompt.replace(/^Feedback they asked for: /, '')}\n\n`;
        return heading + answers.join('\n\n');
      });
      return [`## ${title}`, ...parts.filter(Boolean)].join('\n\n');
    })
    .filter((s) => s.includes('> '))
    .join('\n\n');
}
