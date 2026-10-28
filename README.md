# Inn Ops Reservation System

Room reservations for the Inn, Stonehouse, Ranch House and Mansion. It's a sister program to Event Master Plus but runs
completely on its own: its own website, its own database and its own logins.

## What it does

- **Locations and rooms**: each location has its own check-in and checkout times, buy-out rates, directions and
  instructions for guests, and staff notes. Each room has a name, description, how many it sleeps, rates, and
  its own times and instructions if they differ from the location's. Use the ▲ ▼ buttons on the locations list to set the order
  locations appear in everywhere (date book, calendar, check-in, reports, lists).
- **Weekday and weekend rates**: every room and every buy-out has a weekday rate (Sunday–Thursday nights) and a
  weekend rate (Friday and Saturday nights). Leave the weekend rate blank to charge the weekday rate. A stay is
  priced night by night, and the reservation shows how many weeknights and weekend nights it has.
- **Reservations**: book **individual rooms** or a **full buy-out** of a location. Each reservation keeps:
  - the guest, the dates (arrives and departs), check-in and checkout times, adults and children
  - for each room, its rate and **who's staying in it**
  - **special needs** (accessibility, allergies, cribs…), **special instructions** (printed for the guest) and
    **comments** (staff only)
  - the **event** it belongs to (a wedding, retreat, show…); picking the event fills in its dates (arrive on its first
    day, leave on its last), which you can still change
  - status: Tentative, Confirmed, Checked in, Checked out, Cancelled
  - money: each night at its weekday or weekend rate (rooms or buy-out), discount, lodging tax, deposit and due date,
    payments and refunds, balance
- **Checklists** (Admin › Checklists): give a list a name, pick **Pre-check-in** (things to check and confirm before a
  guest arrives) or **Checkout** (what's done when they leave), and **Save list**; then add its items one at a time. Put them in any order with the ▲ ▼ buttons next to each item. Pick each location's lists on its page under
  Locations and rooms; every room there uses them unless the room picks its own list. On a reservation, each room
  gets its list as tick boxes (the checkout list appears once the guest is checked in). Each tick or untick is saved
  the moment you click it (no Save button), and each tick shows who did it and when. **Check in** / **Check out** ask first if items are still unticked, and the stay shows who checked the
  guest in and out. The same lists are on the phone version.
- **No double bookings**: a room can't be booked twice for the same night, and a buy-out can't overlap any booking
  at that location. A guest can arrive the same day the last one leaves.
- **Calendar** (Calendar): a month view and a list, with every stay on each night it covers. Click + on a day to book.
- **Date book** (Date book): every room on its own line, 7, 14 or 30 days at a time. Each stay is a bar from the
  afternoon it arrives to the morning it leaves. Click a bar to open the stay, or an empty day to book that room.
  Dashed bars are buy-outs; striped bars are tentative; white bars with a black outline are guests checked in.
  A location with no rooms set up is rented only as a whole: it gets one "Whole location" line for its buy-outs.
- **Admin** works like Event Master Plus: a home page of tiles (Your business: Business details, Logins; Lodging:
  Locations and rooms, Checklists, Stay defaults) and the same menu down the side of every Admin page.
- **Check-in** (menu): pick a location (or All; remembered on that computer) and a day (‹ Today ›). **Checking in** lists
  everyone arriving (and anyone due earlier who isn't checked in yet) with their rooms, who's in them, special needs,
  comments and balance. Each guest's steps run in order: **Pre-check-in** (shows "2 of 8" or **Completed**; click to
  open the tick list right there), **Check in** (then shows when and by whom), then the **Checkout** list and **Check out**.
  **Checking out** lists that day's departures with their checkout list and Check out button.
- **Dashboard**: today's arrivals and departures with Check in and Check out buttons, who's staying, how full each
  location is tonight, what's coming up, and money still owed.
- **Guests** and **Events**: a profile for each guest with all their stays; each event lists its reservations and
  has an "Add a reservation" link that fills in the event, dates and location.
- **Lists in pages**: the Reservations and Guests lists show 20 at a time, with Previous / Next and Show 20, 50, 100
  or All at the bottom. Your choice is remembered for each list on that computer.
- **Reports**: arrivals and departures for a date range, and a house list (who's in every room on a night). All print.
- **Phone version** (`/m`, or **Phone version** at the bottom of the menu): today's arrivals, departures and who's
  staying, with big Check in and Check out buttons; flip to other days with ‹ ›; **Coming up** (the next two weeks);
  **Find** (by guest, who's in a room, event or reservation #). Open a stay to see its rooms, special needs, comments
  and instructions, call or text the guest, check in or out (or undo), and add a comment (saved with the time and
  your name). To put it on your phone's home screen: open the site on the phone, sign in, then Share → Add to Home
  Screen (iPhone) or ⋮ → Add to Home screen (Android).
- **Confirmation**: a printable confirmation for the guest from each reservation (staff comments are left off).

## Setting it up on Render

1. In Render: **New → Blueprint**, pick the `wrmagic/inn-ops` repository, and confirm.
2. When it asks, fill in **ADMIN_PASSWORD** (the first password for the `admin` login) and **BASE_URL**
   (the site's web address, e.g. `https://inn-ops.onrender.com`).
3. Open the site and sign in as `admin`. Then:
   - **Admin → Business details**: your business name, address and time zone; **Admin → Stay defaults**: usual
     check-in/checkout times, lodging tax and the confirmation note.
   - **Admin → Locations and rooms**: the four locations are already there; open each one and add its rooms and rates.
   - **Admin → Logins**: add a login for each staff member (Staff can do everything but Admin).

The database lives on Render's disk at `/data/innops.db`, so it survives redeploys. Pushing to `main` redeploys.

## Running it on a computer

Needs Node 22.13 or newer. No packages to install.

```
npm run demo        # makes a database with sample rooms, guests and stays (login admin / the password it prints)
npm start           # http://localhost:3000
npm test            # runs the tests
npm run reset-password -- admin NEWPASSWORD   # sets a new password for a login
```
