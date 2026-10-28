'use strict';
// Phone version (/m): today's arrivals, departures and who's staying; find a reservation; open one to see its rooms,
// needs, instructions and comments, check guests in and out, and add a comment. Installs on the home screen.
const { html, raw, money, dateFmt, dateTimeFmt, time12 } = require('../lib/html');
const { csrfField, icon, CSS, JS, badge } = require('../lib/views');
const { HttpError } = require('../lib/http');
const { str, isDate, addDays, todayIn, own, now } = require('../lib/common');
const R = require('../lib/res');
const CL = require('../lib/checklists');

const CSS2 = CSS.replace('/app.css', '/inn.css');
const TABS = [['/m', 'Today', 'home'], ['/m/upcoming', 'Coming up', 'cal'], ['/m/find', 'Find', 'search'], ['/', 'Full site', 'screen']];

function phone(ctx, { title, back, body, tab = '' }) {
  const s = ctx.settings || {}; const flash = ctx.flash;
  return html`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} – ` : ''}${s.name || 'Inn Ops'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Questrial&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${CSS}"><link rel="stylesheet" href="${CSS2}">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#28143a">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Inn Ops">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"><link rel="apple-touch-icon" href="/static/icon-180.png">
<meta name="csrf" content="${ctx.csrf}">
</head><body class="m inn-m">
<header class="m-top">
  ${back ? html`<a class="m-back" href="${back}" aria-label="Back">${icon('chev')}</a>` : html`<a class="m-logo inn-mlogo" href="/m" aria-label="Home">${icon('key')}</a>`}
  <h1>${title || s.name || 'Inn Ops'}</h1>
  ${back ? html`<a class="m-home" href="/m" aria-label="Home">${icon('home')}</a>` : html`<span class="m-home"></span>`}
</header>
<main id="main" class="m-main">
  ${flash ? html`<div class="flash ${flash.kind}" role="status">${flash.msg}</div>` : ''}
  ${body}
</main>
<nav class="m-tabs inn-tabs" aria-label="Phone menu">${TABS.map(([href, label, ic]) => html`<a href="${href}" class="${tab === href ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`)}</nav>
<script src="${JS}" defer></script><script src="${JS.replace('/app.js', '/inn.js')}" defer></script>
</body></html>`;
}

module.exports = (r, { db }) => {
  const guestOf = (x) => (x.guest_id ? db.get('SELECT * FROM guests WHERE id=?', x.guest_id) : null);
  const live = (where, ...args) => db.all(`SELECT r.* FROM reservations r WHERE ${R.LIVE} AND ${where} ORDER BY r.arrive, r.check_in_time, r.id`, ...args);

  // One small status button (posts to the same place as the full site)
  const btn = (ctx, x, to, label, next, cls = 'primary', confirm = '') => html`<form method="post" action="/reservations/${x.id}/status" class="inline"${confirm ? raw(` data-confirm="${confirm}"`) : ''}>${csrfField(ctx)}
    <input type="hidden" name="to" value="${to}"><input type="hidden" name="next" value="${next}"><button class="btn ${cls}">${label}</button></form>`;
  // The main action for a stay on a given day
  const action = (ctx, x, day, next) => {
    if (['tentative', 'confirmed'].includes(x.status) && x.arrive <= day) return btn(ctx, x, 'checked_in', 'Check in', next);
    if (x.status === 'checked_in' && x.depart <= day) return btn(ctx, x, 'checked_out', 'Check out', next);
    if (x.status === 'checked_in') return badge('In house', 'ok');
    return badge(R.STATUS[x.status].label, R.STATUS[x.status].badge);
  };
  const clFlag = (x) => { const k = ['tentative', 'confirmed'].includes(x.status) ? 'precheck' : x.status === 'checked_in' ? 'checkout' : null; if (!k) return ''; const p = CL.progress(CL.forReservation(db, x, k)); return p.total ? html`<span class="m-flag ${p.done === p.total ? 'ok' : 'cl'}">${k === 'precheck' ? 'Pre-check' : 'Checkout'} ${p.done}/${p.total}</span>` : ''; };
  const flags = (x, t) => html`${clFlag(x)}${x.special_needs ? html`<span class="m-flag need">Needs</span>` : ''}${x.comments ? html`<span class="m-flag note">Comments</span>` : ''}${t && t.balance > 0 ? html`<span class="m-flag due">${money(t.balance)} due</span>` : ''}`;
  const card = (ctx, x, day, next, when) => {
    const t = R.totals(db, x, ctx.settings);
    return html`<li class="m-res st-${x.status}" style="--c:${R.locColor(db.get('SELECT * FROM locations WHERE id=?', x.location_id))}">
      <a href="/m/r/${x.id}"><b>${R.guestName(guestOf(x))}</b><small>${R.whereLine(db, x)}</small><small class="m-when">${when}</small><span class="m-flags">${flags(x, t)}</span></a>
      <div class="m-resact">${action(ctx, x, day, next)}</div></li>`;
  };

  // ---------- Today (or any day)
  r.get('/m', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const d = isDate(ctx.query.d) ? ctx.query.d : today;
    const next = d === today ? '/m' : `/m?d=${d}`;
    const arriving = live('r.arrive=?', d);
    const leaving = live('r.depart=?', d);
    const staying = live('r.arrive<? AND r.depart>?', d, d);
    const sec = (title, list, when, none) => html`<section class="m-card"><h2 class="m-sub">${title} <span class="m-count">${list.length}</span></h2>
      ${list.length ? html`<ul class="m-list m-reslist">${list.map((x) => card(ctx, x, d, next, when(x)))}</ul>` : html`<p class="m-empty">${none}</p>`}</section>`;
    ctx.html(phone(ctx, { tab: '/m', body: html`
      <nav class="m-daynav"><a href="/m?d=${addDays(d, -1)}" aria-label="Previous day">‹</a>
        <a href="/m" class="m-daynav-mid"><b>${d === today ? 'Today' : dateFmt(d, 'dow').split(' ')[0]}</b>, ${dateFmt(d, 'long').split(', ').slice(1).join(', ')}</a>
        <a href="/m?d=${addDays(d, 1)}" aria-label="Next day">›</a></nav>
      ${sec('Arriving', arriving, (x) => `${R.nightsLabel(R.nights(x))}${x.check_in_time ? ` · from ${time12(x.check_in_time)}` : ''}`, 'No one arriving.')}
      ${sec('Leaving', leaving, (x) => `${x.check_out_time ? `by ${time12(x.check_out_time)} · ` : ''}arrived ${dateFmt(x.arrive, 'dow')}`, 'No one leaving.')}
      ${sec('Staying', staying, (x) => `until ${dateFmt(x.depart, 'dow')}`, 'No one else staying.')}` }));
  });

  // ---------- Coming up: arrivals in the next 14 days
  r.get('/m/upcoming', (ctx) => {
    const today = todayIn(ctx.settings.timezone);
    const list = live('r.arrive>? AND r.arrive<=?', today, addDays(today, 14));
    const days = [...new Set(list.map((x) => x.arrive))];
    ctx.html(phone(ctx, { title: 'Coming up', tab: '/m/upcoming', body: html`<p class="m-hint">Arrivals in the next two weeks</p>
      ${days.length ? days.map((d) => html`<section class="m-card"><h2 class="m-sub">${dateFmt(d, 'dow')}</h2><ul class="m-list m-reslist">
        ${list.filter((x) => x.arrive === d).map((x) => card(ctx, x, today, '/m/upcoming', `${R.nightsLabel(R.nights(x))} · until ${dateFmt(x.depart, 'dow')}`))}</ul></section>`)
    : html`<section class="m-card"><p class="m-empty">No arrivals in the next two weeks.</p></section>`}` }));
  });

  // ---------- Find a reservation by guest, room occupant, event or number
  r.get('/m/find', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const q = str(ctx.query.q, 80);
    let list = [];
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      list = db.all(`SELECT r.* FROM reservations r LEFT JOIN guests g ON g.id=r.guest_id WHERE (lower(COALESCE(g.first,'')||' '||COALESCE(g.last,'')) LIKE ? OR lower(COALESCE(g.org_name,'')) LIKE ?
        OR lower(COALESCE(g.phone,'')) LIKE ? OR r.event_id IN (SELECT id FROM events WHERE lower(name) LIKE ?) OR r.id IN (SELECT reservation_id FROM reservation_rooms WHERE lower(COALESCE(occupants,'')) LIKE ?)
        OR CAST(r.id AS TEXT)=?) ORDER BY (r.depart < ?) , abs(julianday(r.arrive) - julianday(?)) LIMIT 40`, like, like, like, like, like, q.replace(/^#/, ''), today, today);
    }
    ctx.html(phone(ctx, { title: 'Find', tab: '/m/find', body: html`<form method="get" class="m-search"><input type="search" name="q" value="${q || ''}" placeholder="Guest, who’s in a room, event or #" aria-label="Search" autofocus><button class="btn primary">Find</button></form>
      ${q ? (list.length ? html`<section class="m-card"><ul class="m-list m-reslist">${list.map((x) => card(ctx, x, today, `/m/find?q=${encodeURIComponent(q)}`, `${dateFmt(x.arrive, 'dow')} – ${dateFmt(x.depart, 'dow')}${x.status === 'cancelled' ? ' · cancelled' : ''}`))}</ul></section>`
        : html`<section class="m-card"><p class="m-empty">Nothing found for “${q}”.</p></section>`) : ''}` }));
  });

  // ---------- One reservation
  r.get('/m/r/:id', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id); const s = ctx.settings; const today = todayIn(s.timezone);
    const g = guestOf(x); const loc = db.get('SELECT * FROM locations WHERE id=?', x.location_id); const rooms = R.roomsOf(db, x.id);
    const ev = x.event_id && db.get('SELECT * FROM events WHERE id=?', x.event_id); const t = R.totals(db, x, s);
    const back = isDate(ctx.query.d) ? `/m?d=${ctx.query.d}` : '/m';
    const here = `/m/r/${x.id}`;
    const pre = CL.forReservation(db, x, 'precheck'); const out = CL.forReservation(db, x, 'checkout'); const preP = CL.progress(pre); const outP = CL.progress(out);
    const notAll = (p, what) => (p.total && p.done < p.total ? `${p.total - p.done} of the ${p.total} ${what} items aren’t ticked yet. Go ahead anyway?` : '');
    const main = ['tentative', 'confirmed'].includes(x.status) ? btn(ctx, x, 'checked_in', x.arrive > today ? `Check in early (due ${dateFmt(x.arrive, 'dow')})` : 'Check in', here, 'primary big', notAll(preP, 'pre-check-in'))
      : x.status === 'checked_in' ? btn(ctx, x, 'checked_out', x.depart > today ? `Check out early (due ${dateFmt(x.depart, 'dow')})` : 'Check out', here, 'primary big', notAll(outP, 'checkout')) : '';
    const by = (id) => (id ? (db.get('SELECT name FROM users WHERE id=?', id) || {}).name : '');
    const clCard = (kind, units, p) => (units.length ? html`<section class="m-card m-cl checklist" id="${kind}"><h2 class="m-sub">${CL.KINDS[kind].label} <span class="cl-count ${p.done === p.total ? 'all' : ''}">${p.done} of ${p.total}</span></h2>
      <form method="post" action="/reservations/${x.id}/checks" data-autocheck="${x.id}">${csrfField(ctx)}<input type="hidden" name="kind" value="${kind}"><input type="hidden" name="next" value="${here}#${kind}">
        ${units.map((u) => html`${units.length > 1 || u.room_id ? html`<h3 class="m-clroom">${u.room}</h3>` : ''}<ul class="plain cl-items">${u.items.map((it) => html`<li class="${it.done ? 'done' : ''}"><label class="check"><input type="checkbox" name="c[]" value="${it.key}"${it.done ? raw(' checked') : ''}><span>${it.text}</span></label>
          ${it.done ? html`<small class="cl-who">${it.done.by || 'Someone'} · ${dateTimeFmt(it.done.at, s.timezone)}</small>` : ''}</li>`)}</ul>`)}
        <noscript><button class="btn">Save ${CL.KINDS[kind].label.toLowerCase()} list</button></noscript></form></section>` : '');
    const undo = x.status === 'checked_in' ? btn(ctx, x, 'confirmed', 'Undo check-in', here, 'ghost small') : x.status === 'checked_out' ? btn(ctx, x, 'checked_in', 'Undo checkout', here, 'ghost small') : '';
    const block = (label, text, cls = '') => (text ? html`<section class="m-card m-note ${cls}"><h2 class="m-sub">${label}</h2><p class="pre">${text}</p></section>` : '');
    ctx.html(phone(ctx, { title: `#${x.id}`, back, body: html`
      <section class="m-card m-reshead" style="--c:${R.locColor(loc)}">
        <div class="m-cardhead"><b class="m-guest">${R.guestName(g)}</b>${badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}</div>
        <p class="m-where">${R.whereLine(db, x)}</p>
        ${g && (g.phone || g.email) ? html`<p class="m-contact">${g.phone ? html`<a class="m-pill" href="tel:${g.phone}">Call ${g.phone}</a> <a class="m-pill" href="sms:${g.phone}">Text</a>` : ''}${g.email ? html` <a class="m-pill" href="mailto:${g.email}">Email</a>` : ''}</p>` : ''}
        <dl class="m-dl">
          <dt>Check-in</dt><dd>${dateFmt(x.arrive, 'dow')}${x.check_in_time ? `, ${time12(x.check_in_time)}` : ''}${x.checked_in_at ? html`<small>in ${dateTimeFmt(x.checked_in_at, s.timezone)}${by(x.checked_in_by) ? ` by ${by(x.checked_in_by)}` : ''}</small>` : ''}</dd>
          <dt>Checkout</dt><dd>${dateFmt(x.depart, 'dow')}${x.check_out_time ? `, ${time12(x.check_out_time)}` : ''}${x.checked_out_at ? html`<small>out ${dateTimeFmt(x.checked_out_at, s.timezone)}${by(x.checked_out_by) ? ` by ${by(x.checked_out_by)}` : ''}</small>` : ''}</dd>
          <dt>Stay</dt><dd>${R.nightsLabel(t.nights)}${x.adults || x.children ? ` · ${[x.adults ? `${x.adults} adult${x.adults === 1 ? '' : 's'}` : '', x.children ? `${x.children} child${x.children === 1 ? '' : 'ren'}` : ''].filter(Boolean).join(', ')}` : ''}</dd>
          ${ev ? html`<dt>Event</dt><dd>${ev.name}</dd>` : ''}
        </dl>
        ${main || undo ? html`<div class="m-actions">${main}${undo}</div>` : ''}
      </section>
      ${block('Special needs', x.special_needs, 'need')}
      ${x.status === 'cancelled' ? '' : html`${['tentative', 'confirmed'].includes(x.status) ? clCard('precheck', pre, preP) : ''}${['checked_in', 'checked_out'].includes(x.status) || x.depart <= today ? clCard('checkout', out, outP) : ''}`}
      ${block('Comments', x.comments, 'note')}
      ${block('Special instructions for the guest', x.special_instructions)}
      <section class="m-card"><h2 class="m-sub">${x.kind === 'buyout' ? 'Whole location · who’s in each room' : 'Rooms'}</h2>
        ${rooms.length ? html`<ul class="m-list m-rooms">${rooms.map((ro) => html`<li><div><b>${ro.name}</b><small>${ro.occupants || '—'}</small>${ro.instructions ? html`<small class="muted">${ro.instructions}</small>` : ''}</div></li>`)}</ul>`
    : html`<p class="m-empty">The whole location.</p>`}
        ${loc && loc.instructions ? html`<p class="m-hint left"><b>${loc.name}:</b> ${loc.instructions}</p>` : ''}</section>
      <section class="m-card"><h2 class="m-sub">Add a comment</h2>
        <form method="post" action="/m/r/${x.id}/comment" class="m-addnote">${csrfField(ctx)}<textarea name="note" rows="2" required maxlength="1000" placeholder="e.g. Arrived late, left key under the mat"></textarea><button class="btn">Save comment</button></form></section>
      <section class="m-card"><h2 class="m-sub">Money</h2><dl class="m-dl">
        <dt>Total</dt><dd>${money(t.total)}</dd><dt>Paid</dt><dd>${money(t.paid)}</dd>
        <dt>${t.balance < 0 ? 'Credit' : 'Balance'}</dt><dd class="${t.balance > 0 ? 'due' : ''}"><b>${money(Math.abs(t.balance))}</b></dd></dl></section>
      <p class="m-hint"><a href="/reservations/${x.id}">Open on the full site</a></p>` }));
  });

  // Comments added from the phone go at the end of the reservation's comments, with when and who
  r.post('/m/r/:id/comment', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id); const note = str(ctx.body.note, 1000);
    if (!note) throw new HttpError(422, 'Type the comment.');
    const stamp = `${dateTimeFmt(now(), ctx.settings.timezone)}, ${ctx.user.name}`;
    db.update('reservations', x.id, { comments: `${x.comments ? `${x.comments}\n` : ''}[${stamp}] ${note}`.slice(0, 6000), updated_at: now() });
    ctx.setFlash('Comment saved.');
    ctx.redirect(`/m/r/${x.id}`);
  });

  // ---------- Home-screen install
  r.get('/manifest.webmanifest', (ctx) => {
    const m = { name: ctx.settings.name || 'Inn Ops', short_name: 'Inn Ops', start_url: '/m', scope: '/', display: 'standalone', background_color: '#f6f3f8', theme_color: '#28143a',
      icons: [{ src: '/static/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/static/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] };
    ctx.send(200, JSON.stringify(m), 'application/manifest+json', { 'Cache-Control': 'no-cache' });
  }, { public: true });
};
