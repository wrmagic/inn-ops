'use strict';
// End-to-end tests: runs the real server on a fresh demo database and walks through the main jobs.
// Tests run in order and later ones use what earlier ones made.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innops-test-'));
const dbFile = path.join(dir, 'test.db');
process.env.DATABASE_FILE = dbFile;
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'setup.js'), '--demo'], { env: { ...process.env, ADMIN_PASSWORD: 'test-password-1' }, stdio: 'ignore' });
const { createApp } = require('../server');

let server; let base; let db;
const jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function send(method, url, pairs) {
  const res = await fetch(base + url, {
    method, redirect: 'manual',
    headers: { Cookie: cookieHeader(), ...(pairs ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: pairs ? new URLSearchParams([['_csrf', jar.csrf], ...pairs]).toString() : undefined,
  });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}
const get = (u) => send('GET', u);
const post = (u, form) => send('POST', u, Array.isArray(form) ? form : Object.entries(form));

let locId; let roomA; let roomB; let guestId; let eventId; let resId;

before(async () => {
  server = createApp({ dbFile });
  db = server.db;
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  await get('/login');
});
after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('pages need a login; a wrong password is refused', async () => {
  const r = await get('/');
  assert.equal(r.status, 303);
  assert.match(r.location, /^\/login/);
  const bad = await post('/login', { username: 'admin', password: 'nope' });
  assert.equal(bad.status, 401);
  const ok = await post('/login', { username: 'admin', password: 'test-password-1' });
  assert.equal(ok.status, 303);
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Arriving/);
});

test('the four locations are set up', () => {
  const names = db.all('SELECT name FROM locations ORDER BY sort').map((l) => l.name);
  for (const n of ['Inn', 'Stonehouse', 'Ranch House', 'Mansion']) assert.ok(names.includes(n), n);
});

test('admin: add a location and its rooms', async () => {
  const r = await post('/admin/locations/new', { name: 'Test Cottage' });
  assert.equal(r.status, 303);
  locId = Number(r.location.split('/').pop());
  const s = await post(`/admin/locations/${locId}`, [
    ['name', 'Test Cottage'], ['check_in_time', '16:00'], ['check_out_time', '10:00'], ['buyout_rate', '500'], ['instructions', 'Key in the lockbox.'],
    ['room_id[]', ''], ['room_name[]', 'Upstairs'], ['room_rate[]', '100'], ['room_max[]', '2'], ['room_active[]', '1'], ['room_desc[]', 'Queen'], ['room_in[]', ''], ['room_out[]', ''], ['room_instr[]', ''], ['room_notes[]', ''],
    ['room_id[]', ''], ['room_name[]', 'Downstairs'], ['room_rate[]', '80.50'], ['room_max[]', '2'], ['room_active[]', '1'], ['room_desc[]', 'Twin'], ['room_in[]', ''], ['room_out[]', ''], ['room_instr[]', ''], ['room_notes[]', ''],
  ]);
  assert.equal(s.status, 303);
  const rooms = db.all('SELECT * FROM rooms WHERE location_id=? ORDER BY sort', locId);
  assert.deepEqual(rooms.map((x) => [x.name, x.rate_cents]), [['Upstairs', 10000], ['Downstairs', 8050]]);
  [roomA, roomB] = rooms.map((x) => x.id);
  const loc = db.get('SELECT * FROM locations WHERE id=?', locId);
  assert.equal(loc.buyout_rate_cents, 50000);
  assert.equal(loc.check_in_time, '16:00');
  const page = await get(`/admin/locations/${locId}`);
  assert.match(page.text, /Downstairs/);
});

test('guests and events', async () => {
  const g = await post('/guests/new', { first: 'Pat', last: 'Tester', phone: '8055550199', email: 'PAT@example.com' });
  assert.equal(g.status, 303);
  guestId = Number(g.location.split('/').pop());
  assert.equal(db.get('SELECT email FROM guests WHERE id=?', guestId).email, 'pat@example.com');
  const e = await post('/events/new', { name: 'Test Retreat', start_date: '2027-03-01', end_date: '2027-03-04', location_id: String(locId), contact_id: String(guestId) });
  assert.equal(e.status, 303);
  eventId = Number(e.location.split('/').pop());
  const page = await get(`/events/${eventId}`);
  assert.match(page.text, /Test Retreat/);
  assert.match(page.text, /Add a reservation/);
  const nf = await get('/reservations/new');
  assert.match(nf.text, new RegExp(`value="${eventId}" data-start="2027-03-01" data-end="2027-03-04"`), 'event options carry their dates for the form');
  const list = await get('/guests?q=Tester');
  assert.match(list.text, /Pat/);
});

const booking = (extra = []) => [
  ['kind', 'rooms'], ['guest_id', String(guestId)], ['location_id', String(locId)], ['event_id', String(eventId)],
  ['arrive', '2027-03-01'], ['depart', '2027-03-04'], ['check_in_time', '16:00'], ['check_out_time', '10:00'], ['adults', '3'], ['children', '0'], ['status', 'confirmed'],
  ['special_needs', 'Ground floor please'], ['special_instructions', 'Use the side gate'], ['comments', 'Returning guest'], ...extra,
];

test('book two rooms with who is in each', async () => {
  const r = await post('/reservations/new', booking([['room_ids[]', String(roomA)], ['rate_' + roomA, '100'], ['occ_' + roomA, 'Pat & Sam'], ['room_ids[]', String(roomB)], ['rate_' + roomB, '80.50'], ['occ_' + roomB, 'Kim'], ['discount', '20'], ['deposit', '100']]));
  assert.equal(r.status, 303, r.text);
  resId = Number(r.location.split('/').pop());
  const rr = db.all('SELECT * FROM reservation_rooms WHERE reservation_id=? ORDER BY room_id', resId);
  assert.equal(rr.length, 2);
  assert.equal(rr.find((x) => x.room_id === roomA).occupants, 'Pat & Sam');
  const page = await get(`/reservations/${resId}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Pat &amp; Sam/);
  assert.match(page.text, /Ground floor please/);
  assert.match(page.text, /Test Retreat/);
  // 3 nights × $180.50 = $541.50, less $20 = $521.50
  assert.match(page.text, /\$521\.50/);
});

test('a room already booked on any of those nights is refused', async () => {
  const r = await post('/reservations/new', booking([['arrive', '2027-03-03'], ['depart', '2027-03-05'], ['room_ids[]', String(roomB)]]).filter(([k, v]) => !(k === 'arrive' && v === '2027-03-01') && !(k === 'depart' && v === '2027-03-04')));
  assert.equal(r.status, 409);
  assert.match(r.text, /Already booked/);
  assert.match(r.text, /Downstairs/);
});

test('a guest can arrive the day the last one leaves', async () => {
  const r = await post('/reservations/new', booking([['room_ids[]', String(roomB)]]).map(([k, v]) => (k === 'arrive' ? [k, '2027-03-04'] : k === 'depart' ? [k, '2027-03-06'] : [k, v])));
  assert.equal(r.status, 303, r.text);
  const id = Number(r.location.split('/').pop());
  // and its rooms show as booked to the availability check
  const a = await get('/api/availability?arrive=2027-03-05&depart=2027-03-06');
  const busy = JSON.parse(a.text).busy;
  assert.ok(Object.keys(busy).map(Number).includes(roomB));
  assert.ok(!Object.keys(busy).map(Number).includes(roomA));
  await post(`/reservations/${id}/status`, { to: 'cancelled' });
  assert.equal(db.get('SELECT status FROM reservations WHERE id=?', id).status, 'cancelled');
});

test('a buy-out is refused while rooms are booked, and blocks rooms once booked', async () => {
  const clash = await post('/reservations/new', booking().map(([k, v]) => (k === 'kind' ? [k, 'buyout'] : [k, v])));
  assert.equal(clash.status, 409);
  const b = await post('/reservations/new', booking([['buyout_rate', '']]).map(([k, v]) => (k === 'kind' ? [k, 'buyout'] : k === 'arrive' ? [k, '2027-04-10'] : k === 'depart' ? [k, '2027-04-12'] : [k, v])));
  assert.equal(b.status, 303, b.text);
  const bid = Number(b.location.split('/').pop());
  assert.equal(db.get('SELECT COUNT(*) n FROM reservation_rooms WHERE reservation_id=?', bid).n, 2);
  assert.equal(db.get('SELECT buyout_rate_cents FROM reservations WHERE id=?', bid).buyout_rate_cents, 50000);
  const room = await post('/reservations/new', booking([['room_ids[]', String(roomA)]]).map(([k, v]) => (k === 'arrive' ? [k, '2027-04-11'] : k === 'depart' ? [k, '2027-04-13'] : [k, v])));
  assert.equal(room.status, 409);
  assert.match(room.text, /Already booked/);
  // a cancelled buy-out frees the rooms
  await post(`/reservations/${bid}/status`, { to: 'cancelled' });
  const again = await post('/reservations/new', booking([['room_ids[]', String(roomA)]]).map(([k, v]) => (k === 'arrive' ? [k, '2027-04-11'] : k === 'depart' ? [k, '2027-04-13'] : [k, v])));
  assert.equal(again.status, 303);
  // and it can't come back while that room is taken
  const back = await post(`/reservations/${bid}/status`, { to: 'confirmed' });
  assert.equal(back.status, 409);
});

test('payments, refunds and lodging tax', async () => {
  // Stay defaults are set for each location: 10% lodging tax at the test cottage only
  const others = db.all('SELECT id FROM locations WHERE id<>? ORDER BY id', locId);
  const row = (id, tax, note) => [['loc_id[]', String(id)], ['loc_in[]', '16:00'], ['loc_out[]', '10:00'], ['loc_tax[]', tax], ['loc_note[]', note]];
  assert.equal((await post('/admin/stays', [...row(locId, 'abc', '')])).status, 422);
  let r = await post('/admin/stays', [...row(locId, '10', 'Cottage Wi-Fi: magic123'), ...others.flatMap((o) => row(o.id, '', ''))]);
  assert.equal(r.status, 303);
  assert.equal(db.get('SELECT tax_percent FROM locations WHERE id=?', locId).tax_percent, 10);
  assert.equal(db.get('SELECT tax_percent FROM locations WHERE id=?', others[0].id).tax_percent, 0);
  const stays = (await get('/admin/stays')).text;
  assert.match(stays, /Test Cottage/); assert.match(stays, /Cottage Wi-Fi: magic123/);
  await post('/admin/business', { name: 'Test Inns', timezone: 'America/Los_Angeles' });
  assert.equal(db.settings().name, 'Test Inns');
  await post(`/reservations/${resId}/payments`, { amount: '300', method: 'card', received_on: '2027-02-01' });
  await post(`/reservations/${resId}/payments`, { amount: '50', method: 'cash', refund: '1' });
  const R = require('../lib/res');
  const t = R.totals(db, db.get('SELECT * FROM reservations WHERE id=?', resId), db.settings());
  assert.equal(t.subtotal, 54150);
  assert.equal(t.discount, 2000);
  assert.equal(t.tax, 5215);
  assert.equal(t.total, 57365);
  assert.equal(t.paid, 25000);
  assert.equal(t.balance, 32365);
  const page = await get(`/reservations/${resId}`);
  assert.match(page.text, /\$323\.65/);
  const pid = db.get('SELECT id FROM payments WHERE reservation_id=? AND amount_cents<0', resId).id;
  await post(`/reservations/${resId}/payments/${pid}/delete`, {});
  assert.equal(R.totals(db, db.get('SELECT * FROM reservations WHERE id=?', resId), db.settings()).paid, 30000);
});

test('check in, check out and undo', async () => {
  await post(`/reservations/${resId}/status`, { to: 'checked_in' });
  let x = db.get('SELECT * FROM reservations WHERE id=?', resId);
  assert.equal(x.status, 'checked_in');
  assert.ok(x.checked_in_at);
  await post(`/reservations/${resId}/status`, { to: 'checked_out' });
  x = db.get('SELECT * FROM reservations WHERE id=?', resId);
  assert.equal(x.status, 'checked_out');
  assert.ok(x.checked_out_at);
  await post(`/reservations/${resId}/status`, { to: 'confirmed' });
  x = db.get('SELECT * FROM reservations WHERE id=?', resId);
  assert.equal(x.status, 'confirmed');
  assert.equal(x.checked_in_at, null);
});

test('editing a reservation keeps its own rooms free of clashes', async () => {
  const r = await post(`/reservations/${resId}`, booking([['room_ids[]', String(roomA)], ['occ_' + roomA, 'Pat only']]));
  assert.equal(r.status, 303, r.text);
  assert.equal(db.get('SELECT COUNT(*) n FROM reservation_rooms WHERE reservation_id=?', resId).n, 1);
  const edit = await get(`/reservations/${resId}/edit`);
  assert.equal(edit.status, 200);
  assert.match(edit.text, /Pat only/);
});

test('calendar, date book, lists, reports and confirmation pages open', async () => {
  for (const u of ['/calendar?date=2027-03-01', '/calendar?view=list&date=2027-03-01', `/datebook?from=2027-03-01&days=14&location=${locId}`, '/datebook?days=30',
    '/reservations?tab=all', '/reservations?tab=now', '/events', '/guests', `/guests/${guestId}`, '/reports', '/reports/arrivals?from=2027-03-01&to=2027-03-31',
    '/reports/house?date=2027-03-02', `/reservations/${resId}/confirmation`, '/admin', '/admin/locations', '/admin/users', '/account']) {
    const r = await get(u);
    assert.equal(r.status, 200, u);
  }
  const dbk = await get(`/datebook?from=2027-03-01&days=7&location=${locId}`);
  assert.match(dbk.text, /Upstairs/);
  assert.match(dbk.text, /Pat/);
  const conf = await get(`/reservations/${resId}/confirmation`);
  assert.match(conf.text, /Use the side gate/);
  assert.match(conf.text, /Cottage Wi-Fi: magic123/, 'the location’s own confirmation note');
  assert.doesNotMatch(conf.text, /Returning guest/, 'staff comments stay off the guest confirmation');
  const cal = await get('/calendar?date=2027-03-01');
  assert.match(cal.text, /Pat/);
});

test('weekend rates: Friday and Saturday nights', async () => {
  const room = (id, name, rate, wrate) => [['room_id[]', String(id)], ['room_name[]', name], ['room_rate[]', rate], ['room_wrate[]', wrate], ['room_max[]', '2'], ['room_active[]', '1'],
    ['room_desc[]', ''], ['room_in[]', ''], ['room_out[]', ''], ['room_instr[]', ''], ['room_notes[]', '']];
  const s = await post(`/admin/locations/${locId}`, [['name', 'Test Cottage'], ['buyout_rate', '500'], ['buyout_wrate', '650'],
    ...room(roomA, 'Upstairs', '100', '150'), ...room(roomB, 'Downstairs', '80.50', '')]);
  assert.equal(s.status, 303);
  assert.equal(db.get('SELECT weekend_rate_cents FROM rooms WHERE id=?', roomA).weekend_rate_cents, 15000);
  assert.equal(db.get('SELECT weekend_rate_cents FROM rooms WHERE id=?', roomB).weekend_rate_cents, null);
  assert.equal(db.get('SELECT buyout_weekend_rate_cents FROM locations WHERE id=?', locId).buyout_weekend_rate_cents, 65000);
  const form = await get(`/reservations/new?room=${roomA}&arrive=2027-05-06`);
  assert.match(form.text, new RegExp(`name="wrate_${roomA}" value="150.00"`));
  // Thu 6 May → Sun 9 May: Thursday is a weeknight, Friday and Saturday are weekend nights
  const r = await post('/reservations/new', booking([['room_ids[]', String(roomA)], ['room_ids[]', String(roomB)]]).map(([k, v]) => (k === 'arrive' ? [k, '2027-05-06'] : k === 'depart' ? [k, '2027-05-09'] : [k, v])));
  assert.equal(r.status, 303, r.text);
  const id = Number(r.location.split('/').pop());
  const R = require('../lib/res');
  const x = db.get('SELECT * FROM reservations WHERE id=?', id);
  const t = R.totals(db, x, { tax_percent: 0 });
  assert.equal(t.weekdayNights, 1);
  assert.equal(t.weekendNights, 2);
  // 1 × (100 + 80.50) + 2 × (150 + 80.50) = 180.50 + 461.00
  assert.equal(t.subtotal, 64150);
  const page = await get(`/reservations/${id}`);
  assert.match(page.text, /1 weeknight/);
  assert.match(page.text, /2 weekend nights/);
  // a buy-out uses the location's weekend rate
  await post(`/reservations/${id}/status`, { to: 'cancelled' });
  const b = await post('/reservations/new', booking().map(([k, v]) => (k === 'kind' ? [k, 'buyout'] : k === 'arrive' ? [k, '2027-05-06'] : k === 'depart' ? [k, '2027-05-09'] : [k, v])));
  assert.equal(b.status, 303, b.text);
  const bx = db.get('SELECT * FROM reservations WHERE id=?', Number(b.location.split('/').pop()));
  assert.equal(bx.buyout_weekend_rate_cents, 65000);
  assert.equal(R.totals(db, bx, { tax_percent: 0 }).subtotal, 50000 + 2 * 65000);
});

test('a location with no rooms is booked whole and shows everywhere', async () => {
  const l = await post('/admin/locations/new', { name: 'Whole Barn' });
  const wid = Number(l.location.split('/').pop());
  await post(`/admin/locations/${wid}`, { name: 'Whole Barn', buyout_rate: '400' });
  const r = await post('/reservations/new', booking().map(([k, v]) => (k === 'kind' ? [k, 'buyout'] : k === 'location_id' ? [k, String(wid)] : k === 'arrive' ? [k, '2027-06-01'] : k === 'depart' ? [k, '2027-06-03'] : [k, v])));
  assert.equal(r.status, 303, r.text);
  const id = Number(r.location.split('/').pop());
  const dbk = await get(`/datebook?from=2027-05-31&days=7&location=${wid}`);
  assert.match(dbk.text, /Whole location/);
  assert.match(dbk.text, new RegExp(`href="/reservations/${id}"`));
  const cal = await get(`/calendar?date=2027-06-01&location=${wid}`);
  assert.match(cal.text, new RegExp(`href="/reservations/${id}"`));
  const house = await get('/reports/house?date=2027-06-02');
  assert.match(house.text, /Whole Barn/);
  assert.match(house.text, /Pat/);
  // one location only
  const barn = db.get("SELECT id FROM locations WHERE name='Whole Barn'").id;
  const only = (await get(`/reports/house?date=2027-06-02&location=${barn}`)).text;
  assert.match(only, /Room list · Whole Barn/); assert.doesNotMatch(only, /<h2>Inn<\/h2>/);
  assert.match(house.text, /<h2>Inn<\/h2>/);
  // a second buy-out on the same nights is refused
  const again = await post('/reservations/new', booking().map(([k, v]) => (k === 'kind' ? [k, 'buyout'] : k === 'location_id' ? [k, String(wid)] : k === 'arrive' ? [k, '2027-06-02'] : k === 'depart' ? [k, '2027-06-04'] : [k, v])));
  assert.equal(again.status, 409);
});

test('phone version: today, find, check in and out, comments', async () => {
  const x = db.get("SELECT * FROM reservations WHERE status='confirmed' ORDER BY id LIMIT 1");
  const day = await get(`/m?d=${x.arrive}`);
  assert.equal(day.status, 200);
  assert.match(day.text, new RegExp(`href="/m/r/${x.id}"`));
  assert.match(day.text, /Check in/);
  assert.equal((await get('/m/upcoming')).status, 200);
  const find = await get('/m/find?q=Tester');
  assert.match(find.text, /Pat/);
  const page = await get(`/m/r/${x.id}`);
  assert.equal(page.status, 200);
  if (x.special_needs) assert.ok(page.text.includes(x.special_needs.replace(/&/g, '&amp;')));
  const ci = await post(`/reservations/${x.id}/status`, { to: 'checked_in', next: `/m/r/${x.id}` });
  assert.equal(ci.location, `/m/r/${x.id}`);
  assert.equal(db.get('SELECT status FROM reservations WHERE id=?', x.id).status, 'checked_in');
  assert.match((await get(`/m/r/${x.id}`)).text, /Check out/);
  await post(`/reservations/${x.id}/status`, { to: 'checked_out', next: `/m/r/${x.id}` });
  assert.equal(db.get('SELECT status FROM reservations WHERE id=?', x.id).status, 'checked_out');
  const c = await post(`/m/r/${x.id}/comment`, { note: 'Left the key in the box' });
  assert.equal(c.status, 303);
  assert.match(db.get('SELECT comments FROM reservations WHERE id=?', x.id).comments, /\] Left the key in the box$/);
  assert.match((await get(`/m/r/${x.id}`)).text, /Left the key in the box/);
  const m = await get('/manifest.webmanifest');
  assert.equal(JSON.parse(m.text).start_url, '/m');
});

test('reservation and guest lists come in pages (20, 50, 100 or All, remembered)', async () => {
  for (let i = 0; i < 45; i++) db.insert('guests', { first: 'Pager', last: `Guest${String(i).padStart(2, '0')}`, created_at: '2026-01-01' });
  const g = db.get("SELECT id FROM guests WHERE last='Guest00'").id;
  for (let i = 0; i < 25; i++) db.insert('reservations', { kind: 'buyout', location_id: locId, guest_id: g, arrive: `2030-0${1 + Math.floor(i / 9)}-${String(1 + (i % 9) * 3).padStart(2, '0')}`, depart: `2030-0${1 + Math.floor(i / 9)}-${String(2 + (i % 9) * 3).padStart(2, '0')}`, status: 'confirmed', buyout_rate_cents: 100, created_at: '2026-01-01' });
  const total = db.get('SELECT COUNT(*) n FROM guests').n;
  let r = await get('/guests');
  assert.match(r.text, new RegExp(`Showing 1–20 of ${total}`));
  assert.match(r.text, /Next ›/);
  r = await get('/guests?page=2');
  assert.match(r.text, new RegExp(`Showing 21–40 of ${total}`));
  r = await get('/guests?per=50');
  assert.match(r.text, new RegExp(`Showing 1–${Math.min(50, total)} of ${total}`));
  r = await get('/guests');
  assert.match(r.text, new RegExp(`Showing 1–${Math.min(50, total)} of ${total}`), 'the choice is remembered');
  r = await get('/guests?q=Pager');
  assert.match(r.text, /Showing 1–45 of 45/);
  await get('/guests?per=20');
  r = await get('/reservations?when=all');
  const n = db.get('SELECT COUNT(*) n FROM reservations').n;
  assert.match(r.text, new RegExp(`Showing 1–20 of ${n}`));
  r = await get('/reservations?when=all&per=all');
  assert.match(r.text, new RegExp(`Showing 1–${n} of ${n}`));
  assert.doesNotMatch(r.text, /Next ›/);
});

test('checklists: location lists, a room’s own list, ticks with who and when, who checked in and out', async () => {
  // Admin › Checklists
  let r = await post('/admin/checklists/new', { name: 'Cottage turnover', kind: 'precheck' });
  const pre = Number(r.location.match(/checklists\/(\d+)/)[1]);
  assert.match(r.location, /#items$/, 'saving the name goes straight to adding items');
  for (const t of ['Fresh towels', 'Heat on', 'Old item']) assert.equal((await post(`/admin/checklists/${pre}/items`, { text: t })).status, 303);
  const oldItem = db.get("SELECT id FROM checklist_items WHERE text='Old item'").id;
  const ids = db.all('SELECT id FROM checklist_items WHERE checklist_id=? ORDER BY sort', pre).map((x) => String(x.id));
  r = await post(`/admin/checklists/${pre}/items/save`, [['item_id[]', ids[0]], ['item_text[]', 'Fresh towels'], ['item_id[]', ids[1]], ['item_text[]', 'Heat on'], ['item_id[]', ids[2]], ['item_text[]', 'Old item'], ['remove[]', String(oldItem)]]);
  assert.equal(r.status, 303);
  assert.equal((await post(`/admin/checklists/${pre}/items`, { text: '' })).status, 422);
  // ▲ ▼ change the order (and keep wording typed before moving)
  const [t1, t2] = db.all('SELECT id FROM checklist_items WHERE checklist_id=? ORDER BY sort', pre).map((x) => String(x.id));
  r = await post(`/admin/checklists/${pre}/items/${t2}/up`, [['item_id[]', t1], ['item_text[]', 'Fresh towels'], ['item_id[]', t2], ['item_text[]', 'Heat on (68°)']]);
  assert.equal(r.status, 303); assert.match(r.location, new RegExp(`#item-${t2}$`));
  assert.deepEqual(db.all('SELECT text FROM checklist_items WHERE checklist_id=? ORDER BY sort', pre).map((x) => x.text), ['Heat on (68°)', 'Fresh towels']);
  await post(`/admin/checklists/${pre}/items/${t2}/up`, []); // already at the top: nothing changes
  await post(`/admin/checklists/${pre}/items/${t2}/down`, []);
  assert.deepEqual(db.all('SELECT text FROM checklist_items WHERE checklist_id=? ORDER BY sort', pre).map((x) => x.text), ['Fresh towels', 'Heat on (68°)']);
  assert.match((await get(`/admin/checklists/${pre}`)).text, /Move Fresh towels up"[^>]*disabled/);
  await post(`/admin/checklists/${pre}/items/save`, [['item_id[]', t1], ['item_text[]', 'Fresh towels'], ['item_id[]', t2], ['item_text[]', 'Heat on']]);
  assert.deepEqual(db.all('SELECT text FROM checklist_items WHERE checklist_id=? ORDER BY sort', pre).map((x) => x.text), ['Fresh towels', 'Heat on']);
  r = await post('/admin/checklists/new', { name: 'Suite extras', kind: 'precheck' });
  const special = Number(r.location.match(/checklists\/(\d+)/)[1]);
  await post(`/admin/checklists/${special}/items`, { text: 'Champagne on ice' });
  r = await post('/admin/checklists/new', { name: 'Cottage checkout', kind: 'checkout' });
  const co = Number(r.location.match(/checklists\/(\d+)/)[1]);
  await post(`/admin/checklists/${co}/items`, { text: 'Keys returned' });
  await post(`/admin/checklists/${co}/items`, { text: 'Damage check' });
  // The location uses Cottage turnover + Cottage checkout; Upstairs picks its own pre-check-in list
  const room = (id, name, rate, plist) => [['room_id[]', String(id)], ['room_name[]', name], ['room_rate[]', rate], ['room_wrate[]', ''], ['room_max[]', '2'], ['room_active[]', '1'],
    ['room_desc[]', ''], ['room_in[]', ''], ['room_out[]', ''], ['room_plist[]', plist], ['room_clist[]', ''], ['room_instr[]', ''], ['room_notes[]', '']];
  r = await post(`/admin/locations/${locId}`, [['name', 'Test Cottage'], ['buyout_rate', '500'], ['precheck_list_id', String(pre)], ['checkout_list_id', String(co)],
    ...room(roomA, 'Upstairs', '100', String(special)), ...room(roomB, 'Downstairs', '80.50', '')]);
  assert.equal(r.status, 303);
  assert.equal(db.get('SELECT precheck_list_id FROM rooms WHERE id=?', roomA).precheck_list_id, special);
  assert.equal(db.get('SELECT precheck_list_id FROM rooms WHERE id=?', roomB).precheck_list_id, null);
  assert.match((await get('/admin/checklists')).text, /Test Cottage: Upstairs/);
  await post(`/admin/checklists/${special}`, { name: 'Suite extras', kind: 'checkout', active: '1' });
  assert.equal(db.get('SELECT kind FROM checklists WHERE id=?', special).kind, 'precheck', 'a list in use keeps its type');
  const home = (await get('/admin')).text;
  for (const t of ['Business details', 'Logins', 'Locations and rooms', 'Checklists', 'Stay defaults']) assert.ok(home.includes(t), t);
  assert.match((await get('/admin/stays')).text, /Admin home/);
  // A stay in both rooms
  r = await post('/reservations/new', booking([['room_ids[]', String(roomA)], ['room_ids[]', String(roomB)]]).map(([k, v]) => (k === 'arrive' ? [k, '2031-02-03'] : k === 'depart' ? [k, '2031-02-05'] : [k, v])));
  const id = Number(r.location.split('/').pop());
  let page = (await get(`/reservations/${id}`)).text;
  assert.match(page, /Pre-check-in/); assert.match(page, /0 of 3/);
  assert.match(page, /Champagne on ice/, 'Upstairs uses its own list');
  assert.match(page, /Heat on/, 'Downstairs follows the location');
  assert.doesNotMatch(page, /Keys returned/, 'checkout list waits for check-in');
  const champ = db.get("SELECT id FROM checklist_items WHERE text='Champagne on ice'").id;
  const towels = db.get("SELECT id FROM checklist_items WHERE text='Fresh towels'").id;
  r = await post(`/reservations/${id}/checks`, [['kind', 'precheck'], ['c[]', `${roomA}:${champ}`], ['c[]', `${roomB}:${towels}`]]);
  assert.equal(r.status, 303);
  const ticks = db.all('SELECT * FROM reservation_checks WHERE reservation_id=?', id);
  assert.equal(ticks.length, 2);
  assert.ok(ticks.every((t) => t.done_by && t.done_at));
  page = (await get(`/reservations/${id}`)).text;
  assert.match(page, /2 of 3/); assert.match(page, /cl-who">Administrator/);
  assert.match(page, /1 of the 3 pre-check-in items aren’t ticked yet/, 'Check in asks first when items are left');
  // untick one
  await post(`/reservations/${id}/checks`, [['kind', 'precheck'], ['c[]', `${roomA}:${champ}`]]);
  assert.equal(db.get('SELECT COUNT(*) n FROM reservation_checks WHERE reservation_id=?', id).n, 1);
  // check in: who did it, and the checkout list appears
  await post(`/reservations/${id}/status`, { to: 'checked_in' });
  const admin = db.get("SELECT id FROM users WHERE username='admin'").id;
  assert.equal(db.get('SELECT checked_in_by FROM reservations WHERE id=?', id).checked_in_by, admin);
  page = (await get(`/reservations/${id}`)).text;
  assert.match(page, /checked in [^<]* by Administrator/);
  assert.match(page, /Keys returned/); assert.match(page, /0 of 4/);
  // phone: same lists
  const m = (await get(`/m/r/${id}`)).text;
  assert.match(m, /Keys returned/);
  const keys = db.get("SELECT id FROM checklist_items WHERE text='Keys returned'").id;
  r = await post(`/reservations/${id}/checks`, [['kind', 'checkout'], ['c[]', `${roomA}:${keys}`], ['next', `/m/r/${id}#checkout`]]);
  assert.equal(r.location, `/m/r/${id}#checkout`);
  await post(`/reservations/${id}/status`, { to: 'checked_out' });
  assert.equal(db.get('SELECT checked_out_by FROM reservations WHERE id=?', id).checked_out_by, admin);
  // deleting a list keeps the ticks already made
  await post(`/admin/checklists/${special}/delete`, {});
  assert.equal(db.get('SELECT precheck_list_id FROM rooms WHERE id=?', roomA).precheck_list_id, null);
  assert.match((await get(`/reservations/${id}`)).text, /Champagne on ice/);
});

test('check-in desk: by location and day, with pre-check-in, check in, checkout list and check out', async () => {
  // A new stay at the test location with lists set (from the checklist test)
  let r = await post('/reservations/new', booking([['room_ids[]', String(roomB)]]).map(([k, v]) => (k === 'arrive' ? [k, '2031-05-06'] : k === 'depart' ? [k, '2031-05-08'] : [k, v])));
  const id = Number(r.location.split('/').pop());
  let page = (await get(`/checkin?loc=${locId}&d=2031-05-06`)).text;
  assert.match(page, new RegExp(`id="r${id}"`));
  assert.match(page, /Checking in/); assert.match(page, /0 of 1 checked in/);
  assert.match(page, /Pre-check-in/); assert.match(page, /0 of 2/);
  assert.doesNotMatch(page, /Check out<\/button>/, 'checkout comes after check-in');
  // the location is remembered
  assert.match((await get('/checkin?d=2031-05-06')).text, new RegExp(`id="r${id}"`));
  // another location shows nobody
  const other = db.get('SELECT id FROM locations WHERE id<>? ORDER BY id LIMIT 1', locId).id;
  assert.doesNotMatch((await get(`/checkin?loc=${other}&d=2031-05-06`)).text, new RegExp(`id="r${id}"`));
  // tick the pre-check-in list from the desk, then check in
  const items = db.all('SELECT id FROM checklist_items WHERE checklist_id=(SELECT precheck_list_id FROM locations WHERE id=?) ORDER BY sort', locId);
  const next = `/checkin?loc=${locId}&d=2031-05-06&open=precheck${id}#r${id}`;
  r = await post(`/reservations/${id}/checks`, [['kind', 'precheck'], ...items.map((it) => ['c[]', `${roomB}:${it.id}`]), ['next', next]]);
  assert.equal(r.location, next);
  page = (await get(`/checkin?loc=${locId}&d=2031-05-06`)).text;
  assert.match(page, /Completed/);
  await post(`/reservations/${id}/status`, { to: 'checked_in', next: `/checkin?loc=${locId}&d=2031-05-06#r${id}` });
  page = (await get(`/checkin?loc=${locId}&d=2031-05-06`)).text;
  assert.match(page, /Checked in [^<]* by Administrator/); assert.match(page, /1 of 1 checked in/);
  assert.match(page, /Check out<\/button>/);
  // on the day they leave, they're under Checking out
  page = (await get(`/checkin?loc=${locId}&d=2031-05-08`)).text;
  assert.match(page, /Checking out/); assert.match(page, new RegExp(`id="r${id}"`)); assert.match(page, /0 of 1 checked out/);
  await post(`/reservations/${id}/status`, { to: 'checked_out' });
  assert.match((await get(`/checkin?loc=${locId}&d=2031-05-08`)).text, /1 of 1 checked out/);
  await get(`/checkin?loc=all`);
});

test('checklist ticks save one at a time as they are clicked', async () => {
  let r = await post('/reservations/new', booking([['room_ids[]', String(roomB)]]).map(([k, v]) => (k === 'arrive' ? [k, '2031-07-01'] : k === 'depart' ? [k, '2031-07-02'] : [k, v])));
  const id = Number(r.location.split('/').pop());
  const items = db.all('SELECT id FROM checklist_items WHERE checklist_id=(SELECT precheck_list_id FROM locations WHERE id=?) ORDER BY sort', locId);
  r = await post(`/reservations/${id}/check`, { kind: 'precheck', key: `${roomB}:${items[0].id}`, on: '1' });
  let j = JSON.parse(r.text);
  assert.equal(j.ok, true); assert.equal(j.done, 1); assert.equal(j.total, items.length); assert.equal(j.by, 'Administrator'); assert.ok(j.at);
  r = await post(`/reservations/${id}/check`, { kind: 'precheck', key: `${roomB}:${items[1].id}`, on: '1' });
  assert.equal(JSON.parse(r.text).done, 2);
  r = await post(`/reservations/${id}/check`, { kind: 'precheck', key: `${roomB}:${items[0].id}`, on: '0' });
  j = JSON.parse(r.text); assert.equal(j.done, 1); assert.equal(j.on, false);
  assert.equal(db.get('SELECT COUNT(*) n FROM reservation_checks WHERE reservation_id=?', id).n, 1);
  assert.equal((await post(`/reservations/${id}/check`, { kind: 'precheck', key: '999:999', on: '1' })).status, 404);
  const page = (await get(`/reservations/${id}`)).text;
  assert.match(page, new RegExp(`data-autocheck="${id}"`));
  assert.match(page, /<noscript><button class="btn">Save pre-check-in list/);
});

test('locations: ▲ ▼ set the order used everywhere', async () => {
  const order = () => db.all('SELECT id FROM locations ORDER BY sort, name').map((x) => x.id);
  const before = order();
  const second = before[1];
  let r = await post(`/admin/locations/${second}/up`, {});
  assert.equal(r.status, 303); assert.match(r.location, new RegExp(`#loc-${second}$`));
  assert.equal(order()[0], second);
  await post(`/admin/locations/${second}/up`, {}); // already first
  assert.equal(order()[0], second);
  await post(`/admin/locations/${second}/down`, {});
  assert.deepEqual(order(), before);
  // the date book follows the order
  await post(`/admin/locations/${before[before.length - 1]}/up`, {});
  const now = order(); const dbk = (await get('/datebook?days=7')).text;
  const names = now.map((id) => db.get('SELECT name FROM locations WHERE id=?', id).name).filter((n) => dbk.includes(`</span>${n} <a`));
  const pos = names.map((n) => dbk.indexOf(`</span>${n} <a`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.match((await get('/admin/locations')).text, new RegExp(`Move [^"]+ up" disabled`));
});

test('phone check-in tab: by location and day with each guest’s steps', async () => {
  let r = await post('/reservations/new', booking([['room_ids[]', String(roomB)]]).map(([k, v]) => (k === 'arrive' ? [k, '2031-09-01'] : k === 'depart' ? [k, '2031-09-03'] : [k, v])));
  const id = Number(r.location.split('/').pop());
  let page = (await get(`/m/checkin?loc=${locId}&d=2031-09-01`)).text;
  assert.match(page, /href="\/m\/checkin"[^>]*class="on"/, 'Check-in tab is lit');
  assert.match(page, new RegExp(`id="r${id}"`)); assert.match(page, /Pre-check-in/); assert.match(page, /0 of 1<\/span>/);
  assert.match(page, new RegExp(`data-autocheck="${id}"`));
  r = await post(`/reservations/${id}/status`, { to: 'checked_in', next: `/m/checkin?loc=${locId}&d=2031-09-01#r${id}` });
  assert.equal(r.location, `/m/checkin?loc=${locId}&d=2031-09-01#r${id}`);
  page = (await get(`/m/checkin?loc=${locId}&d=2031-09-01`)).text;
  assert.match(page, /Checked in [^<]* by Administrator/); assert.match(page, /Check out<\/button>/);
  page = (await get(`/m/checkin?loc=${locId}&d=2031-09-03`)).text;
  assert.match(page, /Checking out/); assert.match(page, new RegExp(`id="r${id}"`));
});

test('emergency contacts and check-in details for the guest (text, email, private link, no prices)', async () => {
  // Contacts on the location
  const room = (id, name, rate) => [['room_id[]', String(id)], ['room_name[]', name], ['room_rate[]', rate], ['room_wrate[]', ''], ['room_max[]', '2'], ['room_active[]', '1'],
    ['room_desc[]', ''], ['room_in[]', ''], ['room_out[]', ''], ['room_plist[]', ''], ['room_clist[]', ''], ['room_instr[]', id === roomB ? 'Key is in the blue lockbox' : ''], ['room_notes[]', '']];
  const loc = db.get('SELECT * FROM locations WHERE id=?', locId);
  let r = await post(`/admin/locations/${locId}`, [['name', 'Test Cottage'], ['buyout_rate', '500'], ['precheck_list_id', String(loc.precheck_list_id || '')], ['checkout_list_id', String(loc.checkout_list_id || '')], ['tax_percent', '10'],
    ['ec_id[]', ''], ['ec_name[]', 'Maria Lopez'], ['ec_role[]', 'On-site manager'], ['ec_phone[]', '8055550142'],
    ['ec_id[]', ''], ['ec_name[]', 'Sam Night'], ['ec_role[]', 'After hours'], ['ec_phone[]', '8055550199'],
    ...room(roomA, 'Upstairs', '100'), ...room(roomB, 'Downstairs', '80.50')]);
  assert.equal(r.status, 303);
  const ecs = db.all('SELECT * FROM location_contacts WHERE location_id=? ORDER BY sort', locId);
  assert.deepEqual(ecs.map((c) => c.name), ['Maria Lopez', 'Sam Night']);
  assert.match((await get(`/admin/locations/${locId}`)).text, /On-site manager/);
  // A stay picking the after-hours contact
  r = await post('/reservations/new', booking([['room_ids[]', String(roomB)], ['occ_' + roomB, 'Pat & Sam'], ['emergency_contact_id', String(ecs[1].id)]]).map(([k, v]) => (k === 'arrive' ? [k, '2031-10-01'] : k === 'depart' ? [k, '2031-10-03'] : [k, v])));
  const id = Number(r.location.split('/').pop());
  assert.equal(db.get('SELECT emergency_contact_id FROM reservations WHERE id=?', id).emergency_contact_id, ecs[1].id);
  const form = (await get(`/reservations/${id}/edit`)).text;
  assert.match(form, new RegExp(`value="${ecs[1].id}" data-loc="${locId}" selected`));
  let page = (await get(`/reservations/${id}`)).text;
  assert.match(page, /Check-in details for the guest/); assert.match(page, /Sam Night/);
  assert.match(page, /href="sms:/); assert.match(page, /href="mailto:pat@example.com\?subject=/);
  // The message: rooms, times, needs, instructions, emergency contact, link; never prices
  const SI = require('../lib/stayinfo');
  const x = db.get('SELECT * FROM reservations WHERE id=?', id);
  const m = SI.message(db, x, db.settings(), 'https://inn.example');
  for (const t of ['Downstairs · Pat & Sam', 'Key is in the blue lockbox', 'Special needs: Ground floor please', 'Use the side gate', 'Emergency contact: Sam Night · After hours · (805) 555-0199', 'Check-in: Wednesday, October 1, 2031', 'Checkout: Friday, October 3, 2031']) assert.ok(m.text.includes(t), t);
  // the text message: one thing per line
  const smsLines = m.sms.split('\n');
  assert.ok(smsLines.includes('Test Cottage')); assert.ok(smsLines.some((l) => l.startsWith('Check-in: '))); assert.ok(smsLines.some((l) => l.startsWith('Checkout: ')));
  assert.ok(smsLines.some((l) => l.startsWith('Room: Downstairs'))); assert.ok(smsLines.some((l) => l.startsWith('Special needs: ')));
  assert.ok(smsLines.some((l) => l.startsWith('Emergency contact: Sam Night'))); assert.match(smsLines[smsLines.length - 1], /^Details: https/);
  // the email: laid out like the guest's page
  const em = SI.emailHtml(m.facts, m.url);
assert.doesNotMatch(m.text + em + m.sms, /Test Inns/, 'no business name and phone at the bottom');
    assert.match(em, />Check-in<\/td>/); assert.match(em, />Emergency contact<\/td>/); assert.match(em, /View or print these details/); assert.doesNotMatch(em, /\$\d/);
  assert.doesNotMatch(m.text + m.sms, /\$\d/, 'no prices');
  assert.doesNotMatch(m.text, /Returning guest/, 'staff comments stay private');
  assert.match(m.sms, /Details: https:\/\/inn\.example\/stay\//);
  // The guest's private link opens without signing in
  const tok = db.get('SELECT token FROM reservations WHERE id=?', id).token;
  const pub = await fetch(`${base}/stay/${tok}`);
  const pubText = await pub.text();
  assert.equal(pub.status, 200); assert.match(pubText, /Sam Night/); assert.doesNotMatch(pubText, /\$\d/);
  assert.equal((await fetch(`${base}/stay/nope-nope-nope`)).status, 404);
  // Noting a text sent from the phone, and an email with no email service set up
  r = await post(`/reservations/${id}/details-sent`, { how: 'text' });
  assert.equal(JSON.parse(r.text).ok, true);
  assert.equal(db.get('SELECT details_sent_how FROM reservations WHERE id=?', id).details_sent_how, 'text');
  assert.match((await get(`/reservations/${id}`)).text, /Last sent by text/);
  r = await post(`/reservations/${id}/send-details`, { next: `/reservations/${id}#details` });
  assert.equal(r.status, 303);
  // On the Check-in page and the phone
  assert.match((await get(`/checkin?loc=${locId}&d=2031-10-01`)).text, /Send check-in details/);
  assert.match((await get(`/m/r/${id}`)).text, /Send check-in details/);
  // Removing a contact clears it from stays
  await post(`/admin/locations/${locId}`, [['name', 'Test Cottage'], ['buyout_rate', '500'], ['tax_percent', '10'], ['ec_id[]', String(ecs[0].id)], ['ec_name[]', 'Maria Lopez'], ['ec_role[]', ''], ['ec_phone[]', ''],
    ...room(roomA, 'Upstairs', '100'), ...room(roomB, 'Downstairs', '80.50')]);
  assert.equal(db.get('SELECT emergency_contact_id FROM reservations WHERE id=?', id).emergency_contact_id, null);
  assert.equal(SI.emergencyOf(db, db.get('SELECT * FROM reservations WHERE id=?', id)).name, 'Maria Lopez', 'falls back to the location’s first contact');
});

test('add an event from the reservation form without leaving it', async () => {
  let r = await post('/api/events/quick', { name: '', start_date: '2032-01-01' });
  assert.equal(r.status, 422);
  r = await post('/api/events/quick', { name: 'Gala', start_date: '2032-01-05', end_date: '2032-01-01' });
  assert.equal(r.status, 422);
  r = await post('/api/events/quick', { name: 'Holiday Gala', start_date: '2032-01-05', end_date: '', location_id: String(locId) });
  const ev = JSON.parse(r.text);
  assert.equal(ev.name, 'Holiday Gala'); assert.equal(ev.end_date, '2032-01-05');
  assert.equal(db.get('SELECT location_id FROM events WHERE id=?', ev.id).location_id, locId);
  assert.match((await get('/reservations/new')).text, /data-quick-event/);
});

test('date book: a buy-out has its own line; rooms show names typed for them or an empty outline', async () => {
  const r = await post('/reservations/new', booking([['occ_' + roomA, 'The Bride']]).map(([k, v]) => (k === 'kind' ? [k, 'buyout'] : k === 'arrive' ? [k, '2033-02-01'] : k === 'depart' ? [k, '2033-02-03'] : [k, v])));
  assert.equal(r.status, 303, r.text);
  const page = (await get(`/datebook?from=2033-01-31&days=7&location=${locId}`)).text;
  assert.match(page, /db-buyrow/); assert.match(page, /<b>Full buy-out<\/b>/);
  assert.match(page, /class="db-bar buyout[^"]*"[^>]*>[\s\S]*?Pat Tester/);
  assert.match(page, /bo-room st-confirmed[^"]*"[^>]*>[^<]*<span>The Bride<\/span>/, 'a room with names shows them');
  assert.match(page, /bo-room st-confirmed bo-empty/, 'a room without names is an empty outline');
});

test('calendar month: each stay is one bar from mid arrival day to mid departure day, carried into the next week', async () => {
  // Fri 2034-03-03 to Tue 2034-03-07: nights Fri, Sat (week 1), Sun, Mon (week 2)
  const r = await post('/reservations/new', booking([['room_ids[]', String(roomA)]]).map(([k, v]) => (k === 'arrive' ? [k, '2034-03-03'] : k === 'depart' ? [k, '2034-03-07'] : [k, v])));
  const id = Number(r.location.split('/').pop());
  const page = (await get(`/calendar?date=2034-03-01&location=${locId}`)).text;
  const bars = page.match(new RegExp(`<a class="mo-bar[^"]*" href="/reservations/${id}"[^>]*style="grid-column:[^;]+`, 'g')) || [];
  assert.equal(bars.length, 2, 'one bar per week it touches');
  // half-day columns: from the middle of Friday (line 12) past Saturday; then to the middle of Tuesday (line 6)
  assert.match(bars[0], /cont-r/); assert.match(bars[0], /grid-column:12 \/ 15/);
  assert.match(bars[1], /cont-l/); assert.match(bars[1], /grid-column:1 \/ 6/);
});

test('new reservations start with the location’s special needs and instructions, which can be changed', async () => {
  const others = db.all('SELECT id FROM locations WHERE id<>? ORDER BY id', locId);
  const row = (id, needs, instr) => [['loc_id[]', String(id)], ['loc_in[]', '16:00'], ['loc_out[]', '10:00'], ['loc_tax[]', ''], ['loc_note[]', ''], ['loc_needs[]', needs], ['loc_instr[]', instr]];
  const r = await post('/admin/stays', [...row(locId, 'Stairs only', 'Key in the lockbox'), ...others.flatMap((o) => row(o.id, '', ''))]);
  assert.equal(r.status, 303);
  const after = db.get('SELECT * FROM locations WHERE id=?', locId);
  assert.equal(after.default_needs, 'Stairs only'); assert.equal(after.default_instructions, 'Key in the lockbox');
  const form = (await get(`/reservations/new?location=${locId}`)).text;
  assert.match(form, /<textarea name="special_needs"[^>]*>Stairs only<\/textarea>/);
  assert.match(form, /<textarea name="special_instructions"[^>]*>Key in the lockbox<\/textarea>/);
  assert.match(form, /data-needs="Stairs only"/, 'switching location swaps them in the browser');
  // an existing reservation keeps what it has
  assert.doesNotMatch((await get(`/reservations/${resId}/edit`)).text, />Key in the lockbox<\/textarea>/);
  // the location page edits them too
  assert.match((await get(`/admin/locations/${locId}`)).text, /Special needs for new reservations/);
});

test('staff logins can’t open Admin', async () => {
  const r = await post('/admin/users', { name: 'Desk', username: 'desk', password: 'desk-password-1', role: 'staff' });
  assert.equal(r.status, 303, r.text);
  await post('/logout', {});
  await get('/login');
  const ok = await post('/login', { username: 'desk', password: 'desk-password-1' });
  assert.equal(ok.status, 303);
  assert.equal((await get('/admin')).status, 403);
  assert.equal((await get('/reservations')).status, 200);
});
