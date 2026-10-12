import { api, t, initI18n, shell, esc, md, fmtDate, registerSW, copy, toast, $, $$ } from './app.js';

registerSW();
await initI18n();
shell({ signedIn: true, onLang: (lang) => api('/api/me/lang', { method: 'PUT', json: { lang } }).catch(() => {}) });

const app = $('#app');
const get = (path) => api(path).catch((e) => (e.status === 401 ? Promise.reject(e) : null));
let data;
try {
  const [letters, goals, mahalo, feedback, people, me] = await Promise.all(
    ['/api/summaries', '/api/goals', '/api/mahalo/mine', '/api/feedback', '/api/people', '/api/me'].map(get),
  );
  const lead = me?.lead ? await get('/api/team-letters') : null;
  data = { letters, goals, mahalo, feedback, people: people?.people || [], lead };
} catch (e) {
  app.innerHTML = `<div class="banner warn">${esc(e.status === 401 ? t('error.login') : t('error.load'))}</div>`;
  throw e;
}

const name = (p) => p.preferred_name || p.name;
const pick = (id) => `<select id="${id}"><option value="">${esc(t('mahalo.pick'))}</option>${data.people.map((p) => `<option value="${p.id}">${esc(name(p))}</option>`).join('')}</select>`;
const doc = (body) => `<div class="summary-doc" style="border:0;padding:0">${md(body)}</div>`;
const when = (r) => `<p class="small muted">${esc(r.cycle)} · ${esc(t('me.sharedOn', { date: fmtDate(r.shared_at) }))}</p>`;

// The bold theme names under "## Themes" in a shared letter.
const themes = (body = '') => [...(body.split(/^## Themes\s*$/m)[1]?.split(/^## /m)[0] ?? '').matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].replace(/[.:]$/, ''));

function letters() {
  const { summaries = [], team = [] } = data.letters || {};
  if (!summaries.length && !team.length) return `<p>${esc(t('me.none'))}</p>`;
  return (
    summaries
      .map(
        (s) => `<section class="card">${when(s)}${doc(s.shared_body)}
          <h3>${esc(t('me.reflect'))}</h3>
          <p class="small muted">${esc(t('me.reflectHelp'))}</p>
          <textarea data-id="${s.id}">${esc(s.reflection || '')}</textarea>
          <p class="row"><button type="button" data-save="${s.id}">${esc(t('me.save'))}</button><span class="status small muted" data-status="${s.id}"></span></p>
        </section>`,
      )
      .join('') +
    team.map((r) => `<section class="card" id="team">${when(r)}<h3 style="margin-top:0">${esc(t('me.teamTitle'))}</h3>${doc(r.body)}</section>`).join('')
  );
}

function goals() {
  const list = data.goals?.goals || [];
  const row = (g) => `<div class="list-item">
    <p style="margin:0 0 .4rem">${esc(g.body)}</p>
    <div class="row small">${g.cycle ? `<span class="muted">${esc(g.cycle)}</span>` : ''}
      <select data-goal="${g.id}" style="width:auto;min-height:36px" aria-label="${esc(t('goals.status.open'))}">
        ${['open', 'met', 'carried', 'dropped'].map((s) => `<option value="${s}" ${s === g.status ? 'selected' : ''}>${esc(t(`goals.status.${s}`))}</option>`).join('')}
      </select>
      <a href="#" data-drop-goal="${g.id}">${esc(t('goals.delete'))}</a></div>
  </div>`;
  const open = list.filter((g) => g.status === 'open');
  const past = list.filter((g) => g.status !== 'open');
  return `<p class="muted">${esc(t('goals.help'))}</p>
    <div class="card">${open.length ? open.map(row).join('') : `<p class="muted" style="margin:0">${esc(t('goals.none'))}</p>`}</div>
    <textarea id="goal-new" class="short" placeholder="${esc(t('goals.placeholder'))}"></textarea>
    <p><button type="button" id="goal-add">${esc(t('goals.add'))}</button></p>
    ${past.length ? `<h3>${esc(t('goals.past'))}</h3><div class="card">${past.map(row).join('')}</div>` : ''}`;
}

function timeline() {
  const rows = (data.letters?.summaries || []).map((s) => {
    const list = themes(s.shared_body);
    return `<div class="list-item"><strong>${esc(s.cycle)}</strong>${list.length ? `<ul style="margin:.3rem 0 0">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
  });
  return `<p class="muted">${esc(t('timeline.help'))}</p>${rows.length ? `<div class="card">${rows.join('')}</div>` : `<p>${esc(t('timeline.none'))}</p>`}`;
}

function mahalo() {
  const { received = [], sent = [], signed = [] } = data.mahalo || {};
  const items = [
    ...signed.map((m) => `<div class="card mahalo-card"><p style="margin-top:0">${esc(m.body)}</p><p class="small muted" style="margin:0">${esc(t('mahalo.fromReview', { cycle: m.cycle, name: m.from }))}</p></div>`),
    ...received.map((m) => `<div class="card mahalo-card"><p style="margin-top:0">${esc(m.body)}</p><p class="small muted" style="margin:0">${esc(m.from ? t('mahalo.from', { name: m.from }) : t('mahalo.anon'))} · ${esc(fmtDate(m.created_at))}</p></div>`),
  ];
  return `<h3>${esc(t('mahalo.received'))}</h3>${items.length ? items.join('') : `<p class="muted">${esc(t('mahalo.none'))}</p>`}
    <h3>${esc(t('mahalo.send'))}</h3>
    <div class="card">
      <label for="m-to">${esc(t('mahalo.to'))}</label>${pick('m-to')}
      <textarea id="m-body" class="short" placeholder="${esc(t('mahalo.placeholder'))}" style="margin-top:.75rem"></textarea>
      <label class="check"><input type="checkbox" id="m-public" checked> ${esc(t('mahalo.public'))}</label>
      <label class="check"><input type="checkbox" id="m-anon"> ${esc(t('mahalo.anonymous'))}</label>
      <p style="margin-bottom:0"><button type="button" id="m-send">${esc(t('mahalo.sendButton'))}</button></p>
    </div>
    ${sent.length ? `<h3>${esc(t('mahalo.yours'))}</h3><div class="card">${sent.map((m) => `<div class="list-item"><p style="margin:0">${esc(m.body)}</p><p class="small muted" style="margin:.3rem 0 0">${esc(t('mahalo.to.line', { name: m.to }))} · ${esc(fmtDate(m.created_at))} · <a href="#" data-drop-mahalo="${m.id}">${esc(t('goals.delete'))}</a></p></div>`).join('')}</div>` : ''}`;
}

function feedback() {
  const { asked = [], forMe = [] } = data.feedback || {};
  const waiting = forMe.filter((f) => !f.response);
  return `${waiting.length ? `<h3>${esc(t('feedback.waiting'))}</h3>` : ''}
    ${waiting.map((f) => `<div class="card" style="border-color:var(--kalo)"><p class="small muted" style="margin-top:0">${esc(t('feedback.asked', { name: f.person }))}</p>
      <p class="prompt" style="font-size:1.1rem">${esc(f.prompt)}</p>
      <textarea data-answer="${f.id}" rows="4"></textarea>
      <p style="margin-bottom:0"><button type="button" data-send-answer="${f.id}">${esc(t('feedback.answer'))}</button></p></div>`).join('')}
    <h3>${esc(t('feedback.ask'))}</h3>
    <p class="muted">${esc(t('feedback.askHelp'))}</p>
    <div class="card">
      <label for="f-to">${esc(t('mahalo.to'))}</label>${pick('f-to')}
      <textarea id="f-prompt" class="short" placeholder="${esc(t('feedback.placeholder'))}" style="margin-top:.75rem"></textarea>
      <p style="margin-bottom:0"><button type="button" id="f-ask">${esc(t('feedback.askButton'))}</button></p>
    </div>
    ${asked.length ? `<h3>${esc(t('feedback.mine'))}</h3><div class="card">${asked.map((f) => `<div class="list-item"><p style="margin:0"><strong>${esc(f.person)}</strong> · ${esc(f.prompt)}</p>
      ${f.response ? `<blockquote style="margin:.5rem 0 0">${esc(f.response)}</blockquote>` : `<p class="small muted" style="margin:.3rem 0 0">${esc(t('feedback.noAnswer'))}</p>`}</div>`).join('')}</div>` : ''}`;
}

function myTeam() {
  const letters = data.lead?.letters || [];
  return `<p class="muted">${esc(t('myteam.help'))}</p>${letters.length ? letters.map((l) => `<section class="card"><h3 style="margin-top:0">${esc(l.person)}</h3>${when(l)}${doc(l.body)}</section>`).join('') : `<p>${esc(t('myteam.none'))}</p>`}`;
}

const SECTIONS = [
  ['letters', 'me.letters', letters],
  ['huli', 'me.huli', goals],
  ['mahalo', 'me.mahalo', mahalo],
  ['feedback', 'me.feedback', feedback],
  ['timeline', 'me.timeline', timeline],
  ...(data.lead ? [['myteam', 'me.myteam', myTeam]] : []),
];

function render() {
  app.innerHTML = `<h1>${esc(t('me.page'))}</h1>
    <nav class="chips">${SECTIONS.map(([id, k]) => `<a href="#${id}">${esc(t(k))}</a>`).join('')}</nav>
    ${SECTIONS.map(([id, k, fn]) => `<section id="${id}"><h2>${esc(t(k))}</h2>${fn()}</section>`).join('')}`;
  wire();
}

async function reload(keys) {
  const paths = { goals: '/api/goals', mahalo: '/api/mahalo/mine', feedback: '/api/feedback' };
  for (const k of keys) data[k] = await get(paths[k]);
  const y = scrollY;
  render();
  scrollTo(0, y);
}

const act = (fn, done) => async (e) => {
  e.preventDefault();
  try {
    await fn(e);
    if (done) toast(done);
  } catch (err) {
    toast(err.message || t('error.generic'));
  }
};

function wire() {
  for (const b of $$('[data-save]')) {
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
  $('#goal-add').onclick = act(async () => {
    await api('/api/goals', { method: 'POST', json: { body: $('#goal-new').value } });
    await reload(['goals']);
  });
  for (const s of $$('[data-goal]')) s.onchange = act(async () => {
    await api(`/api/goals/${s.dataset.goal}`, { method: 'PUT', json: { status: s.value } });
    await reload(['goals']);
  });
  for (const a of $$('[data-drop-goal]')) a.onclick = act(async () => {
    await api(`/api/goals/${a.dataset.dropGoal}`, { method: 'DELETE' });
    await reload(['goals']);
  });
  $('#m-send').onclick = act(async () => {
    await api('/api/mahalo', { method: 'POST', json: { to_id: $('#m-to').value, body: $('#m-body').value, public: $('#m-public').checked, anonymous: $('#m-anon').checked } });
    await reload(['mahalo']);
  }, t('mahalo.sent'));
  for (const a of $$('[data-drop-mahalo]')) a.onclick = act(async () => {
    await api(`/api/mahalo/${a.dataset.dropMahalo}`, { method: 'DELETE' });
    await reload(['mahalo']);
  });
  for (const b of $$('[data-send-answer]')) b.onclick = act(async () => {
    const id = b.dataset.sendAnswer;
    await api(`/api/feedback/${id}`, { method: 'PUT', json: { response: $(`[data-answer="${id}"]`).value } });
    await reload(['feedback']);
  }, t('feedback.answered'));
  $('#f-ask').onclick = act(async () => {
    const to = data.people.find((p) => String(p.id) === $('#f-to').value);
    await api('/api/feedback', { method: 'POST', json: { to_id: $('#f-to').value, prompt: $('#f-prompt').value } });
    await copy(t('feedback.message', { name: name(to), link: `${location.origin}/me/#feedback` }));
    await reload(['feedback']);
  }, t('feedback.copied'));
}

render();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
