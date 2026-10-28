'use strict';
// Admin, organised like Event Master Plus: a home page of areas (tiles with a short explanation and how each is
// set up), and the same grouped menu down the side of every Admin page.
const { html, raw } = require('./html');
const { layout, pageHead } = require('./views');

const svg = (d) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true" class="ico">${d}</svg>`);
const IC = {
  venue: svg('<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6M9 10h.01M15 10h.01"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5l1.6 1.6L21 2.8"/><path d="M16 14.6c2.6 0 4.6 1.6 5.4 4.4"/>'),
  rooms: svg('<path d="M4 21V4h11v17M15 8h5v13M2 21h20"/><path d="M11 12.5h.01"/>'),
  tasks: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12 7M8 14l1.5 1.5L12 13M14 8.5h3M14 14.5h3"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>'),
};

const SECTIONS = [
  { title: 'Your business', about: 'Who you are and who can sign in.', items: [
    { href: '/admin/business', label: 'Business details', icon: 'venue', about: 'Your name, address, phone, email, website and time zone.',
      status: (ctx) => ctx.settings.name || '' },
    { href: '/admin/users', label: 'Logins', icon: 'users', about: 'Who can sign in, and whether they can use Admin.',
      status: (ctx, db) => { const n = db.get('SELECT COUNT(*) n FROM users WHERE active=1').n; return `${n} active login${n === 1 ? '' : 's'}`; } },
  ] },
  { title: 'Lodging', about: 'Your places to stay and how stays work.', items: [
    { href: '/admin/locations', label: 'Locations and rooms', icon: 'rooms', about: 'Each location and its rooms: rates, check-in and checkout times, instructions, and which checklists they use.',
      status: (ctx, db) => { const l = db.get('SELECT COUNT(*) n FROM locations WHERE active=1').n; const r = db.get('SELECT COUNT(*) n FROM rooms WHERE active=1').n; return `${l} location${l === 1 ? '' : 's'} · ${r} room${r === 1 ? '' : 's'}`; } },
    { href: '/admin/checklists', label: 'Checklists', icon: 'tasks', about: 'Pre-check-in and checkout lists. Pick which ones each location or room uses.',
      status: (ctx, db) => { const n = db.get('SELECT COUNT(*) n FROM checklists WHERE active=1').n; return n ? `${n} list${n === 1 ? '' : 's'}` : 'No lists yet'; } },
    { href: '/admin/stays', label: 'Stay defaults', icon: 'key', about: 'For each location: usual check-in and checkout times, lodging tax, and the note printed on its confirmations.',
      status: (ctx, db) => { const t = [...new Set(db.all('SELECT tax_percent FROM locations WHERE active=1').map((x) => Number(x.tax_percent) || 0))]; return t.length === 1 ? (t[0] ? `Lodging tax ${t[0]}% everywhere` : 'No lodging tax') : 'Lodging tax set by location'; } },
  ] },
];

/** The side menu (folds down on phones and small tablets). */
function adminNav(ctx, cur) {
  const here = SECTIONS.flatMap((s) => s.items).find((i) => i.href === cur);
  return html`<details class="admin-nav" open data-admin-nav>
    <summary><span>Admin menu</span>${here ? html`<b>${here.label}</b>` : ''}</summary>
    <a href="/admin" class="admin-home${cur === '/admin' ? ' on' : ''}"${cur === '/admin' ? raw(' aria-current="page"') : ''}>Admin home</a>
    ${SECTIONS.map((s) => html`<div class="admin-nav-group"><h3>${s.title}</h3>
      ${s.items.map((i) => html`<a href="${i.href}" class="${i.href === cur ? 'on' : ''}"${i.href === cur ? raw(' aria-current="page"') : ''}>${IC[i.icon]}<span>${i.label}</span></a>`)}</div>`)}
  </details>`;
}

/** A page inside Admin: the heading, the side menu and the page's own content. */
function adminPage(ctx, { title, cur, body, sub, crumbs = [] }) {
  const trail = html`<a href="/admin">Admin</a>${crumbs.map(([href, label]) => html` › <a href="${href}">${label}</a>`)} › ${title}`;
  return ctx.html(layout(ctx, { title, active: '/admin', body: html`${pageHead(cur === '/admin' && !crumbs.length ? 'Admin' : title, '', cur === '/admin' && !crumbs.length ? sub : trail)}
    <div class="admin-layout">${adminNav(ctx, cur)}<div class="admin-main">${body}</div></div>` }));
}

/** Admin home: every area, what it's for, and a word on how it's set up. */
function adminHome(ctx, db) {
  return html`${SECTIONS.map((s) => html`<section class="admin-area"><h2>${s.title}</h2><p class="muted">${s.about}</p>
    <div class="admin-tiles">${s.items.map((i) => { let st = ''; try { st = i.status ? i.status(ctx, db) : ''; } catch { st = ''; } return html`<a class="admin-tile" href="${i.href}">
      <span class="admin-tile-ic">${IC[i.icon]}</span><span class="admin-tile-txt"><b>${i.label}</b><span>${i.about}</span>${st ? html`<small class="admin-tile-st">${st}</small>` : ''}</span></a>`; })}</div></section>`)}`;
}

module.exports = { SECTIONS, adminNav, adminPage, adminHome };
