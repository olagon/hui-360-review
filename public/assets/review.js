import { api, t, initI18n, shell, esc, getLang, registerSW, APP_NAME, config, $ } from './app.js';
import { get, all, saveDraft, queueAudio, on, startSync, recovered, flush } from './idb.js';

registerSW();
await initI18n();
shell({ signedIn: true, onLang: (lang) => api('/api/me/lang', { method: 'PUT', json: { lang } }).catch(() => {}) });
startSync((n) => t('sync.pending', { n }));

const app = $('#app');
const params = new URLSearchParams(location.search);
const aid = Number(params.get('a'));
const quick = params.has('quick');
const lang = getLang();

let data;
try {
  data = await api(`/api/assignments/${aid}`);
} catch (e) {
  app.innerHTML = `<div class="banner warn">${esc(e.status === 401 ? t('error.login') : t('error.load'))}</div><p><a href="/">${esc(t('review.home'))}</a></p>`;
  throw e;
}

const { assignment, values } = data;
const questions = quick ? data.questions.filter((q) => q.five_min) : data.questions;
const valueById = new Map(values.map((v) => [v.id, v]));
document.title = `${assignment.kind === 'self' ? t('review.forSelf') : assignment.reviewee} · ${APP_NAME}`;

// Server answers, overridden by anything on this phone that has not synced yet.
await recovered;
const state = {};
for (const a of data.answers) state[a.question_id] = { body: a.body || '', signed: a.signed, audio_key: a.audio_key, transcript: a.transcript };
for (const q of data.questions) {
  const d = await get('drafts', `${aid}:${q.id}`);
  if (d && (d.dirty || d.rejected || !state[q.id])) state[q.id] = { body: d.body || '', signed: d.signed, audio_key: d.audio_key, transcript: d.transcript };
}

const keyOf = (qid) => `${aid}:${qid}`;
const answered = async (q) => !!(state[q.id]?.body?.trim() || state[q.id]?.audio_key || (await all('audio')).some((x) => x.key.startsWith(`${keyOf(q.id)}:`)));
const forLine =
  assignment.kind === 'self' ? t('review.forSelf') : t(assignment.kind === 'upward' ? 'review.forUpward' : 'review.forPeer', { name: assignment.reviewee });

let current = null;
let recorder = null;

function setStatus(msg) {
  const el = $('.status');
  if (el) el.textContent = msg;
}

function persist(q) {
  const s = state[q.id];
  saveDraft({ key: keyOf(q.id), assignment_id: aid, question_id: q.id, body: s.body, signed: !!s.signed, audio_key: s.audio_key, transcript: s.transcript })
    .then(() => setStatus(navigator.onLine ? t('review.saved') : t('review.savedLocal')))
    .catch(() => setStatus(t('error.storage')));
}

function go(i) {
  if (recorder) recorder.stop();
  location.hash = String(i);
}

const micIcon = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;

function renderQuestion(i) {
  const q = questions[i];
  current = q;
  state[q.id] ||= { body: '' };
  const s = state[q.id];
  const primary = lang !== 'en' && q.prompt_haw ? q.prompt_haw : q.prompt_en;
  const alt = lang === 'both' && q.prompt_haw ? q.prompt_en : '';
  const value = q.value_id && valueById.get(q.value_id);
  const closed = !assignment.open;
  const anon = assignment.kind === 'self' ? t('review.selfNote') : q.kind === 'mahalo' ? t('review.anonMahalo') : t('review.anon');
  const scale = [1, 2, 3, 4, 5].map((n) => t(`scale.${n}`));

  app.innerHTML = `
    <p class="small muted" style="margin-top:1rem">${esc(forLine)} · ${esc(t('review.of', { n: i + 1, total: questions.length }))}</p>
    <div class="progress" aria-hidden="true"><span style="width:${Math.round((100 * i) / questions.length)}%"></span></div>
    ${closed ? `<div class="banner warn">${esc(t('review.closed'))}</div>` : ''}
    <h1 class="prompt" id="prompt">${esc(primary)}</h1>
    ${alt ? `<p class="prompt-alt">${esc(alt)}</p>` : ''}
    ${value ? `<p class="value-note">${esc(t('review.value', { name: `${value.name_haw}${value.name_en ? ` (${value.name_en})` : ''}` }))}${value.olelo_noeau ? `<br><em>${esc(value.olelo_noeau)}</em>` : ''}</p>` : ''}
    ${
      q.kind === 'scale'
        ? `<div class="scale" role="group" aria-labelledby="prompt">${scale.map((w) => `<button type="button" aria-pressed="${s.body === w}" ${closed ? 'disabled' : ''}>${esc(w)}</button>`).join('')}</div>`
        : `<textarea class="answer" aria-labelledby="prompt" placeholder="${esc(t(config.ai ? 'review.placeholder' : 'review.placeholderType'))}" ${closed ? 'readonly' : ''}>${esc(s.body)}</textarea>
           <div class="tools">
             ${closed || !config.ai ? '' : `<button type="button" class="mic secondary">${micIcon}<span>${esc(t('review.mic'))}</span></button>`}
             <span class="status" role="status"></span>
           </div>`
    }
    ${q.kind === 'mahalo' && assignment.kind !== 'self' ? `<label class="check"><input type="checkbox" id="sign" ${s.signed ? 'checked' : ''} ${closed ? 'disabled' : ''}> ${esc(t('review.sign'))}</label>` : ''}
    <p class="small muted">${esc(anon)}</p>
    <div class="nav">
      <button type="button" class="quiet" id="back" ${i === 0 ? 'disabled' : ''}>${esc(t('review.back'))}</button>
      <span class="row">
        ${!q.required && !closed ? `<button type="button" class="quiet" id="skip">${esc(t('review.skip'))}</button>` : ''}
        <button type="button" id="next">${esc(t(i === questions.length - 1 ? 'review.finish' : 'review.next'))}</button>
      </span>
    </div>`;

  const ta = $('textarea.answer');
  ta?.addEventListener('input', () => {
    s.body = ta.value;
    persist(q);
  });
  for (const b of app.querySelectorAll('.scale button')) {
    b.onclick = () => {
      s.body = b.textContent;
      app.querySelectorAll('.scale button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      persist(q);
    };
  }
  $('#sign')?.addEventListener('change', (e) => {
    s.signed = e.target.checked;
    persist(q);
  });
  $('.mic')?.addEventListener('click', () => toggleMic(q));
  $('#back').onclick = () => go(i - 1);
  $('#skip')?.addEventListener('click', () => go(i + 1));
  $('#next').onclick = async () => {
    if (q.required && !closed && !(await answered(q))) return setStatus(t(config.ai ? 'review.required' : 'review.requiredType')) || ta?.focus();
    go(i + 1);
  };
  if (ta && !s.body && !closed) ta.focus({ preventScroll: true });
}

async function toggleMic(q) {
  if (recorder) return recorder.stop();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return setStatus(t('review.noMic'));
  }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((x) => window.MediaRecorder?.isTypeSupported?.(x));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const started = Date.now();
  const btn = $('.mic');
  const label = btn?.querySelector('span');
  btn?.classList.add('rec');
  if (label) label.textContent = t('review.stop');
  const tick = setInterval(() => {
    const sec = Math.floor((Date.now() - started) / 1000);
    if (current === q) setStatus(t('review.recording', { time: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }));
    if (sec >= 180) rec.stop();
  }, 250);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    clearInterval(tick);
    stream.getTracks().forEach((tr) => tr.stop());
    recorder = null;
    btn?.classList.remove('rec');
    if (label) label.textContent = t('review.mic');
    if (!chunks.length) return;
    await queueAudio(aid, q.id, new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }));
    if (current === q) setStatus(navigator.onLine ? t('review.transcribing') : t('review.audioQueued'));
  };
  recorder = rec;
  rec.start(1000);
}

async function renderEnd() {
  current = null;
  const home = `<p><a class="button" id="home" href="/">${esc(t('review.home'))}</a></p>`;
  // Send the last answers before going back, so the list shows the right count.
  const wire = () =>
    $('#home')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.currentTarget.textContent = t('review.saving');
      await flush();
      location.href = '/';
    });
  if (quick) {
    app.innerHTML = `<h1>${esc(t('review.doneTitle'))}</h1><p>${esc(t('review.quickDoneBody'))}</p>${home}`;
    wire();
    return;
  }
  const missing = [];
  for (const [i, q] of questions.entries()) if (q.required && !(await answered(q))) missing.push(i);
  if (missing.length) {
    app.innerHTML = `<h1>${esc(t('review.almost'))}</h1><p>${esc(t('review.missing', { n: missing.length }))}</p>
      <p><button type="button" id="fix">${esc(t('review.gotoMissing'))}</button></p>`;
    $('#fix').onclick = () => go(missing[0]);
    return;
  }
  if (assignment.open) await saveDraft({ key: `${aid}:finish`, assignment_id: aid, finish: true });
  app.innerHTML = `<h1>${esc(t('review.doneTitle'))}</h1><p>${esc(t('review.doneBody'))}</p>${home}`;
  wire();
}

on((e) => {
  if (e.type === 'transcript') {
    const qid = Number(e.key.split(':')[1]);
    if (!e.key.startsWith(`${aid}:`)) return;
    state[qid] = { ...(state[qid] || {}), body: e.body };
    if (current?.id === qid) {
      const ta = $('textarea.answer');
      if (ta) ta.value = e.body;
      setStatus(e.failed ? t('review.transcribeFailed') : t('review.transcribed'));
    }
  } else if (e.type === 'transcribing' && current && e.key === keyOf(current.id)) {
    setStatus(t('review.transcribing'));
  } else if (e.type === 'rejected' && e.status === 409) {
    setStatus(t('review.closed'));
  } else if (e.type === 'auth') {
    setStatus(t('error.login'));
  } else if (e.type === 'finished' && e.assignment_id === aid && e.ok === false && current === null) {
    app.insertAdjacentHTML('afterbegin', `<div class="banner warn">${esc(t('review.missing', { n: e.missing }))}</div>`);
  }
});

function route() {
  const i = Math.max(0, Math.min(questions.length, Number(location.hash.slice(1)) || 0));
  if (i >= questions.length) renderEnd();
  else renderQuestion(i);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
