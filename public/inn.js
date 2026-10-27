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
