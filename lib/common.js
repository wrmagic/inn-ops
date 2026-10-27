'use strict';
// Small helpers for reading form values and dates.
const { HttpError } = require('./http');

const str = (v, max = 2000) => { if (v === undefined || v === null) return null; const s = String(v).trim().slice(0, max); return s === '' ? null : s; };
const int = (v) => { if (v === undefined || v === null || v === '') return null; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const bool = (v) => (v === '1' || v === 'on' || v === 'true' || v === true ? 1 : 0);
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const now = () => new Date().toISOString();

/** Tidy a US phone number to (805) 555-0142 (anything else is kept as typed). */
function phone(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 && !raw.startsWith('+') ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw.slice(0, 40);
}

/** A row by id, or a 404. */
function own(db, table, id) {
  const row = db.get(`SELECT * FROM ${table} WHERE id=?`, int(id));
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

// ---------- dates (YYYY-MM-DD strings, no time zones) and times (HH:MM)
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = fromISO(s); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
const addMonths = (s, n) => { const d = fromISO(s); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return toISO(d); };
const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 864e5);
const dow = (s) => fromISO(s).getUTCDay();
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromISO(s));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const startOfWeek = (s) => addDays(s, -dow(s));

module.exports = { str, int, bool, arr, now, phone, own, toISO, fromISO, addDays, addMonths, daysBetween, dow, isDate, isTime, todayIn, startOfWeek };
