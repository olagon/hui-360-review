import { api, t, initI18n, shell, esc, registerSW, $ } from './app.js';

registerSW();
await initI18n();
shell({ signedIn: true, onLang: (lang) => api('/api/me/lang', { method: 'PUT', json: { lang } }).catch(() => {}) });

const app = $('#app');
try {
  const { people } = await api('/api/kuleana');
  const byId = Object.fromEntries(people.map((p) => [p.id, p.preferred_name || p.name]));
  const teams = [...new Set(people.map((p) => p.team || ''))];
  app.innerHTML = `<h1>${esc(t('kuleana.title'))}</h1><p class="muted">${esc(t('kuleana.help'))}</p>` +
    teams.map((team) => `${team ? `<h2>${esc(team)}</h2>` : ''}<div class="kgrid">${people.filter((p) => (p.team || '') === team).map((p) => `<div class="card" style="margin:0">
      <h3 style="margin:0">${esc(p.preferred_name || p.name)}</h3>
      ${p.title ? `<p class="small muted" style="margin:.2rem 0 .6rem">${esc(p.title)}</p>` : ''}
      ${p.responsibilities ? `<p style="white-space:pre-line;margin:.4rem 0">${esc(p.responsibilities)}</p>` : ''}
      ${p.works_with.length ? `<p class="small" style="margin:.6rem 0 0"><span class="muted">${esc(t('kuleana.works'))}:</span> ${p.works_with.map((id) => esc(byId[id])).filter(Boolean).join(', ')}</p>` : ''}
    </div>`).join('')}</div>`).join('');
} catch (e) {
  app.innerHTML = `<div class="banner warn">${esc(e.status === 401 ? t('error.login') : t('error.load'))}</div>`;
}
