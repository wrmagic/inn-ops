'use strict';
// First-time setup: the admin login and the four locations. With --demo, sample rooms, guests and stays too.
const path = require('node:path');
const crypto = require('node:crypto');
const { open } = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const { addDays, todayIn } = require('../lib/common');

const db = open(process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'innops.db'));
const now = new Date().toISOString();
const demo = process.argv.includes('--demo');

if (!db.get('SELECT COUNT(*) n FROM users').n) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.insert('users', { username: 'admin', name: 'Administrator', password_hash: hashPassword(pw), role: 'admin', created_at: now });
  console.log(process.env.ADMIN_PASSWORD ? 'Admin login "admin" created with the ADMIN_PASSWORD you set.' : `Admin login: admin   Password: ${pw}   (change it under Your login)`);
}
if (!db.get('SELECT COUNT(*) n FROM locations').n) {
  [['Inn', '#7a4fb3'], ['Stonehouse', '#2f7d9b'], ['Ranch House', '#b35a3c'], ['Mansion', '#3f8f52']].forEach(([name, color], i) => db.insert('locations', { name, color, sort: i }));
  console.log('Locations added: Inn, Stonehouse, Ranch House, Mansion. Add their rooms under Admin › Locations and rooms.');
}

if (demo && !db.get('SELECT COUNT(*) n FROM rooms').n) {
  const loc = (n) => db.get('SELECT id FROM locations WHERE name=?', n).id;
  const rooms = {
    Inn: [['Rose Room', 'Queen bed, private bath', 2, 18900], ['Garden Room', 'King bed, garden view', 2, 21900], ['Blue Room', 'Two twins', 2, 16900], ['Tower Suite', 'King bed, sitting room', 3, 29900]],
    Stonehouse: [['Main Bedroom', 'King bed', 2, 24900], ['Loft', 'Two queens', 4, 19900]],
    'Ranch House': [['Bunk Room', 'Four bunks', 4, 14900], ['Corner Room', 'Queen bed', 2, 15900], ['Porch Room', 'Queen bed, porch', 2, 16900]],
    Mansion: [['Grand Suite', 'King bed, fireplace', 2, 39900], ['East Room', 'Queen bed', 2, 22900], ['West Room', 'Queen bed', 2, 22900], ['Nursery', 'Twin bed', 1, 12900], ['Library Room', 'King bed', 2, 25900]],
  };
  for (const [l, list] of Object.entries(rooms)) list.forEach(([name, description, max_guests, rate_cents], i) => db.insert('rooms', { location_id: loc(l), name, description, max_guests, rate_cents, sort: i }));
  db.run('UPDATE locations SET buyout_rate_cents=? WHERE name=?', 150000, 'Mansion');
  db.run('UPDATE locations SET buyout_rate_cents=? WHERE name=?', 85000, 'Inn');
  db.run("UPDATE locations SET instructions='Park in the lot behind the main house. The front door code is sent the day before arrival.' WHERE name='Mansion'");
  const g = (first, last, phone, email) => db.insert('guests', { first, last, phone, email, created_at: now });
  const smith = g('Madison', 'Smith', '(805) 555-0101', 'madison@example.com'); const lee = g('Daniel', 'Lee', '(805) 555-0102', 'dlee@example.com');
  const ortiz = g('Ana', 'Ortiz', '(805) 555-0103', null); const brown = g('Chris', 'Brown', '(805) 555-0104', 'chris@example.com');
  const today = todayIn(db.settings().timezone);
  const ev = db.insert('events', { name: 'Smith–Jones Wedding', start_date: addDays(today, 3), end_date: addDays(today, 5), location_id: loc('Mansion'), contact_id: smith, created_at: now });
  const room = (n) => db.get('SELECT * FROM rooms WHERE name=?', n);
  const book = (rec, roomNames, occ = {}) => {
    const id = db.insert('reservations', { kind: 'rooms', status: 'confirmed', created_at: now, ...rec });
    const names = rec.kind === 'buyout' ? db.all('SELECT name FROM rooms WHERE location_id=?', rec.location_id).map((x) => x.name) : roomNames;
    for (const n of names) { const ro = room(n); db.insert('reservation_rooms', { reservation_id: id, room_id: ro.id, rate_cents: ro.rate_cents, occupants: occ[n] || null }); }
    return id;
  };
  book({ kind: 'buyout', location_id: loc('Mansion'), guest_id: smith, event_id: ev, arrive: addDays(today, 3), depart: addDays(today, 6), check_in_time: '15:00', check_out_time: '11:00', buyout_rate_cents: 150000, adults: 9, special_needs: 'Bride’s grandmother uses a walker: ground floor please.', deposit_cents: 150000 }, [], { 'Grand Suite': 'Madison Smith & Alex Jones', Nursery: 'Ella Smith' });
  book({ location_id: loc('Inn'), guest_id: lee, arrive: addDays(today, -1), depart: addDays(today, 2), check_in_time: '15:00', check_out_time: '11:00', adults: 2, status: 'checked_in', checked_in_at: now }, ['Rose Room'], { 'Rose Room': 'Daniel & Kim Lee' });
  book({ location_id: loc('Inn'), guest_id: ortiz, event_id: ev, arrive: addDays(today, 3), depart: addDays(today, 5), check_in_time: '16:00', check_out_time: '11:00', adults: 3, status: 'tentative' }, ['Garden Room', 'Blue Room'], { 'Garden Room': 'Ana Ortiz', 'Blue Room': 'Luis & Sofia Ortiz' });
  book({ location_id: loc('Ranch House'), guest_id: brown, arrive: today, depart: addDays(today, 4), check_in_time: '15:00', check_out_time: '10:00', adults: 4, special_instructions: 'Late arrival around 9 PM: leave the porch light on.' }, ['Bunk Room', 'Corner Room']);
  book({ location_id: loc('Stonehouse'), guest_id: lee, arrive: addDays(today, 8), depart: addDays(today, 10), adults: 2 }, ['Main Bedroom']);
  console.log('Sample rooms, guests, an event and stays added.');
}
db.close();
