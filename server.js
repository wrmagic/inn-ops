'use strict';
// Inn Ops Reservation System: web server. No packages; Node 22.13 or newer.
const http = require('node:http');
const path = require('node:path');
const { Router, HttpError, parseForm, readBody, serveStatic, makeCtx, safeEqual } = require('./lib/http');
const { open } = require('./lib/db');
const auth = require('./lib/auth');
const { html } = require('./lib/html');
const { layout, bare } = require('./lib/views');

const ROUTES = ['auth', 'dashboard', 'checkin', 'reservations', 'calendar', 'guests', 'events', 'reports', 'admin', 'api', 'mobile'];
const DEFAULT_DB = path.join(__dirname, 'data', 'innops.db');

function createApp({ dbFile = process.env.DATABASE_FILE || DEFAULT_DB } = {}) {
  const db = open(dbFile);
  const router = new Router();
  for (const r of ROUTES) require(`./routes/${r}`)(router, { db });
  const secureCookies = process.env.SECURE_COOKIES === '1' || (process.env.BASE_URL || '').startsWith('https://');
  const staticRoot = path.join(__dirname, 'public');

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/static/') && (req.method === 'GET' || req.method === 'HEAD') && serveStatic(staticRoot, url.pathname, res)) return;
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    const ctx = makeCtx(req, res, url, secureCookies);
    ctx.db = db;
    ctx.settings = db.settings();
    try {
      const m = router.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, 'Page not found');
      if (m.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
      const { route, params } = m;
      ctx.params = params;
      ctx.sessionToken = ctx.cookies.sid;
      ctx.user = auth.loadSession(db, ctx.sessionToken);
      if (ctx.user) ctx.flash = auth.takeFlash(db, ctx.user);
      ctx.setFlash = (msg, kind = 'ok') => auth.setFlash(db, ctx.user, msg, kind);
      if (!route.opts.public && !ctx.user) {
        if (req.method === 'GET') return ctx.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
        throw new HttpError(401, 'Please log in again.');
      }
      if (route.opts.admin && ctx.user.role !== 'admin') throw new HttpError(403, 'Only administrators can do that.');
      if (req.method === 'POST') {
        const buf = await readBody(req, route.opts.maxBody);
        ctx.body = parseForm(buf.toString('utf8'));
        if (!safeEqual(ctx.body._csrf, ctx.csrf)) throw new HttpError(403, 'Your form expired. Go back, refresh the page and try again.');
      }
      ctx.back = (def) => { const n = (ctx.body && ctx.body.next) || ctx.query.next; return typeof n === 'string' && /^\/(?!\/)/.test(n) && !n.includes('\\') ? n : def; };
      await route.handler(ctx);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return;
      const msg = status === 500 ? 'Something went wrong on our side. The error has been logged.' : err.message;
      if (ctx.url.pathname.startsWith('/api/')) return ctx.json({ error: msg }, status);
      const body = html`<div class="error-page"><h1>${status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Something went wrong'}</h1><p>${msg}</p><p><a href="javascript:history.back()">Go back</a> or <a href="/">return to the dashboard</a>.</p></div>`;
      ctx.html(ctx.user ? layout(ctx, { title: 'Error', body }) : bare(ctx, { title: 'Error', body, cls: 'bare' }), status);
    }
  }
  const server = http.createServer((req, res) => { handle(req, res); });
  server.db = db;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const dbFile = process.env.DATABASE_FILE || DEFAULT_DB;
  // First start on a new server: make the admin login and the four locations
  {
    const probe = open(dbFile);
    const fresh = !probe.get('SELECT COUNT(*) n FROM users').n;
    probe.close();
    if (fresh) {
      console.log('New database: running first-time setup…');
      require('node:child_process').spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'scripts', 'setup.js'), ...(process.env.SEED_DEMO === '1' ? ['--demo'] : [])], { stdio: 'inherit', env: process.env });
    }
  }
  createApp({ dbFile }).listen(port, () => console.log(`Inn Ops running on http://localhost:${port}`));
}

module.exports = { createApp };
