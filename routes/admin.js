'use strict';
// Admin: the business's settings, locations and their rooms, and logins.
const { html, money, centsInput, toCents, time12 } = require('../lib/html');
const { layout, csrfField, field, input, textarea, select, pageHead, empty, badge, icon } = require('../lib/views');
const { str, int, arr, phone, own, now, isTime } = require('../lib/common');
const { HttpError } = require('../lib/http');
const auth = require('../lib/auth');
const R = require('../lib/res');

const A = { admin: true };
const ZONES = () => Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/') || z.startsWith('Pacific/') || z === 'UTC').map((z) => [z, z]);
const time = (v) => (isTime(v) ? v : null);

module.exports = (r, { db }) => {
  const page = (ctx, title, body, cur) => ctx.html(layout(ctx, { title, active: '/admin', body: html`${pageHead(title, '', cur === '/admin' ? 'Settings, locations, rooms and logins.' : html`<a href="/admin">Admin</a> › ${title}`)}
    <nav class="tabs" aria-label="Admin">${[['/admin', 'Settings'], ['/admin/locations', 'Locations and rooms'], ['/admin/users', 'Logins']].map(([h, l]) => html`<a href="${h}" class="${h === cur ? 'on' : ''}">${l}</a>`)}</nav>${body}` }));

  // ---------- Settings
  r.get('/admin', (ctx) => {
    const s = ctx.settings;
    page(ctx, 'Admin', html`<form method="post" action="/admin" class="panel stack form-wide" data-dirty-guard>${csrfField(ctx)}
      <h2>Your business</h2>
      <div class="grid g4">
        ${field('Business name', input('name', s.name, { required: true, maxlength: 120 }), { cls: 'span2' })}
        ${field('Phone', input('phone', s.phone, { type: 'tel' }))}${field('Email', input('email', s.email, { type: 'email' }))}
        ${field('Street', input('address1', s.address1), { cls: 'span2' })}${field('City', input('city', s.city))}
        <div class="grid g2">${field('State', input('state', s.state, { maxlength: 2 }))}${field('ZIP', input('postal', s.postal))}</div>
        ${field('Website', input('website', s.website), { cls: 'span2' })}${field('Time zone', select('timezone', ZONES(), s.timezone), { cls: 'span2' })}
      </div>
      <h2>Stays</h2>
      <div class="grid g4">
        ${field('Usual check-in time', input('check_in_time', s.check_in_time, { type: 'time' }), { hint: 'A location or room can have its own.' })}
        ${field('Usual checkout time', input('check_out_time', s.check_out_time, { type: 'time' }))}
        ${field('Lodging tax %', input('tax_percent', s.tax_percent || '', { inputmode: 'decimal', placeholder: '0' }), { hint: 'Added to every stay (e.g. 10 for 10%).' })}
      </div>
      ${field('Note printed on every confirmation', textarea('confirm_note', s.confirm_note, { rows: 3, placeholder: 'Parking, Wi-Fi, cancellation policy, how to reach us…' }))}
      <div class="form-actions"><button class="btn primary">Save</button></div></form>`, '/admin');
  }, A);
  r.post('/admin', (ctx) => {
    const b = ctx.body;
    const tax = Number(String(b.tax_percent || '0').replace(/[%\s]/g, ''));
    if (!Number.isFinite(tax) || tax < 0 || tax > 50) throw new HttpError(422, 'Enter the lodging tax as a percent, like 10.');
    db.update('settings', 1, { name: str(b.name, 120) || 'Inn Ops', phone: phone(b.phone), email: str(b.email, 200), website: str(b.website, 200), address1: str(b.address1, 200), city: str(b.city, 100),
      state: (str(b.state, 2) || '').toUpperCase() || null, postal: str(b.postal, 20), timezone: ZONES().some(([z]) => z === b.timezone) ? b.timezone : 'America/Los_Angeles',
      check_in_time: time(b.check_in_time) || '15:00', check_out_time: time(b.check_out_time) || '11:00', tax_percent: tax, confirm_note: str(b.confirm_note, 3000) });
    ctx.setFlash('Settings saved.');
    ctx.redirect('/admin');
  }, A);

  // ---------- Locations and rooms
  r.get('/admin/locations', (ctx) => {
    const locs = db.all('SELECT l.*, (SELECT COUNT(*) FROM rooms WHERE location_id=l.id AND active=1) nrooms FROM locations l ORDER BY l.active DESC, l.sort, l.name');
    page(ctx, 'Locations and rooms', html`
      <form method="post" action="/admin/locations/new" class="panel add-row">${csrfField(ctx)}<label class="sr" for="nl">New location</label>
        <input id="nl" name="name" required maxlength="80" placeholder="Add a location (e.g. Carriage House)"><button class="btn">Add location</button></form>
      ${locs.length ? html`<section class="panel"><table class="list"><thead><tr><th>Location</th><th>Rooms</th><th>Check-in / out</th><th class="num">Buy-out a night<small class="muted"> weekday / weekend</small></th><th></th></tr></thead><tbody>
        ${locs.map((l) => html`<tr class="${l.active ? '' : 'struck'}"><td><span class="dot" style="background:${R.locColor(l)}"></span><a href="/admin/locations/${l.id}"><b>${l.name}</b></a>${l.active ? '' : badge('Not in use', 'soft')}</td>
          <td>${l.nrooms}</td><td>${time12(l.check_in_time || ctx.settings.check_in_time)} / ${time12(l.check_out_time || ctx.settings.check_out_time)}</td>
          <td class="num">${l.buyout_rate_cents ? `${money(l.buyout_rate_cents)} / ${money(l.buyout_weekend_rate_cents ?? l.buyout_rate_cents)}` : '—'}</td><td class="num"><a class="btn small ghost" href="/admin/locations/${l.id}">Edit</a></td></tr>`)}</tbody></table></section>`
    : empty('No locations yet.')}`, '/admin/locations');
  }, A);
  r.post('/admin/locations/new', (ctx) => {
    const name = str(ctx.body.name, 80); if (!name) throw new HttpError(422, 'Name the location.');
    const id = db.insert('locations', { name, sort: (db.get('SELECT MAX(sort) m FROM locations').m || 0) + 1 });
    ctx.setFlash(`${name} added. Now add its rooms.`);
    ctx.redirect(`/admin/locations/${id}`);
  }, A);

  r.get('/admin/locations/:id', (ctx) => {
    const l = own(db, 'locations', ctx.params.id); const s = ctx.settings;
    const rooms = db.all('SELECT ro.*, (SELECT COUNT(*) FROM reservation_rooms rr WHERE rr.room_id=ro.id) used FROM rooms ro WHERE location_id=? ORDER BY active DESC, sort, name', l.id);
    const rows = rooms.concat([{}]);
    const room = (x) => html`<div class="room-card" data-row>
        <input type="hidden" name="room_id[]" value="${x.id || ''}">
        <div class="grid g4">
          ${field('Room name', input('room_name[]', x.name, { maxlength: 80, placeholder: x.id ? '' : 'New room' }))}
          ${field('Weekday rate', input('room_rate[]', centsInput(x.rate_cents), { inputmode: 'decimal', placeholder: '0.00' }), { hint: 'Sun – Thu nights' })}
          ${field('Weekend rate', input('room_wrate[]', centsInput(x.weekend_rate_cents), { inputmode: 'decimal', placeholder: 'Same as weekday' }), { hint: 'Fri and Sat nights' })}
          <div class="grid g2">${field('Sleeps', input('room_max[]', x.max_guests, { type: 'number', min: 0, max: 99 }))}
          ${field('In use', select('room_active[]', [['1', 'Yes'], ['0', 'No']], x.id ? (x.active ? '1' : '0') : '1'))}</div>
          ${field('Beds and description', input('room_desc[]', x.description, { maxlength: 200, placeholder: 'King bed, private bath, garden view' }), { cls: 'span2' })}
          ${field('Check-in', input('room_in[]', x.check_in_time, { type: 'time' }), { hint: `Blank: ${time12(l.check_in_time || s.check_in_time)}` })}
          ${field('Checkout', input('room_out[]', x.check_out_time, { type: 'time' }), { hint: `Blank: ${time12(l.check_out_time || s.check_out_time)}` })}
          ${field('Special instructions for guests', textarea('room_instr[]', x.instructions, { rows: 2, placeholder: 'Door code, stairs, where the extra towels are…' }), { cls: 'span2' })}
          ${field('Staff notes', textarea('room_notes[]', x.notes, { rows: 2 }), { cls: 'span2' })}
        </div>
        ${x.used ? html`<p class="hint">Has reservations, so it can be set to “not in use” but not removed.</p>` : html`<button type="button" class="btn ghost small danger" data-remove-row>Remove this room</button>`}
      </div>`;
    page(ctx, l.name, html`<form method="post" action="/admin/locations/${l.id}" class="stack form-wide" data-dirty-guard>${csrfField(ctx)}
      <section class="panel"><h2>Location</h2>
        <div class="grid g4">
          ${field('Name', input('name', l.name, { required: true, maxlength: 80 }), { cls: 'span2' })}
          ${field('Calendar color', input('color', R.locColor(l), { type: 'color' }))}
          ${field('In use', select('active', [['1', 'Yes'], ['0', 'No']], l.active ? '1' : '0'))}
          ${field('Street', input('address1', l.address1), { cls: 'span2' })}${field('City', input('city', l.city))}
          <div class="grid g2">${field('State', input('state', l.state, { maxlength: 2 }))}${field('ZIP', input('postal', l.postal))}</div>
          ${field('Phone', input('phone', l.phone, { type: 'tel' }))}
          ${field('Check-in time', input('check_in_time', l.check_in_time, { type: 'time' }), { hint: `Blank: ${time12(s.check_in_time)}` })}
          ${field('Checkout time', input('check_out_time', l.check_out_time, { type: 'time' }), { hint: `Blank: ${time12(s.check_out_time)}` })}
          <div class="grid g2">${field('Buy-out weekday', input('buyout_rate', centsInput(l.buyout_rate_cents), { inputmode: 'decimal', placeholder: '0.00' }), { hint: 'Sun – Thu nights' })}
          ${field('Buy-out weekend', input('buyout_wrate', centsInput(l.buyout_weekend_rate_cents), { inputmode: 'decimal', placeholder: 'Same' }), { hint: 'Fri, Sat nights' })}</div>
        </div>
        ${field('Special instructions for guests', textarea('instructions', l.instructions, { rows: 2, placeholder: 'Parking, gate code, who to call…' }))}
        ${field('Staff notes', textarea('notes', l.notes, { rows: 2 }))}
      </section>
      <section class="panel"><h2>Rooms <small class="muted">${rooms.filter((x) => x.active).length} in use</small></h2>
        <div class="rows room-rows" data-rows>${rows.map(room)}</div>
        <button type="button" class="btn ghost small" data-add-row>Add another room</button>
      </section>
      <div class="form-actions"><button class="btn primary">Save ${l.name}</button><a class="btn ghost" href="/admin/locations">Back to locations</a></div></form>`, '/admin/locations');
  }, A);

  r.post('/admin/locations/:id', (ctx) => {
    const l = own(db, 'locations', ctx.params.id); const b = ctx.body;
    const name = str(b.name, 80); if (!name) throw new HttpError(422, 'Name the location.');
    const ids = arr(b.room_id); const names = arr(b.room_name);
    const col = (k, i) => arr(b[k])[i];
    db.tx(() => {
      db.update('locations', l.id, { name, color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : null, active: b.active === '0' ? 0 : 1, address1: str(b.address1, 200), city: str(b.city, 100),
        state: (str(b.state, 2) || '').toUpperCase() || null, postal: str(b.postal, 20), phone: phone(b.phone), check_in_time: time(b.check_in_time), check_out_time: time(b.check_out_time),
        buyout_rate_cents: toCents(b.buyout_rate), buyout_weekend_rate_cents: toCents(b.buyout_wrate), instructions: str(b.instructions, 3000), notes: str(b.notes, 3000) });
      const kept = new Set();
      names.forEach((n, i) => {
        const rn = str(n, 80); if (!rn) return;
        const rec = { name: rn, rate_cents: toCents(col('room_rate', i)) || 0, weekend_rate_cents: toCents(col('room_wrate', i)), max_guests: int(col('room_max', i)), active: col('room_active', i) === '0' ? 0 : 1, description: str(col('room_desc', i), 200),
          check_in_time: time(col('room_in', i)), check_out_time: time(col('room_out', i)), instructions: str(col('room_instr', i), 3000), notes: str(col('room_notes', i), 3000), sort: i };
        const rid = int(ids[i]);
        if (rid && db.get('SELECT 1 FROM rooms WHERE id=? AND location_id=?', rid, l.id)) { db.update('rooms', rid, rec); kept.add(rid); }
        else kept.add(db.insert('rooms', { ...rec, location_id: l.id }));
      });
      // Rooms taken off the page: removed, or set "not in use" if they've been booked
      for (const ro of db.all('SELECT id FROM rooms WHERE location_id=?', l.id)) {
        if (kept.has(ro.id)) continue;
        if (db.get('SELECT 1 FROM reservation_rooms WHERE room_id=?', ro.id)) db.run('UPDATE rooms SET active=0 WHERE id=?', ro.id);
        else db.run('DELETE FROM rooms WHERE id=?', ro.id);
      }
    });
    ctx.setFlash(`${name} saved.`);
    ctx.redirect(`/admin/locations/${l.id}`);
  }, A);

  // ---------- Logins
  r.get('/admin/users', (ctx) => {
    const users = db.all('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE');
    const edit = int(ctx.query.edit) && users.find((u) => u.id === int(ctx.query.edit));
    const form = (u) => html`<form method="post" action="${u ? `/admin/users/${u.id}` : '/admin/users'}" class="panel stack" id="user-form">${csrfField(ctx)}
      <h2>${u ? `Edit ${u.name}` : 'Add a login'}</h2>
      <div class="grid g4">
        ${field('Name', input('name', u && u.name, { required: true, maxlength: 100 }))}
        ${field('Login name', input('username', u && u.username, { required: true, maxlength: 40, pattern: '[A-Za-z0-9._-]{2,40}' }))}
        ${field('Email', input('email', u && u.email, { type: 'email' }))}
        ${field('Can use', select('role', [['staff', 'Everything but Admin'], ['admin', 'Everything, including Admin']], u ? u.role : 'staff'))}
        ${field(u ? 'New password' : 'Password', input('password', '', { type: 'password', autocomplete: 'new-password', minlength: 8, required: !u }), { hint: u ? 'Leave blank to keep it.' : 'At least 8 characters.' })}
        ${u ? field('Active', select('active', [['1', 'Yes'], ['0', 'No (can’t sign in)']], u.active ? '1' : '0')) : ''}
      </div>
      <div class="form-actions"><button class="btn primary">${u ? 'Save' : 'Add login'}</button>${u ? html`<a class="btn ghost" href="/admin/users">Cancel</a>` : ''}</div></form>`;
    page(ctx, 'Logins', html`${form(edit)}
      <section class="panel"><table class="list"><thead><tr><th>Name</th><th>Login name</th><th>Can use</th><th></th></tr></thead><tbody>
        ${users.map((u) => html`<tr class="${u.active ? '' : 'struck'}"><td>${u.name}</td><td><code class="code">${u.username}</code></td><td>${u.role === 'admin' ? 'Everything' : 'Everything but Admin'}</td>
          <td class="num"><a class="btn small ghost" href="/admin/users?edit=${u.id}#user-form">${icon('pencil')} Edit</a></td></tr>`)}</tbody></table></section>`, '/admin/users');
  }, A);
  const readUser = (b, isNew) => {
    const rec = { name: str(b.name, 100), username: str(b.username, 40), email: str(b.email, 200), role: b.role === 'admin' ? 'admin' : 'staff' };
    if (!rec.name || !rec.username || !/^[A-Za-z0-9._-]{2,40}$/.test(rec.username)) throw new HttpError(422, 'Enter a name and a login name (letters, numbers, dots, dashes).');
    if (b.password || isNew) { if (String(b.password || '').length < 8) throw new HttpError(422, 'The password needs at least 8 characters.'); rec.password_hash = auth.hashPassword(b.password); }
    return rec;
  };
  r.post('/admin/users', (ctx) => {
    const rec = readUser(ctx.body, true);
    if (db.get('SELECT 1 FROM users WHERE username=?', rec.username)) throw new HttpError(422, 'That login name is taken.');
    db.insert('users', { ...rec, created_at: now() });
    ctx.setFlash(`${rec.name} can now sign in as ${rec.username}.`);
    ctx.redirect('/admin/users');
  }, A);
  r.post('/admin/users/:id', (ctx) => {
    const u = own(db, 'users', ctx.params.id); const rec = readUser(ctx.body, false);
    if (db.get('SELECT 1 FROM users WHERE username=? AND id<>?', rec.username, u.id)) throw new HttpError(422, 'That login name is taken.');
    rec.active = ctx.body.active === '0' ? 0 : 1;
    if (u.id === ctx.user.id && (rec.role !== 'admin' || !rec.active)) throw new HttpError(422, 'You can’t take away your own Admin access.');
    db.update('users', u.id, rec);
    if (!rec.active) db.run('DELETE FROM sessions WHERE user_id=?', u.id);
    ctx.setFlash('Login saved.');
    ctx.redirect('/admin/users');
  }, A);
};
