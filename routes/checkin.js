'use strict';
// Check-in desk: pick a location and a day; everyone arriving (and anyone still to check in) with their steps in order:
// pre-check-in list → check in → checkout list → check out. Below, everyone leaving that day.
const { html, raw, dateFmt, dateTimeFmt, time12, money } = require('../lib/html');
const { layout, csrfField, pageHead, badge, icon } = require('../lib/views');
const { int, isDate, addDays, todayIn } = require('../lib/common');
const R = require('../lib/res');
const CL = require('../lib/checklists');

module.exports = (r, { db }) => {
  r.get('/checkin', (ctx) => {
    const s = ctx.settings; const today = todayIn(s.timezone); const q = ctx.query;
    const locs = db.all('SELECT * FROM locations WHERE active=1 ORDER BY sort, name');
    // The location is remembered on this computer
    let loc = q.loc !== undefined ? (q.loc === 'all' ? 0 : int(q.loc) || 0) : int(ctx.cookies.checkin_loc) || 0;
    if (loc && !locs.some((l) => l.id === loc)) loc = 0;
    if (q.loc !== undefined) ctx.setCookie('checkin_loc', String(loc), { maxAge: 365 * 86400 });
    const d = isDate(q.d) ? q.d : today;
    const here = (extra = '') => `/checkin?loc=${loc || 'all'}${d !== today ? `&d=${d}` : ''}${extra}`;
    const where = loc ? ' AND r.location_id=?' : ''; const args = loc ? [loc] : [];
    const list = (sql, ...a) => db.all(`SELECT r.* FROM reservations r WHERE ${R.LIVE} AND ${sql}${where} ORDER BY r.check_in_time, r.arrive, r.id`, ...a, ...args);
    // Arriving that day, plus anyone whose stay has begun but who isn't checked in yet
    const arriving = list("(r.arrive=? OR (r.arrive<? AND r.depart>? AND r.status IN ('tentative','confirmed')))", d, d, d);
    const leaving = list('r.depart=? AND r.arrive<>?', d, d);
    const by = (id) => (id ? (db.get('SELECT name FROM users WHERE id=?', id) || {}).name : '');
    const guest = (x) => R.guestName(x.guest_id ? db.get('SELECT * FROM guests WHERE id=?', x.guest_id) : null);

    const statusBtn = (x, to, label, confirm) => html`<form method="post" action="/reservations/${x.id}/status" class="inline"${confirm ? raw(` data-confirm="${confirm}"`) : ''}>${csrfField(ctx)}
      <input type="hidden" name="to" value="${to}"><input type="hidden" name="next" value="${here(`#r${x.id}`)}"><button class="btn primary">${label}</button></form>`;
    const notAll = (p, what) => (p.total && p.done < p.total ? `${p.total - p.done} of the ${p.total} ${what} items aren’t ticked yet. Go ahead anyway?` : '');
    // One checklist step: a button showing progress that opens the tick boxes
    const listStep = (x, kind, units, p, open) => {
      if (!units.length) return html`<div class="ci-step"><span class="ci-label">${CL.KINDS[kind].label}</span><span class="muted small">No list set up</span></div>`;
      const done = p.total && p.done === p.total;
      return html`<details class="ci-step ci-list"${open ? raw(' open') : ''}><summary><span class="ci-label">${CL.KINDS[kind].label}</span>
          <span class="cl-count ${done ? 'all' : ''}">${done ? 'Completed' : `${p.done} of ${p.total}`}</span></summary>
        <form method="post" action="/reservations/${x.id}/checks" class="ci-form" data-autocheck="${x.id}">${csrfField(ctx)}<input type="hidden" name="kind" value="${kind}"><input type="hidden" name="next" value="${here(`&open=${kind}${x.id}#r${x.id}`)}">
          ${units.map((u) => html`${units.length > 1 || u.room_id ? html`<h4>${u.room}</h4>` : ''}<ul class="plain cl-items">${u.items.map((it) => html`<li class="${it.done ? 'done' : ''}"><label class="check"><input type="checkbox" name="c[]" value="${it.key}"${it.done ? raw(' checked') : ''}><span>${it.text}</span></label>
            ${it.done ? html`<small class="cl-who">${it.done.by || 'Someone'} · ${dateTimeFmt(it.done.at, s.timezone)}</small>` : ''}</li>`)}</ul>`)}
          <noscript><button class="btn small">Save list</button></noscript></form></details>`;
    };
    const card = (x, mode) => {
      const pre = CL.forReservation(db, x, 'precheck'); const out = CL.forReservation(db, x, 'checkout');
      const preP = CL.progress(pre); const outP = CL.progress(out); const t = R.totals(db, x, s);
      const l = locs.find((y) => y.id === x.location_id) || db.get('SELECT * FROM locations WHERE id=?', x.location_id);
      const rooms = R.roomsOf(db, x.id);
      const isIn = ['checked_in', 'checked_out'].includes(x.status); const isOut = x.status === 'checked_out';
      const late = mode === 'arrive' && x.arrive < d;
      const open = q.open || '';
      return html`<article class="ci-card st-${x.status}" id="r${x.id}" style="--c:${R.locColor(l)}">
        <header class="ci-head"><div><a href="/reservations/${x.id}" class="ci-name">${guest(x)}</a> ${badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}${late ? html` ${badge(`Due ${dateFmt(x.arrive, 'dow')}`, 'warn')}` : ''}
            <div class="muted small">${loc ? '' : html`<b>${l ? l.name : ''}</b> · `}${[x.kind === 'buyout' ? 'Whole location' : rooms.map((ro) => ro.name).join(', '), `${dateFmt(x.arrive, 'dow')} – ${dateFmt(x.depart, 'dow')}`,
              mode === 'arrive' ? (x.check_in_time ? `in from ${time12(x.check_in_time)}` : '') : (x.check_out_time ? `out by ${time12(x.check_out_time)}` : '')].filter(Boolean).join(' · ')}</div>
            ${rooms.some((ro) => ro.occupants) ? html`<div class="small">${rooms.filter((ro) => ro.occupants).map((ro) => html`<span class="ci-occ"><b>${ro.name}:</b> ${ro.occupants}</span>`)}</div>` : ''}
            ${x.special_needs ? html`<div class="ci-need"><b>Needs:</b> ${x.special_needs}</div>` : ''}${x.comments ? html`<div class="ci-note"><b>Comments:</b> <span class="pre">${x.comments}</span></div>` : ''}</div>
          ${t.balance > 0 ? html`<span class="ci-due">${money(t.balance)} due</span>` : ''}</header>
        <div class="ci-steps">
          ${mode === 'arrive' ? html`
            ${listStep(x, 'precheck', pre, preP, open === `precheck${x.id}`)}
            <div class="ci-step"><span class="ci-label">Check-in</span>${isIn ? html`<span class="ci-done">${icon('key')} Checked in ${dateTimeFmt(x.checked_in_at, s.timezone)}${by(x.checked_in_by) ? ` by ${by(x.checked_in_by)}` : ''}</span>`
              : statusBtn(x, 'checked_in', 'Check in', notAll(preP, 'pre-check-in'))}</div>` : ''}
          ${isIn || mode === 'leave' ? html`
            ${listStep(x, 'checkout', out, outP, open === `checkout${x.id}`)}
            <div class="ci-step"><span class="ci-label">Checkout</span>${isOut ? html`<span class="ci-done">Checked out ${dateTimeFmt(x.checked_out_at, s.timezone)}${by(x.checked_out_by) ? ` by ${by(x.checked_out_by)}` : ''}</span>`
              : x.status === 'checked_in' ? statusBtn(x, 'checked_out', 'Check out', notAll(outP, 'checkout')) : html`<span class="muted small">Not checked in yet</span>`}</div>` : ''}
        </div></article>`;
    };
    const count = (arr, test) => arr.filter(test).length;
    const body = html`${pageHead('Check-in', html`<a class="btn ghost" href="/m">Phone version</a>`, 'Pick the location and day. Each guest’s steps run left to right: pre-check-in list, check in, then the checkout list and check out.')}
      <nav class="seg-links ci-locs" aria-label="Location"><a href="/checkin?loc=all${d !== today ? `&d=${d}` : ''}" class="${loc ? '' : 'on'}">All locations</a>${locs.map((l) => html`<a href="/checkin?loc=${l.id}${d !== today ? `&d=${d}` : ''}" class="${loc === l.id ? 'on' : ''}"><i class="dot" style="background:${R.locColor(l)}"></i>${l.name}</a>`)}</nav>
      <div class="cal-nav ci-day"><a class="btn small ghost" href="/checkin?loc=${loc || 'all'}&d=${addDays(d, -1)}" aria-label="Day before">‹</a><a class="btn small ghost" href="/checkin?loc=${loc || 'all'}">Today</a><a class="btn small ghost" href="/checkin?loc=${loc || 'all'}&d=${addDays(d, 1)}" aria-label="Day after">›</a>
        <b class="cal-title">${d === today ? 'Today, ' : ''}${dateFmt(d, 'long')}</b></div>
      <section class="ci-sec"><h2>Checking in <small class="muted">${arriving.length ? `${count(arriving, (x) => ['checked_in', 'checked_out'].includes(x.status))} of ${arriving.length} checked in` : ''}</small></h2>
        ${arriving.length ? arriving.map((x) => card(x, 'arrive')) : html`<p class="muted panel">No one checking in${loc ? ' here' : ''} on this day.</p>`}</section>
      <section class="ci-sec"><h2>Checking out <small class="muted">${leaving.length ? `${count(leaving, (x) => x.status === 'checked_out')} of ${leaving.length} checked out` : ''}</small></h2>
        ${leaving.length ? leaving.map((x) => card(x, 'leave')) : html`<p class="muted panel">No one checking out${loc ? ' here' : ''} on this day.</p>`}</section>`;
    ctx.html(layout(ctx, { title: 'Check-in', body }));
  });
};
