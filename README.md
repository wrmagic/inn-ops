# Inn Ops Reservation System

Room reservations for the Inn, Stonehouse, Ranch House and Mansion. It's a sister program to Event Master Plus but runs
completely on its own: its own website, its own database and its own logins.

## What it does

- **Locations and rooms**: each location has its own check-in and checkout times, buy-out rates, directions and
  instructions for guests, and staff notes. Each room has a name, description, how many it sleeps, rates, and
  its own times and instructions if they differ from the location's.
- **Weekday and weekend rates**: every room and every buy-out has a weekday rate (Sunday–Thursday nights) and a
  weekend rate (Friday and Saturday nights). Leave the weekend rate blank to charge the weekday rate. A stay is
  priced night by night, and the reservation shows how many weeknights and weekend nights it has.
- **Reservations**: book **individual rooms** or a **full buy-out** of a location. Each reservation keeps:
  - the guest, the dates (arrives and departs), check-in and checkout times, adults and children
  - for each room, its rate and **who's staying in it**
  - **special needs** (accessibility, allergies, cribs…), **special instructions** (printed for the guest) and
    **comments** (staff only)
  - the **event** it belongs to (a wedding, retreat, show…)
  - status: Tentative, Confirmed, Checked in, Checked out, Cancelled
  - money: each night at its weekday or weekend rate (rooms or buy-out), discount, lodging tax, deposit and due date,
    payments and refunds, balance
- **No double bookings**: a room can't be booked twice for the same night, and a buy-out can't overlap any booking
  at that location. A guest can arrive the same day the last one leaves.
- **Calendar** (Calendar): a month view and a list, with every stay on each night it covers. Click + on a day to book.
- **Date book** (Date book): every room on its own line, 7, 14 or 30 days at a time. Each stay is a bar from the
  afternoon it arrives to the morning it leaves. Click a bar to open the stay, or an empty day to book that room.
  Dashed bars are buy-outs; striped bars are tentative.
  A location with no rooms set up is rented only as a whole: it gets one "Whole location" line for its buy-outs.
- **Dashboard**: today's arrivals and departures with Check in and Check out buttons, who's staying, how full each
  location is tonight, what's coming up, and money still owed.
- **Guests** and **Events**: a profile for each guest with all their stays; each event lists its reservations and
  has an "Add a reservation" link that fills in the event, dates and location.
- **Reports**: arrivals and departures for a date range, and a house list (who's in every room on a night). All print.
- **Confirmation**: a printable confirmation for the guest from each reservation (staff comments are left off).

## Setting it up on Render

1. In Render: **New → Blueprint**, pick the `wrmagic/inn-ops` repository, and confirm.
2. When it asks, fill in **ADMIN_PASSWORD** (the first password for the `admin` login) and **BASE_URL**
   (the site's web address, e.g. `https://inn-ops.onrender.com`).
3. Open the site and sign in as `admin`. Then:
   - **Admin → Settings**: your business name, address, time zone, default check-in/checkout times and lodging tax.
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
