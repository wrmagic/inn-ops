'use strict';
// Guests: everyone who stays (or books for others), with their stays.
const { html, raw, personName, dateFmt } = require('../lib/html');
const { layout, csrfField, field, input, textarea, pageHead, empty, badge } = require('../lib/views');
const { str, bool, phone, own, now, todayIn } = require('../lib/common');
const { HttpError } = require('../lib/http');
const R = require('../lib/res');

module.exports = (r, { db }) => {
  r.get('/guests', (ctx) => {
    const q = String(ctx.query.q || '').trim();
    const rows = q ? require('./api').findGuests(db, q, 300) : db.all('SELECT * FROM guests ORDER BY last COLLATE NOCASE, first COLLATE NOCASE, org_name COLLATE NOCASE LIMIT 300');
    const stays = (id) => db.get(`SELECT COUNT(*) n, MAX(arrive) last FROM reservations r WHERE guest_id=? AND ${R.LIVE}`, id);
    ctx.html(layout(ctx, { title: 'Guests', body: html`${pageHead('Guests', html`<a class="btn primary" href="/guests/new">Add a guest</a>`)}
      <form class="filters" method="get" role="search"><input type="search" name="q" value="${q}" placeholder="Name, phone or email" aria-label="Search guests" autofocus><button class="btn">Search</button>${q ? html`<a class="btn ghost" href="/guests">Clear</a>` : ''}</form>
      ${rows.length ? html`<section class="panel"><table class="list"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Stays</th></tr></thead><tbody>
        ${rows.map((g) => { const st = stays(g.id); return html`<tr><td><a href="/guests/${g.id}"><b>${personName(g)}</b></a>${g.is_org ? badge('Group') : ''}</td><td>${g.phone || ''}</td><td>${g.email || ''}</td>
          <td>${st.n ? `${st.n} · last ${dateFmt(st.last)}` : ''}</td></tr>`; })}</tbody></table></section>`
    : empty(q ? 'No guests match.' : 'No guests yet.', html`<a class="btn primary" href="/guests/new">Add a guest</a>`)}` }));
  });

  const form = (ctx, g) => html`<form method="post" action="${g.id ? `/guests/${g.id}` : '/guests/new'}" class="panel stack form-wide" data-dirty-guard>${csrfField(ctx)}
    <fieldset class="seg" data-toggle-org><label><input type="radio" name="is_org" value="0"${g.is_org ? '' : raw(' checked')}> Person</label><label><input type="radio" name="is_org" value="1"${g.is_org ? raw(' checked') : ''}> Group or company</label></fieldset>
    <div class="grid g4">
      <div class="org-only span4"${g.is_org ? '' : raw(' hidden')}>${field('Group or company name', input('org_name', g.org_name, { maxlength: 200 }))}</div>
      ${field(g.is_org ? 'Contact first name' : 'First name', input('first', g.first, { maxlength: 100 }))}${field(g.is_org ? 'Contact last name' : 'Last name', input('last', g.last, { maxlength: 100 }))}
      ${field('Phone', input('phone', g.phone, { type: 'tel' }))}${field('Email', input('email', g.email, { type: 'email' }))}
      ${field('Street', input('address1', g.address1), { cls: 'span2' })}${field('City', input('city', g.city))}
      <div class="grid g2">${field('State', input('state', g.state, { maxlength: 2 }))}${field('ZIP', input('postal', g.postal))}</div>
    </div>
    ${field('Notes', textarea('notes', g.notes, { rows: 3, placeholder: 'Preferences, allergies, VIP, anything to remember…' }))}
    <div class="form-actions"><button class="btn primary">${g.id ? 'Save' : 'Add guest'}</button><a class="btn ghost" href="${g.id ? `/guests/${g.id}` : '/guests'}">Cancel</a></div></form>`;
  const read = (b) => {
    const isOrg = bool(b.is_org);
    const rec = { is_org: isOrg, org_name: isOrg ? str(b.org_name, 200) : null, first: str(b.first, 100), last: str(b.last, 100), phone: phone(b.phone), email: (str(b.email, 200) || '').toLowerCase() || null,
      address1: str(b.address1, 200), city: str(b.city, 100), state: (str(b.state, 2) || '').toUpperCase() || null, postal: str(b.postal, 20), notes: str(b.notes, 4000) };
    if (isOrg ? !rec.org_name : !rec.first && !rec.last) throw new HttpError(422, isOrg ? 'Enter the group or company name.' : 'Enter a first or last name.');
    return rec;
  };
  r.get('/guests/new', (ctx) => ctx.html(layout(ctx, { title: 'Add a guest', active: '/guests', body: html`${pageHead('Add a guest')}${form(ctx, {})}` })));
  r.post('/guests/new', (ctx) => {
    const id = db.insert('guests', { ...read(ctx.body), created_at: now() });
    ctx.setFlash('Guest added.');
    ctx.redirect(ctx.back(`/guests/${id}`));
  });
  r.get('/guests/:id/edit', (ctx) => { const g = own(db, 'guests', ctx.params.id); ctx.html(layout(ctx, { title: 'Edit guest', active: '/guests', body: html`${pageHead(`Edit ${personName(g, 'first')}`)}${form(ctx, g)}` })); });
  r.post('/guests/:id', (ctx) => { const g = own(db, 'guests', ctx.params.id); db.update('guests', g.id, read(ctx.body)); ctx.setFlash('Saved.'); ctx.redirect(`/guests/${g.id}`); });

  r.get('/guests/:id', (ctx) => {
    const g = own(db, 'guests', ctx.params.id); const today = todayIn(ctx.settings.timezone);
    const res = db.all('SELECT * FROM reservations WHERE guest_id=? ORDER BY arrive DESC', g.id);
    const addr = [g.address1, [g.city, [g.state, g.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean);
    ctx.html(layout(ctx, { title: personName(g, 'first'), active: '/guests', body: html`${pageHead(personName(g, 'first'), html`<a class="btn ghost" href="/guests">Back to list</a><a class="btn" href="/guests/${g.id}/edit">Edit</a><a class="btn primary" href="/reservations/new?guest=${g.id}">New reservation</a>`, g.is_org ? 'Group or company' : '')}
      <div class="cols"><section class="panel"><h2>Contact</h2><dl class="dl">
          ${g.phone ? html`<dt>Phone</dt><dd><a href="tel:${g.phone}">${g.phone}</a></dd>` : ''}${g.email ? html`<dt>Email</dt><dd><a href="mailto:${g.email}">${g.email}</a></dd>` : ''}
          ${addr.length ? html`<dt>Address</dt><dd>${addr.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}</dd>` : ''}</dl>
          ${g.notes ? html`<h3>Notes</h3><p class="pre">${g.notes}</p>` : ''}</section>
        <section class="panel"><h2>Stays <small class="muted">${res.length}</small></h2>
          ${res.length ? html`<ul class="plain stay-list">${res.map((x) => html`<li class="${x.status === 'cancelled' ? 'struck' : ''}"><a href="/reservations/${x.id}"><b>${dateFmt(x.arrive)} – ${dateFmt(x.depart)}</b></a> · ${R.whereLine(db, x)}
            ${badge(R.STATUS[x.status].label, R.STATUS[x.status].badge)}${x.arrive > today && x.status !== 'cancelled' ? badge('Upcoming', 'warn') : ''}</li>`)}</ul>` : html`<p class="muted">No stays yet.</p>`}</section></div>` }));
  });
};
