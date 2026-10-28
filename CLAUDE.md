# Inn Ops Reservation System: project memory

Read this first. The README is the user guide; keep both up to date.

## What it is

- Lodging reservations for The House of MAGIC's properties: **Inn, Stonehouse, Ranch House, Mansion**.
  Rooms or full buy-outs, who's in each room, dates and times, needs, instructions, comments, linked event, money.
- Owner: James Lantiegne (wrmagic). Not a programmer: tests in the browser, sends screenshots.
  Repo `github.com/wrmagic/inn-ops`, branch `main`; Render blueprint `render.yaml` (disk at `/data`). Push = redeploy.
- Sister app to Event Master Plus (`wrmagic/event-master-plus`), built the same way but fully separate
  (single business, no orgs, no shared database).

## How it's built

- Node ≥ 22.13, **no dependencies**: `node:sqlite`, `http`, `crypto`. Don't add npm packages.
- `server.js` registers `ROUTES` (`routes/*.js`, each `module.exports = (r, { db }) => {…}`); add new route files there.
  First start with no users runs `scripts/setup.js` (`SEED_DEMO=1` adds demo data). Env: `DATABASE_FILE`, `PORT`,
  `ADMIN_PASSWORD`, `BASE_URL`.
- `lib/http.js` and `lib/html.js` are copies from EMP: 303 redirects, `x[]` fields arrive as arrays (a repeated plain
  name keeps only the last), `html` template auto-escapes, `money`/`toCents`/`centsInput`/`dateFmt`/`time12`.
  Routes `{ public: true }`, `{ admin: true }`. Every POST checks CSRF (`csrfField(ctx)` in every form).
- `lib/db.js`: schema + `addColumn` migrations at the end. `settings` is one row (id 1), read as `ctx.settings`.
- `lib/views.js`: `layout`, `bare`, `field`, `input`, `select`, `check`, `textarea`, `guestPicker`, `pageHead`, `badge`, `empty`.
- `lib/res.js`: the rules. Nights = arrive up to (not including) depart. Overlap = `r.arrive < depart AND arrive < r.depart`.
  `conflicts()` (rooms + any buy-out at the location), `busyRooms()`, `totals()` (weeknights × weekday rate + Fri/Sat nights ×
  weekend rate − discount + tax; `weekend_rate_cents`/`buyout_weekend_rate_cents` NULL = weekday rate; copied onto
  `reservation_rooms`/`reservations` when booked),
  `STATUS`, `LIVE` (not cancelled). A buy-out stores a `reservation_rooms` row per room (occupants per room),
  and its price is `reservations.buyout_rate_cents` × nights.
  A location with no rooms is sold only whole: its buy-outs have no `reservation_rooms`, so the date book gives it one
  "Whole location" line (`byLoc`), and the dashboard and room list report treat it as booked/open.
- Pages: `routes/reservations.js` (list, form, view, status, payments, confirmation), `routes/calendar.js`
  (`/calendar` month/list, `/datebook` grid: 2 grid columns per day so bars run afternoon→morning),
  `routes/dashboard.js`, `routes/guests.js`, `routes/events.js`, `routes/reports.js`, `routes/admin.js`
  (`/admin` home of tiles from `lib/adminnav.js` SECTIONS like EMP; `/admin/business`, `/admin/stays` (one block per location: times, `locations.tax_percent`, `locations.confirm_note`;
  `totals()` uses the location's tax, falling back to `settings`), locations + room cards,
  checklists (name+type saved first, then items added one at a time `POST /admin/checklists/:id/items`), logins), `routes/api.js` (guest search/quick add, availability).
- Checklists: `lib/checklists.js` (`KINDS` precheck/checkout, `listIdFor` = room's own list else location's,
  `forReservation(db, r, kind)` → per room (or room_id 0 for a room-less location) items with `done {by, at}`, `progress`,
  `save`). Tables `checklists`, `checklist_items`, `reservation_checks` (unique reservation+kind+room+item, keeps
  `item_text`); `locations/rooms.precheck_list_id/checkout_list_id`; `reservations.checked_in_by/checked_out_by`.
  Admin `/admin/checklists`; ticks `POST /reservations/:id/checks` (`kind`, `c[]` = "room:item", `next`).
  Ticks save instantly: forms with `data-autocheck=<resId>` → inn.js posts each change to `POST /reservations/:id/check`
  (`kind`, `key`, `on`) → JSON `{done,total,by,at}`; updates the count and Check in/out confirm text. The per-list Save
  button is kept only inside `<noscript>`.
- Check-in desk: `routes/checkin.js` `/checkin?loc=<id|all>&d=` (location remembered in cookie `checkin_loc`; `open=<kind><resId>`
  reopens a list after saving). Arriving (+ overdue not checked in) and leaving cards with steps; posts to the existing
  status/checks routes with `next` back to the desk.
- Emergency contacts + check-in details: table `location_contacts` (edited on the location page, `ec_*[]` rows);
  `reservations.emergency_contact_id` (picked in Needs and notes; `stayinfo.emergencyOf` falls back to the location's first).
  `lib/stayinfo.js`: `message()` (subject/text/sms, no prices, no staff comments), `card()`, `sendBox()` (Text = `sms:` link,
  Email = server send via `lib/mail.js` (copied from EMP; RESEND_API_KEY/MAIL_FROM) or `mailto:`), private page
  `/stay/:token` (`reservations.token`), `POST /reservations/:id/send-details`, `/details-sent` (logged by inn.js on click).
- Lists in pages: `lib/paging.js` (from EMP; `paging(ctx, key, total)` → `limit/offset/nav()`, `pageRows` for in-memory
  lists; 20/50/100/All remembered in a `per_<key>` cookie). Used by `/reservations` and `/guests`.
- Phone version: `routes/mobile.js` (`/m` today with ‹ › days, `/m/checkin` (phone check-in desk, same cookie `checkin_loc`), `/m/upcoming`, `/m/find`, `/m/r/:id`, `POST /m/r/:id/comment`
  appends `[when, who] text` to `comments`; `/manifest.webmanifest`; icons `public/icon-*.png`). Uses EMP's `.m-*` styles in
  app.css plus `.m-res*` in inn.css. Check in/out posts to `/reservations/:id/status` with `next`.
- Front end: `public/app.css` + `app.js` (from EMP) and `public/inn.css` + `inn.js` (reservation form, date book).

- Password boxes: app.js wraps every `input[type=password]` (also ones added later) in `.pw-wrap` with an eye button
  (`.pw-eye`) that shows/hides it; on submit it goes back to hidden. Pages need app.js loaded (the EMP login page now does).
- Save buttons stay in view: `form > .form-actions` is `position: sticky; bottom: 0` (app.css), and app.js adds `.is-stuck`
  (background + shadow) while it's stuck. Keep each form's button row as a direct child of its `<form>` to get this.

## Running, testing

- `npm run demo`, `npm start`; or `DATABASE_FILE=/path/x.db PORT=3470 node server.js`.
- `npm test` (`test/app.test.js`, runs in order, logs in as `admin` / `test-password-1`). Keep them passing; add tests.
- Check UI in Playwright (`/opt/npm-tools/node_modules/playwright`); restart the server after code changes.
- Commit messages end with the session's attribution lines; push `main` after each finished change.

## How the owner likes to work

Same as EMP: plain language, short answers saying what changed and where to find it; fold in mid-task follow-ups;
roomy tidy screens; never echo secrets.
