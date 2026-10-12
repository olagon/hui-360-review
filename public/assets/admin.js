import { api as rawApi, esc, md, copy, toast, fmtDate, shell, initI18n, APP_NAME, orgLogo, config, $, $$ } from './app.js';
import { moonFor, moonIcon, hawaiiToday } from './moon.js';
import { layoutMeetings, buildICS } from './ics.js';

// Anything that sends, makes, or deletes something dims the page, shows a spinner with what it is doing,
// and locks the page until it is done. Autosaves (PUT) stay quiet so typing is never blocked.
// The veil waits a moment before showing, so quick actions do not flicker.
const veil = Object.assign(document.createElement('div'), { className: 'veil', hidden: true });
veil.innerHTML = '<div class="veil-box" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span class="veil-msg"></span></div>';
document.body.append(veil);
const veilMsg = veil.querySelector('.veil-msg');
let busyCount = 0;
const BUSY = [
  [/\/(draft|prep)$/, 'Writing the draft. This can take a minute.'],
  [/\/(email|send)$/, 'Sending email...'],
  [/\/signals$/, 'Reading answers. This can take a minute.'],
  [/\/export$/, 'Saving a copy of everything...'],
  [/\/sample$/, 'Setting up the sample...'],
  [/\/autofill$/, 'Choosing reviewers...'],
];
async function busy(promise, msg) {
  busyCount++;
  const show = setTimeout(() => {
    veilMsg.textContent = msg;
    veil.hidden = false;
    document.activeElement?.blur?.();
  }, 250);
  try {
    return await promise;
  } finally {
    clearTimeout(show);
    if (!--busyCount) veil.hidden = true;
  }
}
const api = (path, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'POST' && method !== 'DELETE') return rawApi(path, opts);
  return busy(rawApi(path, opts), BUSY.find(([re]) => re.test(path))?.[1] || (method === 'DELETE' ? 'Removing...' : 'Working...'));
};

await initI18n();
shell({ langSwitch: false, nav: '<a href="#/">Cycles</a><a href="#/staff">People</a><a href="#/values">Values</a><a href="#/data">Data</a><a href="/guide/">Guide</a><span id="who" class="muted small"></span><a href="/cdn-cgi/access/logout">Sign out</a>' });
document.title = `${APP_NAME} admin`;
const app = $('#app');
api('/api/admin/me').then((r) => ($('#who').textContent = r.email)).catch(() => {});

const debounce = (fn, ms = 700) => {
  let t;
  return (...a) => (clearTimeout(t), (t = setTimeout(() => fn(...a), ms)));
};
// The editor shows a formatted letter. Underneath, letters are stored as simple
// marked up text (## for a heading, ** for bold, > for a quote) so they print,
// share, and export the same everywhere. This turns the editor back into that.
function htmlToText(root) {
  const inline = (node) =>
    [...node.childNodes]
      .map((n) => {
        if (n.nodeType === 3) return n.textContent.replace(/\u00a0/g, ' ');
        if (n.nodeType !== 1) return '';
        const inner = inline(n);
        if (n.tagName === 'BR') return '\n';
        if (/^(STRONG|B)$/.test(n.tagName) && inner.trim()) return `**${inner.trim()}**`;
        if (/^(EM|I)$/.test(n.tagName) && inner.trim()) return `*${inner.trim()}*`;
        return inner;
      })
      .join('');
  const blocks = [];
  for (const n of root.childNodes) {
    if (n.nodeType === 3) {
      if (n.textContent.trim()) blocks.push(n.textContent.trim());
      continue;
    }
    if (n.nodeType !== 1) continue;
    const t = n.tagName;
    const words = inline(n).trim();
    if (/^H[1-6]$/.test(t)) words && blocks.push(`${'#'.repeat(Math.max(1, Number(t[1]) - 1))} ${words.replace(/\n+/g, ' ')}`);
    else if (t === 'UL' || t === 'OL') blocks.push([...n.children].map((li) => `- ${inline(li).trim()}`).join('\n'));
    else if (t === 'BLOCKQUOTE') words && blocks.push(words.split('\n').map((l) => `> ${l}`).join('\n'));
    else if (words) blocks.push(words);
  }
  return blocks.join('\n\n');
}

const editorHtml = (text, label) => `
  <div class="toolbar no-print" role="toolbar" aria-label="Formatting">
    <button type="button" class="quiet small" data-cmd="formatBlock" data-arg="h3">Heading</button>
    <button type="button" class="quiet small" data-cmd="formatBlock" data-arg="p">Normal text</button>
    <button type="button" class="quiet small" data-cmd="bold"><strong>Bold</strong></button>
    <button type="button" class="quiet small" data-cmd="insertUnorderedList">Bullets</button>
    <button type="button" class="quiet small" data-cmd="formatBlock" data-arg="blockquote">Quote</button>
    <span class="small muted" data-save role="status"></span>
  </div>
  <div class="summary-doc editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(label)}">${md(text)}</div>`;

function wireEditor(root, store) {
  const editor = $('.editor', root);
  const status = $('[data-save]', root);
  document.execCommand('defaultParagraphSeparator', false, 'p');
  const put = debounce(async () => {
    try {
      await store(htmlToText(editor));
      status.textContent = 'Saved';
    } catch (e) {
      status.textContent = `Not saved: ${e.message}`;
    }
  });
  editor.oninput = () => ((status.textContent = 'Saving...'), put());
  // Paste as plain words so formatting from Word or email does not come along.
  editor.onpaste = (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };
  for (const b of $$('[data-cmd]', root)) {
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      document.execCommand(b.dataset.cmd, false, b.dataset.arg ? `<${b.dataset.arg}>` : null);
      editor.focus();
      editor.oninput();
    };
  }
}

// Closed reviews are a record: show why the controls are off.
function lockPane(pane, c, what) {
  if (!['closed', 'published'].includes(c.status)) return;
  pane.insertAdjacentHTML('afterbegin', `<div class="banner info">This review is closed, so ${what} are locked. Reopen it in Setup to change them.</div>`);
  for (const el of $$('input, textarea, select, button', pane)) el.disabled = true;
  for (const el of $$('[draggable]', pane)) el.draggable = false;
}

// The Hawaiian moon for a date, a small touch next to dates. Counts vary by place.
const moonName = (date) => (config.moon && date ? moonFor(date).name : '');
const moonToday = () => {
  if (!config.moon) return '';
  const m = moonFor(hawaiiToday());
  return `<span class="moon small muted" title="Moon names follow one common count. Local practitioners may count differently.">${moonIcon(m.age)} ${esc(m.name)}</span>`;
};
// Email straight from the app once email is set up, to anyone with Send email checked in People. Otherwise copy.
let channelsP;
let CH = {};
const channels = () => (channelsP ||= api('/api/admin/channels').then((c) => (CH = c)).catch(() => ({})));
channels(); // known before anyone taps, so a tap can decide email or copy without waiting
const emails = (p) => !!(p.email && p.send_email);
// message can be a promise. Deciding without awaiting keeps a copy inside the tap, which Safari requires.
function sendOrCopy(person, message, subject) {
  if ((CH.email && emails(person)) || (CH.sms && person.phone)) return sendNow(person, message, subject);
  return copy(message);
}
async function sendNow(person, message, subject) {
  try {
    const r = await api('/api/admin/send', { method: 'POST', json: { staff_id: person.id, message: await message, subject } });
    toast(`Sent by ${r.channel === 'sms' ? 'text' : 'email'}`);
  } catch (e) {
    copy(message, `Not sent (${e.message}). Copied instead.`);
  }
}
// One button that emails a message to each person in the list who has Send email checked.
// people: [{ id, name, email, send_email }], build(p) gives that person's message.
async function emailButton(el, people, label, subject, build) {
  const ch = await channels();
  const n = people.filter(emails).length;
  if (!ch.email || !people.length) return;
  el.innerHTML = `<button class="small">${esc(label)} (${n})</button>
    ${n < people.length ? `<span class="small muted">${people.length - n} without an email or with Send email unchecked. Copy theirs instead.</span>` : ''}`;
  $('button', el).onclick = async () => {
    if (!n || !confirm(`Email ${n} ${n === 1 ? 'person' : 'people'} now?`)) return;
    $('button', el).disabled = true;
    try {
      const msgs = await Promise.all(people.filter(emails).map(async (p) => ({ staff_id: p.id, subject, message: await build(p) })));
      const r = await api('/api/admin/email', { method: 'POST', json: { messages: msgs } });
      toast(`Emailed ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`, 4000);
    } catch (e) {
      toast(e.message, 6000);
      $('button', el).disabled = false;
    }
  };
}
const letterMsg = (p, cycleName, link) => `Aloha ${first(p)}, your letter from ${cycleName} is ready. Open your link to read it, and write back if you like: ${link}\n\nMahalo, ${config.director}`;

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
  const open = cycles.find((c) => c.status === 'open');
  app.innerHTML = `${orgLogo()}
    <div class="row spread"><h1>Review cycles</h1>${moonToday()}</div>
    <div id="digest"></div>
    <p class="muted small">New here? Watch the <a href="/tour/admin/">90 second walkthrough</a> or read the <a href="/guide/">guide</a>. Add everyone in <a href="#/staff">People</a>, then start a review below. Each review walks you through the next step.
    To see what a finished review looks like, load the sample from <a href="#/data">Data</a>.</p>
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
  if (open) digest(open);
  for (const d of $$('#new input[type=date]')) d.after(Object.assign(document.createElement('small'), { className: 'muted' }));
  $('#new').oninput = () => $$('#new input[type=date]').forEach((d) => (d.nextElementSibling.textContent = moonName(d.value)));
  $('#new').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const { id } = await save('/api/admin/cycles', { ...f, values_set_id: Number(f.values_set_id) || null }, 'POST');
    location.hash = `#/cycle/${id}`;
  };
}

// This morning's nudges: everyone still behind in the open review, one tap to copy or send each.
async function digest(c) {
  const [d, { people }] = await Promise.all([api(`/api/admin/cycles/${c.id}`), api(`/api/admin/cycles/${c.id}/links`)]);
  const behind = people.filter((p) => d.assignments.some((a) => a.reviewer_id === p.id && a.status !== 'done'));
  if (!behind.length) return;
  const ch = await channels();
  $('#digest').innerHTML = `<div class="card"><h2 style="margin-top:0">Today's nudges</h2>
    <p class="small muted">${behind.length} ${behind.length === 1 ? 'person has' : 'people have'} reviews left in ${esc(c.name)}. ${ch.email && ch.auto ? 'An email reminder goes out by itself each morning at 7am to anyone with Send email checked.' : ch.email ? 'Email them all at once, or send one at a time.' : 'Copy each message and send it from your phone.'}</p>
    <p class="row" id="nudgeall"></p>
    ${behind.map((p) => `<div class="row spread list-item"><span>${esc(nameOf(p))} <span class="small muted">${d.assignments.filter((a) => a.reviewer_id === p.id && a.status !== 'done').length} left</span></span><button class="small secondary" data-nudge="${p.id}">${ch.email && emails(p) ? 'Email nudge' : 'Copy nudge'}</button></div>`).join('')}</div>`;
  emailButton($('#nudgeall'), behind, 'Email a nudge to everyone behind', `A gentle reminder: ${c.name}`, (p) => nudge(p, c));
  for (const b of $$('#digest [data-nudge]')) {
    const p = behind.find((x) => x.id === Number(b.dataset.nudge));
    b.onclick = () => sendOrCopy(p, nudge(p, c), 'A gentle reminder');
  }
}
const nudge = (p, c) => `Aloha ${first(p)}, a gentle reminder that ${c.name} is still open${c.closes_at ? ` until ${fmtDate(c.closes_at)}` : ''}. Even 5 minutes helps: ${p.link} Mahalo!`;

const TABS = [['setup', 'Setup'], ['people', 'People'], ['questions', 'Questions'], ['assignments', 'Reviewers'], ['links', 'Links'], ['voices', 'Community'], ['progress', 'Progress'], ['letters', 'Letters'], ['talks', 'Talk story'], ['team', 'Team report']];

async function cycle(id, tab = 'setup') {
  const d = await api(`/api/admin/cycles/${id}`);
  const c = d.cycle;
  const inReview = new Set(d.people);
  d.members = d.staff.filter((s) => inReview.has(s.id));
  app.innerHTML = `
    <p class="small"><a href="#/">Cycles</a></p>
    <div class="row spread"><h1 style="margin:.25rem 0">${esc(c.name)}</h1><span class="row">${moonToday()}${chip(c.status)}</span></div>
    ${nextStep(d)}
    <nav class="tabs">${TABS.map(([t, label]) => `<a href="#/cycle/${id}/${t}" class="${t === tab ? 'on' : ''}">${label}</a>`).join('')}</nav>
    <div id="pane"></div>`;
  $('.tabs .on')?.scrollIntoView({ block: 'nearest', inline: 'center' }); // on a phone the tabs scroll sideways
  await { setup, people: participants, questions, assignments, links, voices, progress, letters, talks, team }[tab]?.(d, $('#pane'));
}

// One plain sentence about where this review stands and what to do next.
function nextStep({ cycle: c, members, assignments: as, summaries, responses }) {
  const go = (tab, label) => ` <a class="button small" href="#/cycle/${c.id}/${tab}">${label}</a>`;
  const peers = as.filter((a) => a.kind === 'peer');
  const lonely = members.filter((m) => !peers.some((a) => a.reviewee_id === m.id)).length;
  const done = as.filter((a) => a.status === 'done').length;
  const needLetters = members.filter((m) => responses[m.id]).length;
  const shared = summaries.filter((s) => s.status === 'shared').length;
  const letterWord = (n) => `${n} ${n === 1 ? 'letter' : 'letters'}`;
  let text;
  if (c.status === 'draft') {
    text = `Getting ready. ${members.length} ${members.length === 1 ? 'person is' : 'people are'} in this review. Check People, Questions, and Reviewers, then open the review from Setup.`;
    if (lonely) text += ` ${lonely} ${lonely === 1 ? 'person has' : 'people have'} no reviewer yet.`;
    text += peers.length ? go('setup', 'Go to Setup') : go('assignments', 'Pick reviewers');
  } else if (c.status === 'open') {
    text = `Open${c.closes_at ? ` until ${fmtDate(c.closes_at)}` : ''}. ${done} of ${as.length} reviews done. Send links from Links and nudges from Progress. When everyone is done, close the review in Setup and the Letters tab opens.`;
    text += done === as.length && as.length ? go('setup', 'Close the review') : go('progress', 'See progress');
  } else if (c.status === 'closed' && (shared < needLetters || !needLetters)) {
    text = `Answers are locked. Now write each person's letter in Letters: read their answers, write a draft, then share it. ${shared} of ${letterWord(needLetters)} shared.`;
    text += go('letters', 'Write letters');
  } else if (c.status === 'closed') {
    text = `${shared === 1 ? 'The letter is' : `All ${shared} letters are`} shared, and everyone can read theirs. Next, write the team report: one report on the whole team, with no names. Then mark the review published in Setup and save a copy from Data, Export.`;
    text += go('team', 'Team report');
  } else {
    text = `Finished. ${letterWord(shared)} shared. Everyone can read theirs. The team report and a copy of everything (Data, Export) are there any time.`;
    text += go('letters', 'See letters');
  }
  return `<div class="banner no-print"><strong>Next step.</strong> ${text}</div>`;
}

async function participants({ cycle: c, staff, people }, pane) {
  const inReview = new Set(people);
  const locked = ['closed', 'published'].includes(c.status);
  pane.innerHTML = `
    <p>Check everyone taking part in this review. Each person checked gets a self reflection when the review opens and shows up in Reviewers. Uncheck anyone sitting this one out.</p>
    <p><strong>${people.length}</strong> of ${staff.length} people are in this review.</p>
    <div class="scroll"><table>
      <tr><th style="width:3rem">In</th><th>Name</th><th>Group</th><th>Email or phone</th></tr>
      ${staff
        .map(
          (s) => `<tr><td><input type="checkbox" data-p="${s.id}" aria-label="Include ${esc(nameOf(s))}" ${inReview.has(s.id) ? 'checked' : ''} ${locked ? 'disabled' : ''} style="width:1.3rem;height:1.3rem;min-height:0;accent-color:var(--kalo)"></td>
          <td>${esc(s.name)}${s.preferred_name ? ` <span class="muted small">(${esc(s.preferred_name)})</span>` : ''}</td><td>${esc(s.team || '')}</td><td class="small">${esc(s.email || s.phone || '')}</td></tr>`,
        )
        .join('')}
    </table></div>
    ${
      locked
        ? ''
        : `<h2>Add someone new</h2>
    <form id="addp" class="card">
      <p class="small muted" style="margin-top:0">Staff, interns, volunteers, or board members. Anyone who will write or receive reviews. They are added to People for future reviews too.</p>
      <div class="row"><label style="flex:2">Name <input name="name" required></label><label style="flex:1">Goes by <input name="preferred_name"></label></div>
      <div class="row"><label style="flex:1">Email <input name="email" type="email"></label><label style="flex:1">Phone <input name="phone" type="tel"></label>
        <label style="flex:1">Group <input name="team" list="groups" placeholder="Staff"></label></div>
      <button>Add to this review</button>
    </form>`
    }
    <p class="small"><a href="#/staff">Edit everyone's details, or add many people at once, in People</a></p>
    ${GROUPS}`;
  for (const box of $$('[data-p]', pane)) {
    box.onchange = async () => {
      try {
        await save(`/api/admin/cycles/${c.id}/people`, { staff_id: Number(box.dataset.p), on: box.checked });
      } catch {
        box.checked = !box.checked;
      }
      route();
    };
  }
  lockPane(pane, c, 'the people in it');
  $('#addp')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { id } = await save('/api/admin/staff', Object.fromEntries(new FormData(e.target)), 'POST');
    await save(`/api/admin/cycles/${c.id}/people`, { staff_id: id, on: true });
    route();
  });
}

const GROUPS = '<datalist id="groups"><option value="Staff"><option value="Intern"><option value="Volunteer"><option value="Board"></datalist>';

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
        <label style="flex:1">Opens <input type="date" data-path="${path}" data-f="opens_at" value="${esc(c.opens_at || '')}"><small class="muted" data-moon>${esc(moonName(c.opens_at))}</small></label>
        <label style="flex:1">Closes <input type="date" data-path="${path}" data-f="closes_at" value="${esc(c.closes_at || '')}"><small class="muted" data-moon>${esc(moonName(c.closes_at))}</small></label>
      </div>
      <label>Values set <select data-path="${path}" data-f="values_set_id" data-num>${sets.map((s) => opt(s.id, s.name, c.values_set_id)).join('')}</select></label>
      <label class="check"><input type="checkbox" data-path="${path}" data-f="upward" ${c.upward ? 'checked' : ''} ${['closed', 'published'].includes(c.status) ? 'disabled' : ''}>
        <span>Include an upward review. Each person also reviews ${esc(config.director)}, and anyone marked lead reviews their team lead, with the Upward review questions.</span></label>
    </div>
    <div class="row">${actions.map(([s, label]) => `<button data-status="${s}">${esc(label)}</button>`).join('')}</div>
    <h2>Delete everything from this cycle</h2>
    <div class="card">
      <p>This removes every question, assignment, answer, recording, summary, and reflection for this cycle. It cannot be undone. Export first if you want a copy.</p>
      <label>Type the cycle name, <strong>${esc(c.name)}</strong>, to confirm <input id="confirm" autocomplete="off"></label>
      <p><button class="danger" id="del" disabled>Delete this cycle</button></p>
    </div>`;
  bindFields(pane);
  for (const d of $$('input[type=date]', pane)) d.addEventListener('input', () => (d.nextElementSibling.textContent = moonName(d.value)));
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
        return `<h2>${title} <small class="muted">${list.filter((q) => q.five_min).length} five minute${aud === 'upward' && !c.upward ? ', turned off in Setup' : ''}</small></h2>
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
  lockPane(pane, c, 'questions');
  $('#reuse').onclick = async () => {
    if (!confirm('Replace these questions with the ones from the last cycle?')) return;
    await save(`/api/admin/cycles/${c.id}/reuse`, {}, 'POST');
    route();
  };
}

async function assignments({ cycle: c, members: staff, assignments: as }, pane) {
  const peers = as.filter((a) => a.kind === 'peer');
  const has = new Set(peers.map((a) => `${a.reviewer_id}:${a.reviewee_id}`));
  const got = (id) => peers.filter((a) => a.reviewee_id === id).length;
  const gave = (id) => peers.filter((a) => a.reviewer_id === id).length;
  const flag = (n) => (n < 1 || n > 3 ? 'bad' : '');
  pane.innerHTML = `
    <p class="muted small">Each row is a person being reviewed. Each column is a reviewer. Tap a box to assign. Aim for 1 to 3 reviewers per person.
    Only people checked in the People tab show here, and each of them gets a self reflection when the review opens.</p>
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
  lockPane(pane, c, 'reviewers');
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
    <p class="muted small">Each link is personal, works for 60 days, and can be opened again. Email them from here, or copy each message into Messages or email.</p>
    <p class="row" id="emailall"></p>
    <p><button id="all" class="secondary">Copy all messages</button></p>
    ${people
      .map(
        (p) => `<div class="card"><div class="row spread"><strong>${esc(nameOf(p))}</strong><span class="small muted">${esc(p.phone || p.email || '')}</span></div>
        <p class="small" style="word-break:break-all">${esc(message(p, c))}</p>
        <div class="row"><button class="small" data-copy="${p.id}">Copy message</button><button class="quiet small" data-new="${p.id}">New link</button></div></div>`,
      )
      .join('')}`;
  $('#all').onclick = () => copy(people.map((p) => `${nameOf(p)}${p.phone ? ` (${p.phone})` : ''}\n${message(p, c)}`).join('\n\n'));
  for (const b of $$('[data-copy]', pane)) b.onclick = () => copy(message(people.find((p) => p.id === Number(b.dataset.copy)), c));
  const ch = await channels();
  emailButton($('#emailall'), people, 'Email everyone their link', `Your link for ${c.name}`, (p) => message(p, c));
  if (ch.email) {
    for (const b of $$('[data-copy]', pane)) {
      const p = people.find((x) => x.id === Number(b.dataset.copy));
      if (!emails(p)) continue;
      b.insertAdjacentHTML('beforebegin', '<button class="small">Email</button>');
      b.previousElementSibling.onclick = () => sendOrCopy(p, message(p, c), `Your link for ${c.name}`);
      b.className = 'small secondary';
    }
  }
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
  const ch = await channels();
  pane.innerHTML = `
    <p><strong>${done} of ${as.length}</strong> reviews done. Only status shows here, never answer counts, so nobody's answers can be matched to them.</p>
    <div class="scroll"><table>
      <tr><th>Person</th><th>Their reviews</th><th></th></tr>
      ${rows
        .map(
          ({ s, mine }) => `<tr><td>${esc(nameOf(s))}</td><td>${mine
            .map((a) => `<div>${chip(a.status)} ${a.kind === 'self' ? 'Self reflection' : esc(nameOf(byId.get(a.reviewee_id) || { name: '?' }))}</div>`)
            .join('')}</td>
          <td>${mine.some((a) => a.status !== 'done') && c.status === 'open' ? `<button class="small secondary" data-nudge="${s.id}">${ch.email && emails(s) ? 'Email nudge' : 'Copy nudge'}</button>` : ''}</td></tr>`,
        )
        .join('')}
    </table></div>
    <p class="row" id="nudgeall"></p>
    <div id="signals"></div>`;
  const linksP = c.status === 'open' ? api(`/api/admin/cycles/${c.id}/links`) : null;
  const linkOf = async (p) => (await linksP).people.find((x) => x.id === p.id).link;
  if (c.status === 'open') {
    const behind = rows.filter((r) => r.mine.some((a) => a.status !== 'done')).map((r) => r.s);
    emailButton($('#nudgeall'), behind, 'Email a nudge to everyone behind', `A gentle reminder: ${c.name}`, async (p) => nudge({ ...p, link: await linkOf(p) }, c));
  }
  for (const b of $$('[data-nudge]', pane)) {
    const p = byId.get(Number(b.dataset.nudge));
    b.onclick = () => sendOrCopy(p, linkOf(p).then((link) => nudge({ ...p, link }, c)), 'A gentle reminder');
  }
  if (c.status !== 'draft') signals(c, $('#signals'));
}

// Early signals: repeated themes across every answer so far, as counts. Never names, never quotes.
const SIGNALS = { burnout: 'Burnout or exhaustion', unclear_roles: 'Unclear roles', safety: 'Safety concerns', friction: 'Friction between people' };
async function signals(c, el) {
  const draw = ({ counts, checked, total }) => {
    el.innerHTML = `<h2>Early signals</h2>
      <p class="small muted">Only you see this. It is pattern spotting, not surveillance: the app sorts answers into a few themes and shows how often each comes up, with no names and no quotes. Use it to ask better questions of the whole team.</p>
      <div class="card">${Object.entries(SIGNALS).map(([k, label]) => `<div class="row spread list-item"><span>${label}</span><strong>${counts[k] || 0}</strong></div>`).join('')}
        <p class="small muted" style="margin-bottom:0">${checked} of ${total} answers checked.</p></div>
      <p><button class="secondary small" id="runsig">${checked < total ? 'Check new answers' : 'Check again'}</button> <span class="small muted" id="sigstatus"></span></p>`;
    $('#runsig', el).onclick = async () => {
      $('#runsig', el).disabled = true;
      $('#sigstatus', el).textContent = 'Reading answers. This can take a minute.';
      try {
        draw(await api(`/api/admin/cycles/${c.id}/signals`, { method: 'POST', json: {} }));
      } catch (e) {
        $('#sigstatus', el).textContent = e.message;
        $('#runsig', el).disabled = false;
      }
    };
  };
  draw(await api(`/api/admin/cycles/${c.id}/signals`));
}

// Community voices: one question links for people outside the organization.
async function voices({ cycle: c, members }, pane) {
  const { voices: list } = await api(`/api/admin/cycles/${c.id}/voices`);
  const open = c.status === 'open' || c.status === 'draft';
  const ask = (p) => `You worked with ${p ? first(p) : '[name]'} this year. What stood out to you about them?`;
  pane.innerHTML = `
    <p>Ask someone outside ${esc(config.hui)} (a partner, a kupuna, a volunteer, a landowner) one question about one person. They get a link, answer once, and need no account. Links stop working when the review closes. Their answers show up in that person's Raw tab and help the letter.</p>
    ${open ? `<form id="vnew" class="card">
      <label>About <select name="reviewee_id" required>${opt('', 'Pick a person')}${members.map((m) => opt(m.id, nameOf(m))).join('')}</select></label>
      <label>The one question <textarea name="question" rows="2">${esc(ask())}</textarea></label>
      <button>Make a link</button>
    </form>` : '<div class="banner info">This review is closed, so community links no longer work.</div>'}
    ${list.length ? `<h2>Links</h2><div class="card">${list.map((v) => `<div class="list-item">
      <div class="row spread"><strong>${esc(v.person)}</strong>${v.answered ? chip('done') : '<span class="small muted">Waiting</span>'}</div>
      <p class="small" style="margin:.3rem 0">${esc(v.question)}</p>
      <div class="row"><button class="small secondary" data-vcopy="${v.id}">Copy link and message</button><button class="quiet small" data-vdel="${v.id}">Delete</button></div>
    </div>`).join('')}</div>` : ''}`;
  const form = $('#vnew', pane);
  if (form) {
    form.reviewee_id.onchange = () => (form.question.value = ask(members.find((m) => m.id === Number(form.reviewee_id.value))));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const made = save(`/api/admin/cycles/${c.id}/voices`, { reviewee_id: Number(form.reviewee_id.value), question: form.question.value }, 'POST');
      await copy(made.then(({ link }) => `Aloha, ${config.director} at ${config.hui} would love one answer from you. It takes a few minutes: ${link} Mahalo!`), 'Link made and copied');
      route();
    };
  }
  for (const b of $$('[data-vcopy]', pane)) {
    const v = list.find((x) => x.id === Number(b.dataset.vcopy));
    b.onclick = () => copy(`Aloha, ${config.director} at ${config.hui} would love one answer from you. It takes a few minutes: ${v.link} Mahalo!`);
  }
  for (const b of $$('[data-vdel]', pane)) b.onclick = async () => confirm('Delete this link? Any answer it got is deleted too.') && (await save(`/api/admin/voices/${b.dataset.vdel}`, {}, 'DELETE'), route());
}

// Talk story scheduler: lay every meeting into the director's open blocks, then hand out calendar files.
async function talks({ cycle: c, members }, pane) {
  const key = `hui360_blocks_${c.id}`;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(key) || '{}');
  } catch {}
  const blocks = saved.blocks?.length ? saved.blocks : [{ date: '', start: '09:00', end: '12:00' }];
  const blockRow = (b, i) => `<div class="row" data-block="${i}">
    <input type="date" value="${esc(b.date)}" aria-label="Date" style="flex:2"><input type="time" value="${esc(b.start)}" aria-label="From" style="flex:1"><input type="time" value="${esc(b.end)}" aria-label="To" style="flex:1">
    <button type="button" class="quiet small" data-unblock="${i}" aria-label="Remove">Remove</button></div>`;
  pane.innerHTML = `
    <p>Each person sits down with ${esc(config.director)} to talk story about their letter. Enter the times you are free, and the app lays out every meeting and makes calendar files to send. It does not touch anyone's calendar.</p>
    <div class="card">
      <h2 style="margin-top:0">When you are free</h2>
      <div id="blocks">${blocks.map(blockRow).join('')}</div>
      <p><button type="button" class="secondary small" id="addblock">Add another time</button></p>
      <div class="row"><label style="flex:1">Each meeting, minutes <input type="number" id="mins" value="${saved.minutes || 45}" min="10" step="5"></label>
        <label style="flex:1">Break between, minutes <input type="number" id="gap" value="${saved.gap ?? 15}" min="0" step="5"></label>
        <label style="flex:2">Where <input id="where" value="${esc(saved.where || '')}" placeholder="The hale, or a video link"></label></div>
      <p style="margin-bottom:0"><button id="layout">Lay out the meetings</button></p>
    </div>
    <div id="schedule"></div>`;
  const read = () => ({
    blocks: $$('[data-block]', pane).map((r) => { const [d, s, e] = $$('input', r); return { date: d.value, start: s.value, end: e.value }; }).filter((b) => b.date && b.start && b.end),
    minutes: Number($('#mins').value) || 45,
    gap: Number($('#gap').value) || 0,
    where: $('#where').value,
  });
  const keep = () => { try { localStorage.setItem(key, JSON.stringify(read())); } catch {} };
  $('#addblock').onclick = () => { $('#blocks').insertAdjacentHTML('beforeend', blockRow({ date: '', start: '09:00', end: '12:00' }, $$('[data-block]', pane).length)); wireBlocks(); };
  const wireBlocks = () => { for (const b of $$('[data-unblock]', pane)) b.onclick = () => { b.parentElement.remove(); keep(); }; };
  wireBlocks();
  pane.oninput = keep;
  const download = (name, events) => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([buildICS(events)], { type: 'text/calendar' })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#layout').onclick = () => {
    const s = read();
    keep();
    if (!s.blocks.length) return toast('Add at least one time you are free');
    const { meetings, unscheduled } = layoutMeetings(s.blocks, members, s.minutes, s.gap);
    const ev = (m) => ({ start: m.start, end: m.end, title: `Talk story: ${nameOf(m.person)} and ${config.director}`, description: `A talk story about ${first(m.person)}'s letter from ${c.name}. Bring the letter and your reflection. Together we set two or three goals for the year ahead.`, location: s.where });
    const time = (d) => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('#schedule').innerHTML = `<h2>Schedule</h2>
      ${unscheduled.length ? `<div class="banner warn">${unscheduled.length} ${unscheduled.length === 1 ? 'person does' : 'people do'} not fit: ${unscheduled.map((p) => esc(nameOf(p))).join(', ')}. Add more time.</div>` : ''}
      <div class="card">${meetings.map((m, i) => `<div class="row spread list-item"><span><strong>${esc(nameOf(m.person))}</strong> <span class="small muted">${esc(time(m.start))}${config.moon ? ` · ${esc(moonFor(m.start).name)}` : ''}</span></span>
        <button class="small secondary" data-ics="${i}">Calendar file</button></div>`).join('')}</div>
      <p class="row"><button id="allics">Download all, one file</button></p>
      <p class="small muted">Open the combined file to add every meeting to your calendar. Send each person their own file, or just the time, with their letter message.</p>`;
    for (const b of $$('[data-ics]', pane)) {
      const m = meetings[Number(b.dataset.ics)];
      b.onclick = () => download(`talk-story-${first(m.person).toLowerCase()}.ics`, [ev(m)]);
    }
    $('#allics').onclick = () => download(`talk-story-${c.name.replace(/\W+/g, '-').toLowerCase()}.ics`, meetings.map(ev));
  };
  if (saved.blocks?.length) $('#layout').click();
}

async function letters({ cycle: c, members, summaries, responses }, pane) {
  const sum = new Map(summaries.map((s) => [s.reviewee_id, s]));
  const closed = ['closed', 'published'].includes(c.status);
  const step = (s) => {
    const x = sum.get(s.id);
    if (!responses[s.id] && !x) return '<span class="muted small">No answers about them</span>';
    if (!x) return 'Read answers, then write a draft';
    if (x.status === 'shared') return `Shared ${esc(fmtDate(x.shared_at, { month: 'short', day: 'numeric' }))}`;
    return x.status === 'ready' ? 'Ready, share it' : 'Draft started, finish and share';
  };
  pane.innerHTML = `
    ${
      closed
        ? `<p>Each person gets a letter about their year. Open a person to read every answer about them, have AI compile a draft, write your final version, and share it. Shared letters show up on their phone, where they can write a reflection back.</p>`
        : '<div class="banner info">Letters open after you close the review in Setup. Until then, answers stay private to the people writing them.</div>'
    }
    ${c.name === 'Sample review (example)' ? '<div class="banner info">This is the sample review, with made up people. Remove it any time from Data.</div>' : '<p class="small muted">Want to see a finished letter first? Load the sample review from <a href="#/data">Data</a>.</p>'}
    <p class="row no-print" id="letterall"></p>
    <div class="scroll"><table><tr><th>Person</th><th>Answers about them</th><th>Letter</th><th></th></tr>
    ${members
      .map(
        (s) => `<tr><td>${esc(nameOf(s))}</td><td>${responses[s.id] || 0}</td>
        <td>${sum.get(s.id) ? chip(sum.get(s.id).status) : ''} <span class="small">${step(s)}</span></td>
        <td>${closed && (responses[s.id] || sum.get(s.id)) ? `<a class="button small secondary" href="#/person/${c.id}/${s.id}">Open</a>` : ''}</td></tr>`,
      )
      .join('')}</table></div>`;
  const shared = members.filter((m) => sum.get(m.id)?.status === 'shared');
  if (shared.length && c.name !== 'Sample review (example)') {
    const { people } = await api(`/api/admin/cycles/${c.id}/links`);
    emailButton($('#letterall'), shared, 'Email everyone whose letter is shared', `Your letter from ${c.name}`, (p) => letterMsg(p, c.name, people.find((x) => x.id === p.id)?.link || location.origin));
  }
}

async function team({ cycle: c }, pane) {
  if (!['closed', 'published'].includes(c.status)) {
    pane.innerHTML = '<div class="banner info">The team report opens after you close the review in Setup.</div>';
    return;
  }
  const { report, stats } = await api(`/api/admin/cycles/${c.id}/team`);
  const text = report ? report.edited ?? report.draft ?? '' : '';
  pane.innerHTML = `
    <h2 class="print-only">Team report</h2>
    <p class="no-print">One report on the whole team: what you do well, where you struggle, what people asked of you, and ideas for next year. It never names anyone. Edit it, print it for your board, or share it with everyone in this review.</p>
    <p><strong>${stats.people}</strong> people took part. <strong>${stats.done} of ${stats.total}</strong> reviews finished (${stats.pct}%).</p>
    <div class="row no-print"><button id="tgen">${text ? 'Regenerate draft' : 'Write a draft'}</button><span class="small muted" id="tstatus"></span></div>
    <div id="tnotes" class="no-print"></div>
    ${
      report?.draft || report?.edited
        ? `<div id="ted">${editorHtml(text, 'Team report')}</div>
      ${report.shared_at ? `<div class="banner no-print">Shared ${esc(fmtDate(report.shared_at))}. Everyone in this review sees it on their home page as What we learned together. Let them know it is there.</div><p class="row no-print" id="teamall"></p>` : ''}
      <p class="row no-print"><button id="tshare" class="${report.shared_at ? 'quiet' : ''}">${report.shared_at ? 'Stop sharing' : 'Share with everyone in this review'}</button>
        <button class="secondary" id="tprint">Print or save as PDF</button></p>`
        : ''
    }`;
  const notes = JSON.parse(sessionStorage.getItem('hui360_team_notes') || '[]');
  sessionStorage.removeItem('hui360_team_notes');
  if (notes.length) $('#tnotes').innerHTML = `<div class="banner info small">${notes.map(esc).join('<br>')}</div>`;
  $('#tgen').onclick = async () => {
    if (report?.edited && !confirm('Regenerating replaces the report, including your edits. Go ahead?')) return;
    $('#tgen').disabled = true;
    $('#tstatus').textContent = 'Reading every answer and writing the draft. This can take a minute.';
    try {
      const r = await api(`/api/admin/cycles/${c.id}/team/draft`, { method: 'POST', json: {} });
      sessionStorage.setItem('hui360_team_notes', JSON.stringify(r.notes || []));
      route();
    } catch (e) {
      $('#tstatus').textContent = e.message;
      $('#tgen').disabled = false;
    }
  };
  board(c, report, stats, pane);
  if (report?.shared_at && $('#teamall')) {
    const { people } = await api(`/api/admin/cycles/${c.id}/links`);
    emailButton($('#teamall'), people, 'Email everyone that it is ready', `What we learned together: ${c.name}`, (p) =>
      `Aloha ${first(p)}, ${config.director} shared what we learned together from ${c.name}, a report on our whole team with no names in it. Read it on your home page: ${p.link}\n\nMahalo!`);
  }
  if (!report?.draft && !report?.edited) return;
  wireEditor($('#ted'), (edited) => api(`/api/admin/cycles/${c.id}/team`, { method: 'PUT', json: { edited } }));
  $('#tprint').onclick = () => print();
  $('#tshare').onclick = async () => {
    const on = !report.shared_at;
    if (!confirm(on ? 'Share the team report with everyone in this review?' : 'Stop sharing the team report?')) return;
    await save(`/api/admin/cycles/${c.id}/team/share`, { shared: on }, 'POST');
    route();
  };
}

// Board report: one page, anonymized, no quotes. Printed on its own.
function board(c, report, stats, pane) {
  const text = report ? report.board_edited ?? report.board_draft ?? '' : '';
  pane.insertAdjacentHTML('beforeend', `
    <section id="board">
      <h2>Board report</h2>
      <p class="no-print">One page for your board: team health, growth themes, participation, and one or two ideas for leadership. No quotes and no names, so nothing in it points to anyone.</p>
      <p class="print-only">${esc(config.hui)} · ${esc(c.name)} · ${stats.people} people took part, ${stats.pct}% of reviews finished.</p>
      <div class="row no-print"><button id="bgen" class="${text ? 'secondary' : ''}">${text ? 'Regenerate board report' : 'Write the board report'}</button><span class="small muted" id="bstatus"></span></div>
      ${text ? `<div id="bed">${editorHtml(text, 'Board report')}</div><p class="no-print"><button class="secondary" id="bprint">Print the board report</button></p>` : ''}
    </section>`);
  $('#bgen').onclick = async () => {
    if (report?.board_edited && !confirm('Regenerating replaces the board report, including your edits. Go ahead?')) return;
    $('#bgen').disabled = true;
    $('#bstatus').textContent = 'Writing. This can take a minute.';
    try {
      await api(`/api/admin/cycles/${c.id}/board/draft`, { method: 'POST', json: {} });
      route();
    } catch (e) {
      $('#bstatus').textContent = e.message;
      $('#bgen').disabled = false;
    }
  };
  if (!text) return;
  wireEditor($('#bed'), (edited) => api(`/api/admin/cycles/${c.id}/board`, { method: 'PUT', json: { edited } }));
  // Print only this section: hide the rest of the page for the print.
  $('#bprint').onclick = () => {
    document.body.classList.add('print-board');
    addEventListener('afterprint', () => document.body.classList.remove('print-board'), { once: true });
    print();
  };
}

// ---------------- one person's workspace ----------------

async function person(cycleId, staffId, tab = 'raw') {
  const base = `/api/admin/cycles/${cycleId}/people/${staffId}`;
  const { summary, person: p, cycle: cyc } = await api(`${base}/summary`);
  app.innerHTML = `
    <p class="small no-print"><a href="#/cycle/${cycleId}/letters">Back to letters</a></p>
    <h1 style="margin:.25rem 0">${esc(nameOf(p))}</h1>
    <nav class="tabs">${['raw', 'draft', 'share'].map((t) => `<a href="#/person/${cycleId}/${staffId}/${t}" class="${t === tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</a>`).join('')}</nav>
    <div id="pane"></div>`;
  const pane = $('#pane');
  const text = () => summary?.edited ?? summary?.draft ?? '';

  if (tab === 'raw') {
    const { groups, tones = {} } = await api(`${base}/raw`);
    const toneNote = [tones.generous && `${tones.generous} ${tones.generous === 1 ? 'tends' : 'tend'} to write more generously than the group`, tones.critical && `${tones.critical} ${tones.critical === 1 ? 'tends' : 'tend'} to write more critically`].filter(Boolean);
    pane.innerHTML = `
      <p class="small muted">Opening this tab is logged. Answers are shuffled within each question, so position tells you nothing about who wrote them.
      Highlight any sentence and tap "Add as quote" to drop it into the draft.</p>
      ${toneNote.length ? `<div class="banner info small">Only you see this. Of the people who reviewed ${esc(first(p))}, ${toneNote.join(', and ')}. Read with that in mind. To keep answers anonymous, it never says which answers are theirs.</div>` : ''}
      ${groups.length ? '' : '<p>No answers about this person.</p>'}
      ${groups
        .map(
          (g) => `<h2>${esc(g.prompt)} <small class="muted">${esc(g.audience)}</small></h2>
          ${g.responses
            .map(
              (r) => `<div class="card">
              ${r.signed_name ? `<p class="small"><span class="chip done">${g.audience === 'mahalo' ? 'From' : 'Signed mahalo from'} ${esc(r.signed_name)}</span></p>` : ''}
              <div class="raw-body">${esc(r.body || '')}</div>
              ${r.audio_key ? `<audio controls preload="none" style="width:100%;margin-top:.5rem" src="/api/admin/file?key=${encodeURIComponent(r.audio_key)}"></audio>` : ''}
              ${r.language && r.language !== 'en' ? `<p class="small muted">Language: ${esc(r.language)}</p>` : ''}
              ${g.audience === 'community' ? `<p class="small muted" style="margin-bottom:0">From outside ${esc(config.hui)}${r.who ? `: ${esc(r.who)}` : ''}</p>` : ''}
              ${g.audience === 'feedback' && r.who ? `<p class="small muted" style="margin-bottom:0">Answered by ${esc(r.who)}</p>` : ''}
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
          ? `<p class="small muted">Edit it like any document. Your changes save as you type. Quotes in the draft were checked word for word against the answers.</p>
             <div id="letter">${editorHtml(text(), `Letter for ${nameOf(p)}`)}</div>
             <label class="check"><input type="checkbox" id="ready" ${summary.status !== 'draft' ? 'checked' : ''} ${summary.status === 'shared' ? 'disabled' : ''}> Ready to share</label>`
          : ''
      }
      <details class="card" id="prep" ${summary?.talk_story_prep ? 'open' : ''}>
        <summary><strong>Talk story prep</strong> <span class="small muted">Only you see this</span></summary>
        <p class="small muted">Openers, one thing to celebrate, one tension worth sitting with, one question to ask, and last year's goals, from the same answers as the letter.</p>
        <div class="summary-doc" style="border:0;padding:0">${md(summary?.talk_story_prep || '')}</div>
        <p style="margin-bottom:0"><button class="secondary small" id="prepgen">${summary?.talk_story_prep ? 'Write it again' : 'Write talk story prep'}</button> <span class="small muted" id="prepstatus"></span></p>
      </details>`;
    $('#prepgen').onclick = async () => {
      $('#prepgen').disabled = true;
      $('#prepstatus').textContent = 'Writing. This can take a minute.';
      try {
        const { prep } = await api(`${base}/prep`, { method: 'POST', json: {} });
        $('#prep .summary-doc').innerHTML = md(prep);
        $('#prepstatus').textContent = '';
        $('#prepgen').textContent = 'Write it again';
      } catch (e) {
        $('#prepstatus').textContent = e.message;
      }
      $('#prepgen').disabled = false;
    };
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
      wireEditor($('#letter'), (edited) => api(`/api/admin/summaries/${summary.id}`, { method: 'PUT', json: { edited } }));
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
  const hasMail = (await channels()).email;
  const canMail = hasMail && emails(p);
  pane.innerHTML = `
    <div class="no-print">
      ${summary.status === 'shared' ? `<div class="banner">Shared ${esc(fmtDate(summary.shared_at))}. ${esc(first(p))} can read it now. Sharing again replaces what they see.</div>` : ''}
      <p>Choose what ${esc(first(p))} will see.</p>
      <div class="row">${parts.map((x, i) => `<label class="check"><input type="checkbox" data-part="${i}" checked> ${esc(x.title)}</label>`).join('')}</div>
      <h2>Preview</h2>
    </div>
    <div class="summary-doc" id="preview"></div>
    <p class="row no-print"><button id="share">Share with ${esc(first(p))}</button><button class="secondary" id="print">Print or save as PDF</button></p>
    ${
      summary.status === 'shared'
        ? `<div class="card no-print"><h2 style="margin-top:0">Let ${esc(first(p))} know</h2>
           <p>${canMail ? `Email ${esc(first(p))} a message with a fresh link that opens their letter, or copy it and send it yourself.` : `Copy this message and send it to ${esc(first(p))} yourself. It has a fresh link that opens their letter.${hasMail ? ` To email it from here, add an email for ${esc(first(p))} and check Send email in People.` : ''}`}</p>
           <p class="row">${canMail ? `<button id="emailtell">Email ${esc(first(p))}</button>` : ''}<button id="tell" class="${canMail ? 'secondary' : ''}">Copy message to ${esc(first(p))}</button></p></div>`
        : ''
    }
    ${summary.reflection ? `<div class="no-print"><h2>${esc(first(p))}'s reflection</h2><div class="card raw-body">${esc(summary.reflection)}</div></div>` : ''}`;
  const chosen = () => parts.filter((_, i) => $(`[data-part="${i}"]`).checked).map((x) => x.lines.join('\n')).join('\n').trim();
  const preview = () => ($('#preview').innerHTML = md(chosen()));
  for (const b of $$('[data-part]', pane)) b.onchange = preview;
  preview();
  $('#print').onclick = () => print();
  const fresh = async () => (await api(`/api/admin/cycles/${cycleId}/links/${staffId}`, { method: 'POST', json: {} })).link;
  $('#tell')?.addEventListener('click', () => copy(fresh().then((link) => letterMsg(p, cyc.name, link))));
  $('#emailtell')?.addEventListener('click', () => sendOrCopy(p, fresh().then((link) => letterMsg(p, cyc.name, link)), `Your letter from ${cyc.name}`));
  $('#share').onclick = async () => {
    if (!confirm(`Share this with ${nameOf(p)}? It also opens their reflection box.`)) return;
    await save(`/api/admin/summaries/${summary.id}/share`, { shared_body: chosen() }, 'POST');
    route();
  };
}

// ---------------- staff ----------------

async function staff() {
  const [{ staff: list }, ch] = await Promise.all([api('/api/admin/staff'), channels()]);
  const row = (s) => {
    const p = `/api/admin/staff/${s.id}`;
    const inp = (f, type = 'text', extra = '') => `<input type="${type}" data-path="${p}" data-f="${f}" value="${esc(s[f] ?? '')}" ${extra}>`;
    return `<tr>
      <td>${inp('name')}</td><td>${inp('preferred_name')}</td><td>${inp('email', 'email')}</td><td>${inp('phone', 'tel')}</td><td>${inp('team', 'text', 'list="groups"')}</td>
      <td><select data-path="${p}" data-f="role">${[['staff', 'Staff'], ['lead', 'Team lead'], ['admin', 'Director']].map(([v, l]) => opt(v, l, s.role)).join('')}</select></td>
      <td><select data-path="${p}" data-f="lang">${[['en', 'English'], ['haw', 'Hawaiian'], ['both', 'Both']].map(([v, l]) => opt(v, l, s.lang)).join('')}</select></td>
      <td>${inp('start_date', 'date')}</td>
      <td><input type="checkbox" data-path="${p}" data-f="send_email" ${s.send_email ? 'checked' : ''} aria-label="Send email to ${esc(nameOf(s))}"></td>
      <td><input type="checkbox" data-path="${p}" data-f="active" ${s.active ? 'checked' : ''} aria-label="Active"></td>
      <td>${s.active ? `<button class="small secondary" data-link="${s.id}" style="white-space:nowrap">${ch.email && emails(s) ? 'Email link' : 'Copy link'}</button>` : ''}</td></tr>`;
  };
  app.innerHTML = `
    <h1>People</h1>
    <p>Everyone who writes or receives reviews goes here once: staff, interns, volunteers, board members. Each review then picks who takes part, in that review's People tab.</p>
    <div class="row" style="align-items:stretch">
      <form id="add" class="card" style="flex:1;min-width:18rem">
        <h2 style="margin-top:0">Add one person</h2>
        <label>Name <input name="name" required></label>
        <div class="row"><label style="flex:1">Goes by <input name="preferred_name"></label><label style="flex:1">Group <input name="team" list="groups" placeholder="Staff"></label></div>
        <div class="row"><label style="flex:1">Email <input name="email" type="email"></label><label style="flex:1">Phone <input name="phone" type="tel"></label></div>
        <label>Language <select name="lang">${opt('en', 'English')}${opt('haw', 'Hawaiian')}${opt('both', 'Both')}</select></label>
        <label class="check"><input type="checkbox" name="send_email" checked> Send email (their link, reminders, and when their letter is ready)</label>
        <p><button>Add</button></p>
      </form>
      <form id="bulk" class="card" style="flex:1;min-width:18rem">
        <h2 style="margin-top:0">Add many at once</h2>
        <label>One person per line: name, then email or phone, then group</label>
        <textarea name="lines" style="min-height:9rem" placeholder="Kainoa Akana, kainoa@example.org, Staff&#10;Lei Kahale, 808-555-0123, Intern"></textarea>
        <p><button>Add everyone</button></p>
      </form>
    </div>
    <h2>Everyone</h2>
    <p class="muted small">Changes save as you go. Joined is the optional date someone started with your organization, not their review. To see who has started or finished a review, open that review's Progress tab. Send email means the app can email them their link, reminders, and when their letter is ready (once email is set up in Data). Uncheck it for anyone who would rather hear from you directly. Sign in link works any time of year, even with no review open, for My page and mahalo. Uncheck Active when someone leaves. Their past reviews stay, and new reviews leave them out. A team lead reads the shared letters of everyone in their Group, and is reviewed by that group in an upward review. Mark yourself Director so staff can review you in an upward review.</p>
    <div class="scroll"><table>
      <tr><th>Name</th><th>Goes by</th><th>Email</th><th>Phone</th><th>Group</th><th>Role</th><th>Language</th><th>Joined</th><th>Send email</th><th>Active</th><th>Sign in link</th></tr>
      ${list.map(row).join('')}
    </table></div>
    ${GROUPS}`;
  bindFields();
  // Their link works all year: in an open review it opens their list, otherwise their page.
  for (const b of $$('[data-link]')) {
    const s = list.find((x) => x.id === Number(b.dataset.link));
    b.onclick = () =>
      sendOrCopy(
        s,
        api(`/api/admin/staff/${s.id}/link`, { method: 'POST', json: {} }).then(({ link }) => `Aloha ${first(s)}, here is your link to ${APP_NAME}: ${link}\n\nIt opens your page, with your goals, mahalo, and letters. It is yours alone, so please do not forward it. Mahalo!`),
        `Your link to ${APP_NAME}`,
      );
  }
  $('#add').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await save('/api/admin/staff', { ...f, send_email: f.send_email ? 1 : 0 }, 'POST');
    route();
  };
  $('#bulk').onsubmit = async (e) => {
    e.preventDefault();
    const lines = new FormData(e.target).get('lines').split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((l) => l[0]);
    for (const [name, contact = '', team = ''] of lines) {
      await api('/api/admin/staff', { method: 'POST', json: { name, team, ...(contact.includes('@') ? { email: contact } : { phone: contact }) } });
    }
    toast(`Added ${lines.length} ${lines.length === 1 ? 'person' : 'people'}`);
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
  const [{ files }, { audit }, settings, { cycles }, ch, { mahalo }] = await Promise.all([api('/api/admin/exports'), api('/api/admin/audit'), api('/api/admin/settings'), api('/api/admin/cycles'), channels(), api('/api/admin/mahalo')]);
  const sampleCycle = cycles.find((c) => c.name === 'Sample review (example)');
  const sample = sampleCycle && { id: sampleCycle.id, person: (await api(`/api/admin/cycles/${sampleCycle.id}`)).summaries[0]?.reviewee_id };
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
    <h2>Sample review</h2>
    <div class="card">
      <p style="margin-top:0">See what a finished review looks like before you run your own. The sample adds a closed review with three made up people, their answers, a finished letter, and a reflection written back. Nobody is contacted.</p>
      <div class="row">${sample ? `<a class="button" href="#/person/${sample.id}/${sample.person}/share">Open the sample letter</a><a class="button secondary" href="#/cycle/${sample.id}/letters">Open the sample review</a><button class="quiet" id="nosample">Remove the sample</button>` : '<button id="sample">Load the sample review</button>'}</div>
    </div>
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
      <label class="check"><input type="checkbox" id="moon" ${settings.moon_calendar !== 'off' ? 'checked' : ''}> Show the Hawaiian moon for today and next to review dates</label>
    </div>
    <h2>Email</h2>
    <div class="card">
      ${ch.email
        ? `<p style="margin-top:0"><strong>Email is set up.</strong> Links, nudges, and letter messages can be emailed from the app to everyone with Send email checked in <a href="#/staff">People</a>. Anyone else, you copy and send yourself.</p>`
        : `<p style="margin-top:0"><strong>Email is not set up yet</strong>, so you copy each link and nudge and send it yourself. Whoever set up the app can turn it on (see the README).</p>`}
      <p class="small">${ch.reply_to
        ? `When someone replies to an email from the app, it goes to <strong>${esc(ch.reply_to)}</strong>, the person marked Director in <a href="#/staff">People</a>.`
        : `Mark someone as Director in <a href="#/staff">People</a>, with an email, so replies to the app's emails reach them.`}</p>
      <label class="check"><input type="checkbox" data-path="/api/admin/settings" data-f="auto_remind" ${settings.auto_remind === '1' ? 'checked' : ''} ${ch.email ? '' : 'disabled'}> Each morning at 7am, email a gentle reminder to anyone still behind in the open review</label>
      <p class="small muted">Needs a CRON_SECRET on the mailer Worker and the app (see the README). Without it, use Today's nudges on the Cycles page.</p>
    </div>
    <h2>Mahalo board</h2>
    <div class="card">
      <p style="margin-top:0" class="small muted">Public mahalo staff have posted. Remove anything that should not be there.</p>
      ${mahalo.length ? mahalo.map((m) => `<div class="row spread list-item"><span><strong>${esc(m.to_name)}</strong> ${esc(m.body)} <span class="small muted">${esc(m.from_name || 'unsigned')}</span></span><button class="quiet small" data-unmahalo="${m.id}">Remove</button></div>`).join('') : '<p class="muted" style="margin:0">None yet.</p>'}
    </div>
    <h2>Audit log</h2>
    <p class="small muted">Every read of raw answers, every draft, share, export, and delete.</p>
    <div class="scroll"><table><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Target</th></tr>
      ${audit.map((a) => `<tr><td>${esc(a.created_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td></tr>`).join('')}
    </table></div>`;
  bindFields();
  $('#moon').onchange = (e) => save('/api/admin/settings', { moon_calendar: e.target.checked ? 'on' : 'off' });
  for (const b of $$('[data-unmahalo]')) b.onclick = async () => confirm('Remove this mahalo from the board?') && (await save(`/api/admin/mahalo/${b.dataset.unmahalo}`, {}, 'DELETE'), route());
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
  $('#sample')?.addEventListener('click', async () => {
    const r = await save('/api/admin/sample', {}, 'POST');
    location.hash = `#/person/${r.id}/${r.person}/share`;
  });
  $('#nosample')?.addEventListener('click', async () => {
    if (!confirm('Remove the sample review and its made up people?')) return;
    await save('/api/admin/sample', {}, 'DELETE');
    route();
  });
  $('#export').onclick = async () => {
    $('#export').disabled = true;
    const r = await save('/api/admin/export', {}, 'POST');
    location.href = `/api/admin/file?key=${encodeURIComponent(`${r.prefix}hui360.json`)}`;
    setTimeout(route, 1000);
  };
}
