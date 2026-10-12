// Shared by every staff page and the admin app.
export const APP_NAME = 'Hui 360'; // The one place the app name lives.
export const REPO_URL = 'https://github.com/olagon/hui-360-review';
export const AUTHOR_URL = 'https://www.linkedin.com/in/olinlagon';

// ---------- language ----------

const LANG_KEY = 'hui360_lang';
export const getLang = () => {
  try {
    return localStorage.getItem(LANG_KEY) || 'en';
  } catch {
    return 'en';
  }
};
export function setLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {}
}

let strings = {};
// Names set by admin (Data, Settings), so every Hui sees its own: {hui} and {director} in any string.
export const config = { hui: 'the Hui', director: 'your director', logo: '' };
export async function initI18n() {
  const get = (url) => fetch(url).then((r) => r.json()).catch(() => ({}));
  const [en, c] = await Promise.all([get('/assets/i18n/en.json'), get('/api/config')]);
  if (c.hui_name) config.hui = c.hui_name;
  if (c.director_name) config.director = c.director_name;
  if (c.logo_v) config.logo = `/api/logo?v=${c.logo_v}`;
  strings = getLang() === 'en' ? en : { ...en, ...(await get('/assets/i18n/haw.json')) };
  document.documentElement.lang = getLang() === 'en' ? 'en' : 'haw';
}
export function t(key, vars = {}) {
  const all = { ...config, ...vars };
  return (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => all[k] ?? '');
}

// ---------- helpers ----------

export async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function fmtDate(s, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  if (!s) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s.replace(' ', 'T') + (s.includes('T') || s.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString(getLang() === 'en' ? 'en-US' : 'haw', opts);
}

// Small Markdown renderer for summaries: headings, quotes, lists, bold, italic.
export function md(src = '') {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])[*_](?!\s)(.+?)[*_](?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  const out = [];
  let para = [];
  let list = null;
  let quote = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    if (list) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
    if (quote) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
    para = [];
    list = quote = null;
  };
  for (const line of src.split('\n')) {
    let m;
    if (!line.trim()) flush();
    else if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      flush();
      const n = Math.min(m[1].length + 1, 4);
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
    } else if ((m = line.match(/^>\s?(.*)/))) {
      if (!quote) flush();
      (quote ||= []).push(m[1]);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (!list) flush();
      (list ||= []).push(m[1]);
    } else {
      if (list || quote) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}

export function toast(msg, ms = 2500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied');
}

// The organization's own logo (set in admin, Data, Settings), if it has one.
export const orgLogo = () => (config.logo ? `<img class="org-logo" src="${config.logo}" alt="${esc(config.hui)}">` : '');

// The niho ring: kapa's niho pattern turned into a circle that points in to one person.
export const mark = (size = 22) => `<img class="mark" src="/favicon.svg" width="${size}" height="${size}" alt="">`;

// Header with the language switch, and the footer every page carries.
// Staff sign out: send anything waiting, then clear this phone so the next person sees nothing.
export async function signOut() {
  const { flush, pending } = await import('./idb.js');
  await flush();
  if ((await pending()) && !confirm(t('signout.unsent'))) return;
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  try {
    for (const k of await caches.keys()) await caches.delete(k);
    for (const k of Object.keys(localStorage)) if (k.startsWith('hui360_draft:')) localStorage.removeItem(k);
    indexedDB.deleteDatabase('hui360');
  } catch {}
  location.href = '/';
}

export function shell({ nav = '', langSwitch = true, onLang, signedIn = false } = {}) {
  const lang = getLang();
  const header = document.createElement('header');
  header.className = 'top';
  header.innerHTML = `<a class="brand" href="/">${mark()} <span>${esc(APP_NAME)}</span></a>
    <nav>${nav}${signedIn ? `<a href="#" id="signout">${esc(t('signout'))}</a>` : ''}${
      langSwitch
        ? `<select id="lang" aria-label="${esc(t('lang.label'))}" style="width:auto;min-height:36px;padding:.25rem .5rem;font-size:.95rem">
        ${['en', 'haw', 'both'].map((l) => `<option value="${l}" ${l === lang ? 'selected' : ''}>${esc(t(`lang.${l}`))}</option>`).join('')}
      </select>`
        : ''
    }</nav>`;
  document.body.prepend(header);
  const footer = document.createElement('footer');
  footer.className = 'foot';
  const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
  footer.innerHTML = `<div>${ext(REPO_URL, t('footer.openSource'))} · ${ext(`${REPO_URL}/blob/main/LICENSE`, t('footer.license'))}</div>
    <div>${esc(t('footer.courtesy', { olin: '%OLIN%' })).replace('%OLIN%', ext(AUTHOR_URL, 'Olin'))}</div>
    <div><a href="/how/">${esc(t('footer.how'))}</a> · <a href="/privacy/">${esc(t('footer.privacy'))}</a></div>`;
  document.body.append(footer);
  $('#signout', header)?.addEventListener('click', (e) => {
    e.preventDefault();
    signOut();
  });
  $('#lang', header)?.addEventListener('change', async (e) => {
    setLang(e.target.value);
    await onLang?.(e.target.value);
    location.reload();
  });
}

export function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
