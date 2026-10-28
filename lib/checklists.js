'use strict';
// Pre-check-in and checkout checklists. Admin › Checklists holds the lists; each location picks one of each, and each
// room uses its location's unless it picks its own. On a reservation, every room (or the whole location, when it has
// no rooms) gets its list; each tick records who did it and when.
const KINDS = { precheck: { label: 'Pre-check-in', col: 'precheck_list_id', hint: 'Things to check and confirm before the guest arrives.' },
  checkout: { label: 'Checkout', col: 'checkout_list_id', hint: 'What gets done when the guest leaves.' } };

const listsOf = (db, kind) => db.all('SELECT * FROM checklists WHERE kind=? AND active=1 ORDER BY sort, name COLLATE NOCASE', kind);
const itemsOf = (db, listId) => db.all('SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY sort, id', listId);

/** The list a room uses: its own, else its location's. room may be null (a location with no rooms). */
function listIdFor(kind, loc, room) {
  const col = KINDS[kind].col;
  return (room && room[col]) || (loc && loc[col]) || null;
}

/** A reservation's checklist for one kind: [{ room_id, room, list, items: [{ key, id, text, done: { by, at } | null }] }] */
function forReservation(db, r, kind) {
  const loc = db.get('SELECT * FROM locations WHERE id=?', r.location_id);
  const rooms = db.all('SELECT ro.* FROM reservation_rooms rr JOIN rooms ro ON ro.id=rr.room_id WHERE rr.reservation_id=? ORDER BY ro.sort, ro.name', r.id);
  const units = rooms.length ? rooms.map((ro) => ({ room_id: ro.id, room: ro.name, listId: listIdFor(kind, loc, ro) })) : [{ room_id: 0, room: loc ? loc.name : 'Whole location', listId: listIdFor(kind, loc, null) }];
  const done = db.all('SELECT c.*, u.name uname FROM reservation_checks c LEFT JOIN users u ON u.id=c.done_by WHERE c.reservation_id=? AND c.kind=?', r.id, kind);
  const out = [];
  for (const u of units) {
    const list = u.listId && db.get('SELECT * FROM checklists WHERE id=?', u.listId);
    const items = list ? itemsOf(db, list.id) : [];
    const mine = done.filter((d) => d.room_id === u.room_id);
    const rows = items.map((it) => { const d = mine.find((m) => m.item_id === it.id); return { key: `${u.room_id}:${it.id}`, id: it.id, text: it.text, done: d ? { by: d.uname, at: d.done_at } : null }; });
    // Ticks for items since taken off the list stay in the record
    for (const d of mine) if (!items.some((it) => it.id === d.item_id)) rows.push({ key: `${u.room_id}:${d.item_id}`, id: d.item_id, text: d.item_text, done: { by: d.uname, at: d.done_at }, old: true });
    if (rows.length) out.push({ room_id: u.room_id, room: u.room, list, items: rows });
  }
  return out;
}

const progress = (units) => { const all = units.flatMap((u) => u.items.filter((i) => !i.old)); return { done: all.filter((i) => i.done).length, total: all.length }; };

/** Save the ticks for one kind: `ticked` = the keys ("room_id:item_id") that are ticked. New ticks record who and when. */
function save(db, r, kind, ticked, userId, at) {
  const set = new Set(ticked);
  const units = forReservation(db, r, kind);
  db.tx(() => {
    for (const u of units) for (const it of u.items) {
      if (set.has(it.key) && !it.done) db.run('INSERT OR IGNORE INTO reservation_checks (reservation_id, kind, room_id, item_id, item_text, done_by, done_at) VALUES (?,?,?,?,?,?,?)', r.id, kind, u.room_id, it.id, it.text, userId, at);
      if (!set.has(it.key) && it.done) db.run('DELETE FROM reservation_checks WHERE reservation_id=? AND kind=? AND room_id=? AND item_id=?', r.id, kind, u.room_id, it.id);
    }
  });
}

/** Tick (on) or untick one item, given its key "room_id:item_id". Returns false if it isn't on this stay's list. */
function setOne(db, r, kind, key, on, userId, at) {
  const units = forReservation(db, r, kind);
  for (const u of units) for (const it of u.items) {
    if (it.key !== key) continue;
    if (on && !it.done) db.run('INSERT OR IGNORE INTO reservation_checks (reservation_id, kind, room_id, item_id, item_text, done_by, done_at) VALUES (?,?,?,?,?,?,?)', r.id, kind, u.room_id, it.id, it.text, userId, at);
    if (!on && it.done) db.run('DELETE FROM reservation_checks WHERE reservation_id=? AND kind=? AND room_id=? AND item_id=?', r.id, kind, u.room_id, it.id);
    return true;
  }
  return false;
}

module.exports = { setOne, KINDS, listsOf, itemsOf, listIdFor, forReservation, progress, save };
