'use strict';
// Reservations: who's in which room when, double-booking checks, and money.
// A stay runs from the arrival date to the departure date; the nights are the dates from arrival up to (not including)
// departure, so one guest can leave the morning another arrives.
const { personName, money } = require('./html');
const { daysBetween, addDays, dow } = require('./common');

const STATUS = {
  tentative: { label: 'Tentative', badge: 'warn' },
  confirmed: { label: 'Confirmed', badge: '' },
  checked_in: { label: 'Checked in', badge: 'ok' },
  checked_out: { label: 'Checked out', badge: 'soft' },
  cancelled: { label: 'Cancelled', badge: 'soft' },
};
const LIVE = "r.status <> 'cancelled'";
const PALETTE = ['#7a4fb3', '#2f7d9b', '#b35a3c', '#3f8f52', '#b0882c', '#8f3f72', '#4b5fb5', '#5c7a2f'];

const nights = (r) => Math.max(0, daysBetween(r.arrive, r.depart));
const guestName = (g) => (g ? personName(g, 'first') : 'No guest yet');
const locColor = (l) => (l && l.color) || PALETTE[((l && l.id) || 0) % PALETTE.length];

/** The rooms on a reservation: [{ id (room), name, location_id, rate_cents, occupants, rr_id }] */
function roomsOf(db, resId) {
  return db.all(`SELECT ro.*, rr.id rr_id, rr.rate_cents res_rate, COALESCE(rr.weekend_rate_cents, rr.rate_cents) res_weekend, rr.occupants FROM reservation_rooms rr JOIN rooms ro ON ro.id=rr.room_id
    WHERE rr.reservation_id=? ORDER BY ro.sort, ro.name`, resId);
}

/**
 * Anything already booked that this stay would clash with: [{ id, guest, arrive, depart, room }]
 * Rooms booked by another stay on any of the same nights, or a whole-location buy-out on those nights.
 */
function conflicts(db, { kind, locationId, roomIds, arrive, depart, excludeId = 0 }) {
  const out = [];
  const g = (r) => guestName(r.guest_id ? db.get('SELECT * FROM guests WHERE id=?', r.guest_id) : null);
  if (kind === 'buyout') {
    for (const r of db.all(`SELECT r.* FROM reservations r WHERE ${LIVE} AND r.location_id=? AND r.arrive < ? AND ? < r.depart AND r.id<>?`, locationId, depart, arrive, excludeId)) {
      out.push({ id: r.id, guest: g(r), arrive: r.arrive, depart: r.depart, room: r.kind === 'buyout' ? 'the whole location' : roomsOf(db, r.id).map((x) => x.name).join(', ') });
    }
    return out;
  }
  if (roomIds.length) {
    for (const r of db.all(`SELECT r.*, ro.name room FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id JOIN rooms ro ON ro.id=rr.room_id
      WHERE ${LIVE} AND rr.room_id IN (${roomIds.map(() => '?').join(',')}) AND r.arrive < ? AND ? < r.depart AND r.id<>?`, ...roomIds, depart, arrive, excludeId)) out.push({ id: r.id, guest: g(r), arrive: r.arrive, depart: r.depart, room: r.room });
  }
  // A buy-out of the location covers every room, even ones added after it was booked
  for (const r of db.all(`SELECT r.* FROM reservations r WHERE ${LIVE} AND r.kind='buyout' AND r.location_id=? AND r.arrive < ? AND ? < r.depart AND r.id<>?`, locationId, depart, arrive, excludeId)) {
    if (!out.some((x) => x.id === r.id)) out.push({ id: r.id, guest: g(r), arrive: r.arrive, depart: r.depart, room: 'the whole location (buy-out)' });
  }
  return out;
}

/** Rooms that are taken on any night between arrive and depart: Map(roomId → { id, guest }) */
function busyRooms(db, arrive, depart, excludeId = 0) {
  const m = new Map();
  for (const r of db.all(`SELECT rr.room_id, r.id, r.guest_id FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id
    WHERE ${LIVE} AND r.arrive < ? AND ? < r.depart AND r.id<>?`, depart, arrive, excludeId)) {
    m.set(r.room_id, { id: r.id, guest: guestName(r.guest_id ? db.get('SELECT * FROM guests WHERE id=?', r.guest_id) : null) });
  }
  for (const r of db.all(`SELECT r.id, r.guest_id, r.location_id FROM reservations r WHERE ${LIVE} AND r.kind='buyout' AND r.arrive < ? AND ? < r.depart AND r.id<>?`, depart, arrive, excludeId)) {
    for (const ro of db.all('SELECT id FROM rooms WHERE location_id=?', r.location_id)) if (!m.has(ro.id)) m.set(ro.id, { id: r.id, guest: guestName(r.guest_id ? db.get('SELECT * FROM guests WHERE id=?', r.guest_id) : null), buyout: true });
  }
  return m;
}

/** Weekend nights are Friday and Saturday nights; the rest (Sunday–Thursday) are weeknights. */
const isWeekendNight = (d) => { const w = dow(d); return w === 5 || w === 6; };
function weekendNights(r) {
  let n = 0;
  for (let d = r.arrive; d < r.depart; d = addDays(d, 1)) if (isWeekendNight(d)) n++;
  return n;
}

/** Money for a stay: weeknights × weekday rates + Friday/Saturday nights × weekend rates (or the buy-out rates),
 *  less the discount, plus lodging tax. A blank weekend rate means the weekday rate. */
function totals(db, r, settings) {
  const n = nights(r);
  const wkend = Math.min(n, weekendNights(r));
  const wkday = n - wkend;
  const rooms = roomsOf(db, r.id);
  const nightly = r.kind === 'buyout' ? (r.buyout_rate_cents || 0) : rooms.reduce((s, x) => s + (x.res_rate || 0), 0);
  const weekendNightly = r.kind === 'buyout' ? (r.buyout_weekend_rate_cents ?? r.buyout_rate_cents ?? 0) : rooms.reduce((s, x) => s + (x.res_weekend || 0), 0);
  const subtotal = nightly * wkday + weekendNightly * wkend;
  const discount = Math.min(r.discount_cents || 0, subtotal);
  const taxPct = Number((settings && settings.tax_percent) || 0);
  const tax = Math.round(((subtotal - discount) * taxPct) / 100);
  const total = subtotal - discount + tax;
  const paid = db.get('SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE reservation_id=?', r.id).n;
  return { nights: n, weekdayNights: wkday, weekendNights: wkend, nightly, weekendNightly, subtotal, discount, taxPct, tax, total, paid, balance: total - paid, deposit: r.deposit_cents || 0, depositOwed: Math.max(0, (r.deposit_cents || 0) - paid) };
}

/** One line about a stay, e.g. "Inn: Rose Room, Oak Room" or "Mansion (buy-out)". */
function whereLine(db, r) {
  const loc = db.get('SELECT name FROM locations WHERE id=?', r.location_id);
  if (r.kind === 'buyout') return `${loc ? loc.name : ''} (whole buy-out)`;
  return `${loc ? loc.name : ''}: ${roomsOf(db, r.id).map((x) => x.name).join(', ') || 'no rooms'}`;
}

const nightsLabel = (n) => `${n} night${n === 1 ? '' : 's'}`;
const lastNight = (r) => addDays(r.depart, -1);

module.exports = { STATUS, LIVE, nights, weekendNights, isWeekendNight, nightsLabel, lastNight, guestName, locColor, roomsOf, conflicts, busyRooms, totals, whereLine, money };
