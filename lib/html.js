'use strict';
// Tiny auto-escaping template helper. Every interpolated value is HTML-escaped
// unless it was produced by html`` itself or wrapped with raw().

class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

const raw = (s) => new Raw(s);

// ---------- formatting helpers ----------
function money(cents) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function toCents(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
function centsInput(c) { return c === null || c === undefined ? '' : (c / 100).toFixed(2); }

function time12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function parseDate(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
function dateFmt(d, style = 'short') {
  if (!d) return '';
  const x = parseDate(d.slice(0, 10));
  if (style === 'long') return `${DOW_LONG[x.getUTCDay()]}, ${MON_LONG[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
  if (style === 'dow') return `${DOW[x.getUTCDay()]} ${MON[x.getUTCMonth()]} ${x.getUTCDate()}`;
  return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
}
function dateTimeFmt(iso, tz = 'America/Los_Angeles') {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function timeOnly(iso, tz = 'America/Los_Angeles') {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
}

function personName(p, style = 'last') {
  if (!p) return '';
  if (p.is_org) return p.org_name || '(Organization)';
  const first = [p.first, p.middle ? p.middle[0] + '.' : ''].filter(Boolean).join(' ');
  if (style === 'first') return [p.first, p.last].filter(Boolean).join(' ');
  return [p.last, first].filter(Boolean).join(', ') || '(No name)';
}

/** The contact person's name on an organization's record (empty for individuals). */
function contactName(p) {
  if (!p || !p.is_org) return '';
  return [p.first, p.middle, p.last, p.suffix].filter(Boolean).join(' ');
}

module.exports = { contactName, html, raw, esc, Raw, money, toCents, centsInput, time12, dateFmt, dateTimeFmt, timeOnly, personName, DOW, DOW_LONG, MON_LONG, parseDate };
