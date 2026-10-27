'use strict';
// Signing in and out, and your own login (name, password).
const { html } = require('../lib/html');
const { bare, layout, csrfField, field, input, pageHead, icon } = require('../lib/views');
const auth = require('../lib/auth');
const { str } = require('../lib/common');
const { HttpError } = require('../lib/http');

const P = { public: true };
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !n.includes('\\') ? n : '/');

module.exports = (r, { db }) => {
  const loginPage = (ctx, { error, username = '' } = {}) => bare(ctx, { title: 'Sign in', body: html`<main class="login-card">
    <div class="login-brand inn-login"><span class="inn-mark big" aria-hidden="true">${icon('key')}</span><b>Inn Ops</b><span>Reservation System</span>
      ${ctx.settings.name && ctx.settings.name !== 'Inn Ops' ? html`<p>${ctx.settings.name}</p>` : ''}</div>
    ${error ? html`<div class="flash err" role="alert">${error}</div>` : ''}
    <form method="post" action="/login" class="stack">${csrfField(ctx)}<input type="hidden" name="next" value="${safeNext(ctx.query.next || ctx.body.next)}">
      ${field('Login name', input('username', username, { autocomplete: 'username', required: true, autofocus: true }))}
      ${field('Password', input('password', '', { type: 'password', autocomplete: 'current-password', required: true }))}
      <button class="btn primary block">Sign in</button></form></main>` });

  r.get('/login', (ctx) => (ctx.user ? ctx.redirect('/') : ctx.html(loginPage(ctx))), P);
  r.post('/login', (ctx) => {
    const username = String(ctx.body.username || '').trim();
    const u = db.get('SELECT * FROM users WHERE username=? AND active=1', username);
    if (!u || !auth.verifyPassword(ctx.body.password || '', u.password_hash)) return ctx.html(loginPage(ctx, { error: 'That login name and password don’t match.', username }), 401);
    ctx.setCookie('sid', auth.createSession(db, u), { maxAge: 14 * 86400 });
    ctx.redirect(safeNext(ctx.body.next));
  }, P);
  r.post('/logout', (ctx) => {
    auth.destroySession(db, ctx.sessionToken);
    ctx.setCookie('sid', '', { maxAge: 0 });
    ctx.redirect('/login');
  }, P);

  // Your own login
  r.get('/account', (ctx) => {
    const u = ctx.user;
    ctx.html(layout(ctx, { title: 'Your login', body: html`${pageHead('Your login', '', `Signed in as ${u.username}`)}
      <form method="post" action="/account" class="panel stack form-narrow">${csrfField(ctx)}
        ${field('Your name', input('name', u.name, { required: true, maxlength: 100 }))}
        ${field('Email', input('email', u.email, { type: 'email', maxlength: 200 }))}
        <h3>Change your password</h3>
        ${field('Current password', input('current', '', { type: 'password', autocomplete: 'current-password' }))}
        ${field('New password', input('password', '', { type: 'password', autocomplete: 'new-password', minlength: 8 }), { hint: 'At least 8 characters. Leave blank to keep your password.' })}
        <div class="form-actions"><button class="btn primary">Save</button></div></form>` }));
  });
  r.post('/account', (ctx) => {
    const b = ctx.body; const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    const rec = { name: str(b.name, 100) || u.name, email: str(b.email, 200) };
    if (b.password) {
      if (!auth.verifyPassword(b.current || '', u.password_hash)) throw new HttpError(422, 'Your current password isn’t right.');
      if (String(b.password).length < 8) throw new HttpError(422, 'The new password needs at least 8 characters.');
      rec.password_hash = auth.hashPassword(b.password);
    }
    db.update('users', u.id, rec);
    ctx.setFlash(b.password ? 'Saved, with your new password.' : 'Saved.');
    ctx.redirect('/account');
  });
};
