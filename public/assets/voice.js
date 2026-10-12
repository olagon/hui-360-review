// Community voice: one question about one person, from someone outside the Hui. No account.
import { api, t, initI18n, shell, esc, orgLogo, pressing, $ } from './app.js';

await initI18n();
shell();
const app = $('#app');
const token = new URLSearchParams(location.search).get('t') || '';
const done = (msg) => (app.innerHTML = `${orgLogo()}<div class="card"><p style="margin:0">${esc(msg)}</p></div>`);

try {
  const v = await api(`/api/voice/${encodeURIComponent(token)}`);
  const vars = { name: v.person, hui: v.hui };
  if (v.answered) done(t('voice.used'));
  else if (!v.open) done(t('voice.closed'));
  else {
    app.innerHTML = `${orgLogo()}<h1>${esc(t('voice.title', vars))}</h1>
      <p class="prompt">${esc(v.question)}</p>
      <textarea id="answer" rows="8" aria-label="${esc(v.question)}"></textarea>
      <label for="who" style="margin-top:1rem">${esc(t('voice.who', vars))}</label>
      <input id="who" autocomplete="name">
      <p class="small muted">${esc(t('voice.help', vars))}</p>
      <p><button type="button" id="send">${esc(t('voice.send'))}</button></p>`;
    $('#send').onclick = () =>
      pressing($('#send'), async () => {
        try {
          await api(`/api/voice/${encodeURIComponent(token)}`, { method: 'POST', json: { response: $('#answer').value, who: $('#who').value } });
          done(t('voice.thanks', vars));
        } catch (e) {
          alert(e.message);
        }
      });
  }
} catch (e) {
  done(e.message || t('error.load'));
}
