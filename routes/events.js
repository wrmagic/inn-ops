'use strict';
// Events: what stays are for (a wedding, a retreat…). Each reservation can belong to one.
const { html, dateFmt, personName } = require('../lib/html');
const { layout, csrfField, field, input, textarea, select, guestPicker, pageHead, empty, badge } = require('../lib/views');
const { str, int, own, now, isDate, todayIn } = require('../lib/common');
const { HttpError } = require('../lib/http');
const R = require('../lib/res');

module.exports = (r, { db }) => {
  const locs = () => db.all('SELECT id, name FROM locations WHERE active=1 ORDER BY sort, name');
  r.get('/events', (ctx) => {
    const today = todayIn(ctx.settings.timezone); const past = ctx.query.show === 'past';
    const rows = db.all(`SELECT e.*, l.name lname, (SELECT COUNT(*) FROM reservations r WHERE r.event_id=e.id AND ${R.LIVE}) nres FROM events e LEFT JOIN locations l ON l.id=e.location_id
      WHERE ${past ? 'COALESCE(e.end_date, e.start_date) < ?' : '(COALESCE(e.end_date, e.start_date) >= ? OR e.start_date IS NULL)'} ORDER BY e.start_date ${past ? 'DESC' : ''} LIMIT 300`, today);
    ctx.html(layout(ctx, { title: 'Events', body: html`${pageHead('Events', html`<a class="btn primary" href="/events/new">Add an event</a>`, 'What stays are for: weddings, retreats, reunions…')}
      <nav class="tabs"><a href="/events" class="${past ? '' : 'on'}">Upcoming</a><a href="/events?show=past" class="${past ? 'on' : ''}">Past</a></nav>
      ${rows.length ? html`<section class="panel"><table class="list"><thead><tr><th>Event</th><th>Dates</th><th>Location</th><th>Reservations</th></tr></thead><tbody>
        ${rows.map((e) => html`<tr><td><a href="/events/${e.id}"><b>${e.name}</b></a></td><td>${e.start_date ? `${dateFmt(e.start_date)}${e.end_date && e.end_date !== e.start_date ? ` – ${dateFmt(e.end_date)}` : ''}` : '—'}</td><td>${e.lname || ''}</td><td>${e.nres || ''}</td></tr>`)}</tbody></table></section>`
    : empty(past ? 'No past events.' : 'No upcoming events.', html`<a class="btn primary" href="/events/new">Add an event</a>`)}` }));
  });
  const form = (ctx, e) => {
    const contact = e.contact_id && db.get('SELECT * FROM guests WHERE id=?', e.contact_id);
    return html`<form method="post" action="${e.id ? `/events/${e.id}` : '/events/new'}" class="panel stack form-wide" data-dirty-guard>${csrfField(ctx)}
      <div class="grid g4">
        ${field('Event name', input('name', e.name, { required: true, maxlength: 150, placeholder: 'e.g. Smith–Jones Wedding' }), { cls: 'span2' })}
        ${field('From', input('start_date', e.start_date, { type: 'date' }))}${field('To', input('end_date', e.end_date, { type: 'date' }))}
        ${field('Main location', select('location_id', locs(), e.location_id, { blank: '—' }), { cls: 'span2' })}
        ${field('Contact', guestPicker('contact_id', contact, { placeholder: 'Search guests (or add one)' }), { cls: 'span2' })}
      </div>
      ${field('Notes', textarea('notes', e.notes, { rows: 3 }))}
      <div class="form-actions"><button class="btn primary">${e.id ? 'Save' : 'Add event'}</button><a class="btn ghost" href="${e.id ? `/events/${e.id}` : '/events'}">Cancel</a></div></form>`;
  };
  const read = (b) => {
    const rec = { name: str(b.name, 150), start_date: isDate(b.start_date) ? b.start_date : null, end_date: isDate(b.end_date) ? b.end_date : null,
      location_id: int(b.location_id) && db.get('SELECT 1 FROM locations WHERE id=?', int(b.location_id)) ? int(b.location_id) : null,
      contact_id: int(b.contact_id) && db.get('SELECT 1 FROM guests WHERE id=?', int(b.contact_id)) ? int(b.contact_id) : null, notes: str(b.notes, 4000) };
    if (!rec.name) throw new HttpError(422, 'Name the event.');
    if (rec.start_date && rec.end_date && rec.end_date < rec.start_date) throw new HttpError(422, 'The end date is before the start date.');
    return rec;
  };
  r.get('/events/new', (ctx) => ctx.html(layout(ctx, { title: 'Add an event', active: '/events', body: html`${pageHead('Add an event')}${form(ctx, {})}` })));
  r.post('/events/new', (ctx) => { const id = db.insert('events', { ...read(ctx.body), created_at: now() }); ctx.setFlash('Event added.'); ctx.redirect(`/events/${id}`); });
  r.get('/events/:id/edit', (ctx) => { const e = own(db, 'events', ctx.params.id); ctx.html(layout(ctx, { title: 'Edit event', active: '/events', body: html`${pageHead(`Edit ${e.name}`)}${form(ctx, e)}` })); });
  r.post('/events/:id', (ctx) => { const e = own(db, 'events', ctx.params.id); db.update('events', e.id, read(ctx.body)); ctx.setFlash('Saved.'); ctx.redirect(`/events/${e.id}`); });

  r.get('/events/:id', (ctx) => {
    const e = own(db, 'events', ctx.params.id);
    const loc = e.location_id && db.get('SELECT name FROM locations WHERE id=?', e.location_id);
    const contact = e.contact_id && db.get('SELECT * FROM guests WHERE id=?', e.contact_id);
    const res = db.all('SELECT * FROM reservations WHERE event_id=? ORDER BY arrive, id', e.id);
    const live = res.filter((x) => x.status !== 'cancelled');
    const rooms = live.reduce((n, x) => n + (x.kind === 'buyout' ? db.get('SELECT COUNT(*) n FROM rooms WHERE location_id=? AND active=1', x.location_id).n : R.roomsOf(db, x.id).length), 0);
    ctx.html(layout(ctx, { title: e.name, active: '/events', body: html`${pageHead(e.name, html`<a class="btn ghost" href="/events">Back to list</a><a class="btn" href="/events/${e.id}/edit">Edit</a><a class="btn primary" href="/reservations/new?event=${e.id}${e.start_date ? `&arrive=${e.start_date}` : ''}${e.location_id ? `&location=${e.location_id}` : ''}">Add a reservation</a>`,
      [e.start_date ? `${dateFmt(e.start_date, 'long')}${e.end_date && e.end_date !== e.start_date ? ` – ${dateFmt(e.end_date, 'long')}` : ''}` : null, loc && loc.name].filter(Boolean).join(' · '))}
      <div class="cols"><section class="panel"><h2>Details</h2><dl class="dl">${contact ? html`<dt>Contact</dt><dd><a href="/guests/${contact.id}">${personName(contact, 'first')}</a>${contact.phone ? ` · ${contact.phone}` : ''}</dd>` : ''}
          <dt>Reservations</dt><dd>${live.length} · ${rooms} room${rooms === 1 ? '' : 's'}</dd></dl>${e.notes ? html`<p class="pre">${e.notes}</p>` : ''}</section>
        <section class="panel"><h2>Reservations</h2>
          ${res.length ? html`<table class="list compact"><tbody>${res.map((x) => { const g = x.guest_id && db.get('SELECT * FROM guests WHERE id=?', x.guest_id); return html`<tr class="${x.status === 'cancelled' ? 'struck' : ''}">
            <td><a href="/reservations/${x.id}"><b>${R.guestName(g)}</b></a></td><td>${dateFmt(x.arrive)} – ${dateFmt(x.depart)}</td><td>${R.whereLine(db, x)}</td><td>${badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}</td></tr>`; })}</tbody></table>`
    : html`<p class="muted">No reservations for this event yet.</p>`}</section></div>` }));
  });
};
