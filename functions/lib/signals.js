// Early signals and reviewer calibration. Pure functions so they test without a model.

export const LABELS = ['burnout', 'unclear_roles', 'safety', 'friction', 'none'];

// One short prompt for a batch of answers. Works on Claude or Llama.
export function signalsPrompt(texts) {
  const system =
    'You sort workplace review answers for a small nonprofit. For each numbered answer, choose one label: ' +
    'burnout (exhaustion, overwork, no rest), unclear_roles (confusion about who does what), safety (physical or emotional safety, harassment), ' +
    'friction (conflict between people), or none. Also rate its tone toward the person from -2 (very critical) to 2 (very warm). ' +
    'Reply with only a JSON array, one object per answer, like [{"label":"none","tone":1}].';
  const user = texts.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n');
  return { system, user };
}

// Returns null when the reply is not one entry per answer, so nothing gets a made up label.
export function parseSignals(text, count) {
  const m = String(text).match(/\[[\s\S]*\]/);
  let arr;
  try {
    arr = JSON.parse(m ? m[0] : 'null');
  } catch {}
  if (!Array.isArray(arr) || arr.length !== count) return null;
  return arr.map((y) => {
    const x = y || {};
    const label = LABELS.includes(x.label) ? x.label : 'none';
    const tone = Math.max(-2, Math.min(2, Math.round(Number(x.tone) || 0)));
    return { label, tone };
  });
}

// rows: [{ reviewer: key, tone }]. A reviewer with 2 or more reviews whose average
// tone sits well above or below the group gets a tag. Never shown to staff.
export function calibrate(rows, { minReviews = 2, threshold = 0.6 } = {}) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.reviewer)) by.set(r.reviewer, { tones: [], reviews: new Set() });
    const x = by.get(r.reviewer);
    x.tones.push(r.tone);
    x.reviews.add(r.review);
  }
  const all = rows.map((r) => r.tone);
  const mean = all.reduce((a, b) => a + b, 0) / (all.length || 1);
  const tags = {};
  for (const [k, x] of by) {
    if (x.reviews.size < minReviews) continue;
    const m = x.tones.reduce((a, b) => a + b, 0) / x.tones.length;
    if (m - mean >= threshold) tags[k] = 'generous';
    else if (mean - m >= threshold) tags[k] = 'critical';
  }
  return tags;
}
