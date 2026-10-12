import { HttpError, json } from '../lib/http.js';
import { requireStaff, verifyAccess } from '../lib/auth.js';
import * as s from '../lib/staff-api.js';
import * as a from '../lib/admin-api.js';

const PUBLIC = new Set(['/api/config', '/api/logo', '/api/logout']);

const routes = [
  ['GET', '/api/config', s.config],
  ['GET', '/api/logo', s.logo],
  ['POST', '/api/logout', s.logout],
  ['GET', '/api/me', s.me],
  ['PUT', '/api/me/lang', s.setLang],
  ['GET', '/api/assignments/:id', s.assignment],
  ['POST', '/api/assignments/:id/finish', s.finish],
  ['PUT', '/api/answers', s.answer],
  ['POST', '/api/audio', s.audio],
  ['GET', '/api/summaries', s.summaries],
  ['PUT', '/api/summaries/:id/reflection', s.reflection],

  ['GET', '/api/admin/me', a.whoami],
  ['GET', '/api/admin/staff', a.listStaff],
  ['POST', '/api/admin/staff', a.createStaff],
  ['PUT', '/api/admin/staff/:id', a.updateStaff],
  ['GET', '/api/admin/settings', a.getSettings],
  ['PUT', '/api/admin/settings', a.putSettings],
  ['PUT', '/api/admin/logo', a.putLogo],
  ['DELETE', '/api/admin/logo', a.deleteLogo],
  ['GET', '/api/admin/values', a.listValues],
  ['POST', '/api/admin/value-sets', a.createValueSet],
  ['PUT', '/api/admin/value-sets/:id', a.updateValueSet],
  ['POST', '/api/admin/values', a.createValue],
  ['PUT', '/api/admin/values/:id', a.updateValue],
  ['DELETE', '/api/admin/values/:id', a.deleteValue],
  ['GET', '/api/admin/cycles', a.listCycles],
  ['POST', '/api/admin/cycles', a.createCycle],
  ['GET', '/api/admin/cycles/:id', a.getCycle_],
  ['PUT', '/api/admin/cycles/:id', a.updateCycle],
  ['DELETE', '/api/admin/cycles/:id', a.deleteCycle],
  ['POST', '/api/admin/cycles/:id/status', a.setStatus],
  ['POST', '/api/admin/cycles/:id/questions', a.createQuestion],
  ['PUT', '/api/admin/cycles/:id/order', a.orderQuestions],
  ['POST', '/api/admin/cycles/:id/reuse', a.reuseQuestions],
  ['PUT', '/api/admin/cycles/:id/assignments', a.toggleAssignment],
  ['POST', '/api/admin/cycles/:id/autofill', a.autofill],
  ['PUT', '/api/admin/cycles/:id/people', a.setParticipant],
  ['GET', '/api/admin/cycles/:id/team', a.getTeam],
  ['POST', '/api/admin/cycles/:id/team/draft', a.draftTeam],
  ['PUT', '/api/admin/cycles/:id/team', a.saveTeam],
  ['POST', '/api/admin/cycles/:id/team/share', a.shareTeam],
  ['GET', '/api/admin/cycles/:id/links', a.links],
  ['POST', '/api/admin/cycles/:id/links/:staff', a.newLink],
  ['GET', '/api/admin/cycles/:id/people/:staff/raw', a.raw],
  ['GET', '/api/admin/cycles/:id/people/:staff/summary', a.getSummary],
  ['POST', '/api/admin/cycles/:id/people/:staff/draft', a.draft],
  ['POST', '/api/admin/cycles/:id/people/:staff/blank', a.blankSummary],
  ['PUT', '/api/admin/questions/:id', a.updateQuestion],
  ['DELETE', '/api/admin/questions/:id', a.deleteQuestion],
  ['PUT', '/api/admin/summaries/:id', a.saveSummary],
  ['POST', '/api/admin/summaries/:id/share', a.share],
  ['GET', '/api/admin/file', a.file],
  ['POST', '/api/admin/export', a.exportAll],
  ['GET', '/api/admin/exports', a.listExports],
  ['GET', '/api/admin/audit', a.listAudit],
  ['POST', '/api/admin/sample', a.loadSample],
  ['DELETE', '/api/admin/sample', a.removeSample],
];

function match(pattern, path) {
  const p = pattern.split('/');
  const x = path.replace(/\/+$/, '').split('/');
  if (p.length !== x.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(x[i]);
    else if (p[i] !== x[i]) return null;
  }
  return params;
}

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  try {
    const origin = request.headers.get('origin');
    if (request.method !== 'GET' && origin && origin !== url.origin) throw new HttpError(403, 'Cross site request blocked');
    for (const [method, pattern, handler] of routes) {
      if (method !== request.method) continue;
      const params = match(pattern, url.pathname);
      if (!params) continue;
      const extra = pattern.startsWith('/api/admin/')
        ? { admin: await verifyAccess(request, env) }
        : PUBLIC.has(pattern)
          ? {}
          : { staff: await requireStaff(request, env) };
      return await handler({ ...ctx, url, params, ...extra });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on our side' }, 500);
  }
}
