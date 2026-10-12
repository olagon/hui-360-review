import { api, t, initI18n, shell, esc, md, fmtDate, registerSW, $ } from './app.js';

registerSW();
await initI18n();
shell({ signedIn: true, onLang: (lang) => api('/api/me/lang', { method: 'PUT', json: { lang } }).catch(() => {}) });

const app = $('#app');
let list;
let team = [];
try {
  ({ summaries: list, team = [] } = await api('/api/summaries'));
} catch (e) {
  app.innerHTML = `<div class="banner warn">${esc(e.status === 401 ? t('error.login') : t('error.load'))}</div>`;
  throw e;
}

const teamHtml = team
  .map(
    (r) => `<section class="card" id="team">
      <p class="small muted">${esc(r.cycle)} · ${esc(t('me.sharedOn', { date: fmtDate(r.shared_at) }))}</p>
      <h2 style="margin-top:0">${esc(t('me.teamTitle'))}</h2>
      <div class="summary-doc" style="border:0;padding:0">${md(r.body)}</div>
    </section>`,
  )
  .join('');
app.innerHTML =
  `<h1>${esc(t('me.title'))}</h1>` +
  (list.length
    ? list
        .map(
          (s) => `<section class="card">
            <p class="small muted">${esc(s.cycle)} · ${esc(t('me.sharedOn', { date: fmtDate(s.shared_at) }))}</p>
            <div class="summary-doc" style="border:0;padding:0">${md(s.shared_body)}</div>
            <h2>${esc(t('me.reflect'))}</h2>
            <p class="small muted">${esc(t('me.reflectHelp'))}</p>
            <textarea data-id="${s.id}">${esc(s.reflection || '')}</textarea>
            <p class="row"><button type="button" data-save="${s.id}">${esc(t('me.save'))}</button><span class="status small muted" data-status="${s.id}"></span></p>
          </section>`,
        )
        .join('')
    : team.length ? '' : `<p>${esc(t('me.none'))}</p>`) + teamHtml;
if (location.hash === '#team') document.getElementById('team')?.scrollIntoView();

for (const b of app.querySelectorAll('[data-save]')) {
  b.onclick = async () => {
    const id = b.dataset.save;
    const status = $(`[data-status="${id}"]`);
    try {
      await api(`/api/summaries/${id}/reflection`, { method: 'PUT', json: { body: $(`textarea[data-id="${id}"]`).value } });
      status.textContent = t('me.saved');
    } catch {
      status.textContent = t('error.generic');
    }
  };
}
