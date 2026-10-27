'use strict';
// Reservations: book rooms (or a whole location), who's in each room, dates and times, needs and notes,
// the event it's for, money and payments, check-in and checkout, and a printable confirmation.
const { html, raw, money, centsInput, toCents, dateFmt, dateTimeFmt, time12, personName } = require('../lib/html');
const { layout, bare, csrfField, field, input, textarea, select, guestPicker, pageHead, empty, badge, icon } = require('../lib/views');
const { str, int, arr, own, now, isDate, isTime, addDays, todayIn } = require('../lib/common');
const { HttpError } = require('../lib/http');
const R = require('../lib/res');

const METHODS = [['cash', 'Cash'], ['check', 'Check'], ['card', 'Card'], ['zelle', 'Zelle'], ['venmo', 'Venmo'], ['paypal', 'PayPal'], ['other', 'Other']];
const METHOD = Object.fromEntries(METHODS);

module.exports = (r, { db }) => {
  const locations = () => db.all('SELECT * FROM locations WHERE active=1 ORDER BY sort, name');
  const guestOf = (x) => (x.guest_id ? db.get('SELECT * FROM guests WHERE id=?', x.guest_id) : null);
  const timesFor = (ctx, loc) => ({ in: (loc && loc.check_in_time) || ctx.settings.check_in_time, out: (loc && loc.check_out_time) || ctx.settings.check_out_time });

  // ---------- The list
  r.get('/reservations', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const q = ctx.query;
    const when = ['upcoming', 'here', 'past', 'all'].includes(q.when) ? q.when : 'upcoming';
    const where = ['1=1']; const args = [];
    if (when === 'upcoming') { where.push('r.depart >= ?'); args.push(today); }
    if (when === 'here') { where.push("r.arrive <= ? AND r.depart > ? AND r.status <> 'cancelled'"); args.push(today, today); }
    if (when === 'past') { where.push('r.depart < ?'); args.push(today); }
    const loc = int(q.location); if (loc) { where.push('r.location_id=?'); args.push(loc); }
    if (q.status && R.STATUS[q.status]) { where.push('r.status=?'); args.push(q.status); } else if (when !== 'all' && !q.status) where.push("r.status <> 'cancelled'");
    const term = String(q.q || '').trim();
    if (term) { const like = `%${term.toLowerCase()}%`; where.push(`(r.id IN (SELECT r2.id FROM reservations r2 JOIN guests g ON g.id=r2.guest_id WHERE lower(COALESCE(g.first,'')||' '||COALESCE(g.last,'')||' '||COALESCE(g.org_name,'')) LIKE ?)
      OR r.event_id IN (SELECT id FROM events WHERE lower(name) LIKE ?) OR r.id IN (SELECT reservation_id FROM reservation_rooms WHERE lower(COALESCE(occupants,'')) LIKE ?) OR CAST(r.id AS TEXT)=?)`); args.push(like, like, like, term.replace(/^#/, '')); }
    const rows = db.all(`SELECT r.* FROM reservations r WHERE ${where.join(' AND ')} ORDER BY r.arrive ${when === 'past' ? 'DESC' : ''}, r.id LIMIT 500`, ...args);
    const qs = (o) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ when, location: loc || '', status: q.status || '', q: term, ...o }).filter(([, v]) => v !== '')))}`;
    ctx.html(layout(ctx, { title: 'Reservations', body: html`${pageHead('Reservations', html`<a class="btn primary" href="/reservations/new">New reservation</a>`)}
      <nav class="tabs">${[['upcoming', 'Upcoming'], ['here', 'Staying now'], ['past', 'Past'], ['all', 'All']].map(([v, l]) => html`<a href="${qs({ when: v })}" class="${when === v ? 'on' : ''}">${l}</a>`)}</nav>
      <form class="filters" method="get"><input type="hidden" name="when" value="${when}">
        <input type="search" name="q" value="${term}" placeholder="Guest, who’s in a room, event or #number" aria-label="Search reservations">
        ${select('location', locations(), loc, { blank: 'All locations', 'aria-label': 'Location', 'data-autosubmit': true })}
        ${select('status', Object.entries(R.STATUS).map(([k, v]) => [k, v.label]), q.status, { blank: 'Any status (not cancelled)', 'aria-label': 'Status', 'data-autosubmit': true })}
        <button class="btn">Search</button>${term || loc || q.status ? html`<a class="btn ghost" href="?when=${when}">Clear</a>` : ''}</form>
      ${rows.length ? html`<section class="panel"><table class="list res-list"><thead><tr><th>Guest</th><th>Dates</th><th>Where</th><th>Event</th><th>Status</th><th class="num">Balance</th></tr></thead><tbody>
        ${rows.map((x) => { const t = R.totals(db, x, ctx.settings); const ev = x.event_id && db.get('SELECT name FROM events WHERE id=?', x.event_id); const loc0 = db.get('SELECT * FROM locations WHERE id=?', x.location_id);
          return html`<tr class="${x.status === 'cancelled' ? 'struck' : ''}"><td><span class="dot" style="background:${R.locColor(loc0)}"></span><a href="/reservations/${x.id}"><b>${R.guestName(guestOf(x))}</b></a></td>
            <td>${dateFmt(x.arrive, 'dow')} – ${dateFmt(x.depart, 'dow')} <small class="muted">${R.nightsLabel(t.nights)}</small></td><td>${R.whereLine(db, x)}</td><td>${ev ? ev.name : ''}</td>
            <td>${badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}</td><td class="num ${t.balance > 0 && x.status !== 'cancelled' ? 'due' : ''}">${x.status === 'cancelled' ? '' : money(t.balance)}</td></tr>`; })}</tbody></table></section>`
    : empty('No reservations here.', html`<a class="btn primary" href="/reservations/new">New reservation</a>`)}` }));
  });

  // ---------- The form
  function form(ctx, x, picked) {
    const locs = locations(); const loc = locs.find((l) => l.id === x.location_id) || locs[0];
    const events = db.all('SELECT id, name, start_date, end_date FROM events WHERE COALESCE(end_date, start_date, ?) >= ? OR id=? ORDER BY start_date', '9999', addDays(todayIn(ctx.settings.timezone), -60), x.event_id || 0);
    const busy = isDate(x.arrive) && isDate(x.depart) && x.depart > x.arrive ? R.busyRooms(db, x.arrive, x.depart, x.id || 0) : new Map();
    const t = timesFor(ctx, loc);
    if (!locs.length) return html`<div class="alert warn">Add your locations and rooms first, under <a href="/admin/locations">Admin › Locations and rooms</a>.</div>`;
    return html`<form method="post" action="${x.id ? `/reservations/${x.id}` : '/reservations/new'}" class="stack form-wide res-form" data-dirty-guard data-res-form data-exclude="${x.id || 0}">${csrfField(ctx)}
      <section class="panel"><h2>Who and when</h2>
        <fieldset class="seg kind-seg"><legend class="sr">What’s being booked</legend>
          <label><input type="radio" name="kind" value="rooms"${x.kind !== 'buyout' ? raw(' checked') : ''}> Individual rooms</label>
          <label><input type="radio" name="kind" value="buyout"${x.kind === 'buyout' ? raw(' checked') : ''}> Full buy-out (the whole location)</label></fieldset>
        <div class="grid g4">
          ${field('Guest (who the reservation is for)', guestPicker('guest_id', guestOf(x), { placeholder: 'Search guests (or add a new one)' }), { cls: 'span2' })}
          ${field('Location', html`<select name="location_id" data-res-loc>${locs.map((l) => html`<option value="${l.id}" data-in="${timesFor(ctx, l).in}" data-out="${timesFor(ctx, l).out}" data-buyout="${centsInput(l.buyout_rate_cents)}" data-buyout-w="${centsInput(l.buyout_weekend_rate_cents ?? l.buyout_rate_cents)}"${l.id === loc.id ? raw(' selected') : ''}>${l.name}</option>`)}</select>`)}
          ${field('Event', html`<select name="event_id" data-res-event><option value="">None</option>${events.map((e) => html`<option value="${e.id}" data-start="${e.start_date || ''}" data-end="${e.end_date || ''}"${e.id === x.event_id ? raw(' selected') : ''}>${e.name}${e.start_date ? ` (${dateFmt(e.start_date)}${e.end_date && e.end_date !== e.start_date ? ` – ${dateFmt(e.end_date)}` : ''})` : ''}</option>`)}</select>`, { hint: html`<a href="/events/new" target="_blank" rel="noopener">Add an event</a>` })}
          ${field('Arrives', input('arrive', x.arrive, { type: 'date', required: true }))}
          ${field('Departs', input('depart', x.depart, { type: 'date', required: true }))}
          ${field('Check-in time', input('check_in_time', x.check_in_time || t.in, { type: 'time' }))}
          ${field('Checkout time', input('check_out_time', x.check_out_time || t.out, { type: 'time' }))}
          ${field('Adults', input('adults', x.adults, { type: 'number', min: 0, max: 999 }))}
          ${field('Children', input('children', x.children, { type: 'number', min: 0, max: 999 }))}
          ${field('Status', select('status', Object.entries(R.STATUS).filter(([k]) => k !== 'cancelled' || x.status === 'cancelled').map(([k, v]) => [k, v.label]), x.status || 'confirmed'))}
          <div class="field" data-nights-out></div>
        </div>
      </section>
      <section class="panel"><h2 data-rooms-title>${x.kind === 'buyout' ? 'Rooms and who’s in them' : 'Rooms'}</h2>
        <p class="hint" data-kind-hint>${x.kind === 'buyout' ? 'The whole location is booked; fill in who’s staying in each room.' : 'Tick the rooms, and who’s staying in each. Rooms already booked for those nights are marked.'}</p>
        <div class="buyout-rate grid g4"${x.kind === 'buyout' ? '' : raw(' hidden')} data-buyout-only>${field('Buy-out weekday rate', input('buyout_rate', centsInput(x.buyout_rate_cents ?? loc.buyout_rate_cents), { inputmode: 'decimal', placeholder: '0.00' }), { hint: 'Sun – Thu nights' })}
          ${field('Buy-out weekend rate', input('buyout_wrate', centsInput(x.id && x.kind === 'buyout' ? x.buyout_weekend_rate_cents ?? x.buyout_rate_cents : loc.buyout_weekend_rate_cents ?? loc.buyout_rate_cents), { inputmode: 'decimal', placeholder: '0.00' }), { hint: 'Fri and Sat nights' })}</div>
        ${locs.map((l) => { const rooms = db.all('SELECT * FROM rooms WHERE location_id=? AND (active=1 OR id IN (SELECT room_id FROM reservation_rooms WHERE reservation_id=?)) ORDER BY sort, name', l.id, x.id || 0);
          return html`<div class="room-pick" data-loc-rooms="${l.id}"${l.id === loc.id ? '' : raw(' hidden')}>
            ${rooms.length ? html`<table class="list compact"><thead><tr><th></th><th>Room</th><th>Weekday<small class="muted"> Sun–Thu</small></th><th>Weekend<small class="muted"> Fri, Sat</small></th><th>Who’s staying in it</th><th></th></tr></thead><tbody>
              ${rooms.map((ro) => { const p = picked.get(ro.id); const b = busy.get(ro.id); return html`<tr data-room="${ro.id}" class="${b ? 'busy' : ''}">
                <td><input type="checkbox" name="room_ids[]" value="${ro.id}" aria-label="Book ${ro.name}"${p ? raw(' checked') : ''} data-room-check></td>
                <td><b>${ro.name}</b>${ro.description ? html`<small class="contact-line">${ro.description}</small>` : ''}${ro.max_guests ? html`<small class="contact-line">Sleeps ${ro.max_guests}</small>` : ''}</td>
                <td><input name="rate_${ro.id}" value="${centsInput(p ? p.rate : ro.rate_cents)}" inputmode="decimal" class="short" aria-label="Weekday rate for ${ro.name}" data-room-rate></td>
                <td><input name="wrate_${ro.id}" value="${centsInput(p ? p.wrate : ro.weekend_rate_cents ?? ro.rate_cents)}" inputmode="decimal" class="short" aria-label="Weekend rate for ${ro.name}" data-room-rate></td>
                <td><input name="occ_${ro.id}" value="${p ? p.occupants || '' : ''}" maxlength="300" placeholder="Names" aria-label="Who’s staying in ${ro.name}"></td>
                <td class="avail" data-avail>${b ? html`<span class="badge warn">Booked: ${b.guest}</span>` : ''}</td></tr>`; })}</tbody></table>`
    : html`<p class="muted">${l.name} has no rooms set up, so it’s booked as a whole: choose <b>Full buy-out</b> above. To rent its rooms one at a time, add them under <a href="/admin/locations/${l.id}">Admin › Locations and rooms</a>.</p>`}</div>`; })}
      </section>
      <section class="panel"><h2>Needs and notes</h2>
        ${field('Special needs', textarea('special_needs', x.special_needs, { rows: 2, placeholder: 'Accessibility, allergies, crib, early check-in…' }))}
        ${field('Special instructions', textarea('special_instructions', x.special_instructions, { rows: 2, placeholder: 'For the guest: arrival, keys, parking. Printed on the confirmation.' }))}
        ${field('Comments about the rental', textarea('comments', x.comments, { rows: 3, placeholder: 'For staff only.' }))}
      </section>
      <section class="panel"><h2>Money</h2>
        <div class="grid g4">
          ${field('Discount', input('discount', centsInput(x.discount_cents || null), { inputmode: 'decimal', placeholder: '0.00' }))}
          ${field('Deposit required', input('deposit', centsInput(x.deposit_cents || null), { inputmode: 'decimal', placeholder: '0.00' }))}
          ${field('Deposit due by', input('deposit_due', x.deposit_due, { type: 'date' }))}
        </div>
        <p class="hint">Weekday rates × Sunday–Thursday nights, weekend rates × Friday and Saturday nights${Number(ctx.settings.tax_percent) ? `, less the discount, plus ${ctx.settings.tax_percent}% lodging tax` : ', less the discount'}. Payments are recorded on the reservation.</p>
      </section>
      <div class="form-actions"><button class="btn primary">${x.id ? 'Save reservation' : 'Book it'}</button><a class="btn ghost" href="${x.id ? `/reservations/${x.id}` : '/reservations'}">Cancel</a></div>
    </form>`;
  }

  /** Read the form; refuses double bookings. Returns { rec, rooms: [{ room_id, rate_cents, occupants }] } */
  function read(ctx, existing) {
    const b = ctx.body;
    const kind = b.kind === 'buyout' ? 'buyout' : 'rooms';
    const loc = int(b.location_id) && db.get('SELECT * FROM locations WHERE id=?', int(b.location_id));
    if (!loc) throw new HttpError(422, 'Pick a location.');
    if (!isDate(b.arrive) || !isDate(b.depart)) throw new HttpError(422, 'Enter the arrival and departure dates.');
    if (b.depart <= b.arrive) throw new HttpError(422, 'The departure date has to be after the arrival date (at least one night).');
    if (b.depart > addDays(b.arrive, 366)) throw new HttpError(422, 'A stay can be up to a year.');
    const allRooms = db.all('SELECT * FROM rooms WHERE location_id=? ORDER BY sort, name', loc.id);
    const chosen = kind === 'buyout' ? allRooms.filter((ro) => ro.active || (existing && db.get('SELECT 1 FROM reservation_rooms WHERE reservation_id=? AND room_id=?', existing.id, ro.id)))
      : arr(b.room_ids).map((v) => allRooms.find((ro) => ro.id === int(v))).filter(Boolean);
    if (kind === 'rooms' && !chosen.length) throw new HttpError(422, 'Tick at least one room.');
    const clash = R.conflicts(db, { kind, locationId: loc.id, roomIds: chosen.map((x) => x.id), arrive: b.arrive, depart: b.depart, excludeId: existing ? existing.id : 0 });
    if (clash.length) throw new HttpError(409, `Already booked: ${clash.map((c) => `${c.room} by ${c.guest} (${dateFmt(c.arrive)} – ${dateFmt(c.depart)}, reservation #${c.id})`).join('; ')}.`);
    const guestId = int(b.guest_id) && db.get('SELECT 1 FROM guests WHERE id=?', int(b.guest_id)) ? int(b.guest_id) : null;
    if (!guestId) throw new HttpError(422, 'Pick the guest (or add a new one from the guest box).');
    const status = R.STATUS[b.status] ? b.status : 'confirmed';
    const nn = (v) => { const n = int(v); return n !== null && n >= 0 ? Math.min(n, 999) : null; };
    const rec = { kind, location_id: loc.id, guest_id: guestId, event_id: int(b.event_id) && db.get('SELECT 1 FROM events WHERE id=?', int(b.event_id)) ? int(b.event_id) : null,
      arrive: b.arrive, depart: b.depart, check_in_time: isTime(b.check_in_time) ? b.check_in_time : null, check_out_time: isTime(b.check_out_time) ? b.check_out_time : null,
      adults: nn(b.adults), children: nn(b.children), status, buyout_rate_cents: kind === 'buyout' ? toCents(b.buyout_rate) ?? loc.buyout_rate_cents ?? 0 : null,
      buyout_weekend_rate_cents: kind === 'buyout' ? toCents(b.buyout_wrate) ?? loc.buyout_weekend_rate_cents ?? toCents(b.buyout_rate) ?? loc.buyout_rate_cents ?? 0 : null,
      discount_cents: Math.max(0, toCents(b.discount) || 0), deposit_cents: Math.max(0, toCents(b.deposit) || 0), deposit_due: isDate(b.deposit_due) ? b.deposit_due : null,
      special_needs: str(b.special_needs, 4000), special_instructions: str(b.special_instructions, 4000), comments: str(b.comments, 6000), updated_at: now() };
    const rooms = chosen.map((ro) => { const rate = Math.max(0, toCents(b[`rate_${ro.id}`]) ?? ro.rate_cents); return { room_id: ro.id, rate_cents: rate,
      weekend_rate_cents: Math.max(0, toCents(b[`wrate_${ro.id}`]) ?? ro.weekend_rate_cents ?? rate), occupants: str(b[`occ_${ro.id}`], 300) }; });
    return { rec, rooms };
  }
  const saveRooms = (resId, rooms) => {
    db.run('DELETE FROM reservation_rooms WHERE reservation_id=?', resId);
    for (const x of rooms) db.insert('reservation_rooms', { reservation_id: resId, ...x });
  };
  const pickedOf = (resId) => new Map(R.roomsOf(db, resId).map((x) => [x.id, { rate: x.res_rate, wrate: x.res_weekend, occupants: x.occupants }]));

  r.get('/reservations/new', (ctx) => {
    const q = ctx.query; const today = todayIn(ctx.settings.timezone);
    const arrive = isDate(q.arrive) ? q.arrive : today;
    const room = int(q.room) && db.get('SELECT * FROM rooms WHERE id=?', int(q.room));
    const ev = int(q.event) && db.get('SELECT * FROM events WHERE id=?', int(q.event));
    const x = { kind: q.kind === 'buyout' ? 'buyout' : 'rooms', arrive, depart: isDate(q.depart) && q.depart > arrive ? q.depart : (ev && ev.end_date && ev.end_date > arrive ? ev.end_date : addDays(arrive, 1)),
      location_id: room ? room.location_id : int(q.location) || (ev && ev.location_id) || null, guest_id: int(q.guest) || (ev && ev.contact_id) || null, event_id: ev ? ev.id : null, status: 'confirmed' };
    const picked = new Map(room ? [[room.id, { rate: room.rate_cents, wrate: room.weekend_rate_cents ?? room.rate_cents, occupants: '' }]] : []);
    ctx.html(layout(ctx, { title: 'New reservation', active: '/reservations', body: html`${pageHead('New reservation')}${form(ctx, x, picked)}` }));
  });
  r.post('/reservations/new', (ctx) => {
    const { rec, rooms } = read(ctx, null);
    const id = db.tx(() => { const rid = db.insert('reservations', { ...rec, created_by: ctx.user.id, created_at: now() }); saveRooms(rid, rooms); return rid; });
    ctx.setFlash(`Booked: reservation #${id}.`);
    ctx.redirect(`/reservations/${id}`);
  });
  r.get('/reservations/:id/edit', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id);
    ctx.html(layout(ctx, { title: 'Edit reservation', active: '/reservations', body: html`${pageHead(`Edit reservation #${x.id}`, '', R.guestName(guestOf(x)))}${form(ctx, x, pickedOf(x.id))}` }));
  });
  r.post('/reservations/:id', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id);
    const { rec, rooms } = read(ctx, x);
    if (rec.status === 'checked_in' && !x.checked_in_at) rec.checked_in_at = now();
    if (rec.status === 'checked_out' && !x.checked_out_at) rec.checked_out_at = now();
    db.tx(() => { db.update('reservations', x.id, rec); saveRooms(x.id, rooms); });
    ctx.setFlash('Reservation saved.');
    ctx.redirect(`/reservations/${x.id}`);
  });

  // ---------- One reservation
  r.get('/reservations/:id', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id); const s = ctx.settings; const today = todayIn(s.timezone);
    const g = guestOf(x); const loc = db.get('SELECT * FROM locations WHERE id=?', x.location_id);
    const ev = x.event_id && db.get('SELECT * FROM events WHERE id=?', x.event_id);
    const rooms = R.roomsOf(db, x.id); const t = R.totals(db, x, s);
    const pays = db.all('SELECT p.*, u.name uname FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE reservation_id=? ORDER BY received_on, id', x.id);
    const st = R.STATUS[x.status]; const by = (id) => (id ? (db.get('SELECT name FROM users WHERE id=?', id) || {}).name : '');
    const action = (to, label, cls = '', confirm = '') => html`<form method="post" action="/reservations/${x.id}/status" class="inline"${confirm ? raw(` data-confirm="${confirm}"`) : ''}>${csrfField(ctx)}<input type="hidden" name="to" value="${to}"><button class="btn ${cls}">${label}</button></form>`;
    const actions = html`<a class="btn ghost" href="/reservations">Back to list</a><a class="btn ghost" href="/reservations/${x.id}/confirmation" target="_blank" rel="noopener">${icon('print')} Confirmation</a><a class="btn" href="/reservations/${x.id}/edit">Edit</a>
      ${['tentative', 'confirmed'].includes(x.status) ? action('checked_in', 'Check in', 'primary') : ''}${x.status === 'checked_in' ? action('checked_out', 'Check out', 'primary') : ''}`;
    ctx.html(layout(ctx, { title: `Reservation #${x.id}`, active: '/reservations', body: html`${pageHead(html`${R.guestName(g)} <small class="muted">#${x.id}</small>`, actions,
      html`${badge(st.label, st.badge)} ${dateFmt(x.arrive, 'long')} – ${dateFmt(x.depart, 'long')} · ${R.nightsLabel(t.nights)} · ${R.whereLine(db, x)}`)}
      ${x.status !== 'cancelled' && x.arrive <= today && x.depart > today && x.status !== 'checked_in' ? html`<div class="alert warn">This stay has started but the guest isn’t checked in yet.</div>` : ''}
      <div class="cols">
        <div class="stack">
          <section class="panel"><h2>The stay</h2><dl class="dl">
            <dt>Guest</dt><dd>${g ? html`<a href="/guests/${g.id}">${personName(g, 'first')}</a>${g.phone ? html` · <a href="tel:${g.phone}">${g.phone}</a>` : ''}${g.email ? html` · <a href="mailto:${g.email}">${g.email}</a>` : ''}` : '—'}</dd>
            <dt>Check-in</dt><dd>${dateFmt(x.arrive, 'long')}${x.check_in_time ? `, ${time12(x.check_in_time)}` : ''}${x.checked_in_at ? html` <small class="muted">· checked in ${dateTimeFmt(x.checked_in_at, s.timezone)}</small>` : ''}</dd>
            <dt>Checkout</dt><dd>${dateFmt(x.depart, 'long')}${x.check_out_time ? `, ${time12(x.check_out_time)}` : ''}${x.checked_out_at ? html` <small class="muted">· checked out ${dateTimeFmt(x.checked_out_at, s.timezone)}</small>` : ''}</dd>
            <dt>Location</dt><dd>${loc ? loc.name : ''}${x.kind === 'buyout' ? html` ${badge('Full buy-out')}` : ''}</dd>
            ${x.adults || x.children ? html`<dt>Guests</dt><dd>${[x.adults ? `${x.adults} adult${x.adults === 1 ? '' : 's'}` : null, x.children ? `${x.children} child${x.children === 1 ? '' : 'ren'}` : null].filter(Boolean).join(', ')}</dd>` : ''}
            ${ev ? html`<dt>Event</dt><dd><a href="/events/${ev.id}">${ev.name}</a></dd>` : ''}
            <dt>Booked</dt><dd>${dateTimeFmt(x.created_at, s.timezone)}${by(x.created_by) ? ` by ${by(x.created_by)}` : ''}</dd></dl></section>
          <section class="panel"><h2>Rooms and who’s in them</h2>
            ${rooms.length ? html`<table class="list compact"><tbody>${rooms.map((ro) => html`<tr><td><b>${ro.name}</b>${ro.description ? html`<small class="contact-line">${ro.description}</small>` : ''}</td><td>${ro.occupants || html`<span class="muted">—</span>`}</td>
              <td class="num">${x.kind === 'buyout' ? '' : html`${money(ro.res_rate)}<small class="muted">/night</small>${ro.res_weekend !== ro.res_rate ? html`<small class="contact-line">${money(ro.res_weekend)} Fri, Sat</small>` : ''}`}</td></tr>
              ${ro.instructions ? html`<tr class="sub-note"><td colspan="3"><small>${ro.instructions}</small></td></tr>` : ''}`)}</tbody></table>` : html`<p class="muted">${x.kind === 'buyout' ? 'The whole location (it has no separate rooms).' : 'No rooms.'}</p>`}
            ${loc && loc.instructions ? html`<p class="hint"><b>${loc.name}:</b> ${loc.instructions}</p>` : ''}</section>
          ${x.special_needs || x.special_instructions || x.comments ? html`<section class="panel"><h2>Needs and notes</h2><dl class="dl">
            ${x.special_needs ? html`<dt>Special needs</dt><dd class="pre">${x.special_needs}</dd>` : ''}
            ${x.special_instructions ? html`<dt>Special instructions</dt><dd class="pre">${x.special_instructions}</dd>` : ''}
            ${x.comments ? html`<dt>Comments</dt><dd class="pre">${x.comments}</dd>` : ''}</dl></section>` : ''}
        </div>
        <div class="stack">
          <section class="panel"><h2>Money</h2>
            <table class="list money-table"><tbody>
              ${t.weekdayNights ? html`<tr><td>${x.kind === 'buyout' ? 'Buy-out' : 'Rooms'} ${money(t.nightly)} × ${t.weekdayNights} weeknight${t.weekdayNights === 1 ? '' : 's'}</td><td class="num">${money(t.nightly * t.weekdayNights)}</td></tr>` : ''}
              ${t.weekendNights ? html`<tr><td>${x.kind === 'buyout' ? 'Buy-out' : 'Rooms'} ${money(t.weekendNightly)} × ${t.weekendNights} weekend night${t.weekendNights === 1 ? '' : 's'} <small class="muted">(Fri, Sat)</small></td><td class="num">${money(t.weekendNightly * t.weekendNights)}</td></tr>` : ''}
              ${t.discount ? html`<tr><td>Discount</td><td class="num">−${money(t.discount)}</td></tr>` : ''}
              ${t.tax ? html`<tr><td>Lodging tax ${t.taxPct}%</td><td class="num">${money(t.tax)}</td></tr>` : ''}
              <tr class="tot"><th>Total</th><td class="num"><b>${money(t.total)}</b></td></tr>
              ${pays.map((p) => html`<tr class="pay-line"><td>${p.amount_cents < 0 ? 'Refund' : 'Paid'}: ${METHOD[p.method] || p.method}${p.reference ? ` #${p.reference}` : ''} <small class="muted">${dateFmt(p.received_on)}${p.uname ? ` · ${p.uname}` : ''}</small>
                <form method="post" action="/reservations/${x.id}/payments/${p.id}/delete" class="inline" data-confirm="Remove this payment?">${csrfField(ctx)}<button class="linkish small danger" aria-label="Remove">×</button></form></td><td class="num">${money(-p.amount_cents)}</td></tr>`)}
              <tr class="bal"><th>${t.balance < 0 ? 'Credit' : 'Balance'}</th><td class="num ${t.balance > 0 ? 'due' : ''}"><b>${money(Math.abs(t.balance))}</b></td></tr></tbody></table>
            ${t.deposit ? html`<p class="${t.depositOwed ? 'warn-text' : 'muted'}">Deposit ${money(t.deposit)}${x.deposit_due ? ` due ${dateFmt(x.deposit_due)}` : ''}${t.depositOwed ? ` · ${money(t.depositOwed)} still owed` : ' · paid'}</p>` : ''}
            ${x.status !== 'cancelled' ? html`<form method="post" action="/reservations/${x.id}/payments" class="stack pay-add">${csrfField(ctx)}
              <div class="grid g4">${field('Amount', input('amount', t.balance > 0 ? centsInput(t.depositOwed || t.balance) : '', { inputmode: 'decimal', required: true }))}${field('How', select('method', METHODS, 'card'))}
                ${field('Date', input('received_on', today, { type: 'date' }))}${field('Reference', input('reference', '', { maxlength: 60, placeholder: 'Check #, last 4…' }))}</div>
              <div class="form-actions"><button class="btn">Record payment</button><label class="check"><input type="checkbox" name="refund" value="1"><span>This is a refund</span></label></div></form>` : ''}
          </section>
          <section class="panel"><h2>Status</h2><p>${badge(st.label, st.badge)}</p>
            <div class="form-actions wrap">
              ${x.status === 'tentative' ? action('confirmed', 'Confirm') : ''}
              ${x.status === 'checked_in' ? action('confirmed', 'Undo check-in', 'ghost') : ''}${x.status === 'checked_out' ? action('checked_in', 'Undo checkout', 'ghost') : ''}
              ${x.status === 'cancelled' ? action('confirmed', 'Restore reservation') : action('cancelled', 'Cancel reservation', 'ghost danger', 'Cancel this reservation? Its rooms become free for those nights.')}
            </div></section>
        </div>
      </div>` }));
  });

  r.post('/reservations/:id/status', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id); const to = ctx.body.to;
    if (!R.STATUS[to]) throw new HttpError(422, 'Which status?');
    if (x.status === 'cancelled' && to !== 'cancelled') {
      const clash = R.conflicts(db, { kind: x.kind, locationId: x.location_id, roomIds: R.roomsOf(db, x.id).map((ro) => ro.id), arrive: x.arrive, depart: x.depart, excludeId: x.id });
      if (clash.length) throw new HttpError(409, `It can’t come back: ${clash.map((c) => `${c.room} is now booked by ${c.guest} (#${c.id})`).join('; ')}.`);
    }
    const rec = { status: to, updated_at: now() };
    if (to === 'checked_in') rec.checked_in_at = x.checked_in_at && x.status === 'checked_out' ? x.checked_in_at : now();
    if (to === 'checked_out') rec.checked_out_at = now();
    if (to === 'cancelled') rec.cancelled_at = now();
    if (to === 'confirmed') { rec.checked_in_at = null; rec.checked_out_at = null; rec.cancelled_at = null; }
    if (to === 'checked_in' && x.status === 'checked_out') rec.checked_out_at = null;
    db.update('reservations', x.id, rec);
    ctx.setFlash({ checked_in: 'Checked in.', checked_out: 'Checked out.', cancelled: 'Reservation cancelled.', confirmed: 'Reservation confirmed.', tentative: 'Marked tentative.' }[to]);
    ctx.redirect(ctx.back(`/reservations/${x.id}`));
  });

  r.post('/reservations/:id/payments', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id); const b = ctx.body;
    const amt = toCents(b.amount);
    if (!amt || amt <= 0) throw new HttpError(422, 'Enter the amount.');
    db.insert('payments', { reservation_id: x.id, amount_cents: b.refund === '1' ? -amt : amt, method: METHOD[b.method] ? b.method : 'other', reference: str(b.reference, 60),
      received_on: isDate(b.received_on) ? b.received_on : todayIn(ctx.settings.timezone), user_id: ctx.user.id, created_at: now() });
    ctx.setFlash(b.refund === '1' ? `Refund of ${money(amt)} recorded.` : `${money(amt)} recorded.`);
    ctx.redirect(`/reservations/${x.id}`);
  });
  r.post('/reservations/:id/payments/:pid/delete', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id);
    db.run('DELETE FROM payments WHERE id=? AND reservation_id=?', int(ctx.params.pid), x.id);
    ctx.setFlash('Payment removed.');
    ctx.redirect(`/reservations/${x.id}`);
  });

  // ---------- Printable confirmation for the guest
  r.get('/reservations/:id/confirmation', (ctx) => {
    const x = own(db, 'reservations', ctx.params.id); const s = ctx.settings;
    const g = guestOf(x); const loc = db.get('SELECT * FROM locations WHERE id=?', x.location_id); const rooms = R.roomsOf(db, x.id); const t = R.totals(db, x, s);
    const addr = (o) => [o.address1, [o.city, [o.state, o.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
    ctx.html(bare(ctx, { title: `Confirmation #${x.id}`, cls: 'print-page', body: html`<div class="no-print print-tools"><button type="button" class="btn primary" data-print>${icon('print')} Print</button></div>
      <article class="confirm-doc">
        <header><div><h1>${s.name}</h1><p>${[addr(s), s.phone, s.email].filter(Boolean).join(' · ')}</p></div><div class="c-num">Confirmation<br><b>#${x.id}</b></div></header>
        <h2>${x.status === 'cancelled' ? 'Cancelled reservation' : x.status === 'tentative' ? 'Reservation (tentative)' : 'Reservation confirmed'}</h2>
        <p>Dear ${g ? (g.is_org ? g.org_name : g.first || personName(g, 'first')) : 'Guest'}, ${x.status === 'cancelled' ? 'this reservation has been cancelled.' : 'thank you for your reservation. Here are the details.'}</p>
        <table class="kv"><tbody>
          <tr><td>Guest</td><td>${R.guestName(g)}</td></tr>
          <tr><td>Where</td><td>${loc.name}${addr(loc) ? html`<br><small>${addr(loc)}</small>` : ''}${x.kind === 'buyout' ? ' (the whole location)' : ''}</td></tr>
          <tr><td>Check-in</td><td>${dateFmt(x.arrive, 'long')}${x.check_in_time ? `, from ${time12(x.check_in_time)}` : ''}</td></tr>
          <tr><td>Checkout</td><td>${dateFmt(x.depart, 'long')}${x.check_out_time ? `, by ${time12(x.check_out_time)}` : ''}</td></tr>
          <tr><td>Nights</td><td>${t.nights}</td></tr>
          ${x.adults || x.children ? html`<tr><td>Guests</td><td>${[x.adults ? `${x.adults} adult${x.adults === 1 ? '' : 's'}` : null, x.children ? `${x.children} child${x.children === 1 ? '' : 'ren'}` : null].filter(Boolean).join(', ')}</td></tr>` : ''}
          <tr><td>Room${rooms.length === 1 ? '' : 's'}</td><td>${rooms.map((ro, i) => html`${i ? html`<br>` : ''}<b>${ro.name}</b>${ro.occupants ? ` · ${ro.occupants}` : ''}`)}</td></tr>
        </tbody></table>
        ${loc.instructions || x.special_instructions || rooms.some((ro) => ro.instructions) ? html`<h3>Good to know</h3>
          ${loc.instructions ? html`<p class="pre">${loc.instructions}</p>` : ''}${rooms.filter((ro) => ro.instructions).map((ro) => html`<p class="pre"><b>${ro.name}:</b> ${ro.instructions}</p>`)}
          ${x.special_instructions ? html`<p class="pre">${x.special_instructions}</p>` : ''}` : ''}
        <h3>Charges</h3>
        <table class="kv"><tbody><tr><td>${R.nightsLabel(t.nights)}</td><td class="num">${money(t.subtotal)}</td></tr>
          ${t.discount ? html`<tr><td>Discount</td><td class="num">−${money(t.discount)}</td></tr>` : ''}${t.tax ? html`<tr><td>Lodging tax ${t.taxPct}%</td><td class="num">${money(t.tax)}</td></tr>` : ''}
          <tr><td><b>Total</b></td><td class="num"><b>${money(t.total)}</b></td></tr><tr><td>Paid</td><td class="num">${money(t.paid)}</td></tr>
          <tr><td><b>${t.balance < 0 ? 'Credit' : 'Balance'}</b></td><td class="num"><b>${money(Math.abs(t.balance))}</b></td></tr>
          ${t.depositOwed ? html`<tr><td>Deposit due${x.deposit_due ? ` by ${dateFmt(x.deposit_due)}` : ''}</td><td class="num">${money(t.depositOwed)}</td></tr>` : ''}</tbody></table>
        ${s.confirm_note ? html`<p class="pre c-note">${s.confirm_note}</p>` : ''}
      </article>` }));
  });
};
