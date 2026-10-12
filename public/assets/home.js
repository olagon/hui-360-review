import { api, t, initI18n, shell, esc, fmtDate, registerSW, APP_NAME, getLang, setLang, orgLogo } from './app.js';
import { startSync, on } from './idb.js';

registerSW();
await initI18n();
document.title = APP_NAME;
const app = document.getElementById('app');

let me = null;
let error = null;
try {
  me = await api('/api/me');
} catch (e) {
  error = e;
}

// First visit on this phone: use the language admin set for this person.
if (me && !localStorage.getItem('hui360_lang') && me.staff.lang !== getLang()) {
  setLang(me.staff.lang);
  await initI18n();
}
shell({ onLang: me ? (lang) => api('/api/me/lang', { method: 'PUT', json: { lang } }).catch(() => {}) : null });

if (me) {
  // Answers saved on the phone may reach the server after this page loads. Redraw when they do.
  on(async (e) => {
    if (e.type !== 'synced') return;
    try {
      dashboard(await api('/api/me'));
    } catch {}
  });
  startSync((n) => t('sync.pending', { n }));
  dashboard(me);
} else {
  landing(error);
}

function landing(e) {
  const expired = new URLSearchParams(location.search).has('expired');
  app.innerHTML = `${orgLogo()}
    <h1>${esc(t('landing.title'))}</h1>
    <p class="prompt" style="font-size:1.25rem">${esc(t('app.tagline'))}</p>
    ${expired ? `<div class="banner warn">${esc(t('landing.expired'))}</div>` : ''}
    ${e && e.status !== 401 ? `<div class="banner info">${esc(t('landing.offline'))}</div>` : ''}
    <p>${esc(t('landing.body'))}</p>
    <p>${esc(t('landing.howto'))}</p>
    <p class="muted">${esc(t('landing.newlink'))}</p>
    <p class="row"><a class="button secondary" href="/how/">${esc(t('footer.how'))}</a><a class="button secondary" href="/tour/">${esc(t('landing.tour'))}</a></p>
    <p class="small muted" style="margin-top:2rem">${esc(t('landing.adminNote'))} <a href="/admin/">${esc(t('landing.admin'))}</a></p>`;
}

function card(a) {
  const title = a.kind === 'self' ? t('card.self') : a.reviewee;
  const sub = a.kind === 'peer' ? t('card.peerSub') : a.kind === 'upward' ? t('card.upwardSub') : '';
  const pct = a.total ? Math.round((100 * a.answered) / a.total) : 0;
  const quickDone = a.status !== 'done' && a.quick_total && a.quick_answered === a.quick_total && a.answered < a.total;
  const action =
    a.status === 'done'
      ? `<span class="chip done">${esc(t('card.done'))}</span> <a href="/review/?a=${a.id}">${esc(t('card.reopen'))}</a>`
      : `<a class="button" href="/review/?a=${a.id}">${esc(t(a.answered ? 'card.continue' : 'card.start'))}</a>`;
  return `<div class="card">
    <h2 style="margin:0">${esc(title)}</h2>
    ${sub ? `<small>${esc(sub)}</small>` : ''}
    <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
    <div class="row spread small">
      <span>${esc(t('card.progress', { n: a.answered, total: a.total }))}</span>
      ${a.status !== 'done' && a.minutes ? `<span class="muted">${esc(t('card.minutes', { n: a.minutes }))}</span>` : ''}
    </div>
    ${quickDone ? `<p class="small">${esc(t('card.quickDone'))}</p>` : ''}
    <p style="margin:.75rem 0 0">${action}</p>
  </div>`;
}

function dashboard({ staff, cycle, assignments, summaries }) {
  let html = `${orgLogo()}<h1>${esc(t('dash.hello', { name: staff.name }))}</h1>`;
  if (!navigator.onLine) html += `<div class="banner info">${esc(t('dash.offline'))}</div>`;
  if (!cycle) {
    html += `<p>${esc(t('dash.none'))}</p>`;
  } else {
    html += `<div class="banner">${esc(t('dash.closes', { cycle: cycle.name, date: fmtDate(cycle.closes_at) }))}</div>`;
    const quick = assignments.find((a) => a.status !== 'done' && a.quick_answered < a.quick_total);
    if (quick) html += `<p><a class="button secondary" href="/review/?a=${quick.id}&quick=1">${esc(t('dash.quick'))}</a></p>`;
    html += assignments.map(card).join('');
  }
  if (summaries) html += `<p><a href="/me/">${esc(t('dash.summaries'))}</a></p>`;
  app.innerHTML = html;
}
