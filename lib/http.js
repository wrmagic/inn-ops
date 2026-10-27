'use strict';
// Minimal web framework: routing, body/cookie parsing, CSRF, static files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Parses urlencoded bodies. Keys ending in [] always become arrays.
function parseForm(str) {
  const out = {};
  for (const [k, v] of new URLSearchParams(str)) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      (out[key] = out[key] || []).push(v);
    } else out[k] = v;
  }
  return out;
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, opts });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveStatic(root, pathname, res) {
  const rel = pathname.replace(/^\/static\//, '');
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
  return true;
}

// Response helpers attached to each request context
function makeCtx(req, res, url, secure) {
  const cookies = parseCookies(req.headers.cookie);
  const setCookies = [];
  const ctx = {
    req, res, url, cookies,
    query: Object.fromEntries(url.searchParams),
    body: {}, params: {},
    setCookie(name, value, { maxAge, httpOnly = true } = {}) {
      let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
      if (httpOnly) c += '; HttpOnly';
      if (secure) c += '; Secure';
      if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
      setCookies.push(c);
    },
    send(status, body, type = 'text/html; charset=utf-8', headers = {}) {
      const h = {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'X-Frame-Options': 'SAMEORIGIN',
        ...headers,
      };
      if (setCookies.length) h['Set-Cookie'] = setCookies;
      res.writeHead(status, h);
      res.end(req.method === 'HEAD' ? undefined : String(body));
    },
    html(body, status = 200) { ctx.send(status, body); },
    json(obj, status = 200) { ctx.send(status, JSON.stringify(obj), 'application/json'); },
    redirect(loc, status = 303) { ctx.send(status, '', 'text/plain', { Location: loc }); },
  };
  // Double-submit CSRF token: random value in a cookie, echoed in every form.
  ctx.csrf = cookies.csrf && /^[a-f0-9]{32}$/.test(cookies.csrf) ? cookies.csrf : null;
  if (!ctx.csrf) { ctx.csrf = crypto.randomBytes(16).toString('hex'); ctx.setCookie('csrf', ctx.csrf, { maxAge: 60 * 60 * 24 * 30 }); }
  return ctx;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { Router, HttpError, parseForm, readBody, serveStatic, makeCtx, safeEqual };
