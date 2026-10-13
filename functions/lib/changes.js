// Settings, Ask for a change. Temporary, for finishing this build.
// An admin describes a change. The app opens a GitHub issue and labels it app-request, and
// .github/workflows/app-request.yml runs Claude Code on its own branch. CI tests that branch.
// Approve merges it into main, and CI deploys main. Nothing reaches staff before Approve.
// To remove: this file, its routes, the Settings section, the workflow, and "App requests" in CLAUDE.md.
// The change_requests table stays, so the log stays in exports.
import { HttpError, json, body, audit } from './http.js';

const OPEN = ['asked', 'working', 'testing', 'ready', 'failed', 'no_change'];

async function gh(env, path, { method = 'GET', data, allow = [] } = {}) {
  const r = await fetch(`https://api.github.com/repos/${env.CHANGES_REPO}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.CHANGES_GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'hui-360',
      ...(data ? { 'content-type': 'application/json' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok && !allow.includes(r.status)) throw new HttpError(502, `GitHub answered ${r.status}. If this keeps happening, the GitHub token may have expired.`);
  return r.status === 204 ? {} : r.ok ? r.json() : null;
}

// Claude keeps one progress comment on the issue. Read where it stands from that comment.
// Its summary starts "For the director:" (see App requests in CLAUDE.md).
export function readTracking(text = '') {
  return {
    error: /encountered an error/i.test(text),
    done: /Claude finished/i.test(text),
    summary: text.match(/For the director:[ \t]*([^\n]+)/)?.[1]?.trim() || null, // one paragraph, one line; links follow it
    branch: text.match(/\/tree\/(claude\/[^\s)"'`\]]+)/)?.[1] || null,
  };
}

async function refresh(env, row) {
  const comments = (await gh(env, `/issues/${row.issue}/comments?per_page=100`)) || [];
  const t = readTracking(comments.findLast((c) => c.user?.login === 'claude[bot]')?.body);
  let next = { status: 'working', summary: t.summary, branch: t.branch };
  if (t.error) next.status = 'failed';
  else if (t.done || t.summary) {
    const ref = t.branch
      ? await gh(env, `/git/ref/heads/${t.branch}`, { allow: [404] })
      : ((await gh(env, `/git/matching-refs/heads/claude/issue-${row.issue}-`)) || [])[0];
    if (!ref) next.status = 'no_change';
    else {
      next.branch = ref.ref.replace('refs/heads/', '');
      const ci = ((await gh(env, `/actions/runs?head_sha=${ref.object.sha}`))?.workflow_runs || []).find((w) => w.name === 'test and deploy');
      next.status = ci?.status !== 'completed' ? 'testing' : ci.conclusion === 'success' ? 'ready' : 'failed';
    }
  }
  next = { ...next, summary: next.summary || row.summary, branch: next.branch || row.branch };
  await env.DB.prepare('UPDATE change_requests SET status = ?, summary = ?, branch = ? WHERE id = ?').bind(next.status, next.summary, next.branch, row.id).run();
  return { ...row, ...next };
}

export async function listChanges({ env }) {
  const on = !!(env.CHANGES_GITHUB_TOKEN && env.CHANGES_REPO);
  const rows = (await env.DB.prepare('SELECT * FROM change_requests ORDER BY id DESC LIMIT 50').all()).results;
  const changes = await Promise.all(rows.map((r) => (on && r.issue && OPEN.includes(r.status) ? refresh(env, r) : r)));
  return json({ on, repo: env.CHANGES_REPO, changes });
}

export async function askChange({ env, request, admin }) {
  if (!env.CHANGES_GITHUB_TOKEN || !env.CHANGES_REPO) throw new HttpError(409, 'Asking for changes is not set up on this app.');
  const text = String((await body(request)).request || '').trim();
  if (text.length < 10) throw new HttpError(400, 'Say a little more about the change you want.');
  if (text.length > 4000) throw new HttpError(400, 'Keep it under about a page. Ask for one change at a time.');
  // One at a time, so changes never collide and each one is decided before the next.
  const open = await env.DB.prepare(`SELECT id FROM change_requests WHERE status IN (${OPEN.map(() => '?').join(', ')}) LIMIT 1`).bind(...OPEN).first();
  if (open) throw new HttpError(409, 'Approve or decline the last change first.');
  const { meta } = await env.DB.prepare('INSERT INTO change_requests (asked_by, request) VALUES (?, ?)').bind(admin, text).run();
  const id = meta.last_row_id;
  const title = text.split('\n')[0].slice(0, 70);
  const issue = await gh(env, '/issues', {
    method: 'POST',
    data: { title: `App request: ${title}${title.length < text.split('\n')[0].length ? '...' : ''}`, body: `${text}\n\n---\nApp request ${id}, asked from the admin page. Follow "App requests" in CLAUDE.md.` },
  });
  // A separate call, so GitHub always sends the labeled event that starts the workflow.
  await gh(env, `/issues/${issue.number}/labels`, { method: 'POST', data: { labels: ['app-request'] } });
  await env.DB.prepare("UPDATE change_requests SET issue = ?, status = 'working' WHERE id = ?").bind(issue.number, id).run();
  await audit(env, admin, 'change_asked', `request:${id} issue:${issue.number}`);
  return json({ ok: true, id });
}

const getRow = async (env, id) => {
  const row = await env.DB.prepare('SELECT * FROM change_requests WHERE id = ?').bind(Number(id)).first();
  if (!row) throw new HttpError(404, 'Not found');
  return row;
};

async function finish(env, row, admin, status, note) {
  await gh(env, `/issues/${row.issue}/comments`, { method: 'POST', data: { body: note } });
  await gh(env, `/issues/${row.issue}`, { method: 'PATCH', data: { state: 'closed', state_reason: status === 'approved' ? 'completed' : 'not_planned' } });
  if (row.branch) await gh(env, `/git/refs/heads/${row.branch}`, { method: 'DELETE', allow: [404, 422] });
  await env.DB.prepare("UPDATE change_requests SET status = ?, version = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").bind(status, row.version || null, admin, row.id).run();
  await audit(env, admin, `change_${status}`, `request:${row.id} issue:${row.issue}`);
}

export async function approveChange({ env, params, admin }) {
  const row = await refresh(env, await getRow(env, params.id));
  if (row.status !== 'ready') throw new HttpError(409, 'This change is not ready to approve yet.');
  const file = await gh(env, `/contents/public/assets/app.js?ref=${encodeURIComponent(row.branch)}`);
  row.version = atob(file.content.replace(/\n/g, '')).match(/VERSION = '([^']+)'/)?.[1];
  const merged = await gh(env, '/merges', { method: 'POST', data: { base: 'main', head: row.branch, commit_message: `App request ${row.id}: ${row.request.split('\n')[0].slice(0, 60)}\n\nApproved in the app.` }, allow: [409] });
  if (merged === null) throw new HttpError(409, 'This change clashes with another change made since. Decline it and ask again.');
  await finish(env, row, admin, 'approved', `Approved in the app${row.version ? ` as version ${row.version}` : ''}. It deploys once the tests pass on main.`);
  return json({ ok: true, version: row.version });
}

export async function declineChange({ env, params, admin }) {
  const row = await getRow(env, params.id);
  if (!OPEN.includes(row.status)) throw new HttpError(409, 'This change was already decided.');
  await finish(env, row, admin, 'declined', 'Declined in the app. Nothing was changed.');
  return json({ ok: true });
}
