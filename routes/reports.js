'use strict';
// Reports: arrivals and departures for a date range, and the room list for one night. Both print.
const { html, dateFmt, time12, money } = require('../lib/html');
const { layout, pageHead, select, icon } = require('../lib/views');
const { int, isDate, addDays, todayIn } = require('../lib/common');
const R = require('../lib/res');

module.exports = (r, { db }) => {
  const locs = () => db.all('SELECT * FROM locations WHERE active=1 ORDER BY sort, name');
  const g = (x) => (x.guest_id ? db.get('SELECT * FROM guests WHERE id=?', x.guest_id) : null);
  r.get('/reports', (ctx) => ctx.html(layout(ctx, { title: 'Reports', body: html`${pageHead('Reports', '', 'Each one prints.')}
    <div class="report-grid"><a class="report-card" href="/reports/arrivals">${icon('cal')}<span><b>Arrivals and departures</b><small>Who’s coming and going each day for a date range, with times, rooms, needs and balances.</small></span></a>
      <a class="report-card" href="/reports/house">${icon('bed')}<span><b>Room list for a night</b><small>Every room and who’s in it on one night, with special needs. The house list for staff.</small></span></a></div>` })));

  const tools = (ctx, inner) => html`<div class="report-tools no-print"><a class="btn ghost" href="/reports">Reports</a>${inner}<button type="button" class="btn primary" data-print>${icon('print')} Print</button></div>`;
  r.get('/reports/arrivals', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const q = ctx.query;
    const from = isDate(q.from) ? q.from : today; const to = isDate(q.to) && q.to >= from ? q.to : addDays(from, 6); const loc = int(q.location);
    const rows = db.all(`SELECT r.* FROM reservations r WHERE ${R.LIVE} AND ((r.arrive BETWEEN ? AND ?) OR (r.depart BETWEEN ? AND ?)) ${loc ? 'AND r.location_id=?' : ''} ORDER BY r.arrive`, from, to, from, to, ...(loc ? [loc] : []));
    const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const line = (x, what) => { const t = R.totals(db, x, ctx.settings); const rooms = R.roomsOf(db, x.id); return html`<tr><td><b>${what}</b> ${what === 'Arriving' ? (x.check_in_time ? time12(x.check_in_time) : '') : (x.check_out_time ? time12(x.check_out_time) : '')}</td>
      <td><b>${R.guestName(g(x))}</b>${g(x) && g(x).phone ? html`<br><small>${g(x).phone}</small>` : ''}</td><td>${R.whereLine(db, x)}${rooms.some((ro) => ro.occupants) ? html`<br><small>${rooms.filter((ro) => ro.occupants).map((ro) => `${ro.name}: ${ro.occupants}`).join(' · ')}</small>` : ''}</td>
      <td>${[x.special_needs, x.special_instructions].filter(Boolean).join(' · ')}</td><td class="num">${t.balance > 0 ? money(t.balance) : ''}</td></tr>`; };
    ctx.html(layout(ctx, { title: 'Arrivals and departures', active: '/reports', body: html`${tools(ctx, html`<form method="get" class="inline-filter"><label>From <input type="date" name="from" value="${from}"></label><label>To <input type="date" name="to" value="${to}"></label>${select('location', locs(), loc, { blank: 'All locations', 'aria-label': 'Location' })}<button class="btn">Show</button></form>`)}
      <article class="report-doc"><header class="rd-head"><div><div class="rd-org">${ctx.settings.name}</div><div class="rd-kind">Arrivals and departures</div></div><div class="rd-meta">${dateFmt(from)} – ${dateFmt(to)}</div></header>
        ${days.map((d) => { const a = rows.filter((x) => x.arrive === d); const dep = rows.filter((x) => x.depart === d); if (!a.length && !dep.length) return '';
          return html`<section class="rd-sec"><h2>${dateFmt(d, 'long')}</h2><table class="rd-table"><thead><tr><th>When</th><th>Guest</th><th>Where</th><th>Needs / instructions</th><th class="num">Balance</th></tr></thead><tbody>${a.map((x) => line(x, 'Arriving'))}${dep.map((x) => line(x, 'Leaving'))}</tbody></table></section>`; })}
        ${rows.length ? '' : html`<p class="rd-none">No arrivals or departures in these dates.</p>`}</article>` }));
  });

  r.get('/reports/house', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const night = isDate(ctx.query.date) ? ctx.query.date : today;
    const busy = R.busyRooms(db, night, addDays(night, 1));
    ctx.html(layout(ctx, { title: 'Room list', active: '/reports', body: html`${tools(ctx, html`<form method="get" class="inline-filter"><label>Night of <input type="date" name="date" value="${night}" data-autosubmit></label></form>`)}
      <article class="report-doc"><header class="rd-head"><div><div class="rd-org">${ctx.settings.name}</div><div class="rd-kind">Room list</div></div><div class="rd-meta">Night of ${dateFmt(night, 'long')}</div></header>
        ${locs().map((l) => { const rooms = db.all('SELECT * FROM rooms WHERE location_id=? AND active=1 ORDER BY sort, name', l.id); if (!rooms.length) return '';
          return html`<section class="rd-sec"><h2>${l.name}</h2><table class="rd-table"><thead><tr><th>Room</th><th>Guest</th><th>Who’s in it</th><th>Stay</th><th>Special needs</th></tr></thead><tbody>
            ${rooms.map((ro) => { const b = busy.get(ro.id); const x = b && db.get('SELECT * FROM reservations WHERE id=?', b.id); const rr = x && db.get('SELECT occupants FROM reservation_rooms WHERE reservation_id=? AND room_id=?', x.id, ro.id);
              return html`<tr><td><b>${ro.name}</b></td>${x ? html`<td><a href="/reservations/${x.id}">${R.guestName(g(x))}</a></td><td>${(rr && rr.occupants) || ''}</td><td>${dateFmt(x.arrive, 'dow')} – ${dateFmt(x.depart, 'dow')}${x.arrive === night ? ' · arriving' : ''}</td><td>${x.special_needs || ''}</td>` : html`<td colspan="4" class="muted">Empty</td>`}</tr>`; })}</tbody></table></section>`; })}
      </article>` }));
  });
};

