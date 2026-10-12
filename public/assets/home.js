import { api, t, initI18n, shell, esc, fmtDate, registerSW, APP_NAME, getLang, setLang, orgLogo, config, pressing, adminStatus, openMyReviews, $ } from './app.js';
import { startSync, on } from './idb.js';
import { moonFor, moonIcon, hawaiiToday } from './moon.js';

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
if (me && config.hawaiian && !localStorage.getItem('hui360_lang') && me.staff.lang !== getLang()) {
  setLang(me.staff.lang);
  await initI18n();
}
shell({ signedIn: !!me, onLang: me ? (lang) => api('/api/me/lang', { method: 'PUT', json: { lang } }).catch(() => {}) : null });

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
    ${config.email ? `<form id="req" class="card">
      <p style="margin-top:0">${esc(t('landing.newlink'))}</p>
      <label for="contact">${esc(t('landing.requestLabel'))}</label>
      <input id="contact" autocomplete="email" required>
      <p style="margin-bottom:0"><button>${esc(t('landing.requestButton'))}</button></p>
    </form>` : `<p class="muted">${esc(t('landing.askDirector'))}</p>`}
    <p class="row"><a class="button secondary" href="/how/">${esc(t('footer.how'))}</a><a class="button secondary" href="/tour/">${esc(t('landing.tour'))}</a></p>
    ${adminSide(false)}
    <section class="card" id="adminblock" style="margin-top:1.5rem">
      <h2 style="margin-top:0">${esc(t('landing.adminTitle'))}</h2>
      <p>${esc(t('landing.adminBody'))}</p>
      <p style="margin-bottom:0"><a class="button" href="/admin/">${esc(t('landing.admin'))}</a></p>
    </section>`;
  // Already signed in as an admin: say so, and go straight there.
  adminStatus().then((s) => {
    if (!s.admin) return;
    $('#adminblock').innerHTML = `<h2 style="margin-top:0">${esc(t('landing.adminIn'))}</h2><p class="small muted">${esc(s.email || '')}</p>
      ${s.staff ? `<p>${esc(t('landing.adminAlsoStaff'))}</p>` : ''}
      <p class="row" style="margin-bottom:0">${s.staff ? `<button type="button" id="mine">${esc(t('landing.myReviews'))}</button>` : ''}<a class="button ${s.staff ? 'secondary' : ''}" href="/admin/">${esc(t('landing.toAdmin'))}</a></p>`;
    $('#mine')?.addEventListener('click', (e) => pressing(e.currentTarget, openMyReviews));
    $('#adminblock').scrollIntoView({ block: 'nearest' });
  });
  const req = document.getElementById('req');
  if (req) req.onsubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    let msg;
    await pressing(form.querySelector('button'), async () => {
      try {
        const r = await api('/api/request-link', { method: 'POST', json: { contact: form.contact.value } });
        msg = t(r.manual ? 'landing.requestManual' : 'landing.requestSent');
      } catch (err) {
        msg = err.message;
      }
    });
    form.innerHTML = `<p style="margin:0">${esc(msg)}</p>`;
  };
}

// The admin side, open to everyone: how reviews are run, what the director sees and does.
function adminSide(compact) {
  return `<section class="card" style="margin-top:${compact ? '2rem' : '1.5rem'}">
    <h2 style="margin-top:0">${esc(t('open.title'))}</h2>
    <p>${esc(t('open.body'))}</p>
    <p class="row" style="margin-bottom:0"><a class="button ${compact ? 'secondary' : ''}" href="/tour/admin/">${esc(t('open.video'))}</a><a class="button secondary" href="/guide/">${esc(t('open.guide'))}</a></p>
  </section>`;
}

function moon() {
  if (!config.moon) return '';
  const m = moonFor(hawaiiToday());
  return ` <span class="moon" title="${esc(t('moon.note'))}">${moonIcon(m.age)} ${esc(t('moon.tonight', { name: m.name }))}</span>`;
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

function dashboard({ staff, cycle, assignments, summaries, team, asks }) {
  let html = `${orgLogo()}<h1>${esc(t('dash.hello', { name: staff.name }))}</h1>`;
  if (!navigator.onLine) html += `<div class="banner info">${esc(t('dash.offline'))}</div>`;
  if (!cycle) {
    html += `<p>${esc(t('dash.none'))}</p>${config.moon ? `<p class="small muted">${moon()}</p>` : ''}`;
  } else {
    html += `<div class="banner">${esc(t('dash.closes', { cycle: cycle.name, date: fmtDate(cycle.closes_at) }))}${moon()}</div>`;
    const quick = assignments.find((a) => a.status !== 'done' && a.quick_answered < a.quick_total);
    if (quick) html += `<p><a class="button secondary" href="/review/?a=${quick.id}&quick=1">${esc(t('dash.quick'))}</a></p>`;
    html += assignments.map(card).join('');
  }
  if (team) {
    html = html.replace('</h1>', `</h1><div class="card"><h2 style="margin-top:0">${esc(t('dash.teamTitle'))}</h2>
      <p>${esc(t('dash.teamBody'))}</p><p style="margin-bottom:0"><a class="button secondary" href="/me/#team">${esc(t('dash.teamButton'))}</a></p></div>`);
  }
  if (asks) {
    html = html.replace('</h1>', `</h1><div class="card" style="border-color:var(--kalo)"><h2 style="margin-top:0">${esc(t('dash.asksTitle'))}</h2>
      <p>${esc(t('dash.asksBody'))}</p><p style="margin-bottom:0"><a class="button" href="/me/#feedback">${esc(t('dash.asksButton'))}</a></p></div>`);
  }
  if (summaries) {
    html = html.replace('</h1>', `</h1><div class="card" style="border-color:var(--kalo)"><h2 style="margin-top:0">${esc(t('dash.letterTitle'))}</h2>
      <p>${esc(t('dash.letterBody'))}</p><p style="margin-bottom:0"><a class="button" href="/me/">${esc(t('dash.letterButton'))}</a></p></div>`);
  }
  html += `<p class="small muted" style="margin-top:2rem">${esc(t('dash.links'))} <a href="/me/">${esc(t('nav.me'))}</a></p>` + adminSide(true);
  app.innerHTML = html;
  // Also an admin: a quiet way across, on top of the Admin link in the header.
  adminStatus().then((s) => {
    if (s.admin) app.insertAdjacentHTML('afterbegin', `<p class="banner info small no-print">${esc(t('dash.alsoAdmin'))} <a href="/admin/">${esc(t('landing.toAdmin'))}</a></p>`);
  });
}
