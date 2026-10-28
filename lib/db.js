'use strict';
// Database: one SQLite file (node:sqlite, no packages). The schema is created on first open; later columns are
// added with addColumn() at the end of open(), so existing databases update themselves.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- The business: name, time zone, defaults (one row, id 1)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Inn Ops',
  phone TEXT, email TEXT, website TEXT,
  address1 TEXT, city TEXT, state TEXT, postal TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  check_in_time TEXT NOT NULL DEFAULT '15:00',
  check_out_time TEXT NOT NULL DEFAULT '11:00',
  tax_percent REAL NOT NULL DEFAULT 0,
  confirm_note TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  flash TEXT,
  list_state TEXT
);

-- Where guests stay: the Inn, Stonehouse, Ranch House, Mansion…
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address1 TEXT, city TEXT, state TEXT, postal TEXT, phone TEXT,
  check_in_time TEXT, check_out_time TEXT,
  buyout_rate_cents INTEGER,
  color TEXT,
  instructions TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  max_guests INTEGER,
  rate_cents INTEGER NOT NULL DEFAULT 0,
  check_in_time TEXT, check_out_time TEXT,
  instructions TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rooms_loc ON rooms(location_id, sort);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY,
  is_org INTEGER NOT NULL DEFAULT 0,
  first TEXT, last TEXT, org_name TEXT,
  phone TEXT, email TEXT,
  address1 TEXT, city TEXT, state TEXT, postal TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- What a stay is for (a wedding, a retreat…)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT, end_date TEXT,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- A stay: some rooms, or the whole location (buy-out), from the arrival date to the departure date
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'rooms' CHECK (kind IN ('rooms','buyout')),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  arrive TEXT NOT NULL,
  depart TEXT NOT NULL,
  check_in_time TEXT, check_out_time TEXT,
  adults INTEGER, children INTEGER,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative','confirmed','checked_in','checked_out','cancelled')),
  buyout_rate_cents INTEGER,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  deposit_due TEXT,
  special_needs TEXT,
  special_instructions TEXT,
  comments TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  checked_in_at TEXT, checked_out_at TEXT, cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS res_dates ON reservations(arrive, depart);

CREATE TABLE IF NOT EXISTS reservation_rooms (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  rate_cents INTEGER NOT NULL DEFAULT 0,
  occupants TEXT,
  UNIQUE (reservation_id, room_id)
);
CREATE INDEX IF NOT EXISTS resroom_room ON reservation_rooms(room_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  received_on TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
`;

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA);
  raw.exec('INSERT OR IGNORE INTO settings (id) VALUES (1)');
  const cols = (t) => raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  // eslint-disable-next-line no-unused-vars
  const addColumn = (t, c, def) => { if (!cols(t).includes(c)) raw.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  // Later columns go here, e.g. addColumn('rooms', 'floor', 'TEXT');
  // Weekend rates: Friday and Saturday nights (blank = same as the weekday rate)
  addColumn('rooms', 'weekend_rate_cents', 'INTEGER');
  addColumn('locations', 'buyout_weekend_rate_cents', 'INTEGER');
  addColumn('reservation_rooms', 'weekend_rate_cents', 'INTEGER');
  addColumn('reservations', 'buyout_weekend_rate_cents', 'INTEGER');
  // Checklists: pre-check-in and checkout lists, chosen per location (rooms follow it unless they pick their own)
  raw.exec(`CREATE TABLE IF NOT EXISTS checklists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('precheck','checkout')),
      active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT);
    CREATE TABLE IF NOT EXISTS checklist_items (id INTEGER PRIMARY KEY, checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE, text TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS reservation_checks (id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, room_id INTEGER NOT NULL DEFAULT 0, item_id INTEGER NOT NULL, item_text TEXT, done_by INTEGER REFERENCES users(id) ON DELETE SET NULL, done_at TEXT NOT NULL,
      UNIQUE (reservation_id, kind, room_id, item_id));`);
  for (const t of ['locations', 'rooms']) { addColumn(t, 'precheck_list_id', 'INTEGER'); addColumn(t, 'checkout_list_id', 'INTEGER'); }
  addColumn('reservations', 'checked_in_by', 'INTEGER');
  addColumn('reservations', 'checked_out_by', 'INTEGER');
  // Emergency contacts: kept on each location; a reservation picks one. Check-in details sent to the guest.
  raw.exec(`CREATE TABLE IF NOT EXISTS location_contacts (id INTEGER PRIMARY KEY, location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT, role TEXT, sort INTEGER NOT NULL DEFAULT 0)`);
  addColumn('reservations', 'emergency_contact_id', 'INTEGER');
  addColumn('reservations', 'token', 'TEXT');
  addColumn('reservations', 'details_sent_at', 'TEXT');
  addColumn('reservations', 'details_sent_by', 'INTEGER');
  addColumn('reservations', 'details_sent_how', 'TEXT');
  // Stay defaults per location (times, lodging tax, confirmation note). First time: copy the business-wide ones over.
  if (!cols('locations').includes('tax_percent')) {
    addColumn('locations', 'tax_percent', 'REAL'); addColumn('locations', 'confirm_note', 'TEXT');
    raw.exec(`UPDATE locations SET tax_percent=(SELECT tax_percent FROM settings WHERE id=1), confirm_note=(SELECT confirm_note FROM settings WHERE id=1),
      check_in_time=COALESCE(check_in_time, (SELECT check_in_time FROM settings WHERE id=1)), check_out_time=COALESCE(check_out_time, (SELECT check_out_time FROM settings WHERE id=1))`);
  }

  const cache = new Map();
  const prep = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  let depth = 0;
  const db = {
    raw,
    all: (sql, ...p) => prep(sql).all(...norm(p)),
    get: (sql, ...p) => prep(sql).get(...norm(p)),
    run: (sql, ...p) => { const r = prep(sql).run(...norm(p)); return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    insert(table, obj) {
      const keys = Object.keys(obj);
      return db.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k])).id;
    },
    update(table, id, obj) {
      const keys = Object.keys(obj);
      if (!keys.length) return 0;
      return db.run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => obj[k]), id).changes;
    },
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } finally { depth--; }
    },
    settings: () => prep('SELECT * FROM settings WHERE id=1').get(),
    close: () => raw.close(),
  };
  return db;
}

module.exports = { open };
