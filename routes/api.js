'use strict';
// Small JSON helpers for the pages: guest search, quick-add a guest, which rooms are free.
const { personName } = require('../lib/html');
const { str, bool, phone, now, isDate } = require('../lib/common');
const R = require('../lib/res');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Guests matching a name, phone or email. */
function findGuests(db, q, limit = 10) {
  const t = String(q || '').trim().toLowerCase(); if (t.length < 2) return [];
  const like = `%${t}%`; const digits = t.replace(/\D/g, '');
  return db.all(`SELECT * FROM guests WHERE lower(COALESCE(first,'')||' '||COALESCE(last,'')) LIKE ? OR lower(COALESCE(last,'')||', '||COALESCE(first,'')) LIKE ?
      OR lower(COALESCE(org_name,'')) LIKE ? OR lower(COALESCE(email,'')) LIKE ? ${digits.length >= 3 ? "OR replace(replace(replace(replace(replace(COALESCE(phone,''),'(',''),')',''),'-',''),' ',''),'.','') LIKE ?" : ''}
    ORDER BY last COLLATE NOCASE, first COLLATE NOCASE LIMIT ?`, like, like, like, like, ...(digits.length >= 3 ? [`%${digits}%`] : []), limit);
}

module.exports = (r, { db }) => {
  r.get('/api/people', (ctx) => ctx.json(findGuests(db, ctx.query.q).map((g) => ({ id: g.id, name: personName(g, 'first'), detail: [g.phone, g.email, g.city].filter(Boolean).join(' · ') }))));

  r.post('/api/people/quick', (ctx) => {
    const b = ctx.body; const isOrg = bool(b.is_org);
    const rec = { is_org: isOrg, first: str(b.first, 100), last: str(b.last, 100), org_name: isOrg ? str(b.org_name, 200) : null, phone: phone(b.phone), email: (str(b.email, 200) || '').toLowerCase() || null };
    if (isOrg && !rec.org_name) return ctx.json({ error: 'Enter the organization name.' }, 422);
    if (!isOrg && !rec.first && !rec.last) return ctx.json({ error: 'Enter a first or last name.' }, 422);
    if (rec.email && !EMAIL_RE.test(rec.email)) return ctx.json({ error: 'That email address doesn’t look right.' }, 422);
    if (rec.email) { const ex = db.get('SELECT * FROM guests WHERE email=?', rec.email); if (ex) return ctx.json({ id: ex.id, name: personName(ex, 'first'), existing: true }); }
    const id = db.insert('guests', { ...rec, created_at: now() });
    ctx.json({ id, name: personName({ ...rec }, 'first') });
  });

  // Which rooms are taken between two dates (for the reservation form)
  r.get('/api/availability', (ctx) => {
    const { arrive, depart } = ctx.query;
    if (!isDate(arrive) || !isDate(depart) || depart <= arrive) return ctx.json({ busy: {} });
    const busy = R.busyRooms(db, arrive, depart, Number(ctx.query.exclude) || 0);
    ctx.json({ busy: Object.fromEntries([...busy].map(([k, v]) => [k, v])) });
  });
};
module.exports.findGuests = findGuests;
