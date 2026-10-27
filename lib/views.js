'use strict';
// Page layout and form helpers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { html, raw, esc, personName } = require('./html');

// Version stamp so browsers fetch new styles and scripts after an update
const ASSET_V = (() => {
  try { const h = crypto.createHash('sha1'); for (const f of ['app.css', 'app.js', 'inn.css', 'inn.js']) h.update(fs.readFileSync(path.join(__dirname, '..', 'public', f))); return h.digest('hex').slice(0, 10); } catch { return String(Date.now()); }
})();
const CSS = `/static/app.css?v=${ASSET_V}`;
const CSS2 = `/static/inn.css?v=${ASSET_V}`;
const JS = `/static/app.js?v=${ASSET_V}`;
const JS2 = `/static/inn.js?v=${ASSET_V}`;
const HEAD = raw(`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Questrial&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${CSS}"><link rel="stylesheet" href="${CSS2}">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg?v=${ASSET_V}">`);
const SIDE_STATE = raw('<script>try{if(localStorage.getItem("emp-side")==="collapsed")document.documentElement.classList.add("side-collapsed")}catch(e){}</script>');

const NAV = [
  ['/', 'Dashboard', 'home'],
  ['/calendar', 'Calendar', 'cal'],
  ['/datebook', 'Date book', 'book'],
  ['/reservations', 'Reservations', 'bed'],
  ['/guests', 'Guests', 'people'],
  ['/events', 'Events', 'star'],
  ['/reports', 'Reports', 'chart'],
  ['/admin', 'Admin', 'gear', 'admin'],
];

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  book: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>',
  bed: '<path d="M3 18V7M3 13h18v5M21 18v-3a3 3 0 0 0-3-3h-8v4"/><circle cx="7" cy="10.5" r="1.8"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6 0 4.6 1.6 5.4 4.4"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  chev: '<path d="M15 5l-7 7 7 7"/>',
  out: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h9l3 3v15M3 21h18"/><circle cx="13" cy="12.5" r="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.3-6 8-6s7 2 8 6"/>',
};
const icon = (k) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true" class="ico">${ICONS[k] || ''}</svg>`);

function layout(ctx, { title, body, active }) {
  const u = ctx.user; const s = ctx.settings || {};
  const p = ctx.url.pathname;
  const on = (href) => (active ? active === href : href === '/' ? p === '/' : p === href || p.startsWith(`${href}/`));
  const flash = ctx.flash;
  return html`<!doctype html><html lang="en"><head>${HEAD}
<title>${title ? `${title} – ` : ''}${s.name || 'Inn Ops'}</title>${SIDE_STATE}<meta name="csrf" content="${ctx.csrf}"></head>
<body class="staff"><a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <aside class="side">
    <div class="side-top">
      <a class="brand inn-brand" href="/" title="Inn Ops Reservation System"><span class="inn-mark" aria-hidden="true">${icon('key')}</span><span class="inn-word"><b>Inn Ops</b><small>Reservation System</small></span></a>
      <button type="button" class="side-toggle" data-side-toggle aria-label="Collapse the menu" title="Collapse the menu" aria-expanded="true">${icon('chev')}</button>
    </div>
    <div class="brand-org">${s.name && s.name !== 'Inn Ops' ? s.name : ''}</div>
    <nav aria-label="Main">${NAV.filter((n) => !n[3] || (u && u.role === 'admin')).map(([href, label, ic]) => html`<a href="${href}" class="${on(href) ? 'on' : ''}" title="${label}">${icon(ic)}<span>${label}</span></a>`)}</nav>
    <div class="side-foot">
      <a href="/account" title="Your login">${icon('user')}<span>${u ? u.name : ''}</span></a>
      <form method="post" action="/logout">${csrfField(ctx)}<button class="linkish" title="Log out">${icon('out')}<span>Log out</span></button></form>
    </div>
  </aside>
  <main id="main">
    ${flash ? html`<div class="flash ${flash.kind}" role="status">${flash.msg}</div>` : ''}
    ${body}
  </main>
</div>
<script src="${JS}" defer></script><script src="${JS2}" defer></script>
</body></html>`;
}

/** A small page with no menu (sign-in, printouts). */
function bare(ctx, { title, body, cls = 'login' }) {
  return html`<!doctype html><html lang="en"><head>${HEAD}<title>${title} – Inn Ops</title><meta name="csrf" content="${ctx.csrf}"></head>
<body class="${cls}">${body}<script src="${JS}" defer></script><script src="${JS2}" defer></script></body></html>`;
}

// ---------- form helpers
const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
function attrs(a = {}) {
  return raw(Object.entries(a).filter(([, v]) => v !== false && v !== null && v !== undefined).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join(''));
}
function field(label, control, { hint, cls = '' } = {}) {
  return html`<label class="field ${cls}"><span class="lbl">${label}</span>${control}${hint ? html`<small class="hint">${hint}</small>` : ''}</label>`;
}
const input = (name, value, a = {}) => html`<input name="${name}" value="${value ?? ''}"${attrs({ type: 'text', ...a })}>`;
const textarea = (name, value, a = {}) => html`<textarea name="${name}"${attrs({ rows: 3, ...a })}>${value ?? ''}</textarea>`;
function select(name, options, selected, { blank, ...a } = {}) {
  const sel = selected === null || selected === undefined ? '' : String(selected);
  return html`<select name="${name}"${attrs(a)}>${blank !== undefined ? html`<option value="">${blank}</option>` : ''}${options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o.id ?? o.value, o.name ?? o.label];
    return html`<option value="${v}"${String(v) === sel ? raw(' selected') : ''}>${l}</option>`;
  })}</select>`;
}
function check(name, checked, label, a = {}) {
  const { value = 1, ...rest } = a;
  return html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${checked ? raw(' checked') : ''}${attrs(rest)}><span>${label}</span></label>`;
}
function guestPicker(name, guest, { placeholder = 'Search guests…' } = {}) {
  return html`<div class="picker" data-picker="people" data-allow-new>
    <input type="hidden" name="${name}" value="${guest ? guest.id : ''}">
    <input type="search" class="picker-q" autocomplete="off" placeholder="${placeholder}" value="${guest ? personName(guest, 'first') : ''}" aria-label="${placeholder}">
    <ul class="picker-list" role="listbox" hidden></ul></div>`;
}
const pageHead = (title, actions, sub) => html`<header class="page-head"><div><h1>${title}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div>${actions ? html`<div class="actions">${actions}</div>` : ''}</header>`;
const empty = (msg, action) => html`<div class="empty"><p>${msg}</p>${action || ''}</div>`;
const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;

module.exports = { layout, bare, csrfField, attrs, field, input, textarea, select, check, guestPicker, pageHead, empty, badge, icon, CSS, JS };
