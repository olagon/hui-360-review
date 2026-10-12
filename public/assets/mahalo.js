import { api, t, initI18n, shell, esc, fmtDate, registerSW, $ } from './app.js';

registerSW();
await initI18n();
shell({ signedIn: true, onLang: (lang) => api('/api/me/lang', { method: 'PUT', json: { lang } }).catch(() => {}) });

// A kalo leaf, the only mark mahalo gets. No likes, no comments.
const leaf = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c-5-2-8-6-8-11 3 0 6 1 8 4 2-3 5-4 8-4 0 5-3 9-8 11z" fill="none" stroke="var(--kalo)" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 21V12" stroke="var(--kalo)" stroke-width="1.6"/></svg>`;
const app = $('#app');
try {
  const { mahalo } = await api('/api/mahalo/board');
  app.innerHTML = `<h1>${leaf} ${esc(t('mahalo.board'))}</h1>
    <p class="muted">${esc(t('mahalo.boardHelp'))} <a href="/me/#mahalo">${esc(t('mahalo.send'))}</a></p>
    ${mahalo.length ? mahalo.map((m) => `<div class="card mahalo-card">
      <p class="small muted" style="margin-top:0"><strong style="color:var(--ink)">${esc(t('mahalo.to.line', { name: m.to }))}</strong></p>
      <p>${esc(m.body)}</p>
      <p class="small muted" style="margin:0">${esc(m.from ? t('mahalo.from', { name: m.from }) : t('mahalo.anon'))} · ${esc(fmtDate(m.created_at))}</p>
    </div>`).join('') : `<p>${esc(t('mahalo.boardEmpty'))}</p>`}`;
} catch (e) {
  app.innerHTML = `<div class="banner warn">${esc(e.status === 401 ? t('error.login') : t('error.load'))}</div>`;
}
