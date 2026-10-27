// Small progressive enhancements. Every page works without this file.
(function () {
  'use strict';
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const $ = (sel, root = document) => root.querySelector(sel);

  // ----- A row that opens the row under it (Set list report); without the script the link opens the page itself
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle-next]'); if (!t) return;
    const row = t.closest('tr'); const next = row && row.nextElementSibling; if (!next) return;
    e.preventDefault();
    next.hidden = !next.hidden;
    t.setAttribute('aria-expanded', next.hidden ? 'false' : 'true');
    t.textContent = next.hidden ? 'Set list' : 'Hide';
  });

  // ----- Set lists: keep the numbers in order and the total time up to date
  const slSecs = (v) => { const t = String(v || '').trim(); let m = /^(\d{1,3}):([0-5]?\d)$/.exec(t); if (m) return +m[1] * 60 + +m[2]; m = /^\d{1,3}(\.\d+)?$/.exec(t); return m ? Math.round(parseFloat(t) * 60) : 0; };
  const slFix = (box) => {
    $$('[data-row]', box).forEach((r, i) => { const n = r.querySelector('.sl-n'); if (n) n.textContent = i + 1; });
    const sec = $$('[data-sl-time]', box).reduce((s, el) => s + slSecs(el.value), 0);
    const out = box.querySelector('[data-sl-total]'); if (!out) return;
    const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s2 = sec % 60;
    const mins = `${m} minute${m === 1 ? '' : 's'}${s2 ? ` ${s2} second${s2 === 1 ? '' : 's'}` : ''}`;
    out.textContent = sec ? `Total: ${h ? `${h} hr${m || s2 ? ` ${mins}` : ''}` : mins}` : '';
  };
  document.addEventListener('input', (e) => { const box = e.target.closest('[data-setlist]'); if (box && e.target.matches('[data-sl-time]')) slFix(box); });
  document.addEventListener('click', (e) => { const box = e.target.closest('[data-setlist]'); if (box && e.target.closest('[data-add-row], [data-remove-row]')) setTimeout(() => { $$('[data-row]:last-child details', box).forEach((d) => { if (!d.querySelector('input').value) d.open = false; }); slFix(box); }); });

  // ----- Contract editor: a page to type on with a formatting toolbar; what's typed is sent in a hidden field
  $$('[data-rte]').forEach((box) => {
    const page = box.querySelector('[data-rte-page]'); const out = box.querySelector('[data-rte-out]');
    const sync = () => { out.value = page.innerHTML; out.dispatchEvent(new Event('input', { bubbles: true })); };
    try { document.execCommand('styleWithCSS', false, false); } catch { /* older browsers */ }
    const run = (cmd, val) => { page.focus(); document.execCommand(cmd, false, val); sync(); };
    box.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]'); if (!b) return;
      const cmd = b.dataset.cmd;
      if (cmd === 'pagebreak') return run('insertHTML', '<hr class="page-break"><p><br></p>');
      run(cmd, b.dataset.val || null);
    });
    const block = box.querySelector('[data-block]'); if (block) block.addEventListener('change', () => { run('formatBlock', `<${block.value}>`); block.value = 'p'; });
    const size = box.querySelector('[data-size]'); if (size) size.addEventListener('change', () => { if (size.value) run('fontSize', size.value); size.value = ''; });
    const fld = box.querySelector('[data-field]'); if (fld) fld.addEventListener('change', () => { if (fld.value) run('insertText', `{{${fld.value}}}`); fld.value = ''; });
    // Remember where the cursor was, so a menu choice goes there
    let range = null;
    const keep = () => { const s = window.getSelection(); if (s.rangeCount && page.contains(s.anchorNode)) range = s.getRangeAt(0); };
    document.addEventListener('selectionchange', keep);
    box.querySelectorAll('select').forEach((sel) => sel.addEventListener('mousedown', keep));
    const restore = () => { if (!range) return; const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); };
    box.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', restore, true));
    page.addEventListener('input', sync);
    const form = box.closest('form'); if (form) form.addEventListener('submit', sync);
  });
  // ----- Contract signature: draw it, or upload a picture (white becomes see-through); sent as a trimmed PNG
  $$('[data-sig-form]').forEach((form) => {
    const pad = form.querySelector('[data-sig-pad]'); const out = form.querySelector('input[name=signature_data]');
    const g = pad.getContext('2d'); let inked = false; let drawing = false; let last = null;
    const pen = () => { g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#1a1a2e'; };
    const at = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
    pad.addEventListener('pointerdown', (e) => { drawing = true; last = at(e); pad.setPointerCapture(e.pointerId); e.preventDefault(); });
    pad.addEventListener('pointermove', (e) => { if (!drawing) return; const p = at(e); pen(); g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke(); last = p; inked = true; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => pad.addEventListener(t, () => { drawing = false; }));
    form.querySelector('[data-sig-clear]').addEventListener('click', () => { g.clearRect(0, 0, pad.width, pad.height); inked = false; });
    const file = form.querySelector('[data-sig-file]');
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => {
        g.clearRect(0, 0, pad.width, pad.height);
        const k = Math.min(pad.width / img.width, pad.height / img.height); const w = img.width * k; const h = img.height * k;
        g.drawImage(img, (pad.width - w) / 2, (pad.height - h) / 2, w, h);
        // Paper white (and light grey) becomes see-through, so it sits on the signature line
        const d = g.getImageData(0, 0, pad.width, pad.height); const px = d.data;
        for (let i = 0; i < px.length; i += 4) { const lum = (px[i] + px[i + 1] + px[i + 2]) / 3; if (lum > 200) px[i + 3] = 0; else if (lum > 150) px[i + 3] = Math.round(px[i + 3] * (200 - lum) / 50); }
        g.putImageData(d, 0, 0); inked = true; URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    });
    form.addEventListener('submit', () => {
      if (!inked) return;
      // Trim to the ink
      const d = g.getImageData(0, 0, pad.width, pad.height).data; let x0 = pad.width; let y0 = pad.height; let x1 = 0; let y1 = 0;
      for (let y = 0; y < pad.height; y++) for (let x = 0; x < pad.width; x++) if (d[(y * pad.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      if (x1 <= x0) return;
      const c = document.createElement('canvas'); c.width = x1 - x0 + 8; c.height = y1 - y0 + 8;
      c.getContext('2d').drawImage(pad, x0 - 4, y0 - 4, c.width, c.height, 0, 0, c.width, c.height);
      out.value = c.toDataURL('image/png');
    });
  });
  // "See it filled in for…": open the chosen booking's contract
  $$('[data-preview-go]').forEach((a) => {
    const sel = a.parentElement.querySelector('[data-preview]');
    const set = () => { a.href = sel.value; }; sel.addEventListener('change', set); set();
  });

  // ----- From/To dates: the To date follows the From date, keeping the same number of days between them
  // (pick From 10/29 → To 10/29; change To to 10/30; change From to 11/1 → To becomes 11/2).
  // An optional "until" date (repeats) only moves when it's filled in.
  {
    const PAIRS = [['start_date', 'end_date'], ['from', 'to'], ['starts_on', 'ends_on', true], ['rep_first', 'rep_until', true]];
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) / 864e5 : null);
    const iso = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
    $$('form').forEach((form) => {
      for (const [f, t, optional] of PAIRS) {
        const from = form.querySelector(`input[type=date][name="${f}"]`); const to = form.querySelector(`input[type=date][name="${t}"]`);
        if (!from || !to) continue;
        let prev = from.value;
        const move = () => {
          const nf = day(from.value); if (nf === null) return;
          const oldF = day(prev); const oldT = day(to.value);
          let gap = oldF !== null && oldT !== null ? oldT - oldF : 0;
          if (gap < 0) gap = 0;
          if (to.value || !optional) { to.value = iso(nf + gap); to.dispatchEvent(new Event('input', { bubbles: true })); }
          prev = from.value;
        };
        from.addEventListener('change', move);
        // Typing a date fires "input" as each part is entered; only finished dates count
        from.addEventListener('input', () => { if (day(from.value) !== null && from.value.slice(0, 1) !== '0') move(); });
      }
    });
  }

  // ----- A Cancel button inside a folded box closes it again
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-close-details]'); if (b) { const d = b.closest('details'); if (d) { d.open = false; const f = b.closest('form'); if (f) f.reset(); } } });
  // Opening the Add work box puts the cursor in Details
  document.addEventListener('toggle', (e) => { const d = e.target; if (d.matches && d.matches('details.work-add-box') && d.open) { const t = d.querySelector('textarea'); if (t) t.focus(); } }, true);

  // ----- Repeating rows (phones, dates, talent, tickets…)
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-row]');
    if (add) {
      let rows = add.previousElementSibling;
      while (rows && !rows.matches('[data-rows]')) rows = rows.previousElementSibling;
      if (!rows) return;
      const all = $$('[data-row]', rows);
      const last = all[all.length - 1];
      // An optional list that's empty keeps one hidden blank row: show it instead of adding another
      if (all.length === 1 && last.hidden) {
        last.hidden = false; const em = rows.parentElement.querySelector('[data-rows-empty]'); if (em) em.hidden = true;
        const head = rows.querySelector('.row.head'); if (head) head.hidden = false;
        const f0 = last.querySelector('input:not([type=hidden]), select'); if (f0) f0.focus();
        return;
      }
      const clone = last.cloneNode(true);
      $$('input, select, textarea', clone).forEach((el) => {
        if (el.type === 'radio') { el.checked = false; el.value = String(all.length); }
        else if (el.type === 'checkbox') el.checked = false;
        else if (el.tagName === 'SELECT') el.selectedIndex = el.name === 'tt_online[]' ? 0 : el.selectedIndex;
        else if (el.type === 'hidden') { if (!el.hasAttribute('data-keep')) el.value = ''; }
        else if (el.type === 'number' && el.name.includes('qty') && !el.name.startsWith('opt_')) el.value = '1';
        else if (el.type === 'date' && last.querySelector('input[type=date]') === el) el.value = '';
        else if (el.dataset.default !== undefined) el.value = el.dataset.default; // e.g. talent times start as the date's
        else if (el.type !== 'time') el.value = '';
      });
      $$('[disabled]', clone).forEach((b) => { b.disabled = false; b.removeAttribute('title'); });
      rows.appendChild(clone);
      const first = clone.querySelector('input:not([type=hidden]), select');
      if (first) first.focus();
      return;
    }
    const rm = e.target.closest('[data-remove-row]');
    if (rm) {
      const row = rm.closest('[data-row]');
      const rows = row.parentElement;
      if ($$('[data-row]', rows).length > 1) row.remove();
      else {
        $$('input:not([type=hidden]):not([type=radio]), textarea', row).forEach((el) => { el.value = ''; });
        // An optional list (other tickets when selling by seat) can be emptied
        if (rows.hasAttribute('data-rows-optional')) {
          row.hidden = true; const em = rows.parentElement.querySelector('[data-rows-empty]'); if (em) em.hidden = false;
          const head = rows.querySelector('.row.head'); if (head) head.hidden = true;
        }
      }
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const inp = copy.parentElement.querySelector('input');
      inp.select();
      (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(() => { copy.textContent = 'Copied'; }, () => document.execCommand('copy'));
    }
  });

  // ----- Confirm destructive actions
  document.addEventListener('submit', (e) => {
    const f = e.target;
    const btn = e.submitter;
    const msg = (btn && btn.dataset.confirm) || f.dataset.confirm;
    if (msg && !window.confirm(msg)) { e.preventDefault(); return; }
    f.dataset.submitting = '1';
  });
  document.addEventListener('change', (e) => { if (e.target.matches('[data-autosubmit]')) e.target.form.submit(); });

  // ----- Warn before leaving a half-filled form
  $$('form[data-dirty-guard]').forEach((f) => {
    let dirty = false;
    f.addEventListener('input', () => { dirty = true; });
    window.addEventListener('beforeunload', (e) => { if (dirty && !f.dataset.submitting) { e.preventDefault(); e.returnValue = ''; } });
  });

  // ----- Individual / organization toggle on the profile form
  $$('[data-toggle-org]').forEach((seg) => {
    const form = seg.closest('form');
    const apply = () => {
      const org = form.querySelector('input[name=is_org]:checked')?.value === '1';
      $$('.org-only', form).forEach((el) => { el.hidden = !org; });
      $$('.person-only', form).forEach((el) => { el.hidden = org; });
    };
    seg.addEventListener('change', apply); apply();
  });
  // Offsite address only when offsite is ticked
  $$('input[name=offsite]').forEach((cb) => {
    const box = cb.closest('form').querySelector('.offsite-fields');
    if (!box) return;
    const apply = () => { box.hidden = !cb.checked; };
    cb.addEventListener('change', apply); apply();
  });

  // ----- Money and tickets: show only the fields for the chosen way of charging
  $$('[data-fin-select]').forEach((sel) => {
    const form = sel.closest('form');
    const apply = () => {
      $$('[data-fin]', form).forEach((g) => {
        const on = g.dataset.fin.split(' ').includes(sel.value);
        g.hidden = !on;
        // Hidden fields aren't sent, so stale values from another option are never saved
        $$('input, select, textarea, button', g).forEach((el) => { if (!el.hasAttribute('data-keep-disabled')) el.disabled = !on; });
      });
    };
    $$('[data-fin] [disabled]', form).forEach((el) => el.setAttribute('data-keep-disabled', ''));
    sel.addEventListener('change', apply); apply();
  });

  // ----- Talent: one section per activity date, picked with the date pills
  $$('.day-pills').forEach((bar) => {
    const form = bar.closest('form');
    if (!form || !bar.querySelector('[data-show-when]')) return; // date pills that are plain links (door, check-in) need nothing here
    let whenInput = form.querySelector('input[name=when]');
    if (!whenInput) { whenInput = document.createElement('input'); whenInput.type = 'hidden'; whenInput.name = 'when'; form.appendChild(whenInput); }
    const show = (key) => {
      $$('.day-pill', bar).forEach((b) => { const on = b.dataset.showWhen === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      $$('.talent-day', form).forEach((sec) => { sec.hidden = sec.dataset.when !== key; });
      whenInput.value = key;
    };
    bar.addEventListener('click', (e) => { const b = e.target.closest('.day-pill'); if (b) show(b.dataset.showWhen); });
    const on = bar.querySelector('.day-pill.on'); if (on) show(on.dataset.showWhen);
  });
  // ----- Appointment booking: repeat options only when repeating
  $$('[data-freq]').forEach((sel) => {
    const form = sel.closest('form');
    const apply = () => {
      $$('.repeat-only', form).forEach((el) => { el.hidden = sel.value === 'once'; });
      // Day-of-week and week-of-month choices only for the repeats that use them
      $$('[data-show-freq]', form).forEach((el) => { el.hidden = !el.dataset.showFreq.split(' ').includes(sel.value); });
    };
    sel.addEventListener('change', apply); apply();
  });

  // ----- Show a section only when a yes/no question is answered Yes
  $$('[data-hide-if]').forEach((box) => {
    const form = box.closest('form'); const name = box.dataset.hideIf;
    const apply = () => { const el = form.querySelector(`[name="${name}"]:checked`); box.hidden = !!(el && el.value === '1'); };
    $$(`[name="${name}"]`, form).forEach((r) => r.addEventListener('change', apply)); apply();
  });
  $$('[data-show-if]').forEach((box) => {
    const form = box.closest('form');
    const name = box.dataset.showIf;
    const apply = () => {
      const el = form.querySelector(`[name="${name}"]:checked`);
      box.hidden = !(el && el.value === '1');
    };
    $$(`[name="${name}"]`, form).forEach((r) => r.addEventListener('change', apply));
    apply();
  });

  // ----- Blackouts: hours only when not all day
  $$('[data-all-day]').forEach((cb) => {
    const form = cb.closest('form');
    const apply = () => $$('[data-times]', form).forEach((el) => { el.hidden = cb.checked; });
    cb.addEventListener('change', apply); apply();
  });

  // ----- Talent: fill in default cost/charge when chosen
  const prices = document.getElementById('talent-prices');
  if (prices) {
    const map = JSON.parse(prices.textContent);
    document.addEventListener('change', (e) => {
      if (!e.target.matches('select[name="talent_id[]"]')) return;
      const p = map[e.target.value]; if (!p) return;
      const row = e.target.closest('[data-row]');
      const cost = row.querySelector('[name="talent_cost[]"]'); const price = row.querySelector('[name="talent_price[]"]');
      if (!cost.value) cost.value = p.cost; if (!price.value) price.value = p.price;
    });
  }

  // ----- Ticket sale on the phone: running total, and nothing to pay for until a ticket is picked
  $$('form[data-sell]').forEach((f) => {
    const out = $('[data-sell-total]', f); const go = $('[data-sell-go]', f);
    const calc = () => {
      let c = 0; let n = 0;
      f.querySelectorAll('input[data-price]').forEach((i) => { const q = Math.max(0, parseInt(i.value, 10) || 0); c += q * Number(i.dataset.price); n += q; });
      out.textContent = `$${(c / 100).toFixed(2)}${n ? ` · ${n} ticket${n === 1 ? '' : 's'}` : ''}`; go.disabled = !n;
    };
    f.addEventListener('input', calc); calc();
  });

  // ----- Cash change calculator
  $$('[data-change]').forEach((out) => {
    const form = out.closest('form');
    const amt = form.querySelector('[name=amount]');
    const due = amt.dataset.due ? Number(amt.dataset.due) / 100 : parseFloat(amt.value) || 0;
    const calc = () => {
      const m = form.querySelector('[name=method]:checked') || form.querySelector('input[type=hidden][name=method]');
      const cash = m && m.value === 'cash';
      const got = parseFloat(String(amt.value).replace(/[$,]/g, '')) || 0;
      out.textContent = cash && got > due ? `Change due: $${(got - due).toFixed(2)}` : '';
    };
    form.addEventListener('input', calc); form.addEventListener('change', calc);
  });

  // ----- Quick add a person without leaving the page
  let qa = null;
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
    kids.forEach((k) => e.appendChild(k));
    return e;
  }
  function fieldEl(label, input) { return el('label', { class: 'field' }, el('span', { class: 'lbl', text: label }), input); }
  function buildQuickAdd() {
    const f = el('form', { class: 'stack', method: 'dialog' });
    const seg = el('fieldset', { class: 'seg' },
      el('label', {}, el('input', { type: 'radio', name: 'is_org', value: '0', checked: '' }), document.createTextNode(' Individual')),
      el('label', {}, el('input', { type: 'radio', name: 'is_org', value: '1' }), document.createTextNode(' Organization')));
    const org = fieldEl('Organization name', el('input', { name: 'org_name' }));
    org.hidden = true;
    const contactNote = el('p', { class: 'hint', text: 'Contact person (optional):' }); contactNote.hidden = true;
    const names = el('div', { class: 'grid g2' }, fieldEl('First name', el('input', { name: 'first' })), fieldEl('Last name', el('input', { name: 'last' })));
    const contact = el('div', { class: 'grid g2' }, fieldEl('Phone', el('input', { name: 'phone', type: 'tel' })), fieldEl('Email', el('input', { name: 'email', type: 'email' })));
    const err = el('p', { class: 'err-text', role: 'alert' });
    const save = el('button', { class: 'btn primary', type: 'submit', text: 'Add and use' });
    const cancel = el('button', { class: 'btn ghost', type: 'button', text: 'Cancel' });
    f.append(el('h2', { text: 'Add a new person' }), seg, org, contactNote, names, contact,
      el('p', { class: 'hint', text: 'You can fill in the rest of their profile later from the Directory.' }), err,
      el('div', { class: 'form-actions' }, save, cancel));
    const dlg = el('dialog', { class: 'quick-add', 'aria-label': 'Add a new person' }, f);
    document.body.appendChild(dlg);
    seg.addEventListener('change', () => {
      const isOrg = f.is_org.value === '1';
      org.hidden = !isOrg; contactNote.hidden = !isOrg;
    });
    cancel.addEventListener('click', () => dlg.close());
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = ''; save.disabled = true;
      const body = new URLSearchParams(new FormData(f));
      body.set('_csrf', document.querySelector('meta[name=csrf]').content);
      try {
        const res = await fetch('/api/people/quick', { method: 'POST', body, headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.error || 'Couldn’t save. Try again.'; return; }
        dlg.close();
        qa.done(data);
      } catch { err.textContent = 'Couldn’t reach the server. Check your connection and try again.'; }
      finally { save.disabled = false; }
    });
    return { dlg, f, org, contactNote };
  }
  function quickAdd(term, done) {
    if (!qa) qa = buildQuickAdd();
    const { dlg, f, org, contactNote } = qa;
    f.reset(); org.hidden = true; contactNote.hidden = true;
    qa.done = done;
    const t = (term || '').trim();
    if (t.includes(',')) { const [l, fi] = t.split(','); f.first.value = (fi || '').trim(); f.last.value = l.trim(); }
    else { const parts = t.split(/\s+/); f.first.value = parts.shift() || ''; f.last.value = parts.join(' '); }
    dlg.showModal();
    (f.first.value ? f.last : f.first).focus();
  }

  // ----- Person picker (directory typeahead)
  $$('[data-picker=people]').forEach((box) => {
    const hidden = box.querySelector('input[type=hidden]');
    const q = box.querySelector('.picker-q');
    const list = box.querySelector('.picker-list');
    let timer; let items = []; let active = -1;
    if (hidden.value) box.classList.add('chosen');
    const close = () => { list.hidden = true; active = -1; };
    const choose = (it) => {
      if (it.newProfile) { close(); quickAdd(it.term, (p) => choose(p)); return; }
      hidden.value = it.id; q.value = it.name; box.classList.add('chosen'); close();
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      box.dispatchEvent(new CustomEvent('picked', { bubbles: true, detail: it }));
    };
    const draw = () => {
      list.innerHTML = '';
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === active));
        li.textContent = it.name;
        if (it.detail) { const s = document.createElement('small'); s.textContent = it.detail; li.appendChild(s); }
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(it); });
        list.appendChild(li);
      });
      list.hidden = !items.length;
    };
    q.addEventListener('input', () => {
      hidden.value = ''; box.classList.remove('chosen');
      clearTimeout(timer);
      const term = q.value.trim();
      if (term.length < 2) { items = []; draw(); return; }
      timer = setTimeout(async () => {
        try {
          const res = await fetch('/api/people?q=' + encodeURIComponent(term), { headers: { Accept: 'application/json' } });
          items = res.ok ? await res.json() : [];
        } catch { items = []; }
        if (box.hasAttribute('data-allow-new')) items.push({ newProfile: true, term, name: `Add “${term}” as a new person` });
        active = -1; draw();
      }, 180);
    });
    q.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    q.addEventListener('blur', () => setTimeout(close, 120));
  });
  // ----- POS: coin and bill counts add up as you type
  const fmt = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  $$('[data-count]').forEach((box) => {
    const form = box.closest('form');
    const calc = () => {
      let coins = 0; let bills = 0;
      $$('tbody', box).forEach((tb, i) => {
        let sum = 0;
        $$('input', tb).forEach((inp) => {
          const v = inp.hasAttribute('data-odd') ? Math.round((parseFloat(inp.value) || 0) * 100) : (parseInt(inp.value, 10) || 0) * Number(inp.dataset.denom);
          sum += Math.max(0, v);
          const cell = inp.closest('tr').querySelector('[data-line]'); if (cell) cell.textContent = fmt(Math.max(0, v));
        });
        if (i === 0) coins = sum; else bills = sum;
      });
      const set = (k, v) => { const el = box.querySelector(`[data-sum=${k}]`); if (el) el.innerHTML = `<b>${fmt(v)}</b>`; };
      set('coins', coins); set('bills', bills);
      const tot = box.querySelector('[data-sum=total]'); if (tot) tot.textContent = fmt(coins + bills);
      const exp = form.querySelector('[data-expected]');
      const st = form.querySelector('[data-recon-state]');
      if (exp && st) {
        const diff = coins + bills - Number(exp.dataset.expected);
        st.textContent = diff === 0 ? '✓ Reconciled' : `${fmt(Math.abs(diff))} ${diff > 0 ? 'over' : 'short'}`;
        st.className = 'recon-state ' + (diff === 0 ? 'ok-text' : 'err-text');
      }
      const dep = form.querySelector('[data-deposit]');
      if (dep) { const out = dep.querySelector('[data-deposit-out]'); out.textContent = fmt(Number(dep.dataset.deposit) - coins - bills); }
    };
    box.addEventListener('input', calc); calc();
  });

  // ----- POS item: dim the stock fields when stock isn't counted
  $$('[data-dim-toggle]').forEach((cb) => {
    const box = cb.closest('form').querySelector(`[data-dim="${cb.dataset.dimToggle}"]`);
    const apply = () => { box.classList.toggle('dim', !cb.checked); $$('input', box).forEach((i) => { i.disabled = !cb.checked; }); };
    cb.addEventListener('change', apply); apply();
  });

  // ----- POS item picture: shrink in the browser before upload
  $$('[data-picture]').forEach((box) => {
    const file = box.querySelector('input[type=file]');
    const hidden = box.querySelector('input[name=picture_data]');
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => {
        const max = 480; const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        hidden.value = c.toDataURL('image/jpeg', 0.82);
        let pv = box.querySelector('img');
        if (!pv) { pv = document.createElement('img'); pv.alt = ''; const none = box.querySelector('.pic-none'); if (none) none.replaceWith(pv); else box.prepend(pv); }
        pv.src = hidden.value; URL.revokeObjectURL(img.src);
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
      };
      img.src = URL.createObjectURL(f);
    });
  });

  // ----- Directory photo: pick a file or use the camera; square it, shrink it, save it
  $$('[data-photo-form]').forEach((form) => {
    const hidden = form.querySelector('input[name=photo_data]');
    const SIZE = 480;
    const square = (src, w, h) => {
      const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
      const side = Math.min(w, h);
      c.getContext('2d').drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
      return c.toDataURL('image/jpeg', 0.85);
    };
    const save = (data) => { hidden.value = data; form.submit(); };
    form.querySelectorAll('[data-photo-file]').forEach((file) => file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => { save(square(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
      img.onerror = () => alert('That file isn’t a picture this browser can read. Try a JPG or PNG.');
      img.src = URL.createObjectURL(f);
    }));
    const camBtn = form.querySelector('[data-photo-camera]');
    const dlg = form.closest('.panel').querySelector('[data-camera-dlg]');
    const fallback = () => { const fb = form.querySelector('.sr-fallback input'); if (fb) fb.click(); };
    if (!camBtn || !dlg) return;
    const video = dlg.querySelector('video'); const canvas = dlg.querySelector('canvas'); const msg = dlg.querySelector('[data-camera-msg]');
    const btn = (k) => dlg.querySelector(`[data-camera-${k}]`);
    let stream = null; let shot = null;
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const live = (on) => { video.hidden = !on; canvas.hidden = on; btn('snap').hidden = !on; btn('retake').hidden = on; btn('use').hidden = on; };
    camBtn.addEventListener('click', async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !dlg.showModal) return fallback();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        // No camera, or permission refused: phones and tablets can still use their camera app
        return fallback();
      }
      video.srcObject = stream; msg.textContent = 'Line up the face in the middle, then take the photo.';
      live(true); dlg.showModal();
    });
    btn('snap').addEventListener('click', () => {
      const w = video.videoWidth; const h = video.videoHeight; if (!w) return;
      shot = square(video, w, h);
      const im = new Image(); im.onload = () => { canvas.width = SIZE; canvas.height = SIZE; canvas.getContext('2d').drawImage(im, 0, 0); live(false); msg.textContent = 'Happy with it?'; }; im.src = shot;
    });
    btn('retake').addEventListener('click', () => { live(true); msg.textContent = 'Line up the face in the middle, then take the photo.'; });
    btn('use').addEventListener('click', () => { stop(); dlg.close(); if (shot) save(shot); });
    btn('close').addEventListener('click', () => { stop(); dlg.close(); });
    dlg.addEventListener('close', stop);
  });

  // ----- Admin: upload a backup to restore
  $$('form[data-restore]').forEach((f) => {
    const out = f.querySelector('[data-restore-status]');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = f.querySelector('input[type=file]').files[0];
      if (!file) return;
      if (!window.confirm(`Replace ALL data here with ${file.name}? This can’t be undone from this screen.`)) return;
      const btn = f.querySelector('button'); btn.disabled = true;
      out.className = 'hint'; out.textContent = `Uploading ${(file.size / 1048576).toFixed(1)} MB and restoring… keep this page open.`;
      try {
        const res = await fetch('/admin/restore', { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF': document.querySelector('meta[name=csrf]').content } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { out.className = 'err-text'; out.textContent = data.error || 'The restore didn’t work. Nothing was changed.'; btn.disabled = false; return; }
        out.className = 'ok-text'; out.textContent = 'Restored. Sign in again with the logins from your backup…';
        setTimeout(() => { location.href = data.redirect || '/login'; }, 2500);
      } catch { out.className = 'err-text'; out.textContent = 'Couldn’t reach the server. Check your connection and try again.'; btn.disabled = false; }
    });
  });

  // ----- Owner: suggest a venue address from its name
  $$('[data-slug-from]').forEach((nameIn) => {
    const slugIn = nameIn.form.querySelector('[data-slug]');
    if (!slugIn) return;
    let touched = false;
    slugIn.addEventListener('input', () => { touched = true; });
    nameIn.addEventListener('input', () => {
      if (touched) return;
      slugIn.value = nameIn.value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    });
  });

  // ----- Collapse / expand the sidebar (remembered on this device)
  $$('[data-side-toggle]').forEach((btn) => {
    const root = document.documentElement;
    const sync = () => {
      const c = root.classList.contains('side-collapsed');
      btn.setAttribute('aria-expanded', c ? 'false' : 'true');
      const t = c ? 'Expand the menu' : 'Collapse the menu';
      btn.setAttribute('aria-label', t); btn.title = t;
    };
    sync();
    btn.addEventListener('click', () => {
      root.classList.toggle('side-collapsed');
      try { localStorage.setItem('emp-side', root.classList.contains('side-collapsed') ? 'collapsed' : 'open'); } catch { /* private window */ }
      sync();
    });
  });

  // ----- Phone numbers: (805) 555-0142 as you type (international numbers starting with + are left alone)
  const fmtPhone = (v, partial) => {
    const s = String(v || '');
    if (s.trim().startsWith('+') && !s.trim().startsWith('+1')) return s;
    const m = /^(.*?)(\s*(?:ext\.?|extension|x|#)\s*\d*)?$/i.exec(s);
    let d = m[1].replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (d.length > 10) return s;
    const ext = m[2] ? ` ext. ${m[2].replace(/\D/g, '')}` : '';
    if (!partial && d.length !== 10) return s;
    if (d.length === 0) return ext ? s : '';
    if (d.length < 4) return `(${d}` + (d.length === 3 && partial ? ') ' : '');
    if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}${ext}`;
  };
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'tel') return;
    if (e.inputType && e.inputType.startsWith('delete')) return; // let backspace work naturally
    if (el.selectionStart !== el.value.length) return; // only when typing at the end
    if (/[a-z]/i.test(el.value)) return; // typing an extension: tidy it up on leaving the box
    const f = fmtPhone(el.value, true);
    if (f !== el.value) el.value = f;
  });
  document.addEventListener('blur', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.type === 'tel' && el.value) el.value = fmtPhone(el.value, false);
  }, true);

  // ----- Print buttons
  document.addEventListener('click', (e) => { if (e.target.closest('[data-print]')) window.print(); });

  // ----- Phone app: install on the home screen, quantity buttons
  if (document.body.classList.contains('m') || document.body.classList.contains('login')) {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const card = $('[data-install]');
  let hidden = false; try { hidden = localStorage.getItem('emp-install-hide') === '1'; } catch (e) { /* private mode */ }
  if (card && !standalone && !hidden) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let deferred = null;
    if (ios) { card.hidden = false; $('[data-install-ios]', card).hidden = false; }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferred = e;
      card.hidden = false; $('[data-install-other]', card).hidden = true; $('[data-install-go]', card).hidden = false;
    });
    // Browsers without an install prompt (e.g. Firefox, Samsung Internet): show the menu steps after a moment
    setTimeout(() => { if (!deferred && !ios && /android/i.test(navigator.userAgent)) { card.hidden = false; $('[data-install-other]', card).hidden = false; } }, 2500);
    $('[data-install-go]', card).addEventListener('click', async () => {
      if (!deferred) return; deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* ignore */ }
      deferred = null; card.hidden = true;
    });
    $('[data-install-hide]', card).addEventListener('click', () => { card.hidden = true; try { localStorage.setItem('emp-install-hide', '1'); } catch (e) { /* ignore */ } });
  }
  window.addEventListener('appinstalled', () => { if (card) card.hidden = true; });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    const inp = b.parentElement.querySelector('input'); if (!inp) return;
    if (inp.disabled) return;
    const max = Number(inp.max) || 999; const min = inp.min !== '' ? Number(inp.min) : 1;
    inp.value = String(Math.max(min, Math.min(max, (parseInt(inp.value, 10) || 0) + Number(b.dataset.step))));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ----- Assigned to: several staff (summary lists who's ticked; closes when you click away)
  document.addEventListener('change', (e) => {
    const box = e.target.closest('.staff-pick'); if (!box) return;
    const names = $$('input:checked', box).map((i) => i.parentElement.textContent.trim());
    $('summary', box).textContent = names.length ? names.join(', ') : (box.dataset.none || 'No one');
  });
  document.addEventListener('click', (e) => { $$('.staff-pick[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });

  // ----- Phone booking: offsite address only when Where is Offsite
  $$('[data-offsite-box]').forEach((box) => {
    const sel = box.closest('form').querySelector('select[name=location_id]'); if (!sel) return;
    const apply = () => { box.hidden = sel.value !== 'offsite'; };
    sel.addEventListener('change', apply); apply();
  });

  // ----- A file sent as text (spreadsheet import): read it in the browser into hidden fields
  $$('[data-file-form]').forEach((f) => {
    const pick = f.querySelector('[data-file-pick]');
    f.addEventListener('submit', (e) => {
      if (f.file_data.value || !pick.files.length) return;
      e.preventDefault();
      const file = pick.files[0];
      if (file.size > 1400000) { alert('That file is too large. Split it into smaller spreadsheets (up to about 1 MB each).'); return; }
      const rd = new FileReader();
      rd.onload = () => { f.file_data.value = rd.result; f.file_name.value = file.name; pick.removeAttribute('required'); pick.disabled = true; f.submit(); };
      rd.readAsDataURL(file);
    });
  });
  // ----- Item options: a new option takes the product's price, cost, location and reorder level
  $$('[data-opt-autofill]').forEach((rows) => {
    const form = rows.closest('form');
    const from = { 'opt_price[]': 'retail', 'opt_cost[]': 'cost', 'opt_location[]': 'location', 'opt_reorder[]': 'reorder_level' };
    const fill = (row) => {
      for (const [k, src] of Object.entries(from)) {
        const to = row.querySelector(`[name="${k}"]`); const v = form.querySelector(`[name="${src}"]`);
        if (to && v && !to.value && v.value) to.value = v.value;
      }
    };
    // When an option gets a name (typed, or a row added), fill what's still empty
    rows.addEventListener('input', (e) => { if (e.target.name === 'opt_name[]' && e.target.value.trim()) fill(e.target.closest('[data-row]')); });
  });
  // ----- Coupon codes: check a code before paying
  $$('[data-coupon]').forEach((box) => {
    const inp = box.querySelector('input'); const msg = box.querySelector('[data-coupon-msg]');
    const go = async () => {
      const code = inp.value.trim(); if (!code) { msg.textContent = ''; return; }
      try {
        const r = await fetch(`${box.dataset.coupon}&code=${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
        const j = await r.json();
        msg.textContent = j.ok ? `✓ ${j.message} It comes off at payment.` : j.message;
        msg.className = `hint ${j.ok ? 'ok-text' : 'err-text'}`;
      } catch { msg.textContent = 'Couldn’t check the code. It will be checked when you continue.'; }
    };
    box.querySelector('[data-coupon-check]').addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  });
  // ----- Seating chart editor: show the fields for chairs, tables or rounds
  document.querySelectorAll('[data-sr-row]').forEach((row) => {
    const sel = row.querySelector('[data-sr-kind]'); if (!sel) return;
    const apply = () => row.querySelectorAll('.sr-k').forEach((c) => { c.hidden = c.dataset.k !== sel.value; });
    sel.addEventListener('change', apply); apply();
  });
  // ----- Picking seats: running count and total
  document.querySelectorAll('[data-seat-form]').forEach((f) => {
    const out = f.querySelector('[data-seat-total]'); const btn = f.querySelector('[data-seat-go]');
    const upd = () => {
      const picked = [...f.querySelectorAll('input[name="seats[]"]:checked')];
      const cents = picked.reduce((a, x) => a + Number(x.dataset.price || 0), 0);
      if (out) out.textContent = picked.length ? `${picked.length} seat${picked.length === 1 ? '' : 's'} · $${(cents / 100).toFixed(2)}` : 'No seats chosen yet';
      if (btn) btn.disabled = !picked.length;
    };
    f.addEventListener('change', upd); upd();
  });

  // ----- A checkbox that is really a link (e.g. Sales › Show voided transactions)
  document.querySelectorAll('input[data-nav]').forEach((cb) => cb.addEventListener('change', () => { location.href = cb.dataset.nav; }));

  // ----- Taking payment on an order: picking "Card" shows the ways to take a card (QR code, type it in, card on file)
  // ----- Paying a booking's bill: ticking invoices fills in the amount (nothing ticked: the whole balance)
  document.addEventListener('change', (e) => {
    if (!e.target.matches('[data-pay-line]')) return;
    const f = document.getElementById('pay-form'); if (!f) return;
    const ticked = [...document.querySelectorAll('[data-pay-line]:checked')];
    const cents = ticked.length ? ticked.reduce((n, c) => n + Number(c.dataset.left || 0), 0) : Number(f.dataset.balance || 0);
    const amt = f.querySelector('input[name=amount]'); if (amt) amt.value = (cents / 100).toFixed(2);
    e.target.closest('tr').classList.toggle('picked', e.target.checked);
  });

  document.querySelectorAll('[data-pay-form]').forEach((f) => {
    const ways = f.querySelector('[data-card-ways]'); if (!ways) return;
    const apply = () => {
      const card = (f.querySelector('input[name=method]:checked') || {}).value === 'card';
      ways.hidden = !card;
      f.querySelectorAll('[data-card-label]').forEach((x) => { x.hidden = !card; });
      f.querySelectorAll('[data-other-label]').forEach((x) => { x.hidden = card; });
    };
    f.addEventListener('change', apply); apply();
  });

  // ----- Self check-in kiosk: after a while with nobody touching it, go back to the start screen
  const kb = document.body;
  if (kb.classList.contains('kiosk') && Number(kb.dataset.kioskIdle) > 0) {
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { location.href = kb.dataset.kioskHome || '/kiosk'; }, Number(kb.dataset.kioskIdle) * 1000); };
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((e) => document.addEventListener(e, reset, { passive: true }));
    reset();
  }

  // ----- Admin side menu: folded away on small screens until it's wanted
  document.querySelectorAll('[data-admin-nav]').forEach((d) => { if (window.matchMedia('(max-width: 900px)').matches) d.open = false; });

  // ----- Folded lists (Dashboard subtasks): each one stays open or closed the way you left it
  document.querySelectorAll('details[data-remember]').forEach((d) => {
    const key = `open:${d.dataset.remember}`;
    try { if (localStorage.getItem(key) === '1') d.open = true; } catch (e) { /* storage off */ }
    d.addEventListener('toggle', () => { try { if (d.open) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (e) { /* storage off */ } });
  });

  // ----- Grouped task lists (Tasks page, phone): subtasks fold under their main task; open/closed is remembered
  const foldSet = (btn, open, save) => {
    const key = btn.dataset.fold;
    document.querySelectorAll(`[data-fold-of="${key}"]`).forEach((row) => { row.hidden = !open; });
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (save) { try { if (open) localStorage.setItem(`open:${key}`, '1'); else localStorage.removeItem(`open:${key}`); } catch (e) { /* storage off */ } }
  };
  document.querySelectorAll('button[data-fold]').forEach((btn) => {
    let open = false; try { open = localStorage.getItem(`open:${btn.dataset.fold}`) === '1'; } catch (e) { /* storage off */ }
    foldSet(btn, open, false);
    btn.addEventListener('click', () => foldSet(btn, btn.getAttribute('aria-expanded') !== 'true', true));
  });
  document.querySelectorAll('[data-fold-all]').forEach((b) => b.addEventListener('click', () => {
    const open = b.dataset.foldAll === 'open';
    document.querySelectorAll('button[data-fold]').forEach((btn) => foldSet(btn, open, true));
  }));

  // ----- Booking details: picking an organization as the client fills in its contact person (only empty boxes)
  document.addEventListener('picked', (e) => {
    const it = e.detail; const form = e.target.closest('form');
    if (!it || !it.isOrg || !it.contact || !form || !form.querySelector('[name=contact_name]')) return;
    const fill = (n, v) => { const el = form.querySelector(`[name=${n}]`); if (el && !el.value && v) el.value = v; };
    fill('contact_name', it.contact.name); fill('contact_phone', it.contact.phone); fill('contact_email', it.contact.email);
  });

  // ----- Camera scanner: reads QR codes (tickets, pass numbers) with a phone or tablet camera.
  // Uses the browser's built-in barcode reader when there is one, otherwise a small QR reader loaded when first needed.
  // The reader ships with the app (no outside download), so it works on any phone and on venue wifi.
  const QR_SRC = (document.querySelector('script[src*="/static/app.js"]') || {}).src || '/static/app.js';
  let qrLoad = null;
  const loadReader = () => qrLoad || (qrLoad = new Promise((ok, fail) => {
    if (window.EMPQR) return ok(window.EMPQR);
    const sc = document.createElement('script'); sc.src = QR_SRC.replace('app.js', 'qrscan.js'); sc.async = true;
    sc.onload = () => (window.EMPQR ? ok(window.EMPQR) : fail(new Error('The QR reader did not start.')));
    sc.onerror = () => { qrLoad = null; fail(new Error('Could not load the QR reader. Check the connection and try again.')); };
    document.head.appendChild(sc);
  }));
  let audio = null;
  const beep = (good) => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(); const g = audio.createGain();
      o.frequency.value = good ? 1046 : 220; o.type = good ? 'sine' : 'square';
      g.gain.setValueAtTime(0.18, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (good ? 0.18 : 0.45));
      o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + (good ? 0.2 : 0.5));
    } catch (e) { /* no sound */ }
    try { navigator.vibrate && navigator.vibrate(good ? 60 : [120, 60, 120]); } catch (e) { /* ignore */ }
  };
  async function openScanner(btn) {
    const mode = btn.dataset.scan; // 'door' (check in each ticket) or 'go' (open the code in a page)
    const ov = document.createElement('div');
    ov.className = 'scanner'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Camera scanner');
    ov.innerHTML = `<div class="scan-top"><b></b><span class="scan-count"></span><button type="button" class="scan-flip" aria-label="Switch camera" title="Switch camera">⟲</button><button type="button" class="scan-close" aria-label="Close scanner">×</button></div>
      <div class="scan-view"><video playsinline muted autoplay></video><div class="scan-frame"></div><p class="scan-hint">Point the camera at the QR code</p></div>
      <div class="scan-result" hidden><b class="sr-title"></b><span class="sr-detail"></span><div class="sr-actions"></div></div>
      <form class="scan-manual"><input name="code" placeholder="Or type the code" autocomplete="off" autocapitalize="characters"><button class="btn">Enter</button></form>`;
    $('.scan-top b', ov).textContent = btn.dataset.scanTitle || 'Scan';
    document.body.appendChild(ov); document.body.classList.add('scanning');
    const video = $('video', ov); const res = $('.scan-result', ov); const canvas = document.createElement('canvas'); const c2d = canvas.getContext('2d', { willReadFrequently: true });
    let stream = null; let stopped = false; let busy = false; let last = ''; let lastAt = 0; let timer = null; let detector = null; let reader = null; let frames = 0;
    const close = () => { stopped = true; clearTimeout(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); ov.remove(); document.body.classList.remove('scanning'); if (mode === 'door' && btn.dataset.changed) location.reload(); };
    $('.scan-close', ov).addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    const show = (kind, title, detail, actions = []) => {
      res.hidden = false; res.className = `scan-result ${kind}`;
      $('.sr-title', res).textContent = title; $('.sr-detail', res).textContent = detail || '';
      const act = $('.sr-actions', res); act.innerHTML = '';
      actions.forEach(([label, fn, primary]) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${primary ? 'primary' : ''}`; b.textContent = label; b.addEventListener('click', fn); act.appendChild(b); });
    };
    const handle = async (code, force) => {
      if (busy) return; busy = true;
      if (mode === 'go') { beep(true); show('ok', 'Found', code); stopped = true; location.href = btn.dataset.scanGo + encodeURIComponent(code); return; }
      try {
        const body = new URLSearchParams({ _csrf: $('meta[name=csrf]').content, code, s: btn.dataset.scanS || '' });
        if (force) body.set('force', '1');
        const r = await fetch(btn.dataset.scanUrl, { method: 'POST', body, headers: { Accept: 'application/json' } });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        if (j.counts) $('.scan-count', ov).textContent = `${j.counts.here || 0} of ${j.counts.sold} in`;
        if (j.result === 'ok') btn.dataset.changed = '1';
        beep(j.result === 'ok');
        const resume = () => { res.hidden = true; busy = false; };
        if (j.result === 'warn' && j.canForce) show('warn', j.title, j.detail, [['Check in anyway', () => { busy = false; handle(code, true); }, true], ['Skip', resume]]);
        else { show(j.result, j.title, j.detail); timer = setTimeout(resume, j.result === 'ok' ? 1400 : 2600); }
      } catch (e) { beep(false); show('bad', 'Couldn’t check that ticket', e.message || 'Try again.'); timer = setTimeout(() => { res.hidden = true; busy = false; }, 2600); }
    };
    $('.scan-manual', ov).addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.code.value.trim(); if (v) { e.target.code.value = ''; busy = false; handle(v); } });
    // Start the camera: the back camera on phones, or the front one for a kiosk tablet facing the customer (data-scan-facing="user").
    // The ⟲ button switches between them, and the choice is remembered on this device.
    let facing = btn.dataset.scanFacing || 'environment';
    try { facing = localStorage.getItem(`scanFacing:${mode}`) || facing; } catch (e) { /* private mode */ }
    const startCam = async () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser can’t use the camera here. The site must be opened over https.');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream; ov.classList.toggle('front', facing === 'user'); await video.play().catch(() => {});
    };
    $('.scan-flip', ov).addEventListener('click', async () => {
      facing = facing === 'user' ? 'environment' : 'user';
      try { localStorage.setItem(`scanFacing:${mode}`, facing); } catch (e) { /* ignore */ }
      try { await startCam(); } catch (e) { /* keep the old one */ }
    });
    try {
      await startCam();
      if (stopped) return;
    } catch (e) {
      $('.scan-hint', ov).textContent = e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or type the code below.' : (e.message || 'The camera couldn’t start. Type the code below instead.');
      ov.classList.add('no-cam'); return;
    }
    const hint = $('.scan-hint', ov);
    try { reader = await loadReader(); } catch (e) { hint.textContent = e.message; }
    try {
      if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) { detector = null; }
    if (reader || detector) hint.textContent = 'Hold the QR code inside the square, about 6 inches away';
    // Each pass reads either the whole picture (scaled down) or the middle of it at full detail, so small codes still read.
    const readFrame = () => {
      const vw = video.videoWidth; const vh = video.videoHeight; if (!vw || !vh) return null;
      const crop = frames % 2 === 1; let sx = 0; let sy = 0; let sw = vw; let sh = vh;
      if (crop) { const side = Math.min(vw, vh) * 0.7; sx = (vw - side) / 2; sy = (vh - side) / 2; sw = side; sh = side; }
      const scale = Math.min(1, 720 / Math.max(sw, sh)); const w = Math.round(sw * scale); const h = Math.round(sh * scale);
      canvas.width = w; canvas.height = h; c2d.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      return reader.decode(c2d.getImageData(0, 0, w, h).data, w, h);
    };
    const tick = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2) {
        frames++;
        let code = null;
        try { if (detector) { const found = await detector.detect(video); if (found.length) code = found[0].rawValue; } } catch (e) { detector = null; }
        try { if (!code && reader) code = readFrame(); } catch (e) { /* keep trying */ }
        if (code) {
          code = String(code).trim();
          const now = Date.now();
          if (code !== last || now - lastAt > 4000) { last = code; lastAt = now; handle(code); }
        }
      }
      setTimeout(tick, 90);
    };
    tick();
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-scan]'); if (b) { e.preventDefault(); openScanner(b); } });

  // ----- Guest list at the door: tap the check to let someone in; Undo puts the ticket back.
  let toastT = null;
  const toast = (msg, undo) => {
    let t = $('.gl-toast');
    if (!t) { t = document.createElement('div'); t.className = 'gl-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = ''; const sp = document.createElement('span'); sp.textContent = msg; t.appendChild(sp);
    if (undo) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Undo'; b.addEventListener('click', () => { t.hidden = true; undo(); }); t.appendChild(b); }
    t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3000);
  };
  const glFilter = (box) => {
    const find = $('[data-gl-find]', box); const words = (find ? find.value : '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const show = box.dataset.show || 'all'; let any = false;
    box.querySelectorAll('.gl-group').forEach((g) => {
      let vis = 0;
      g.querySelectorAll('[data-gl-row]').forEach((li) => {
        const inn = li.classList.contains('in');
        const ok = words.every((w) => li.dataset.search.includes(w)) && (show === 'all' || (show === 'in') === inn);
        li.hidden = !ok; if (ok) vis++;
      });
      g.hidden = !vis; if (vis) any = true;
      const all = $('[data-gl-all]', g); if (all) all.hidden = !g.querySelector('[data-gl-row]:not(.in)');
    });
    const none = $('.gl-none', box); if (none) none.hidden = any;
  };
  const glCounts = (box, c) => {
    if (!c) return;
    box.querySelectorAll('[data-gl-here]').forEach((x) => { x.textContent = c.here; });
    box.querySelectorAll('[data-gl-sold]').forEach((x) => { x.textContent = c.sold; });
    box.querySelectorAll('[data-gl-out]').forEach((x) => { x.textContent = c.sold - c.here; });
  };
  async function glSend(f, quiet) {
    const li = f.closest('[data-gl-row]'); const box = f.closest('[data-guestlist]');
    if (li.classList.contains('busy')) return; li.classList.add('busy');
    const undoing = f.classList.contains('gl-undo'); const name = li.dataset.name || $('.gl-who b', li).textContent;
    try {
      const r = await fetch(f.action, { method: 'POST', body: new URLSearchParams(new FormData(f)), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(r.status === 403 ? 'Your session expired. Reload the page.' : 'Couldn’t save. Try again.');
      const j = await r.json();
      li.classList.toggle('in', !!j.in); $('.gl-when', li).textContent = j.in && j.at ? ` · in at ${j.at}` : '';
      glCounts(box, j.counts);
      if (!j.ok) { beep(false); toast(j.message); }
      else if (!quiet && !undoing && j.in) { beep(true); toast(`${name} checked in`, () => glSend($('.gl-undo', li))); }
      else if (!quiet && undoing) toast(`Undone: ${name} is not checked in`);
    } catch (e) { beep(false); toast(e.message || 'Couldn’t save. Check the connection.'); }
    finally { li.classList.remove('busy'); glFilter(box); }
  }
  document.addEventListener('submit', (e) => { const f = e.target.closest('form[data-gl]'); if (!f || !window.fetch) return; e.preventDefault(); glSend(f); });
  document.addEventListener('input', (e) => { if (e.target.matches('[data-gl-find]')) glFilter(e.target.closest('[data-guestlist]')); });
  document.addEventListener('click', async (e) => {
    const sh = e.target.closest('[data-gl-show]');
    if (sh) { const box = sh.closest('[data-guestlist]'); box.dataset.show = sh.dataset.glShow; box.querySelectorAll('[data-gl-show]').forEach((b) => b.classList.toggle('on', b === sh)); glFilter(box); return; }
    const all = e.target.closest('[data-gl-all]');
    if (all) {
      const g = all.closest('.gl-group'); const rows = [...g.querySelectorAll('[data-gl-row]:not(.in)')];
      for (const li of rows) await glSend($('.gl-do', li), true);
      beep(true); toast(`${rows.length} checked in`);
    }
  });
  document.querySelectorAll('[data-guestlist]').forEach(glFilter);

  // ----- Receipt logo: shrink to receipt-printer dots (about 203 per inch) and turn it into pure black and white
  // (Floyd–Steinberg dithering), which is what a thermal printer prints anyway, so it looks crisp.
  const logoFile = $('[data-logo-file]');
  if (logoFile) {
    logoFile.addEventListener('change', () => {
      const f = logoFile.files && logoFile.files[0]; if (!f) return;
      const img = new Image(); const url = URL.createObjectURL(f);
      img.onload = () => {
        const maxW = 460; const maxH = 208;
        const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight) || 1;
        const w = Math.max(1, Math.round(img.naturalWidth * k)); const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h); const px = d.data; const lum = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const L = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
          lum[i] = Math.max(0, Math.min(255, (L - 35) * 255 / (215 - 35))); // pale backgrounds become white, dark lines stay solid
        }
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = y * w + x; const old = lum[i]; const nv = old < 128 ? 0 : 255; const err = old - nv; lum[i] = nv;
            if (x + 1 < w) lum[i + 1] += err * 7 / 16;
            if (y + 1 < h) { if (x > 0) lum[i + w - 1] += err * 3 / 16; lum[i + w] += err * 5 / 16; if (x + 1 < w) lum[i + w + 1] += err / 16; }
          }
        }
        for (let i = 0; i < w * h; i++) { const v = lum[i] < 128 ? 0 : 255; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
        g.putImageData(d, 0, 0);
        const data = c.toDataURL('image/png');
        $('[data-logo-data]').value = data;
        const box = $('[data-logo-preview]'); box.innerHTML = ''; const im = document.createElement('img'); im.src = data; im.alt = 'New logo (not saved yet)'; box.appendChild(im);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { alert('That image couldn’t be opened. Try a PNG or JPG.'); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }

  // ----- POS card payment by QR code: wait for Stripe, then show the result
  const qrBox = $('[data-qrpay]');
  if (qrBox && window.fetch) {
    let tries = 0;
    const poll = async () => {
      tries++;
      try {
        const r = await fetch(qrBox.dataset.qrpay, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const j = await r.json();
        if (j.status && j.status !== 'pending') { beep(j.status === 'paid'); setTimeout(() => location.reload(), 350); return; }
      } catch (e) { /* keep waiting */ }
      setTimeout(poll, tries < 150 ? 2000 : 5000);
    };
    setTimeout(poll, 1500);
  }
})();
