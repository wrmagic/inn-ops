'use strict';
// Check-in details for the guest: where, which rooms, check-in and checkout times, special needs and instructions,
// and who to call in an emergency. No prices. Sent by text or email, with a private link to view it online.
const crypto = require('node:crypto');
const { html, dateFmt, time12 } = require('./html');
const R = require('./res');

/** The reservation's private link token (made the first time it's needed). */
function tokenOf(db, r) {
  if (r.token) return r.token;
  const t = crypto.randomBytes(12).toString('base64url');
  db.run('UPDATE reservations SET token=? WHERE id=?', t, r.id); r.token = t;
  return t;
}

/** The emergency contact for a stay: the one picked on the reservation, else the location's first. */
function emergencyOf(db, r) {
  return (r.emergency_contact_id && db.get('SELECT * FROM location_contacts WHERE id=? AND location_id=?', r.emergency_contact_id, r.location_id))
    || db.get('SELECT * FROM location_contacts WHERE location_id=? ORDER BY sort, id LIMIT 1', r.location_id) || null;
}

/** Everything the guest needs, as plain facts. */
function facts(db, r, settings) {
  const g = r.guest_id ? db.get('SELECT * FROM guests WHERE id=?', r.guest_id) : null;
  const loc = db.get('SELECT * FROM locations WHERE id=?', r.location_id) || {};
  const rooms = R.roomsOf(db, r.id);
  const inT = r.check_in_time || loc.check_in_time || settings.check_in_time;
  const outT = r.check_out_time || loc.check_out_time || settings.check_out_time;
  const addr = [loc.address1, [loc.city, [loc.state, loc.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  return {
    guest: g, first: g ? (g.first || R.guestName(g)) : '', business: settings.name || 'Inn Ops', loc, addr,
    where: r.kind === 'buyout' ? `${loc.name || ''} (the whole place)` : loc.name || '',
    rooms: rooms.map((x) => ({ name: x.name, who: x.occupants || '', instructions: x.instructions || '' })),
    checkIn: `${dateFmt(r.arrive, 'long')}${inT ? `, from ${time12(inT)}` : ''}`,
    checkOut: `${dateFmt(r.depart, 'long')}${outT ? `, by ${time12(outT)}` : ''}`,
    nights: R.nightsLabel(R.nights(r)),
    needs: r.special_needs || '', instructions: [r.special_instructions, loc.instructions].filter(Boolean).join('\n\n'),
    emergency: emergencyOf(db, r), note: loc.confirm_note || settings.confirm_note || '', phone: loc.phone || settings.phone || '',
  };
}

/** The message: subject, plain text (email and text message), and the short text-message version. */
function message(db, r, settings, base) {
  const f = facts(db, r, settings);
  const url = `${base}/stay/${tokenOf(db, r)}`;
  const em = f.emergency ? `${f.emergency.name}${f.emergency.role ? ` (${f.emergency.role})` : ''}${f.emergency.phone ? `: ${f.emergency.phone}` : ''}` : '';
  // The plain version (for email programs): laid out like the guest's page, one thing per line
  const lines = [
    `Hi ${f.first || 'there'}, here are your check-in details.`, '',
    f.where, ...(f.addr ? [f.addr] : []), '',
    `Check-in: ${f.checkIn}`, `Checkout: ${f.checkOut}`, `Stay: ${f.nights}`,
    ...(f.rooms.length ? [`${f.rooms.length > 1 ? 'Rooms' : 'Room'}:`, ...f.rooms.map((x) => `  ${x.name}${x.who ? ` · ${x.who}` : ''}${x.instructions ? `\n    ${x.instructions}` : ''}`)] : []),
    ...(f.needs ? [`Special needs: ${f.needs}`] : []),
    ...(f.instructions ? [`Instructions: ${f.instructions}`] : []),
    ...(f.emergency ? [`Emergency contact: ${f.emergency.name}${f.emergency.role ? ` · ${f.emergency.role}` : ''}${f.emergency.phone ? ` · ${f.emergency.phone}` : ''}`] : []),
    ...(f.note ? ['', f.note] : []),
    '', `View or print these details: ${url}`, '', f.business + (f.phone ? ` · ${f.phone}` : ''),
  ];
  // The text message: one thing per line
  const sms = [`Hi ${f.first || 'there'}, here are your check-in details.`, f.where, f.addr,
    `Check-in: ${f.checkIn}`, `Checkout: ${f.checkOut}`,
    f.rooms.length ? `Room${f.rooms.length > 1 ? 's' : ''}: ${f.rooms.map((x) => `${x.name}${x.who ? ` (${x.who})` : ''}`).join(', ')}` : '',
    f.needs ? `Special needs: ${f.needs}` : '', f.instructions ? `Instructions: ${f.instructions}` : '',
    em ? `Emergency contact: ${em}` : '', `Details: ${url}`].filter(Boolean).join('\n');
  return { subject: `Your check-in details: ${f.where}, ${dateFmt(r.arrive)}`, text: lines.join('\n'), sms, url, facts: f };
}

/** The details as a page section (the public link and the staff preview). */
function card(f) {
  return html`<article class="stay-card">
    <h1>${f.where}</h1>${f.addr ? html`<p class="muted">${f.addr}</p>` : ''}
    <dl class="dl">
      <dt>Check-in</dt><dd>${f.checkIn}</dd><dt>Checkout</dt><dd>${f.checkOut}</dd><dt>Stay</dt><dd>${f.nights}</dd>
      ${f.rooms.length ? html`<dt>Room${f.rooms.length > 1 ? 's' : ''}</dt><dd>${f.rooms.map((x) => html`<div><b>${x.name}</b>${x.who ? ` · ${x.who}` : ''}${x.instructions ? html`<small class="contact-line">${x.instructions}</small>` : ''}</div>`)}</dd>` : ''}
      ${f.needs ? html`<dt>Special needs</dt><dd class="pre">${f.needs}</dd>` : ''}
      ${f.instructions ? html`<dt>Instructions</dt><dd class="pre">${f.instructions}</dd>` : ''}
      ${f.emergency ? html`<dt>Emergency contact</dt><dd><b>${f.emergency.name}</b>${f.emergency.role ? ` · ${f.emergency.role}` : ''}${f.emergency.phone ? html` · <a href="tel:${f.emergency.phone}">${f.emergency.phone}</a>` : ''}</dd>` : ''}
    </dl>
    ${f.note ? html`<p class="pre stay-note">${f.note}</p>` : ''}
    <p class="muted small">${f.business}${f.phone ? html` · <a href="tel:${f.phone}">${f.phone}</a>` : ''}</p></article>`;
}

module.exports = { tokenOf, emergencyOf, facts, message, card };

// ---------- Sending: the "Check-in details" buttons (Text, Email, View) used on the reservation, the Check-in page and the phone
const { csrfField } = require('./views');
const { dateTimeFmt } = require('./html');
const mail = require('./mail');

const baseUrl = (ctx) => (process.env.BASE_URL || `${ctx.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${ctx.req.headers.host}`).replace(/\/$/, '');

/** The buttons. `next` is where to come back to after an email goes out. */
function sendBox(ctx, db, r, { next, compact } = {}) {
  const m = message(db, r, ctx.settings, baseUrl(ctx)); const g = m.facts.guest || {};
  const smsTo = String(g.phone || '').replace(/[^\d+]/g, '');
  const smsHref = `sms:${smsTo}${/iPhone|iPad|Mac/.test(ctx.req.headers['user-agent'] || '') ? '&' : '?'}body=${encodeURIComponent(m.sms)}`;
  const mailHref = `mailto:${g.email || ''}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;
  const by = r.details_sent_by && db.get('SELECT name FROM users WHERE id=?', r.details_sent_by);
  const sent = r.details_sent_at ? html`<p class="muted small sd-last">Last sent ${({ email: 'by email', text: 'by text', 'email-app': 'by email' })[r.details_sent_how] || ''} ${dateTimeFmt(r.details_sent_at, ctx.settings.timezone)}${by ? ` by ${by.name}` : ''}</p>` : '';
  return html`<div class="send-details${compact ? ' compact' : ''}">
    <div class="sd-btns">
      <a class="btn" href="${smsHref}" data-log-sent="${r.id}" data-how="text">Text${smsTo ? '' : ' (no number on file)'}</a>
      ${mail.configured() && g.email ? html`<form method="post" action="/reservations/${r.id}/send-details" class="inline">${csrfField(ctx)}<input type="hidden" name="next" value="${next || `/reservations/${r.id}`}"><button class="btn">Email ${g.email}</button></form>`
    : html`<a class="btn" href="${mailHref}" data-log-sent="${r.id}" data-how="email-app">Email${g.email ? '' : ' (no address on file)'}</a>`}
      <a class="btn ghost" href="${m.url}" target="_blank" rel="noopener">View</a>
    </div>${sent}</div>`;
}

/** The email, laid out like the guest's page: name and address, then a table of the details. */
function emailHtml(f, url) {
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const row = (label, value) => (value ? `<tr><td style="padding:7px 14px 7px 0;color:#6b6478;vertical-align:top;white-space:nowrap;font-size:14px">${label}</td><td style="padding:7px 0;vertical-align:top;font-size:15px">${value}</td></tr>` : '');
  const em = f.emergency ? `<b>${esc(f.emergency.name)}</b>${f.emergency.role ? ` · ${esc(f.emergency.role)}` : ''}${f.emergency.phone ? ` · <a href="tel:${esc(f.emergency.phone)}" style="color:#5b2d82">${esc(f.emergency.phone)}</a>` : ''}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:#f4f1f7;font-family:Arial,Helvetica,sans-serif;color:#222">
<div style="max-width:600px;margin:0 auto">
  <p style="font-size:16px;margin:0 0 14px">Hi ${esc(f.first || 'there')}, here are your check-in details.</p>
  <div style="background:#ffffff;border:1px solid #e3deeb;border-radius:14px;padding:20px 22px">
    <div style="font-size:24px;line-height:1.25;margin:0 0 2px">${esc(f.where)}</div>
    ${f.addr ? `<div style="color:#6b6478;font-size:14px;margin:0 0 12px">${esc(f.addr)}</div>` : ''}
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">
      ${row('Check-in', esc(f.checkIn))}${row('Checkout', esc(f.checkOut))}${row('Stay', esc(f.nights))}
      ${row(f.rooms.length > 1 ? 'Rooms' : 'Room', f.rooms.map((x) => `<div><b>${esc(x.name)}</b>${x.who ? ` · ${esc(x.who)}` : ''}${x.instructions ? `<div style="color:#6b6478;font-size:13px">${esc(x.instructions)}</div>` : ''}</div>`).join(''))}
      ${row('Special needs', esc(f.needs))}${row('Instructions', esc(f.instructions))}${row('Emergency contact', em)}
    </table>
    ${f.note ? `<div style="background:#faf8fc;border-radius:8px;padding:10px 12px;margin-top:12px;font-size:14px">${esc(f.note)}</div>` : ''}
    <div style="color:#6b6478;font-size:13px;margin-top:14px">${esc(f.business)}${f.phone ? ` · <a href="tel:${esc(f.phone)}" style="color:#5b2d82">${esc(f.phone)}</a>` : ''}</div>
  </div>
  <p style="margin:18px 0"><a href="${url}" style="display:inline-block;background:#3d2156;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">View or print these details</a></p>
</div></body></html>`;
}

/** Email the details through the email service. Returns true if it went. */
async function sendEmail(ctx, db, r) {
  const m = message(db, r, ctx.settings, baseUrl(ctx)); const g = m.facts.guest;
  if (!g || !g.email) return false;
  const htmlMail = emailHtml(m.facts, m.url);
  const ok = await mail.send({ to: g.email, subject: m.subject, text: m.text, html: htmlMail, replyTo: ctx.settings.email || undefined });
  if (ok) markSent(db, r, ctx.user.id, 'email');
  return ok;
}
const markSent = (db, r, userId, how) => db.run('UPDATE reservations SET details_sent_at=?, details_sent_by=?, details_sent_how=? WHERE id=?', new Date().toISOString(), userId, how, r.id);

module.exports.sendBox = sendBox;
module.exports.emailHtml = emailHtml;
module.exports.sendEmail = sendEmail;
module.exports.markSent = markSent;
module.exports.baseUrl = baseUrl;
