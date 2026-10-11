import { api, esc, md, copy, toast, fmtDate, shell, initI18n, APP_NAME, orgLogo, $, $$ } from './app.js';

await initI18n();
shell({ langSwitch: false, nav: '<a href="#/">Cycles</a><a href="#/staff">Staff</a><a href="#/values">Values</a><a href="#/data">Data</a><span id="who" class="muted small"></span>' });
document.title = `${APP_NAME} admin`;
const app = $('#app');
api('/api/admin/me').then((r) => ($('#who').textContent = r.email)).catch(() => {});

const debounce = (fn, ms = 700) => {
  let t;
  return (...a) => (clearTimeout(t), (t = setTimeout(() => fn(...a), ms)));
};
const opt = (value, label, selected) => `<option value="${esc(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
const chip = (status) => `<span class="chip ${status}">${esc(status.replace('_', ' '))}</span>`;
const first = (p) => (p.preferred_name || p.name).split(' ')[0];
const nameOf = (p) => p.preferred_name || p.name;
const save = async (path, json, method = 'PUT') => {
  try {
    const r = await api(path, { method, json });
    toast('Saved');
    return r;
  } catch (e) {
    toast(e.message, 4000);
    throw e;
  }
};

// Every editable input carries data-path and data-f. Change saves just that field.
function bindFields(root = app) {
  for (const el of $$('[data-path][data-f]', root)) {
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
      save(el.dataset.path, { [el.dataset.f]: el.dataset.num !== undefined && v !== '' ? Number(v) : v });
    });
  }
}

// ---------------- router ----------------

const views = { '': home, staff, values, data, cycle, person };
async function route() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/');
  app.innerHTML = '<p class="muted">Loading...</p>';
  try {
    await (views[name] || home)(...args.map(decodeURIComponent));
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.status === 401 ? 'Please sign in through Cloudflare Access, then reload.' : e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
route();

// ---------------- cycles ----------------

async function home() {
  const [{ cycles }, { sets }] = await Promise.all([api('/api/admin/cycles'), api('/api/admin/values')]);
  app.innerHTML = `${orgLogo()}
    <h1>Review cycles</h1>
    ${
      cycles.length
        ? `<div class="scroll"><table><tr><th>Cycle</th><th>Opens</th><th>Closes</th><th>Status</th><th>Done</th></tr>
      ${cycles
        .map(
          (c) => `<tr><td><a href="#/cycle/${c.id}">${esc(c.name)}</a></td><td>${esc(c.opens_at || '')}</td><td>${esc(c.closes_at || '')}</td>
          <td>${chip(c.status)}</td><td>${c.done} of ${c.assignments}</td></tr>`,
        )
        .join('')}</table></div>`
        : '<p>No cycles yet. Start one below.</p>'
    }
    <h2>Start a new cycle</h2>
    <form id="new" class="card">
      <label>Name <input name="name" required placeholder="Hoʻoilo 2026"></label>
      <div class="row"><label style="flex:1">Opens <input type="date" name="opens_at"></label><label style="flex:1">Closes <input type="date" name="closes_at"></label></div>
      <label>Values set <select name="values_set_id">${sets.map((s) => opt(s.id, s.name, sets.at(-1)?.id)).join('')}</select></label>
      <p class="small muted">Questions are copied from the last cycle, or from the starter set if this is the first one.</p>
      <button>Create cycle</button>
    </form>`;
  $('#new').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const { id } = await save('/api/admin/cycles', { ...f, values_set_id: Number(f.values_set_id) || null }, 'POST');
    location.hash = `#/cycle/${id}`;
  };
}

async function cycle(id, tab = 'setup') {
  const d = await api(`/api/admin/cycles/${id}`);
  const c = d.cycle;
  const tabs = ['setup', 'questions', 'assignments', 'links', 'progress', 'people'];
  app.innerHTML = `
    <p class="small"><a href="#/">Cycles</a></p>
    <div class="row spread"><h1 style="margin:.25rem 0">${esc(c.name)}</h1>${chip(c.status)}</div>
    <nav class="tabs">${tabs.map((t) => `<a href="#/cycle/${id}/${t}" class="${t === tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</a>`).join('')}</nav>
    <div id="pane"></div>`;
  await { setup, questions, assignments, links, progress, people }[tab]?.(d, $('#pane'));
}

async function setup({ cycle: c }, pane) {
  const { sets } = await api('/api/admin/values');
  const path = `/api/admin/cycles/${c.id}`;
  const actions = {
    draft: [['open', 'Open the cycle', 'This adds a self reflection for every active staff member and lets people start. Open now?']],
    open: [['closed', 'Close the cycle', 'Close now? Staff will not be able to change answers. Raw answers open to you after closing.']],
    closed: [
      ['open', 'Reopen', 'Reopen so staff can keep answering?'],
      ['published', 'Mark published', 'Mark this cycle published once summaries are shared?'],
    ],
    published: [['closed', 'Back to closed', 'Move back to closed?']],
  }[c.status];
  pane.innerHTML = `
    <div class="card">
      <label>Name <input data-path="${path}" data-f="name" value="${esc(c.name)}"></label>
      <div class="row">
        <label style="flex:1">Opens <input type="date" data-path="${path}" data-f="opens_at" value="${esc(c.opens_at || '')}"></label>
        <label style="flex:1">Closes <input type="date" data-path="${path}" data-f="closes_at" value="${esc(c.closes_at || '')}"></label>
      </div>
      <label>Values set <select data-path="${path}" data-f="values_set_id" data-num>${sets.map((s) => opt(s.id, s.name, c.values_set_id)).join('')}</select></label>
    </div>
    <div class="row">${actions.map(([s, label]) => `<button data-status="${s}">${esc(label)}</button>`).join('')}</div>
    <h2>Delete everything from this cycle</h2>
    <div class="card">
      <p>This removes every question, assignment, answer, recording, summary, and reflection for this cycle. It cannot be undone. Export first if you want a copy.</p>
      <label>Type the cycle name, <strong>${esc(c.name)}</strong>, to confirm <input id="confirm" autocomplete="off"></label>
      <p><button class="danger" id="del" disabled>Delete this cycle</button></p>
    </div>`;
  bindFields(pane);
  for (const b of $$('[data-status]', pane)) {
    const [, , question] = actions.find((a) => a[0] === b.dataset.status);
    b.onclick = async () => {
      if (!confirm(question)) return;
      await save(`${path}/status`, { status: b.dataset.status }, 'POST');
      route();
    };
  }
  $('#confirm').oninput = (e) => ($('#del').disabled = e.target.value.trim() !== c.name.trim());
  $('#del').onclick = async () => {
    await save(path, { confirm: $('#confirm').value }, 'DELETE');
    location.hash = '#/';
  };
}

async function questions({ cycle: c, questions: qs }, pane) {
  const { sets } = await api('/api/admin/values');
  const vals = sets.find((s) => s.id === c.values_set_id)?.values || [];
  const kinds = ['story', 'short', 'mahalo', 'scale'];
  const row = (q) => {
    const p = `/api/admin/questions/${q.id}`;
    return `<div class="card q" draggable="true" data-id="${q.id}">
      <div class="handle" title="Drag to reorder">⠿<br><button class="quiet small" data-move="-1" aria-label="Move up">↑</button><br><button class="quiet small" data-move="1" aria-label="Move down">↓</button></div>
      <div>
        <label>English <textarea style="min-height:4rem" data-path="${p}" data-f="prompt_en">${esc(q.prompt_en)}</textarea></label>
        <label>ʻŌlelo Hawaiʻi <textarea style="min-height:3rem" data-path="${p}" data-f="prompt_haw" placeholder="Optional. Staff who choose Hawaiian see the English until this is filled in.">${esc(q.prompt_haw || '')}</textarea></label>
        <div class="row small">
          <select style="width:auto" data-path="${p}" data-f="kind">${kinds.map((k) => opt(k, k, q.kind)).join('')}</select>
          <select style="width:auto" data-path="${p}" data-f="value_id" data-num>${opt('', 'No linked value')}${vals.map((v) => opt(v.id, v.name_haw, q.value_id)).join('')}</select>
          <label class="check"><input type="checkbox" data-path="${p}" data-f="required" ${q.required ? 'checked' : ''}> Required</label>
          <label class="check"><input type="checkbox" data-path="${p}" data-f="five_min" ${q.five_min ? 'checked' : ''}> Five minute</label>
          <button class="quiet small" data-del="${q.id}">Delete</button>
        </div>
      </div>
    </div>`;
  };
  const groups = { self: 'Self reflection', peer: 'Peer review', upward: 'Upward review' };
  pane.innerHTML = `
    <div class="row spread"><p class="muted small">Story questions work best. Peer reviews start with mahalo. Flag 2 or 3 per group as five minute questions.</p>
    <button class="secondary small" id="reuse">Reuse questions from last cycle</button></div>
    ${Object.entries(groups)
      .map(([aud, title]) => {
        const list = qs.filter((q) => q.audience === aud);
        return `<h2>${title} <small class="muted">${list.filter((q) => q.five_min).length} five minute</small></h2>
          <div class="qlist" data-aud="${aud}">${list.map(row).join('')}</div>
          <button class="secondary small" data-add="${aud}">Add a ${aud} question</button>`;
      })
      .join('')}`;
  bindFields(pane);
  const saveOrder = () => save(`/api/admin/cycles/${c.id}/order`, { ids: $$('.q', pane).map((el) => Number(el.dataset.id)) });
  let dragging;
  for (const el of $$('.q', pane)) {
    el.ondragstart = (e) => {
      if (e.target.closest('textarea, input, select')) return e.preventDefault();
      dragging = el;
      el.classList.add('dragging');
    };
    el.ondragend = () => {
      el.classList.remove('dragging');
      saveOrder();
    };
    el.ondragover = (e) => {
      if (!dragging || dragging === el || dragging.parentNode !== el.parentNode) return;
      e.preventDefault();
      const after = e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
      el.parentNode.insertBefore(dragging, after ? el.nextSibling : el);
    };
  }
  for (const b of $$('[data-move]', pane)) {
    b.onclick = () => {
      const el = b.closest('.q');
      const sib = b.dataset.move === '-1' ? el.previousElementSibling : el.nextElementSibling?.nextElementSibling;
      if (b.dataset.move === '-1' && !sib) return;
      el.parentNode.insertBefore(el, sib);
      saveOrder();
    };
  }
  for (const b of $$('[data-add]', pane)) {
    b.onclick = async () => {
      await save(`/api/admin/cycles/${c.id}/questions`, { audience: b.dataset.add }, 'POST');
      route();
    };
  }
  for (const b of $$('[data-del]', pane)) {
    b.onclick = async () => {
      if (!confirm('Delete this question?')) return;
      await save(`/api/admin/questions/${b.dataset.del}`, {}, 'DELETE');
      route();
    };
  }
  $('#reuse').onclick = async () => {
    if (!confirm('Replace these questions with the ones from the last cycle?')) return;
    await save(`/api/admin/cycles/${c.id}/reuse`, {}, 'POST');
    route();
  };
}

async function assignments({ cycle: c, staff, assignments: as }, pane) {
  const peers = as.filter((a) => a.kind === 'peer');
  const has = new Set(peers.map((a) => `${a.reviewer_id}:${a.reviewee_id}`));
  const got = (id) => peers.filter((a) => a.reviewee_id === id).length;
  const gave = (id) => peers.filter((a) => a.reviewer_id === id).length;
  const flag = (n) => (n < 1 || n > 3 ? 'bad' : '');
  pane.innerHTML = `
    <p class="muted small">Each row is a person being reviewed. Each column is a reviewer. Tap a box to assign. Aim for 1 to 3 reviewers per person.
    Self reflections are added for everyone when the cycle opens.</p>
    <div class="row"><label class="row" style="margin:0">Reviewers each <select id="target" style="width:auto">${[1, 2, 3].map((n) => opt(n, n, 2)).join('')}</select></label>
    <button class="secondary small" id="auto">Auto fill</button>
    <span class="small muted">Prefers people who work together, avoids last cycle's pairs. Only adds, you can change anything after.</span></div>
    <div class="scroll"><table class="grid">
      <tr><th>Reviewed ↓ / Reviewer →</th>${staff.map((s) => `<th class="rot">${esc(nameOf(s))}</th>`).join('')}<th>Reviewers</th></tr>
      ${staff
        .map(
          (e) => `<tr><td>${esc(nameOf(e))}</td>${staff
            .map((r) =>
              r.id === e.id
                ? '<td class="muted">·</td>'
                : `<td><input type="checkbox" aria-label="${esc(nameOf(r))} reviews ${esc(nameOf(e))}" data-r="${r.id}" data-e="${e.id}" ${has.has(`${r.id}:${e.id}`) ? 'checked' : ''}></td>`,
            )
            .join('')}<td class="${flag(got(e.id))}">${got(e.id)}</td></tr>`,
        )
        .join('')}
      <tr><td>Reviews given</td>${staff.map((r) => `<td class="${flag(gave(r.id))}">${gave(r.id)}</td>`).join('')}<td></td></tr>
    </table></div>`;
  for (const box of $$('input[data-r]', pane)) {
    box.onchange = async () => {
      try {
        await save(`/api/admin/cycles/${c.id}/assignments`, { reviewer_id: Number(box.dataset.r), reviewee_id: Number(box.dataset.e), on: box.checked });
      } catch {
        box.checked = !box.checked;
      }
      route();
    };
  }
  $('#auto').onclick = async () => {
    const { added } = await save(`/api/admin/cycles/${c.id}/autofill`, { target: Number($('#target').value) }, 'POST');
    toast(`Added ${added} pairs`);
    route();
  };
}

function message(p, c) {
  return `Aloha ${first(p)}, here is your link for ${c.name} in ${APP_NAME}: ${p.link}${c.closes_at ? ` It is open until ${fmtDate(c.closes_at)}.` : ''} Mahalo!`;
}

async function links({ cycle: c }, pane) {
  if (c.status === 'draft') {
    pane.innerHTML = '<p>Links are ready once the cycle is open. Set up questions and assignments, then open it from Setup.</p>';
    return;
  }
  const { people } = await api(`/api/admin/cycles/${c.id}/links`);
  pane.innerHTML = `
    <p class="muted small">Each link is personal, works for 60 days, and can be opened again. Paste each message into Messages or email.</p>
    <p><button id="all">Copy all messages</button></p>
    ${people
      .map(
        (p) => `<div class="card"><div class="row spread"><strong>${esc(nameOf(p))}</strong><span class="small muted">${esc(p.phone || p.email || '')}</span></div>
        <p class="small" style="word-break:break-all">${esc(message(p, c))}</p>
        <div class="row"><button class="small" data-copy="${p.id}">Copy message</button><button class="quiet small" data-new="${p.id}">New link</button></div></div>`,
      )
      .join('')}`;
  $('#all').onclick = () => copy(people.map((p) => `${nameOf(p)}${p.phone ? ` (${p.phone})` : ''}\n${message(p, c)}`).join('\n\n'));
  for (const b of $$('[data-copy]', pane)) b.onclick = () => copy(message(people.find((p) => p.id === Number(b.dataset.copy)), c));
  for (const b of $$('[data-new]', pane)) {
    b.onclick = async () => {
      if (!confirm('Make a new link for this person? The old one keeps working until it expires.')) return;
      await save(`/api/admin/cycles/${c.id}/links/${b.dataset.new}`, {}, 'POST');
      route();
    };
  }
}

async function progress({ cycle: c, staff, assignments: as }, pane) {
  const byId = new Map(staff.map((s) => [s.id, s]));
  const rows = staff
    .map((s) => ({ s, mine: as.filter((a) => a.reviewer_id === s.id) }))
    .filter((r) => r.mine.length)
    .sort((a, b) => a.mine.filter((x) => x.status === 'done').length / a.mine.length - b.mine.filter((x) => x.status === 'done').length / b.mine.length);
  const done = as.filter((a) => a.status === 'done').length;
  pane.innerHTML = `
    <p><strong>${done} of ${as.length}</strong> reviews done. Only status shows here, never answer counts, so nobody's answers can be matched to them.</p>
    <div class="scroll"><table>
      <tr><th>Person</th><th>Their reviews</th><th></th></tr>
      ${rows
        .map(
          ({ s, mine }) => `<tr><td>${esc(nameOf(s))}</td><td>${mine
            .map((a) => `<div>${chip(a.status)} ${a.kind === 'self' ? 'Self reflection' : esc(nameOf(byId.get(a.reviewee_id) || { name: '?' }))}</div>`)
            .join('')}</td>
          <td>${mine.some((a) => a.status !== 'done') && c.status === 'open' ? `<button class="small secondary" data-nudge="${s.id}">Copy nudge</button>` : ''}</td></tr>`,
        )
        .join('')}
    </table></div>`;
  for (const b of $$('[data-nudge]', pane)) {
    b.onclick = async () => {
      const { people } = await api(`/api/admin/cycles/${c.id}/links`);
      const p = people.find((x) => x.id === Number(b.dataset.nudge));
      copy(`Aloha ${first(p)}, a gentle reminder that ${c.name} is still open${c.closes_at ? ` until ${fmtDate(c.closes_at)}` : ''}. Even 5 minutes helps: ${p.link} Mahalo!`);
    };
  }
}

async function people({ cycle: c, staff, summaries, responses }, pane) {
  const sum = new Map(summaries.map((s) => [s.reviewee_id, s]));
  const closed = ['closed', 'published'].includes(c.status);
  pane.innerHTML = `
    ${closed ? '' : '<div class="banner info">Raw answers and drafts open after the cycle closes.</div>'}
    <div class="scroll"><table><tr><th>Person</th><th>Answers about them</th><th>Summary</th></tr>
    ${staff
      .map(
        (s) => `<tr><td>${closed ? `<a href="#/person/${c.id}/${s.id}">${esc(nameOf(s))}</a>` : esc(nameOf(s))}</td>
        <td>${responses[s.id] || 0}</td><td>${sum.get(s.id) ? chip(sum.get(s.id).status) : '<span class="muted small">none yet</span>'}</td></tr>`,
      )
      .join('')}</table></div>`;
}

// ---------------- one person's workspace ----------------

async function person(cycleId, staffId, tab = 'raw') {
  const base = `/api/admin/cycles/${cycleId}/people/${staffId}`;
  const { summary, person: p } = await api(`${base}/summary`);
  app.innerHTML = `
    <p class="small"><a href="#/cycle/${cycleId}/people">Back to people</a></p>
    <h1 style="margin:.25rem 0">${esc(nameOf(p))}</h1>
    <nav class="tabs">${['raw', 'draft', 'share'].map((t) => `<a href="#/person/${cycleId}/${staffId}/${t}" class="${t === tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</a>`).join('')}</nav>
    <div id="pane"></div>`;
  const pane = $('#pane');
  const text = () => summary?.edited ?? summary?.draft ?? '';

  if (tab === 'raw') {
    const { groups } = await api(`${base}/raw`);
    pane.innerHTML = `
      <p class="small muted">Opening this tab is logged. Answers are shuffled within each question, so position tells you nothing about who wrote them.
      Highlight any sentence and tap "Add as quote" to drop it into the draft.</p>
      ${groups.length ? '' : '<p>No answers about this person.</p>'}
      ${groups
        .map(
          (g) => `<h2>${esc(g.prompt)} <small class="muted">${esc(g.audience)}</small></h2>
          ${g.responses
            .map(
              (r) => `<div class="card">
              ${r.signed_name ? `<p class="small"><span class="chip done">Signed mahalo from ${esc(r.signed_name)}</span></p>` : ''}
              <div class="raw-body">${esc(r.body || '')}</div>
              ${r.audio_key ? `<audio controls preload="none" style="width:100%;margin-top:.5rem" src="/api/admin/file?key=${encodeURIComponent(r.audio_key)}"></audio>` : ''}
              ${r.language && r.language !== 'en' ? `<p class="small muted">Language: ${esc(r.language)}</p>` : ''}
            </div>`,
            )
            .join('')}`,
        )
        .join('')}`;
    const btn = Object.assign(document.createElement('button'), { className: 'quote-btn small', textContent: 'Add as quote', hidden: true });
    document.body.append(btn);
    const onSel = () => {
      const sel = getSelection();
      const node = sel.anchorNode?.parentElement;
      if (!sel.isCollapsed && node?.closest('.raw-body') && location.hash.includes(`/${staffId}`)) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        Object.assign(btn.style, { top: `${Math.max(8, r.top - 48)}px`, left: `${Math.max(8, r.left)}px` });
        btn.hidden = false;
      } else btn.hidden = true;
    };
    document.addEventListener('selectionchange', onSel);
    window.addEventListener('hashchange', () => (document.removeEventListener('selectionchange', onSel), btn.remove()), { once: true });
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = async () => {
      const quote = getSelection().toString().trim().replace(/\s+/g, ' ');
      if (!quote) return;
      if (!summary) await api(`${base}/blank`, { method: 'POST', json: {} });
      const s = (await api(`${base}/summary`)).summary;
      const current = s.edited ?? s.draft ?? '';
      await save(`/api/admin/summaries/${s.id}`, { edited: `${current.trimEnd()}\n\n> "${quote}"\n` });
      btn.hidden = true;
      toast('Added to the draft');
    };
    return;
  }

  if (tab === 'draft') {
    pane.innerHTML = `
      <div class="row">
        <button id="gen">${summary?.draft ? 'Regenerate draft' : 'Write a draft'}</button>
        ${summary ? '' : '<button class="secondary" id="blank">Start a blank draft</button>'}
        <span class="small muted" id="genStatus"></span>
      </div>
      <div id="notes"></div>
      ${
        summary
          ? `<p class="small muted">Edits save as you type. Quotes in the draft were checked word for word against the answers.</p>
             <textarea id="text" style="min-height:60vh;font-size:1rem">${esc(text())}</textarea>
             <label class="check"><input type="checkbox" id="ready" ${summary.status !== 'draft' ? 'checked' : ''} ${summary.status === 'shared' ? 'disabled' : ''}> Ready to share</label>`
          : ''
      }`;
    $('#gen').onclick = async () => {
      if (summary?.edited && !confirm('Regenerating replaces the draft, including your edits. Go ahead?')) return;
      const b = $('#gen');
      b.disabled = true;
      $('#genStatus').textContent = 'Writing the draft. This can take a minute.';
      try {
        const r = await api(`${base}/draft`, { method: 'POST', json: {} });
        sessionStorage.setItem('hui360_notes', JSON.stringify(r.notes || []));
        route();
      } catch (e) {
        $('#genStatus').textContent = e.message;
        b.disabled = false;
      }
    };
    $('#blank')?.addEventListener('click', async () => {
      await api(`${base}/blank`, { method: 'POST', json: {} });
      route();
    });
    const notes = JSON.parse(sessionStorage.getItem('hui360_notes') || '[]');
    sessionStorage.removeItem('hui360_notes');
    if (notes.length) $('#notes').innerHTML = `<div class="banner info small">${notes.map(esc).join('<br>')}</div>`;
    if (summary) {
      const put = debounce((edited) => save(`/api/admin/summaries/${summary.id}`, { edited }));
      $('#text').oninput = (e) => put(e.target.value);
      $('#ready').onchange = (e) => save(`/api/admin/summaries/${summary.id}`, { status: e.target.checked ? 'ready' : 'draft' });
    }
    return;
  }

  // share
  if (!summary || !text().trim()) {
    pane.innerHTML = '<p>Write a draft first.</p>';
    return;
  }
  const parts = [];
  for (const line of text().split('\n')) {
    const h = line.match(/^##\s+(.*)/);
    if (h || !parts.length) parts.push({ title: h ? h[1] : 'Opening', lines: [] });
    parts.at(-1).lines.push(line);
  }
  pane.innerHTML = `
    ${summary.status === 'shared' ? `<div class="banner">Shared ${esc(fmtDate(summary.shared_at))}. Sharing again replaces what ${esc(first(p))} sees.</div>` : ''}
    <p>Choose what ${esc(first(p))} will see.</p>
    <div class="row">${parts.map((x, i) => `<label class="check"><input type="checkbox" data-part="${i}" checked> ${esc(x.title)}</label>`).join('')}</div>
    <h2>Preview</h2>
    <div class="summary-doc" id="preview"></div>
    <p><button id="share">Share with ${esc(first(p))}</button></p>
    ${summary.reflection ? `<h2>${esc(first(p))}'s reflection</h2><div class="card raw-body">${esc(summary.reflection)}</div>` : ''}`;
  const chosen = () => parts.filter((_, i) => $(`[data-part="${i}"]`).checked).map((x) => x.lines.join('\n')).join('\n').trim();
  const preview = () => ($('#preview').innerHTML = md(chosen()));
  for (const b of $$('[data-part]', pane)) b.onchange = preview;
  preview();
  $('#share').onclick = async () => {
    if (!confirm(`Share this with ${nameOf(p)}? It also opens their reflection box.`)) return;
    await save(`/api/admin/summaries/${summary.id}/share`, { shared_body: chosen() }, 'POST');
    route();
  };
}

// ---------------- staff ----------------

async function staff() {
  const { staff: list } = await api('/api/admin/staff');
  const row = (s) => {
    const p = `/api/admin/staff/${s.id}`;
    const inp = (f, type = 'text') => `<input type="${type}" data-path="${p}" data-f="${f}" value="${esc(s[f] ?? '')}">`;
    return `<tr>
      <td>${inp('name')}</td><td>${inp('preferred_name')}</td><td>${inp('email', 'email')}</td><td>${inp('phone', 'tel')}</td><td>${inp('team')}</td>
      <td><select data-path="${p}" data-f="role">${['staff', 'lead', 'admin'].map((r) => opt(r, r, s.role)).join('')}</select></td>
      <td><select data-path="${p}" data-f="lang">${[['en', 'English'], ['haw', 'Hawaiian'], ['both', 'Both']].map(([v, l]) => opt(v, l, s.lang)).join('')}</select></td>
      <td>${inp('start_date', 'date')}</td>
      <td><input type="checkbox" data-path="${p}" data-f="active" ${s.active ? 'checked' : ''} aria-label="Active"></td></tr>`;
  };
  app.innerHTML = `
    <h1>Staff</h1>
    <p class="muted small">Changes save as you go. Uncheck Active when someone leaves, their past reviews stay.</p>
    <div class="scroll"><table>
      <tr><th>Name</th><th>Goes by</th><th>Email</th><th>Phone</th><th>Team</th><th>Role</th><th>Language</th><th>Started</th><th>Active</th></tr>
      ${list.map(row).join('')}
    </table></div>
    <h2>Add a person</h2>
    <form id="add" class="card">
      <div class="row"><label style="flex:2">Name <input name="name" required></label><label style="flex:1">Goes by <input name="preferred_name"></label></div>
      <div class="row"><label style="flex:1">Email <input name="email" type="email"></label><label style="flex:1">Phone <input name="phone" type="tel"></label></div>
      <div class="row"><label style="flex:1">Team <input name="team"></label>
        <label style="flex:1">Language <select name="lang">${opt('en', 'English')}${opt('haw', 'Hawaiian')}${opt('both', 'Both')}</select></label></div>
      <button>Add</button>
    </form>`;
  bindFields();
  $('#add').onsubmit = async (e) => {
    e.preventDefault();
    await save('/api/admin/staff', Object.fromEntries(new FormData(e.target)), 'POST');
    route();
  };
}

// ---------------- values ----------------

async function values() {
  const { sets } = await api('/api/admin/values');
  const val = (v) => {
    const p = `/api/admin/values/${v.id}`;
    const f = (k, label, area) =>
      `<label>${label} ${area ? `<textarea style="min-height:3rem" data-path="${p}" data-f="${k}">${esc(v[k] ?? '')}</textarea>` : `<input data-path="${p}" data-f="${k}" value="${esc(v[k] ?? '')}">`}</label>`;
    return `<div class="card">
      <div class="row"><div style="flex:1">${f('name_haw', 'Hawaiian name')}</div><div style="flex:1">${f('name_en', 'English name')}</div><div style="width:5rem">${f('ord', 'Order')}</div></div>
      ${f('olelo_noeau', 'ʻŌlelo noʻeau', true)}${f('olelo_noeau_meaning', 'Meaning', true)}${f('description', 'What it looks like in this Hui', true)}
      <button class="quiet small" data-del="${v.id}">Remove</button></div>`;
  };
  app.innerHTML = `
    <h1>Values</h1>
    <div class="banner warn small">The starter set is a sample from Pukui's ʻŌlelo Noʻeau. Replace it with the Hui's own values before the first cycle.</div>
    ${sets
      .map(
        (s) => `<h2><input data-path="/api/admin/value-sets/${s.id}" data-f="name" value="${esc(s.name)}" style="font-weight:600"></h2>
        ${s.values.map(val).join('')}
        <div class="row"><button class="secondary small" data-add="${s.id}">Add a value</button><button class="quiet small" data-copy="${s.id}">Copy this set</button></div>`,
      )
      .join('')}
    <p style="margin-top:2rem"><button class="secondary" id="newset">New empty values set</button></p>`;
  bindFields();
  for (const b of $$('[data-add]')) b.onclick = async () => (await save('/api/admin/values', { values_set_id: Number(b.dataset.add) }, 'POST'), route());
  for (const b of $$('[data-del]')) b.onclick = async () => confirm('Remove this value?') && (await save(`/api/admin/values/${b.dataset.del}`, {}, 'DELETE'), route());
  for (const b of $$('[data-copy]')) b.onclick = async () => (await save('/api/admin/value-sets', { name: 'Copy of values', copy_from: Number(b.dataset.copy) }, 'POST'), route());
  $('#newset').onclick = async () => (await save('/api/admin/value-sets', { name: 'New values' }, 'POST'), route());
}

// ---------------- data ----------------

async function data() {
  const [{ files }, { audit }, settings] = await Promise.all([api('/api/admin/exports'), api('/api/admin/audit'), api('/api/admin/settings')]);
  const byFolder = {};
  for (const f of files) (byFolder[f.key.split('/')[1]] ||= []).push(f);
  const link = (key) => `<a href="/api/admin/file?key=${encodeURIComponent(key)}">${esc(key.split('/').slice(2).join('/'))}</a>`;
  app.innerHTML = `
    <h1>Data</h1>
    <div class="card">
      <h2 style="margin-top:0">Export everything</h2>
      <p>One click writes a full JSON file and a folder of Markdown files (one per person per cycle) to the Hui's R2 storage. Everything the Hui enters is the Hui's.
      The reviewer hash table is left out on purpose, so an export can never be used to match answers to people.</p>
      <button id="export">Export now</button>
    </div>
    ${Object.entries(byFolder)
      .sort()
      .reverse()
      .map(([folder, fs]) => `<details class="card"><summary>${esc(folder)}</summary><ul>${fs.map((f) => `<li>${link(f.key)}</li>`).join('')}</ul></details>`)
      .join('')}
    <h2>Settings</h2>
    <div class="card">
      <label>Name of your organization <input data-path="/api/admin/settings" data-f="hui_name" value="${esc(settings.hui_name || '')}" placeholder="the Hui"></label>
      <label>Director's name, as staff call them <input data-path="/api/admin/settings" data-f="director_name" value="${esc(settings.director_name || '')}" placeholder="your director"></label>
      <p class="small muted">Staff see these names on their screens, and summary drafts are written in the director's voice.</p>
      <label>Logo, shown on the staff and admin home pages</label>
      <div class="row">${orgLogo() || '<span class="small muted">No logo yet.</span>'}
        <input type="file" id="logo" accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif" style="width:auto">
        ${orgLogo() ? '<button class="quiet small" id="nologo">Remove logo</button>' : ''}</div>
      <p class="small muted">SVG (animated is fine), PNG, JPG, WebP, or GIF, under 2 MB.</p>
    </div>
    <h2>Audit log</h2>
    <p class="small muted">Every read of raw answers, every draft, share, export, and delete.</p>
    <div class="scroll"><table><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Target</th></tr>
      ${audit.map((a) => `<tr><td>${esc(a.created_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td></tr>`).join('')}
    </table></div>`;
  bindFields();
  $('#logo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await api('/api/admin/logo', { method: 'PUT', body: f, headers: { 'content-type': f.type } });
      location.reload();
    } catch (err) {
      toast(err.message, 4000);
    }
  };
  $('#nologo')?.addEventListener('click', async () => confirm('Remove the logo?') && (await save('/api/admin/logo', {}, 'DELETE'), location.reload()));
  $('#export').onclick = async () => {
    $('#export').disabled = true;
    const r = await save('/api/admin/export', {}, 'POST');
    location.href = `/api/admin/file?key=${encodeURIComponent(`${r.prefix}hui360.json`)}`;
    setTimeout(route, 1000);
  };
}
