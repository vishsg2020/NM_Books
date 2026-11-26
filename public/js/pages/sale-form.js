// The common sales entry form for Tele-sales, Online and Onsite.
import { api, get, esc, html, raw, inr, drawer, onSubmit, options, toast, state, myChannel, todayLocal, uid, debounce, fmtDate, STATES, districtField, wide, canEdit, canView } from '../core.js';

// The form has four shapes. Tele-sales and Online are orders; Exhibition is a sale at a book fair (saved as an Onsite sale);
// Visit is a visit to a school or bookstore, opened from the Visits page.
const lastFair = () => { try { return localStorage.getItem('nm-last-exhibition') || ''; } catch { return ''; } };
const keepFair = v => { try { localStorage.setItem('nm-last-exhibition', v); } catch { /* not kept */ } };


function channelFields(ch, c, locations = []) {
  const phone = (label, required) => `<div class="field"><label for="s-phone">${label}${required ? ' *' : ''}</label><input id="s-phone" name="customer_phone" type="tel" inputmode="tel" maxlength="30" autocomplete="off" value="${esc(c?.phone)}"></div>`;
  if (ch === 'Tele-sales') return `
    <div class="grid2">${phone('Customer contact number', true)}
      <div class="field"><label for="s-name">Customer name *</label><input id="s-name" name="customer_name" maxlength="150" value="${esc(c?.name)}"></div></div>
    <div id="cust-note"></div>
    <div class="field"><label for="s-addr">Customer address *</label><textarea id="s-addr" name="address" maxlength="500">${esc(c?.address)}</textarea></div>
    <div class="grid2">
      <div class="field"><label for="s-state">State</label><select id="s-state" name="state">${options(STATES, c?.state || 'Kerala')}</select></div>
      <div class="field" id="s-dist">${districtField(c?.state || 'Kerala', c?.location)}</div>
    </div>
    <div class="grid2"><div class="field"><label for="s-pin">PIN</label><input id="s-pin" name="pin" inputmode="numeric" maxlength="7" autocomplete="off" value="${esc(c?.pin)}"><div class="hint">Needed for delivery. Without it the customer goes to Update needed.</div></div></div>`;
  if (ch === 'Online') return `
    <div class="grid2">
      <div class="field"><label for="s-plat">Platform *</label><select id="s-plat" name="platform">${options(['Website', 'Amazon', 'Flipkart'], '', 'Select')}</select></div>
      <div class="field"><label for="s-oid">Order ID *</label><input id="s-oid" name="platform_order_id" maxlength="80" autocomplete="off"></div>
    </div>
    <div class="grid2">
      <div class="field"><label for="s-name">Customer name *</label><input id="s-name" name="customer_name" maxlength="150" value="${esc(c?.name)}"></div>
      ${phone('Customer contact number', false).replace('</div>', '<div class="hint">If available. Links the order to the customer.</div></div>')}
    </div>
    <div id="cust-note"></div>
    <div class="field"><label for="s-addr">Customer address</label><textarea id="s-addr" name="address" maxlength="500">${esc(c?.address)}</textarea><div class="hint">Delivery address, where available.</div></div>`;
  if (ch === 'Exhibition') return `
    <input type="hidden" name="location_type" value="Exhibition">
    <div class="field"><label for="s-ln">Exhibition name *</label><input id="s-ln" name="location_name" maxlength="150" value="${esc(lastFair())}" placeholder="For example: Kochi Book Fair 2026"></div>
    <div class="grid2">
      <div class="field"><label for="s-buyer">Buyer name</label><input id="s-buyer" name="customer_name" maxlength="150"></div>
      ${phone('Buyer contact number', false).replace('</div>', '<div class="hint">Optional. With a name and number, the buyer is saved as a customer.</div></div>')}
    </div>`;
  return `
    <div class="field"><label for="s-pick">School or bookstore</label><select id="s-pick" name="location_id">${options(locations.map(l => [l.id, `${l.name} · ${l.type}`]), c?.location_id, 'New school or bookstore')}</select>
      <div class="hint">Pick a place you have visited before, or leave this and type a new one below.</div></div>
    <div id="loc-note"></div>
    <div class="grid2">
      <div class="field"><label for="s-lt">Location type *</label><select id="s-lt" name="location_type">${options(state.lists.places, '', 'Select')}</select></div>
      <div class="field"><label for="s-ln">Location name *</label><input id="s-ln" name="location_name" maxlength="150" value="${esc(c?.name)}"></div>
    </div>
    <div class="field"><label for="s-addr">Address</label><textarea id="s-addr" name="address" maxlength="500">${esc(c?.address)}</textarea></div>
    <div class="grid2">
      <div class="field"><label for="s-cp">Contact person</label><input id="s-cp" name="contact_person" maxlength="100"></div>
      ${phone('Customer contact number', false)}
    </div>
    <div class="grid2">
      <div class="field"><label for="s-nv">Next visit date</label><input id="s-nv" name="next_visit_date" type="date" min="${todayLocal()}"></div>
      <div class="field"><label for="s-out">If no books were sold</label><select id="s-out" name="outcome">${options(['No sale', 'Payment collected'], 'No sale')}</select></div>
    </div>
    <label class="check"><input type="checkbox" name="handed_over" id="s-ho" checked> Books handed over now</label>
    <div class="hint" id="s-ho-hint"></div>`;
}

/** Opens the sale form. `customer` pre-fills the customer block; `after(sale)` runs once the sale is saved. */
export async function saleForm({ customer = null, after = () => {}, callId = null, startChannel = null } = {}) {
  const fixed = myChannel();
  const books = (await get('/api/books?active=1')).sort((a, b) => a.name.localeCompare(b.name));
  if (!books.length) { toast(canEdit('books') ? 'Add a book in the Book Master first.' : 'There are no active books yet. Ask the Admin to add them.', 'error'); return; }
  const requestKey = uid(); // the same key on a repeated submit, so a double click saves one sale
  // `channel` is the shape of the form; an Exhibition or a Visit is saved under the Onsite channel.
  const visitMode = startChannel === 'Onsite';
  let channel = callId ? 'Tele-sales' : visitMode ? 'Onsite' : fixed === 'Onsite' ? 'Exhibition' : fixed || startChannel || 'Tele-sales';
  const charges = state.charges || {};
  const locations = canView('visits') ? await get('/api/locations') : [];
  let lineSeq = 0;

  drawer({
    wide: true,
    title: 'Record a sale',
    body: html`<form id="s-form" novalidate>
      ${raw(fixed || visitMode ? '' : `<div class="seg" role="radiogroup" aria-label="Sales channel">${['Tele-sales', 'Online', 'Exhibition'].map(c => `<label><input type="radio" name="channel" value="${c}" ${c === channel ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div>`)}
      <div class="grid2">
        <div class="field"><label for="s-date" id="s-date-l">Sales date</label><input id="s-date" name="sale_date" type="date" max="${todayLocal()}" value="${todayLocal()}"></div>
        ${raw(wide() ? `<div class="field"><label for="s-sp">Sales person</label><select id="s-sp" name="salesperson_id">${options(state.people.filter(p => p.active).map(p => [p.id, p.name]), state.me.id)}</select></div>` : '')}
      </div>
      <fieldset><legend id="s-cust-legend">Customer</legend><div id="s-channel"></div></fieldset>
      <fieldset><legend>Books</legend><div class="hint" id="s-books-hint"></div>
        <table class="lines"><thead><tr><th scope="col">Book</th><th scope="col">Quantity</th><th scope="col">Unit price (₹)</th><th scope="col" class="c-total">Total</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody id="s-lines"></tbody></table>
        <div class="btn-row"><button class="btn small" type="button" id="s-add-line">Add another book</button><span class="muted small" id="s-price-hint"></span></div>
      </fieldset>
      <fieldset><legend>Payment</legend>
        <div class="grid3">
          <div class="field"><label for="s-pm">Payment method</label><select id="s-pm" name="payment_method"></select></div>
          <div class="field"><label for="s-recv" id="s-recv-l">Amount received</label><div class="money"><span>₹</span><input id="s-recv" name="amount_received" type="number" inputmode="numeric" min="0" step="1" value="0"></div></div>
          <div class="field" id="s-due-f"><label for="s-due">Due date</label><input id="s-due" name="due_date" type="date"><div class="hint" id="s-due-hint">For any balance.</div></div>
        </div>
        <div id="s-charges" class="hidden">
          ${raw(charges.delivery_charge ? `<label class="check"><input type="checkbox" id="s-dc"> Add delivery charge of ${esc(inr(charges.delivery_charge))}</label><div class="hint">${charges.free_delivery_above ? `Ticked by itself when the books come to ${esc(inr(charges.free_delivery_above))} or less; free above that.` : ''}</div>` : '')}
          ${raw(charges.cod_charge ? `<label class="check"><input type="checkbox" id="s-cc"> Add COD charge of ${esc(inr(charges.cod_charge))}</label><div class="hint" id="s-cc-hint"></div>` : '')}
        </div>
        <dl class="totals"><dt class="charge-row">Books</dt><dd class="charge-row" id="s-books-total">₹0</dd><dt class="charge-row">Delivery charge</dt><dd class="charge-row" id="s-dc-total">₹0</dd><dt class="charge-row">COD charge</dt><dd class="charge-row" id="s-cc-total">₹0</dd>
          <dt>Total amount</dt><dd class="big" id="s-total">₹0</dd><dt>Balance amount</dt><dd id="s-balance">₹0</dd><dt>Payment status</dt><dd id="s-pstatus">Unpaid</dd></dl>
      </fieldset>
      <div class="field"><label for="s-rem">Remarks</label><textarea id="s-rem" name="remarks" maxlength="1000"></textarea></div>
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="s-form">Save sale</button>`,
    onMount: (d, close) => {
      const form = d.querySelector('#s-form'); const lines = d.querySelector('#s-lines');
      const $ = sel => d.querySelector(sel);

      // ----- price by channel -----
      // A set in a discount group gets its channel's discount on the MRP (Settings → Discounts); everything else sells at MRP.
      // Flipkart uses the Amazon rate. Exhibition and visits sell at MRP.
      const priceKey = () => { if (channel === 'Tele-sales') return 'Tele-sales'; if (channel !== 'Online') return null; const pl = $('#s-plat')?.value; return pl === 'Website' ? 'Website' : pl ? 'Amazon' : null; };
      const priceFor = b => { const k = priceKey(); return (k && b.prices && b.prices[k] != null) ? b.prices[k] : b.price; };
      // When the channel or platform changes, re-price the lines whose price was not typed by hand.
      const reprice = () => {
        for (const r of lines.querySelectorAll('tr')) {
          const b = books.find(x => String(x.id) === r.querySelector('select').value); const inp = r.querySelector('[data-price]');
          if (b && inp.value === (inp.dataset.auto ?? '')) { inp.value = priceFor(b); inp.dataset.auto = inp.value; }
        }
        const k = priceKey();
        $('#s-price-hint').textContent = k ? `${k === 'Tele-sales' ? 'WhatsApp' : k === 'Amazon' ? 'Amazon / Flipkart' : 'Website'} discount applied to the sets; single books at MRP.` : 'All books and sets at MRP.';
        recalc();
      };

      // ----- book lines -----
      const rows = () => [...lines.querySelectorAll('tr')];
      const recalc = () => {
        let total = 0; const picked = rows().map(r => r.querySelector('select').value);
        for (const r of rows()) {
          const sel = r.querySelector('select'); const book = books.find(b => String(b.id) === sel.value);
          const qty = Number(r.querySelector('[data-qty]').value) || 0; const price = Number(r.querySelector('[data-price]').value) || 0;
          const line = qty * price; total += line;
          r.querySelector('.c-total').textContent = inr(line);
          const av = r.querySelector('.avail');
          av.textContent = book ? `${book.available} available` : ''; av.classList.toggle('short', !!book && qty > book.available);
          // A book can be on one line only: hide it in the other lines' lists.
          for (const o of sel.options) o.hidden = !!o.value && o.value !== sel.value && picked.includes(o.value);
        }
        const recv = Number($('#s-recv').value) || 0; const method = $('#s-pm').value;
        // Charges (tele-sales orders): the COD charge follows the payment method; both can be unticked.
        const cc = $('#s-cc'); const dc = $('#s-dc'); const withCharges = channel === 'Tele-sales';
        // Delivery: free when the books come to more than the Settings amount; until someone changes the tick box by hand, it follows the total.
        if (dc && !dc.dataset.manual) dc.checked = withCharges && total > 0 && !(charges.free_delivery_above && total > charges.free_delivery_above);
        if (cc) { const isCod = method === 'COD'; if (cc.dataset.method !== method) { cc.checked = withCharges && isCod; cc.dataset.method = method; } cc.disabled = !isCod; $('#s-cc-hint').textContent = isCod ? '' : 'Offered when the payment method is COD.'; }
        const delivery = withCharges && dc?.checked ? charges.delivery_charge : 0; const cod = withCharges && cc?.checked && !cc.disabled ? charges.cod_charge : 0;
        $('#s-books-total').textContent = inr(total); $('#s-dc-total').textContent = inr(delivery); $('#s-cc-total').textContent = inr(cod);
        for (const el of d.querySelectorAll('.charge-row')) el.classList.toggle('hidden', !(delivery || cod));
        form.dataset.delivery = delivery; form.dataset.cod = cod;
        total += delivery + cod;
        $('#s-total').textContent = inr(total);
        $('#s-balance').textContent = inr(Math.max(total - recv, 0)); $('#s-balance').classList.toggle('due', total - recv > 0);
        $('#s-pstatus').textContent = recv > total ? 'More than the total' : total > 0 && recv >= total ? 'Paid' : recv > 0 ? 'Partially Paid' : method === 'COD' ? 'COD' : 'Unpaid';
        $('#s-add-line').disabled = rows().length >= books.length;
      };
      const addLine = () => {
        const n = ++lineSeq; const tr = document.createElement('tr');
        tr.innerHTML = `<td class="c-book"><label class="sr-only" for="l-b${n}">Book</label><select id="l-b${n}">${options(books.map(b => [b.id, b.name + (b.kind === 'Pack' ? ' (set)' : '')]), '', 'Select book or set')}</select><span class="avail"></span></td>
          <td class="c-qty"><label class="sr-only" for="l-q${n}">Quantity</label><input id="l-q${n}" data-qty type="number" inputmode="numeric" min="1" step="1" value="1" placeholder="Qty"></td>
          <td class="c-price"><label class="sr-only" for="l-p${n}">Unit price</label><input id="l-p${n}" data-price type="number" inputmode="numeric" min="0" step="1" placeholder="Price"></td>
          <td class="c-total">₹0</td>
          <td class="c-x"><button class="btn small" type="button" data-remove aria-label="Remove this book">×</button></td>`;
        lines.append(tr);
        tr.querySelector('select').addEventListener('change', e => { const b = books.find(x => String(x.id) === e.target.value); const inp = tr.querySelector('[data-price]'); inp.value = b ? priceFor(b) : ''; inp.dataset.auto = inp.value; recalc(); });
        tr.querySelector('[data-remove]').addEventListener('click', () => { if (rows().length > 1) tr.remove(); else { tr.querySelector('select').value = ''; tr.querySelector('[data-price]').value = ''; } recalc(); });
        recalc(); return tr;
      };
      lines.addEventListener('input', recalc);
      $('#s-add-line').addEventListener('click', () => addLine().querySelector('select').focus());
      $('#s-recv').addEventListener('input', recalc);
      $('#s-pm').addEventListener('change', recalc);
      $('#s-dc')?.addEventListener('change', e => { e.target.dataset.manual = '1'; recalc(); }); $('#s-cc')?.addEventListener('change', recalc);

      // ----- existing customer lookup by contact number -----
      const lookup = debounce(async () => {
        const note = $('#cust-note'); const phone = $('#s-phone')?.value || '';
        if (!note) return;
        if (phone.replace(/\D/g, '').length < 7) { note.innerHTML = ''; return; }
        try {
          const { customer: c } = await get('/api/customers/lookup?phone=' + encodeURIComponent(phone));
          if ($('#s-phone')?.value !== phone) return; // the number changed while we were looking
          if (!c) { note.innerHTML = '<div class="notice info">New customer. A customer record is created when you save.</div>'; return; }
          note.innerHTML = `<div class="notice info">${c.kind === 'Lead' ? 'Lead' : 'Existing customer'} <strong>${esc(c.name)}</strong> (${esc(c.code)}) · ${c.total_orders} order${c.total_orders === 1 ? '' : 's'}${c.last_purchase_date ? ', last on ' + esc(fmtDate(c.last_purchase_date)) : ''}${c.outstanding_amount ? ` · <strong>${esc(inr(c.outstanding_amount))} outstanding</strong>` : ''}. This sale is added to their history.</div>`;
          const fill = (sel, v) => { const el = $(sel); if (el && !el.value && v) el.value = v; };
          fill(channel === 'Onsite' ? '#s-ln' : '#s-name', c.name === 'Name not known' ? '' : c.name); fill('#s-addr', c.address); fill('#s-pin', c.pin);
          const st = $('#s-state'); // an existing customer's State and District are filled in unless a district was already chosen
          if (st && !$('#s-loc')?.value && (c.state || c.location)) { if (c.state && STATES.includes(c.state)) st.value = c.state; $('#s-dist').innerHTML = districtField(st.value, c.location); }
        } catch { note.innerHTML = ''; }
      }, 350);

      // ----- onsite: pick a saved school or bookstore, or type a new place -----
      const wireLocation = () => {
        const pick = $('#s-pick'); const type = $('#s-lt');
        const apply = () => {
          const l = locations.find(x => String(x.id) === pick.value);
          const set = (sel, v) => { const el = $(sel); if (el) el.value = v || ''; };
          if (l) { set('#s-lt', l.type); set('#s-ln', l.name); set('#s-addr', l.address); set('#s-cp', l.contact_person); set('#s-phone', l.phone); }
          for (const sel of ['#s-lt', '#s-ln']) $(sel).disabled = !!l; // the saved place keeps its name and type
          $('#loc-note').innerHTML = l ? `<div class="notice info"><strong>${esc(l.name)}</strong> · ${l.visits} earlier visit${l.visits === 1 ? '' : 's'}${l.last_visit ? ', last on ' + esc(fmtDate(l.last_visit)) : ''}${l.outstanding ? ` · <strong>${esc(inr(l.outstanding))} outstanding</strong>. Open the order from Sales to record a payment.` : ''}</div>` : '';
        };
        pick.addEventListener('change', apply); type.addEventListener('change', apply); apply();
      };

      // ----- channel-specific block -----
      const setChannel = ch => {
        channel = ch;
        $('#s-channel').innerHTML = channelFields(ch, customer, locations);
        const onsite = ch === 'Onsite'; const fair = ch === 'Exhibition';
        d.querySelector('#drawer-title').textContent = onsite ? 'Record a visit' : 'Record a sale';
        d.querySelector('button[form=s-form]').textContent = onsite ? 'Save visit' : 'Save sale';
        $('#s-books-hint').textContent = onsite ? 'Leave this empty if nothing was sold on the visit.' : fair ? 'The books are handed over now: stock is deducted as soon as you save.' : '';
        $('#s-due-hint').textContent = onsite ? 'Needed when a balance remains.' : 'For any balance.';
        // A tele-sales order and an exhibition sale have no due date.
        $('#s-due-f').classList.toggle('hidden', ch === 'Tele-sales' || fair); if (ch === 'Tele-sales' || fair) $('#s-due').value = '';
        $('#s-charges').classList.toggle('hidden', ch !== 'Tele-sales');
        if (onsite) wireLocation();
        $('#s-cust-legend').textContent = onsite ? 'Visit location' : fair ? 'Exhibition' : 'Customer';
        $('#s-date-l').textContent = onsite ? 'Visit date' : 'Sales date';
        $('#s-recv-l').textContent = onsite ? 'Advance payment' : 'Amount received';
        $('#s-pm').innerHTML = options(state.lists.payment_methods.filter(m => !fair || m !== 'COD'), '', 'Select');
        $('#s-state')?.addEventListener('change', e => { $('#s-dist').innerHTML = districtField(e.target.value, ''); });
        if (ch === 'Tele-sales' || ch === 'Online') $('#s-phone')?.addEventListener('input', lookup);
        const ho = $('#s-ho');
        if (ho) {
          const hint = () => { $('#s-ho-hint').textContent = ho.checked ? 'Stock is deducted as soon as you save.' : 'Saved as an order: stock is reserved now and deducted when it is dispatched.'; };
          ho.addEventListener('change', hint); hint();
        }
        if (customer?.phone && !onsite && !fair) lookup();
        $('#s-plat')?.addEventListener('change', reprice);
        reprice();
      };
      form.querySelectorAll('input[name=channel]').forEach(r => r.addEventListener('change', () => setChannel(r.value)));
      addLine();
      setChannel(channel);

      onSubmit(form, async v => {
        const items = rows().map(r => ({ book_id: r.querySelector('select').value, qty: r.querySelector('[data-qty]').value, unit_price: r.querySelector('[data-price]').value }))
          .filter(i => i.book_id);
        if (!items.length && channel === 'Onsite') { // a visit where nothing was sold
          const visit = await api('POST', '/api/visits', { ...v, request_key: requestKey });
          close(); toast(`${visit.visit_no} saved`); after(null, visit); return;
        }
        if (!items.length) throw new Error('Select at least one book');
        const onsite = channel === 'Onsite' || channel === 'Exhibition';
        const body = { ...v, channel: onsite ? 'Onsite' : channel, items, request_key: requestKey, call_id: callId || undefined };
        if (channel === 'Tele-sales') { body.delivery_charge = Number(form.dataset.delivery) || 0; body.cod_charge = Number(form.dataset.cod) || 0; }
        if (channel === 'Exhibition') { body.handed_over = true; if (v.location_name) keepFair(v.location_name.trim()); }
        const sale = await api('POST', '/api/sales', body);
        close(); toast(`${sale.sale_no} saved`); after(sale);
      });
    },
  });
}
