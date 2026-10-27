'use strict';
// Calendar (month and list) and the Date book (each room on its own line, stays drawn across the days).
const { html, dateFmt, MON_LONG } = require('../lib/html');
const { layout, select, pageHead, empty, badge } = require('../lib/views');
const { int, isDate, addDays, addMonths, daysBetween, dow, todayIn, startOfWeek, fromISO } = require('../lib/common');
const R = require('../lib/res');

const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

module.exports = (r, { db }) => {
  const locations = () => db.all('SELECT * FROM locations WHERE active=1 ORDER BY sort, name');
  /** Stays touching the nights from..to (inclusive), with guest and where. */
  function stays(from, to, locId) {
    return db.all(`SELECT r.* FROM reservations r WHERE ${R.LIVE} AND r.arrive <= ? AND r.depart > ? ${locId ? 'AND r.location_id=?' : ''} ORDER BY r.arrive, r.id`, to, from, ...(locId ? [locId] : []))
      .map((x) => {
        const g = x.guest_id && db.get('SELECT * FROM guests WHERE id=?', x.guest_id); const loc = db.get('SELECT * FROM locations WHERE id=?', x.location_id);
        const rooms = R.roomsOf(db, x.id);
        return { ...x, guest: R.guestName(g), loc, color: R.locColor(loc), short: x.kind === 'buyout' ? `${loc.name} buy-out` : `${loc.name}: ${rooms.map((ro) => ro.name).join(', ')}` };
      });
  }
  const chip = (x, d, mini) => html`<a class="chip res-chip st-${x.status}${x.arrive === d ? ' arr' : ''}" style="--c:${x.color}" href="/reservations/${x.id}" title="${x.guest} · ${x.short} · ${dateFmt(x.arrive)} – ${dateFmt(x.depart)}">${x.arrive === d ? html`<b>${mini ? '' : '→ '}${x.guest}</b>` : x.guest}${mini ? '' : html`<small>${x.short}</small>`}</a>`;
  const locFilter = (ctx, loc, keep) => html`<form method="get" class="inline-filter">${Object.entries(keep).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}${select('location', locations(), loc, { blank: 'All locations', 'aria-label': 'Location', 'data-autosubmit': true })}<noscript><button class="btn small">Show</button></noscript></form>`;
  const legend = () => html`<div class="loc-legend">${locations().map((l) => html`<span><i style="background:${R.locColor(l)}"></i>${l.name}</span>`)}</div>`;

  // ---------- Calendar
  r.get('/calendar', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const q = ctx.query;
    const view = q.view === 'list' ? 'list' : 'month';
    const date = isDate(q.date) ? q.date : today; const loc = int(q.location);
    let body;
    if (view === 'month') {
      const first = `${date.slice(0, 8)}01`; const from = startOfWeek(first); const last = addDays(addMonths(first, 1), -1); const to = addDays(startOfWeek(last), 6);
      const all = stays(from, to, loc);
      const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      const f = fromISO(first);
      body = html`<div class="cal-bar">${navBar(`${MON_LONG[f.getUTCMonth()]} ${f.getUTCFullYear()}`, `?view=month&date=${addMonths(first, -1)}${loc ? `&location=${loc}` : ''}`, `?view=month&date=${addMonths(first, 1)}${loc ? `&location=${loc}` : ''}`, `?view=month${loc ? `&location=${loc}` : ''}`)}${locFilter(ctx, loc, { view, date })}</div>
        <div class="month"><div class="mo-head">${DOW3.map((d) => html`<div>${d}</div>`)}</div>
        <div class="mo-grid">${days.map((d) => { const here = all.filter((x) => x.arrive <= d && x.depart > d); const outs = all.filter((x) => x.depart === d).length;
          return html`<div class="mo-day ${d.slice(0, 7) !== first.slice(0, 7) ? 'out' : ''} ${d === today ? 'today' : ''}">
            <a class="mo-n" href="/datebook?from=${d}${loc ? `&location=${loc}` : ''}" title="Open the date book from this day">${fromISO(d).getUTCDate()}</a>
            ${here.slice(0, 5).map((x) => chip(x, d, true))}${here.length > 5 ? html`<a class="more" href="/calendar?view=list&date=${d}${loc ? `&location=${loc}` : ''}">${here.length - 5} more</a>` : ''}
            ${outs ? html`<small class="mo-outs">${outs} leaving</small>` : ''}
            <a class="wk-add" href="/reservations/new?arrive=${d}${loc ? `&location=${loc}` : ''}" aria-label="New reservation arriving ${dateFmt(d)}">+</a></div>`; })}</div></div>${legend()}`;
    } else {
      const from = date; const to = addDays(date, 29);
      const all = stays(from, to, loc);
      const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      body = html`<div class="cal-bar">${navBar(`${dateFmt(from)} – ${dateFmt(to)}`, `?view=list&date=${addDays(from, -30)}${loc ? `&location=${loc}` : ''}`, `?view=list&date=${addDays(from, 30)}${loc ? `&location=${loc}` : ''}`, `?view=list${loc ? `&location=${loc}` : ''}`)}${locFilter(ctx, loc, { view, date })}</div>
        ${days.map((d) => { const arr = all.filter((x) => x.arrive === d); const dep = all.filter((x) => x.depart === d); const stay = all.filter((x) => x.arrive < d && x.depart > d);
          if (!arr.length && !dep.length && !stay.length) return '';
          const row = (x, what) => html`<tr><td><span class="dot" style="background:${x.color}"></span>${what}</td><td><a href="/reservations/${x.id}"><b>${x.guest}</b></a></td><td>${x.short}</td><td>${dateFmt(x.arrive, 'dow')} – ${dateFmt(x.depart, 'dow')}</td><td>${badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}</td></tr>`;
          return html`<section class="panel day-list"><h3>${dateFmt(d, 'long')}${d === today ? html` ${badge('Today', 'ok')}` : ''}</h3><table class="list compact"><tbody>
            ${arr.map((x) => row(x, 'Arriving'))}${dep.map((x) => row(x, 'Leaving'))}${stay.map((x) => row(x, 'Staying'))}</tbody></table></section>`; })}
        ${all.length ? '' : empty('No stays in these 30 days.')}`;
    }
    ctx.html(layout(ctx, { title: 'Calendar', body: html`${pageHead('Calendar', html`<a class="btn ghost" href="/datebook">Date book</a><a class="btn primary" href="/reservations/new">New reservation</a>`)}
      <nav class="tabs"><a href="?view=month${loc ? `&location=${loc}` : ''}" class="${view === 'month' ? 'on' : ''}">Month</a><a href="?view=list${loc ? `&location=${loc}` : ''}" class="${view === 'list' ? 'on' : ''}">List</a></nav>${body}` }));
  });
  const navBar = (title, prev, next, today) => html`<div class="cal-nav"><a class="btn small ghost" href="${prev}" aria-label="Earlier">‹</a><a class="btn small ghost" href="${today}">Today</a><a class="btn small ghost" href="${next}" aria-label="Later">›</a><b class="cal-title">${title}</b></div>`;

  // ---------- Date book: rooms down the side, days across, stays drawn as bars (afternoon arrival to morning departure)
  r.get('/datebook', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const q = ctx.query;
    const n = [7, 14, 30].includes(int(q.days)) ? int(q.days) : 14;
    const from = isDate(q.from) ? q.from : addDays(today, -1); const to = addDays(from, n - 1);
    const loc = int(q.location);
    const locs = locations().filter((l) => !loc || l.id === loc);
    const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    // Every stay in the window, by room (a buy-out covers every room of its location)
    const byRoom = new Map();
    const add = (roomId, x) => { if (!byRoom.has(roomId)) byRoom.set(roomId, []); if (!byRoom.get(roomId).some((y) => y.id === x.id)) byRoom.get(roomId).push(x); };
    for (const x of db.all(`SELECT r.*, rr.room_id, rr.occupants FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id WHERE ${R.LIVE} AND r.arrive <= ? AND r.depart > ?`, to, from)) add(x.room_id, x);
    for (const x of db.all(`SELECT r.* FROM reservations r WHERE ${R.LIVE} AND r.kind='buyout' AND r.arrive <= ? AND r.depart > ?`, to, from)) for (const ro of db.all('SELECT id FROM rooms WHERE location_id=?', x.location_id)) add(ro.id, x);
    const guestOf = new Map(); const gname = (x) => { if (!guestOf.has(x.guest_id)) guestOf.set(x.guest_id, R.guestName(x.guest_id ? db.get('SELECT * FROM guests WHERE id=?', x.guest_id) : null)); return guestOf.get(x.guest_id); };
    const cols = `minmax(150px, 190px) repeat(${n * 2}, minmax(${n > 14 ? 13 : 22}px, 1fr))`;
    const bar = (x, color) => {
      const a = daysBetween(from, x.arrive); const dd = daysBetween(from, x.depart);
      const start = a < 0 ? 2 : 3 + a * 2; const end = dd >= n ? 2 + n * 2 : 3 + dd * 2;
      const occ = x.occupants ? ` (${x.occupants})` : '';
      return html`<a class="db-bar st-${x.status}${a < 0 ? ' cont-l' : ''}${dd >= n ? ' cont-r' : ''}${x.kind === 'buyout' ? ' buyout' : ''}" style="grid-column:${start} / ${end};--c:${color}" href="/reservations/${x.id}"
        title="${gname(x)}${occ} · ${dateFmt(x.arrive)} – ${dateFmt(x.depart)} · ${R.STATUS[x.status].label}${x.kind === 'buyout' ? ' · full buy-out' : ''}"><span>${gname(x)}${x.occupants && x.occupants !== gname(x) ? html`<small> · ${x.occupants}</small>` : ''}</span></a>`;
    };
    const qs = (o) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ from, days: n, location: loc || '', ...o }).filter(([, v]) => v !== '' && v !== null)))}`;
    const body = html`${pageHead('Date book', html`<a class="btn ghost" href="/calendar">Calendar</a><a class="btn primary" href="/reservations/new">New reservation</a>`, 'Each room on its own line. Click a stay to open it, or an empty day to book that room.')}
      <div class="cal-bar">${navBar(`${dateFmt(from)} – ${dateFmt(to)}`, qs({ from: addDays(from, -n) }), qs({ from: addDays(from, n) }), qs({ from: addDays(today, -1) }))}
        <div class="seg-links small">${[7, 14, 30].map((k) => html`<a href="${qs({ days: k })}" class="${k === n ? 'on' : ''}">${k} days</a>`)}</div>
        <form method="get" class="inline-filter"><input type="hidden" name="days" value="${n}"><input type="date" name="from" value="${from}" aria-label="Start from" data-autosubmit>${select('location', locations(), loc, { blank: 'All locations', 'aria-label': 'Location', 'data-autosubmit': true })}</form></div>
      ${locs.length ? html`<div class="datebook" style="--cols:${cols}">
        <div class="db-row db-head"><div class="db-room">Room</div>${days.map((d) => html`<div class="db-day${d === today ? ' today' : ''}${[0, 6].includes(dow(d)) ? ' wkend' : ''}"><small>${n > 14 ? DOW1[dow(d)] : DOW3[dow(d)]}</small><b>${fromISO(d).getUTCDate()}</b></div>`)}</div>
        ${locs.map((l) => { const rooms = db.all('SELECT * FROM rooms WHERE location_id=? AND active=1 ORDER BY sort, name', l.id); const color = R.locColor(l);
          return html`<div class="db-loc" style="--c:${color}"><span class="dot" style="background:${color}"></span>${l.name} <a class="small" href="/reservations/new?kind=buyout&location=${l.id}&arrive=${from > today ? from : today}">Book a buy-out</a></div>
            ${rooms.length ? rooms.map((ro) => html`<div class="db-row">
              <div class="db-room"><b>${ro.name}</b>${ro.max_guests ? html`<small>sleeps ${ro.max_guests}</small>` : ''}</div>
              ${days.map((d, i) => html`<a class="db-cell${d === today ? ' today' : ''}${[0, 6].includes(dow(d)) ? ' wkend' : ''}" style="grid-column:${2 + i * 2} / span 2" href="/reservations/new?room=${ro.id}&arrive=${d}" aria-label="Book ${ro.name} from ${dateFmt(d)}"></a>`)}
              ${(byRoom.get(ro.id) || []).map((x) => bar(x, color))}</div>`) : html`<div class="db-row"><div class="db-room muted">No rooms yet</div></div>`}`; })}
      </div>${legend()}` : empty('No locations yet. Add them under Admin › Locations and rooms.')}`;
    ctx.html(layout(ctx, { title: 'Date book', body }));
  });
};
