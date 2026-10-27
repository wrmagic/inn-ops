'use strict';
// Lists in pages: 20 to a page by default, or 50, 100 or All. The choice is remembered per list (and per browser).
const { html } = require('./html');

const SIZES = ['20', '50', '100', 'all'];

/** How many to a page for this list, from ?per= (then remembered) or the last choice. Infinity = all. */
function perPage(ctx, key) {
  let v = ctx.query.per;
  if (SIZES.includes(v)) { if (ctx.cookies[`per_${key}`] !== v) ctx.setCookie(`per_${key}`, v, { maxAge: 365 * 86400 }); }
  else v = SIZES.includes(ctx.cookies[`per_${key}`]) ? ctx.cookies[`per_${key}`] : '20';
  return v === 'all' ? Infinity : Number(v);
}

/**
 * Work out the page. Returns { per, page, pages, offset, limit (for SQL: -1 = no limit), nav }.
 * nav() draws "Showing 21–40 of 132 · Previous · Page 2 of 7 · Next · Show 20 50 100 All".
 */
function paging(ctx, key, total) {
  const per = perPage(ctx, key);
  const pages = per === Infinity ? 1 : Math.max(1, Math.ceil(total / per));
  const page = Math.min(pages, Math.max(1, Number.parseInt(ctx.query.page, 10) || 1));
  const offset = per === Infinity ? 0 : (page - 1) * per;
  const href = (o) => {
    const p = new URLSearchParams();
    for (const [k, v] of ctx.url.searchParams) if (k !== 'page' && k !== 'per') p.append(k, v);
    for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && !(k === 'page' && v === 1)) p.set(k, String(v));
    const s = p.toString(); return s ? `?${s}` : '?';
  };
  const nav = () => {
    if (total <= 20) return '';
    const from = offset + 1; const to = Math.min(total, offset + (per === Infinity ? total : per));
    return html`<nav class="list-pager" aria-label="Pages">
      <span class="pg-count">Showing ${from}–${to} of ${total}</span>
      ${pages > 1 ? html`<span class="pg-move">${page > 1 ? html`<a class="btn ghost small" href="${href({ page: page - 1 })}" rel="prev">‹ Previous</a>` : ''}
        <span>Page ${page} of ${pages}</span>
        ${page < pages ? html`<a class="btn ghost small" href="${href({ page: page + 1 })}" rel="next">Next ›</a>` : ''}</span>` : ''}
      <span class="pg-size">Show ${SIZES.map((s) => { const on = (s === 'all' ? Infinity : Number(s)) === per; return on ? html`<b aria-current="true">${s === 'all' ? 'All' : s}</b>` : html`<a href="${href({ per: s, page: 1 })}">${s === 'all' ? 'All' : s}</a>`; })}</span>
    </nav>`;
  };
  return { per, page, pages, offset, limit: per === Infinity ? -1 : per, nav };
}

/**
 * Page a list that's already in memory. `unitStart(row)` says where a new unit begins (so a main task and its
 * subtasks stay on the same page); by default every row is a unit.
 */
function pageRows(ctx, key, rows, unitStart = () => true) {
  const units = [];
  for (const r of rows) { if (!units.length || unitStart(r)) units.push([]); units[units.length - 1].push(r); }
  const p = paging(ctx, key, units.length);
  const slice = p.per === Infinity ? units : units.slice(p.offset, p.offset + p.per);
  return { ...p, rows: slice.flat() };
}

module.exports = { perPage, paging, pageRows, SIZES };
