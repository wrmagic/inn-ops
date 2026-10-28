// Inn Ops: the reservation form (rooms for the chosen location, buy-out, which rooms are free, nights)
(() => {
  'use strict';
  const form = document.querySelector('[data-res-form]');
  if (!form) return;
  const locSel = form.querySelector('[data-res-loc]');
  const arrive = form.querySelector('input[name=arrive]'); const depart = form.querySelector('input[name=depart]');
  const tin = form.querySelector('input[name=check_in_time]'); const tout = form.querySelector('input[name=check_out_time]');
  const nightsOut = form.querySelector('[data-nights-out]');
  const kind = () => (form.querySelector('input[name=kind]:checked') || {}).value || 'rooms';
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) / 864e5 : null);
  const iso = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  let touchedTimes = false;
  [tin, tout].forEach((el) => el && el.addEventListener('input', () => { touchedTimes = true; }));

  const showRooms = () => {
    const id = locSel.value; const buy = kind() === 'buyout';
    form.classList.toggle('is-buyout', buy);
    form.querySelectorAll('[data-loc-rooms]').forEach((box) => {
      const mine = box.dataset.locRooms === id; box.hidden = !mine;
      // Rooms at other locations aren't sent
      box.querySelectorAll('input').forEach((i) => { i.disabled = !mine; });
      if (mine && buy) box.querySelectorAll('[data-room-check]').forEach((c) => { c.checked = true; });
    });
    form.querySelectorAll('[data-buyout-only]').forEach((el) => { el.hidden = !buy; });
    const t = form.querySelector('[data-rooms-title]'); if (t) t.textContent = buy ? 'Rooms and who’s in them' : 'Rooms';
    const h = form.querySelector('[data-kind-hint]'); if (h) h.textContent = buy ? 'The whole location is booked; fill in who’s staying in each room.' : 'Tick the rooms, and who’s staying in each. Rooms already booked for those nights are marked.';
  };
  locSel.addEventListener('change', () => {
    const o = locSel.selectedOptions[0];
    if (!touchedTimes) { if (tin) tin.value = o.dataset.in || tin.value; if (tout) tout.value = o.dataset.out || tout.value; }
    const br = form.querySelector('input[name=buyout_rate]'); if (br && o.dataset.buyout) br.value = o.dataset.buyout;
    const bw = form.querySelector('input[name=buyout_wrate]'); if (bw && o.dataset.buyoutW) bw.value = o.dataset.buyoutW;
    showRooms(); check();
  });
  form.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', () => {
    if (kind() !== 'buyout') form.querySelectorAll('[data-loc-rooms]:not([hidden]) [data-room-check]').forEach((c) => { c.checked = false; });
    showRooms();
  }));

  // Nights, and the departure date following the arrival date (keeping the same number of nights)
  let prevArr = arrive.value;
  const nights = () => { const a = day(arrive.value); const d = day(depart.value); const n = a !== null && d !== null ? d - a : null; let w = 0; if (n > 0) for (let i = a; i < d; i++) { const g = new Date(i * 864e5).getUTCDay(); if (g === 5 || g === 6) w++; }
    nightsOut.textContent = n > 0 ? `${n} night${n === 1 ? '' : 's'}${w ? ` (${w === n ? 'all' : w} weekend)` : ''}` : n !== null ? 'Departure must be after arrival' : ''; };
  arrive.addEventListener('change', () => {
    const a = day(arrive.value); if (a === null) return;
    const oldA = day(prevArr); const d = day(depart.value);
    const n = oldA !== null && d !== null && d > oldA ? d - oldA : 1;
    depart.value = iso(a + n); prevArr = arrive.value; nights(); check();
  });
  depart.addEventListener('change', () => { nights(); check(); });

  // Picking an event fills in its dates (arrive on its first day, leave on its last day; a one-day event = one night); they can be changed
  const evSel = form.querySelector('[data-res-event]');
  if (evSel) evSel.addEventListener('change', () => {
    const o = evSel.selectedOptions[0]; const s = o && day(o.dataset.start || ''); if (s === null || s === undefined || !o.dataset.start) return;
    const e = day(o.dataset.end || '');
    arrive.value = iso(s); depart.value = iso(e !== null && e > s ? e : s + 1); prevArr = arrive.value;
    [arrive, depart].forEach((el) => { el.classList.add('just-set'); setTimeout(() => el.classList.remove('just-set'), 1200); });
    nights(); check();
  });

  // Mark the rooms already booked for these nights
  let timer;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (day(arrive.value) === null || day(depart.value) === null || depart.value <= arrive.value) return;
      try {
        const res = await fetch(`/api/availability?arrive=${arrive.value}&depart=${depart.value}&exclude=${form.dataset.exclude || 0}`, { headers: { Accept: 'application/json' } });
        const { busy } = await res.json();
        form.querySelectorAll('tr[data-room]').forEach((tr) => {
          const b = busy[tr.dataset.room]; tr.classList.toggle('busy', !!b);
          const cell = tr.querySelector('[data-avail]'); cell.textContent = '';
          if (b) { const s = document.createElement('span'); s.className = 'badge warn'; s.textContent = `Booked: ${b.guest}`; cell.appendChild(s); }
        });
      } catch { /* the server checks again when saving */ }
    }, 200);
  };
  // Typing in a room's names or rate ticks it
  form.querySelectorAll('tr[data-room] input:not([type=checkbox])').forEach((i) => i.addEventListener('input', () => { const c = i.closest('tr').querySelector('[data-room-check]'); if (c && i.name.startsWith('occ_') && i.value.trim()) c.checked = true; }));
  showRooms(); nights();
})();

// Checklists: each tick or untick is saved the moment it's clicked (no Save button needed)
(() => {
  'use strict';
  document.addEventListener('change', async (e) => {
    const box = e.target; if (!box.matches || !box.matches('form[data-autocheck] input[name="c[]"]')) return;
    const form = box.closest('form'); const li = box.closest('li');
    const kind = (form.querySelector('input[name=kind]') || {}).value; const id = form.dataset.autocheck;
    const body = new URLSearchParams({ _csrf: (form.querySelector('input[name=_csrf]') || {}).value || '', kind, key: box.value, on: box.checked ? '1' : '0' });
    if (li) li.classList.add('saving');
    try {
      const res = await fetch(`/reservations/${id}/check`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, credentials: 'same-origin' });
      const r = await res.json(); if (!res.ok || !r.ok) throw new Error(r.error || 'Not saved');
      if (li) {
        li.classList.toggle('done', r.on);
        let who = li.querySelector('.cl-who');
        if (r.on) { if (!who) { who = document.createElement('small'); who.className = 'cl-who'; li.appendChild(who); } who.textContent = `${r.by || 'You'} · ${r.at}`; } else if (who) who.remove();
      }
      // the count on this list ("3 of 8" / "Completed")
      const holder = form.closest('details') || form.closest('section') || form.parentElement;
      const cnt = holder && holder.querySelector('.cl-count');
      if (cnt) { const all = r.total && r.done === r.total; cnt.classList.toggle('all', all); cnt.textContent = cnt.closest('summary') && all ? 'Completed' : `${r.done} of ${r.total}`; }
      // Check in / Check out stop asking once everything is ticked
      const to = kind === 'precheck' ? 'checked_in' : 'checked_out';
      document.querySelectorAll(`form[action="/reservations/${id}/status"]`).forEach((f) => {
        const t = f.querySelector('input[name=to]'); if (!t || t.value !== to) return;
        if (r.done >= r.total) f.removeAttribute('data-confirm');
        else f.setAttribute('data-confirm', `${r.total - r.done} of the ${r.total} ${kind === 'precheck' ? 'pre-check-in' : 'checkout'} items aren’t ticked yet. Go ahead anyway?`);
      });
    } catch (err) {
      box.checked = !box.checked;
      alert('That tick wasn’t saved. Check the connection and try again.');
    } finally { if (li) li.classList.remove('saving'); }
  });
})();
