'use strict';
// Dashboard: today at a glance. Arriving, leaving, staying tonight, and what's owed.
const { html, money, dateFmt, time12 } = require('../lib/html');
const { layout, csrfField, pageHead, badge } = require('../lib/views');
const { addDays, todayIn } = require('../lib/common');
const R = require('../lib/res');

module.exports = (r, { db }) => {
  r.get('/', (ctx) => {
    const s = ctx.settings; const today = todayIn(s.timezone);
    const live = (sql, ...a) => db.all(`SELECT r.* FROM reservations r WHERE ${R.LIVE} AND ${sql} ORDER BY r.arrive, r.id`, ...a);
    const arriving = live('r.arrive=?', today);
    const leaving = live('r.depart=?', today);
    const staying = live('r.arrive<=? AND r.depart>?', today, today);
    const soon = live('r.arrive>? AND r.arrive<=?', today, addDays(today, 7));
    const guest = (x) => R.guestName(x.guest_id ? db.get('SELECT * FROM guests WHERE id=?', x.guest_id) : null);
    // Rooms in use tonight, by location
    const locs = db.all('SELECT * FROM locations WHERE active=1 ORDER BY sort, name').map((l) => {
      const total = db.get('SELECT COUNT(*) n FROM rooms WHERE location_id=? AND active=1', l.id).n;
      const busy = R.busyRooms(db, today, addDays(today, 1));
      const used = db.all('SELECT id FROM rooms WHERE location_id=? AND active=1', l.id).filter((ro) => busy.has(ro.id)).length;
      return { ...l, total, used };
    });
    const btn = (x, to, label) => html`<form method="post" action="/reservations/${x.id}/status" class="inline">${csrfField(ctx)}<input type="hidden" name="to" value="${to}"><input type="hidden" name="next" value="/"><button class="btn small">${label}</button></form>`;
    const line = (x, extra) => html`<li><a href="/reservations/${x.id}"><b>${guest(x)}</b></a> <span class="muted">${R.whereLine(db, x)}</span>${extra || ''}</li>`;
    const owed = db.all(`SELECT r.* FROM reservations r WHERE ${R.LIVE} AND r.depart >= ? ORDER BY r.arrive LIMIT 400`, addDays(today, -30))
      .map((x) => ({ x, t: R.totals(db, x, s) })).filter(({ x, t }) => (t.depositOwed > 0 && x.deposit_due && x.deposit_due <= addDays(today, 14)) || (t.balance > 0 && x.arrive <= addDays(today, 7)));
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    ctx.html(layout(ctx, { title: 'Dashboard', body: html`${pageHead(`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${ctx.user.name.split(' ')[0]}`, html`<a class="btn ghost" href="/datebook">Date book</a><a class="btn primary" href="/reservations/new">New reservation</a>`, dateFmt(today, 'long'))}
      <div class="stats">
        <div><b>${arriving.length}</b><span>arriving today</span></div><div><b>${leaving.length}</b><span>leaving today</span></div>
        <div><b>${staying.length}</b><span>staying tonight</span></div><div><b>${soon.length}</b><span>arriving in the next 7 days</span></div>
      </div>
      <div class="occ-row">${locs.map((l) => html`<a class="occ" href="/datebook?location=${l.id}" style="--c:${R.locColor(l)}"><b>${l.name}</b><span>${l.total ? `${l.used} of ${l.total} rooms tonight` : 'No rooms yet'}</span>
        <i class="occ-bar"><i style="width:${l.total ? Math.round((l.used / l.total) * 100) : 0}%"></i></i></a>`)}</div>
      <div class="cols">
        <div class="stack">
          <section class="panel"><h2>Arriving today</h2>${arriving.length ? html`<ul class="plain dash-list">${arriving.map((x) => line(x, html` <span class="muted">${x.check_in_time ? `from ${time12(x.check_in_time)}` : ''}</span> ${['tentative', 'confirmed'].includes(x.status) ? btn(x, 'checked_in', 'Check in') : badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}`))}</ul>` : html`<p class="muted">No one arriving today.</p>`}</section>
          <section class="panel"><h2>Leaving today</h2>${leaving.length ? html`<ul class="plain dash-list">${leaving.map((x) => line(x, html` <span class="muted">${x.check_out_time ? `by ${time12(x.check_out_time)}` : ''}</span> ${x.status === 'checked_in' ? btn(x, 'checked_out', 'Check out') : badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}`))}</ul>` : html`<p class="muted">No one leaving today.</p>`}</section>
          <section class="panel"><h2>Staying tonight</h2>${staying.length ? html`<ul class="plain dash-list">${staying.map((x) => line(x, html` <span class="muted">until ${dateFmt(x.depart, 'dow')}</span>`))}</ul>` : html`<p class="muted">No one staying tonight.</p>`}</section>
        </div>
        <aside class="stack">
          <section class="panel"><h2>Coming up</h2>${soon.length ? html`<ul class="plain dash-list">${soon.map((x) => html`<li><b>${dateFmt(x.arrive, 'dow')}</b> <a href="/reservations/${x.id}">${guest(x)}</a> <span class="muted">${R.whereLine(db, x)}</span></li>`)}</ul>` : html`<p class="muted">Nothing in the next 7 days.</p>`}</section>
          ${owed.length ? html`<section class="panel"><h2>Money due</h2><ul class="plain dash-list">${owed.map(({ x, t }) => html`<li><a href="/reservations/${x.id}">${guest(x)}</a> <span class="${t.depositOwed && x.deposit_due < today ? 'err-text' : 'muted'}">${t.depositOwed && x.deposit_due ? `deposit ${money(t.depositOwed)} due ${dateFmt(x.deposit_due)}` : `${money(t.balance)} balance · arrives ${dateFmt(x.arrive, 'dow')}`}</span></li>`)}</ul></section>` : ''}
        </aside>
      </div>` }));
  });
};

