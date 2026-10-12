// Offline first: every keystroke and recording lands in IndexedDB before anything
// touches the network. sync() pushes it up and retries with backoff.

let dbp;
function open() {
  return (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('hui360', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('drafts', { keyPath: 'key' });
      req.result.createObjectStore('audio', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const put = (store, val) => tx(store, 'readwrite', (s) => s.put(val));
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const all = (store) => tx(store, 'readonly', (s) => s.getAll());

const listeners = new Set();
export const on = (fn) => listeners.add(fn);
const emit = (e) => listeners.forEach((fn) => fn(e));

// IndexedDB writes are async and die with the tab, so each keystroke also goes to
// localStorage synchronously first. recover() moves any leftovers back on the next load.
const LS = 'hui360_draft:';
const lsGet = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};

export async function saveDraft(rec) {
  const full = { ...rec, dirty: true, v: Date.now() + Math.random() };
  try {
    localStorage.setItem(LS + full.key, JSON.stringify(full));
  } catch {}
  await put('drafts', full);
  if (lsGet(LS + full.key)?.v === full.v) localStorage.removeItem(LS + full.key);
  emit({ type: 'status' });
  soon();
}

async function recover() {
  let keys = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(LS));
  } catch {}
  for (const k of keys) {
    const rec = lsGet(k);
    const cur = rec && (await get('drafts', rec.key));
    if (rec && (!cur || cur.v < rec.v)) await put('drafts', rec);
    localStorage.removeItem(k);
  }
}
export const recovered = recover().catch(() => {});

export async function queueAudio(assignmentId, questionId, blob) {
  await put('audio', { key: `${assignmentId}:${questionId}:${Date.now()}`, assignment_id: assignmentId, question_id: questionId, blob, type: blob.type || 'audio/webm' });
  emit({ type: 'status' });
  sync();
}

export async function pending() {
  const [drafts, audio] = await Promise.all([all('drafts'), all('audio')]);
  return drafts.filter((d) => d.dirty).length + audio.length;
}

let inflight = null;
let backoff = 0;
let timer;
function soon(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(sync, ms);
}

const giveUp = (status) => status === 400 || status === 404 || status === 409 || status === 413;

// One sync at a time. Callers that need the result await the run in flight.
export function sync() {
  if (!navigator.onLine) return Promise.resolve();
  return (inflight ||= run().finally(() => (inflight = null)));
}

// Push everything waiting, for up to `ms`. Used before leaving a page whose counts matter.
export async function flush(ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end && navigator.onLine && (await pending())) {
    await sync();
    if (await pending()) await new Promise((r) => setTimeout(r, 300));
  }
}

async function run() {
  await recovered;
  let sent = 0;
  emit({ type: 'syncing' });
  try {
    for (const a of await all('audio')) {
      emit({ type: 'transcribing', key: `${a.assignment_id}:${a.question_id}` });
      const res = await fetch(`/api/audio?assignment=${a.assignment_id}&question=${a.question_id}`, {
        method: 'POST',
        body: a.blob,
        headers: { 'content-type': a.type },
        credentials: 'same-origin',
      });
      if (res.status === 401) throw Object.assign(new Error('auth'), { auth: true });
      if (giveUp(res.status)) {
        await del('audio', a.key);
        emit({ type: 'audio-rejected', key: `${a.assignment_id}:${a.question_id}`, status: res.status });
        continue;
      }
      if (!res.ok) throw new Error(`audio ${res.status}`);
      const out = await res.json();
      const key = `${a.assignment_id}:${a.question_id}`;
      const d = (await get('drafts', key)) || { key, assignment_id: a.assignment_id, question_id: a.question_id, body: '' };
      const before = (d.body || '').trim();
      const body = [before, out.transcript].filter(Boolean).join('\n\n');
      await put('drafts', { ...d, body, audio_key: out.key, transcript: out.transcript, language: out.language, dirty: true, v: Date.now() });
      await del('audio', a.key);
      sent++;
      emit({ type: 'transcript', key, body, failed: !!out.error });
    }

    for (const d of await all('drafts')) {
      if (!d.dirty) continue;
      const res = d.finish
        ? await fetch(`/api/assignments/${d.assignment_id}/finish`, { method: 'POST', credentials: 'same-origin' })
        : await fetch('/api/answers', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              assignment_id: d.assignment_id,
              question_id: d.question_id,
              body: d.body,
              signed: !!d.signed,
              audio_key: d.audio_key || null,
              transcript: d.transcript || null,
              language: d.language || null,
            }),
          });
      if (res.status === 401) throw Object.assign(new Error('auth'), { auth: true });
      if (giveUp(res.status)) {
        // Keep the words on the phone, stop retrying.
        await put('drafts', { ...d, dirty: false, rejected: res.status });
        emit({ type: 'rejected', key: d.key, status: res.status });
        continue;
      }
      if (!res.ok) throw new Error(`answer ${res.status}`);
      sent++;
      const cur = await get('drafts', d.key);
      if (d.finish) {
        await del('drafts', d.key);
        emit({ type: 'finished', assignment_id: d.assignment_id, ...(await res.json()) });
      } else if (cur && cur.v === d.v) {
        await put('drafts', { ...cur, dirty: false, rejected: undefined });
      }
    }
    backoff = 0;
  } catch (e) {
    if (e.auth) emit({ type: 'auth' });
    backoff = Math.min(60_000, (backoff || 1000) * 2);
  }
  const n = await pending();
  emit({ type: 'status', pending: n });
  if (sent) emit({ type: 'synced' });
  if (n) soon(backoff || 3000);
}

export function startSync(format) {
  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());
  const badge = document.createElement('div');
  badge.className = 'sync-badge';
  badge.hidden = true;
  badge.setAttribute('role', 'status');
  document.body.append(badge);
  on(async (e) => {
    if (e.type !== 'status') return;
    const n = e.pending ?? (await pending());
    badge.hidden = !n;
    badge.textContent = format(n);
  });
  emit({ type: 'status' });
  sync();
}
