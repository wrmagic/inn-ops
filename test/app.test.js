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
  await post('/admin', { name: 'Test Inns', timezone: 'America/Los_Angeles', check_in_time: '15:00', check_out_time: '11:00', tax_percent: '10' });
  assert.equal(Number(db.settings().tax_percent), 10);
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
  // a second buy-out on the same nights is refused
  const again = await post('/reservations/new', booking().map(([k, v]) => (k === 'kind' ? [k, 'buyout'] : k === 'location_id' ? [k, String(wid)] : k === 'arrive' ? [k, '2027-06-02'] : k === 'depart' ? [k, '2027-06-04'] : [k, v])));
  assert.equal(again.status, 409);
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
