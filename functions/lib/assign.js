// The only bridge between an assignment and the responses written for it.
// Without HASH_PEPPER (a Worker secret, never in D1) nobody can recompute it.
export async function assignmentHash(assignmentId, pepper, cycleId) {
  if (!pepper) throw new Error('HASH_PEPPER is not set');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${assignmentId}:${pepper}:${cycleId}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Suggest peer pairs. Avoids last cycle's pairs and spreads the load.
// Only adds; never removes what admin set.
// ponytail: greedy, fine for a Hui of 20 to 60 people.
export function autoFill({ staffIds, existing = [], lastPairs = new Set(), target = 2 }) {
  const pairs = new Set(existing.map((p) => `${p.reviewer}:${p.reviewee}`));
  const given = new Map(staffIds.map((id) => [id, 0]));
  const got = new Map(staffIds.map((id) => [id, 0]));
  for (const p of existing) {
    if (given.has(p.reviewer)) given.set(p.reviewer, given.get(p.reviewer) + 1);
    if (got.has(p.reviewee)) got.set(p.reviewee, got.get(p.reviewee) + 1);
  }
  const added = [];

  for (const cap of [target, 3]) {
    const order = [...staffIds].sort((a, b) => got.get(a) - got.get(b) || Math.random() - 0.5);
    for (const reviewee of order) {
      while (got.get(reviewee) < target) {
        const pick = staffIds
          .filter((r) => r !== reviewee && !pairs.has(`${r}:${reviewee}`) && given.get(r) < cap)
          .map((r) => ({
            r,
            score: -(lastPairs.has(`${r}:${reviewee}`) ? 3 : 0) - given.get(r) + Math.random() * 0.5,
          }))
          .sort((a, b) => b.score - a.score)[0];
        if (!pick) break;
        pairs.add(`${pick.r}:${reviewee}`);
        given.set(pick.r, given.get(pick.r) + 1);
        got.set(reviewee, got.get(reviewee) + 1);
        added.push({ reviewer: pick.r, reviewee });
      }
    }
  }
  return added;
}
