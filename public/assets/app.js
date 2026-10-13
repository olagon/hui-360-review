// Shared by every staff page and the admin app.
// The product's name. An organization can show its own (Settings, Organization), like "huiMAU 360".
export const PRODUCT = 'Hui 360';
export let APP_NAME = PRODUCT;
// The build number, shown in every footer. Goes up by 0.1 with each release.
export const VERSION = '0.6';
export const REPO_URL = 'https://github.com/olagon/hui-360-review';
export const AUTHOR_URL = 'https://www.linkedin.com/in/olinlagon';

// ---------- language ----------

const LANG_KEY = 'hui360_lang';
// English unless the organization offers ʻŌlelo Hawaiʻi (Settings, Language) and this person chose it.
export const getLang = () => {
  if (!config.hawaiian) return 'en';
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
export const config = { hui: 'the Hui', director: 'your director', logo: '', moon: true, email: false, ai: true, hawaiian: false };
export async function initI18n() {
  const get = (url) => fetch(url).then((r) => r.json()).catch(() => ({}));
  const [en, c] = await Promise.all([get('/assets/i18n/en.json'), get('/api/config')]);
  if (c.hui_name) config.hui = c.hui_name;
  if (c.director_name) config.director = c.director_name;
  if (c.logo_v) config.logo = `/api/logo?v=${c.logo_v}`;
  config.moon = c.moon_calendar !== 'off';
  config.email = !!c.email;
  config.ai = c.ai !== 'off';
  config.hawaiian = c.hawaiian === 'on';
  APP_NAME = c.app_name?.trim() || PRODUCT;
  // Hawaiian: the starter file, then whatever admins translated in Settings, Translations.
  strings = getLang() === 'en' ? en : { ...en, ...(await get('/assets/i18n/haw.json')), ...((await get('/api/i18n/haw')).strings || {}) };
  // An organization's own word for goals (Settings, Organization) wins in every language.
  if (c.goals_name?.trim()) strings = { ...strings, 'me.huli': c.goals_name.trim() };
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
    } else if ((m = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)/))) {
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

// A pressed button shows a small spinner and stays locked until its work is done,
// so a slow send never looks like nothing happened. Only that button locks, never typing.
export async function pressing(button, work) {
  if (!button || button.classList.contains('is-busy')) return work();
  button.classList.add('is-busy');
  const was = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    if (button.isConnected) {
      button.classList.remove('is-busy');
      button.disabled = was;
      button.removeAttribute('aria-busy');
    }
  }
}

export function toast(msg, ms = 2500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

// Takes the text, or a promise of it. Safari only allows a copy during the tap itself, so when
// the text needs a network call first, the promise goes to the clipboard right away.
export async function copy(text, done = 'Copied') {
  try {
    if (typeof text !== 'string' && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': Promise.resolve(text).then((s) => new Blob([s], { type: 'text/plain' })) })]);
    } else await navigator.clipboard.writeText(await text);
  } catch {
    try {
      const ta = Object.assign(document.createElement('textarea'), { value: await text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e) {
      return toast(e.message || 'Could not copy', 4000);
    }
  }
  if (done) toast(done);
}

// Copies formatted text for a doc or an email (headings, bold, quotes), with a clean
// plain text copy alongside for places that take text only.
export async function copyRich(markdown, title = '') {
  const plain = (title ? `${title}\n\n` : '') + plainText(markdown);
  const html = (title ? `<h2>${esc(title)}</h2>` : '') + md(markdown);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) }),
    ]);
    toast('Copied. Paste it into a doc or an email.');
  } catch {
    copy(plain, 'Copied as plain text. Paste it into a doc or an email.');
  }
}

// Letters and reports are stored as simple marked up text. This reads it as plain words.
export function plainText(src = '') {
  return src
    .split('\n')
    .map((l) => l.replace(/^#{1,4}\s+/, '').replace(/^>\s?/, '    ').replace(/^\s*[-*]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[\s(])[*_](?!\s)(.+?)[*_](?=[\s).,;:!?]|$)/g, '$1$2'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The organization's own logo (set in admin, Data, Settings), if it has one.
export const orgLogo = () => (config.logo ? `<img class="org-logo" src="${config.logo}" alt="${esc(config.hui)}">` : '');

// The niho ring: kapa's niho pattern turned into a circle that points in to one person.
// Next to the name at the top of every page: the organization's own logo when it has one, otherwise the niho ring.
export const mark = (size = 22) =>
  config.logo ? `<img class="mark mark-org" src="${config.logo}" height="${size + 14}" alt="">` : `<img class="mark" src="/favicon.svg" width="${size}" height="${size}" alt="">`;

// An admin who is also on the People list opens their own reviews with one click, no link needed.
export async function openMyReviews() {
  const r = await fetch('/api/admin/as-staff', { method: 'POST', credentials: 'same-origin' });
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error || 'Could not open your reviews', 6000);
  location.href = '/';
}

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
  // Someone who is also an admin signs out of both, so a shared computer is left clean.
  location.href = (await adminStatus()).admin ? '/cdn-cgi/access/logout' : '/';
}

// Is this person signed in as an admin? Asked once per page, so staff pages can link back to admin.
let adminP;
export const adminStatus = () => (adminP ||= fetch('/api/admin-status', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ admin: false })));

export function shell({ nav = '', langSwitch = true, onLang, signedIn = false, home = '/' } = {}) {
  const lang = getLang();
  const header = document.createElement('header');
  header.className = 'top';
  header.innerHTML = `<a class="brand" href="${home}">${mark()} <span>${esc(APP_NAME)}</span></a>
    <nav>${nav}${signedIn ? `<a href="#" id="signout">${esc(t('signout'))}</a>` : ''}${
      langSwitch && config.hawaiian
        ? `<select id="lang" aria-label="${esc(t('lang.label'))}" style="width:auto;min-height:36px;padding:.25rem .5rem;font-size:.95rem">
        ${['en', 'haw', 'both'].map((l) => `<option value="${l}" ${l === lang ? 'selected' : ''}>${esc(t(`lang.${l}`))}</option>`).join('')}
      </select>`
        : ''
    }</nav>`;
  document.body.prepend(header);
  // Admins browsing the staff side get a way back.
  if (home === '/') {
    adminStatus().then((s) => {
      if (s.admin) $('nav', header).insertAdjacentHTML('afterbegin', `<a href="/admin/">${esc(t('nav.admin'))}</a>`);
    });
  }
  if (signedIn) {
    const sub = document.createElement('nav');
    sub.className = 'subnav';
    sub.setAttribute('aria-label', t('nav.label'));
    const here = location.pathname;
    sub.innerHTML = [['/', 'nav.home'], ['/me/', 'nav.me'], ['/mahalo/', 'nav.mahalo']]
      .map(([h, k]) => `<a href="${h}" ${here === h ? 'aria-current="page"' : ''}>${esc(t(k))}</a>`)
      .join('');
    header.after(sub);
  }
  const footer = document.createElement('footer');
  footer.className = 'foot';
  const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
  footer.innerHTML = `<div>${ext(REPO_URL, t('footer.openSource'))} · ${ext(`${REPO_URL}/blob/main/LICENSE`, t('footer.license'))}</div>
    <div>${esc(t('footer.courtesy', { olin: '%OLIN%' })).replace('%OLIN%', ext(AUTHOR_URL, 'Olin Lagon'))}</div>
    <div><a href="/how/">${esc(t('footer.how'))}</a> · <a href="/privacy/">${esc(t('footer.privacy'))}</a></div>
    <div class="small muted">${esc(t('footer.version', { v: VERSION }))}${APP_NAME !== PRODUCT ? ` · ${esc(t('footer.poweredBy', { product: PRODUCT }))}` : ''}</div>`;
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
