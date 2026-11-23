import { api, get, esc, html, raw, inr, pill, table, drawer, onSubmit, options, toast, can, fmtDate, fmtStamp, parseHash, setQuery, wireFilters, qs, state, myChannel, todayLocal, drawerGeneration, reasonBox } from '../core.js';
import { saleForm } from './sale-form.js';

const STATUSES = ['Confirmed', 'Packing', 'Ready to Dispatch', 'Dispatched', 'Delivered', 'Completed', 'Cancelled'];
const FLOW = ['Confirmed', 'Packing', 'Ready to Dispatch', 'Dispatched', 'Delivered'];
const NEXT_LABEL = { Packing: 'Start packing', 'Ready to Dispatch': 'Mark ready to dispatch', Dispatched: 'Mark dispatched', Delivered: 'Mark delivered' };
const payMethods = () => state.lists.payment_methods.filter(m => m !== 'COD'); // COD is how an order is placed, not how money arrives
const sellers = () => can('admin', 'manager', 'telesales', 'online', 'onsite');

export async function renderList(page, { query }) {
  const wide = can('admin', 'manager'); const dispatch = can('dispatch');
  page.innerHTML = html`<div class="page-head"><div><h1>${dispatch ? 'Orders' : 'Sales'}</h1>
      <div class="sub">${dispatch ? 'Orders to pack, dispatch and deliver.' : myChannel() ? `${myChannel()} sales and orders.` : 'Every sale across Tele-sales, Online and Onsite.'}</div></div>
    ${raw(sellers() ? `<div class="actions"><button class="btn primary" type="button" id="add-s">${myChannel() === 'Onsite' ? 'Record a visit' : 'Record a sale'}</button></div>` : '')}</div>
    <form class="filters" id="s-filters">
      <div class="field grow"><label for="sf-q">Search</label><input id="sf-q" name="q" type="search" placeholder="Customer, phone, sale or order number" value="${query.q}"></div>
      ${raw(wide || dispatch ? `<div class="field"><label for="sf-ch">Channel</label><select id="sf-ch" name="channel">${options(['Tele-sales', 'Online', 'Onsite'], query.channel, 'All channels')}</select></div>` : '')}
      <div class="field"><label for="sf-st">Status</label><select id="sf-st" name="status">${raw(options([['open', 'Not yet dispatched'], ...STATUSES.filter(s => !(dispatch && s === 'Completed')).map(s => [s, s])], query.status, 'All except cancelled'))}</select></div>
      <div class="field"><label for="sf-ps">Payment</label><select id="sf-ps" name="payment_status">${raw(options([['outstanding', 'Has a balance'], ['overdue', 'Overdue'], 'Paid', 'Partially Paid', 'Unpaid', 'COD'], query.payment_status, 'All'))}</select></div>
      ${raw(wide ? `<div class="field"><label for="sf-sp">Sales person</label><select id="sf-sp" name="salesperson">${options(state.people.map(p => [p.id, p.name + (p.active ? '' : ' (inactive)')]), query.salesperson, 'Everyone')}</select></div>` : '')}
      <div class="field"><label for="sf-b">Book</label><select id="sf-b" name="book_id">${raw(options(state.books.map(b => [b.id, b.name]), query.book_id, 'All books'))}</select></div>
      <div class="field"><label for="sf-f">From</label><input id="sf-f" name="date_from" type="date" value="${query.date_from}"></div>
      <div class="field"><label for="sf-t">To</label><input id="sf-t" name="date_to" type="date" value="${query.date_to}"></div>
      <button class="btn" type="button" data-clear>Clear filters</button>
    </form><p class="list-totals" id="s-totals"></p><div id="s-list"></div>`;
  const list = page.querySelector('#s-list');
  const load = async () => {
    const q = { ...parseHash().query }; delete q.new; delete q.open;
    const r = await get('/api/sales' + qs(q)); const t = r.totals;
    page.querySelector('#s-totals').innerHTML = `<span><b>${t.orders}</b> sale${t.orders === 1 ? '' : 's'}</span><span>Total <b>${esc(inr(t.amount))}</b></span>
      <span>Received <b>${esc(inr(t.received))}</b></span><span>Balance <b>${esc(inr(t.balance))}</b></span>${r.truncated ? '<span>Showing the newest 500. Narrow the filters to see the rest.</span>' : ''}`;
    const any = Object.keys(q).length;
    list.innerHTML = table([
      { label: 'Sale', cell: s => `<button class="linkbtn" type="button" data-open="${s.id}">${esc(s.sale_no)}</button><span class="sub">${esc(fmtDate(s.sale_date))}</span>` },
      { label: 'Customer', cell: s => `${esc(s.customer_name)}<span class="sub">${esc(s.customer_phone || s.platform_order_id || '')}</span>` },
      { label: 'Books', cell: s => `${esc(s.books)}` },
      { label: 'Amount', cls: 'num', cell: s => `${esc(inr(s.total_amount))}${s.balance > 0 && s.status !== 'Cancelled' ? `<span class="sub${s.due_date && s.due_date < todayLocal() ? ' due' : ''}">${esc(inr(s.balance))} due</span>` : ''}` },
      { label: 'Payment', cell: s => pill(s.payment_status).__raw },
      { label: 'Status', cell: s => pill(s.status).__raw },
      { label: 'Channel', cell: s => `${esc(s.channel)}${s.platform ? ' · ' + esc(s.platform) : ''}<span class="sub">${esc(s.salesperson_name)}</span>` },
    ], r.rows, { empty: any ? 'No sales match these filters' : 'No sales yet', emptyHint: any ? 'Clear the filters to see everything.' : (sellers() ? 'Record the first sale to see it here.' : 'Orders appear here once the sales teams record them.') });
  };
  wireFilters(page.querySelector('#s-filters'), load);
  const changed = () => { window.dispatchEvent(new Event('nm:changed')); load(); };
  const saved = s => { changed(); if (s) openSale(s.id, changed); };
  page.querySelector('#add-s')?.addEventListener('click', () => saleForm({ after: saved }));
  list.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openSale(b.dataset.open, changed); });
  await load();
  // Deep links from the dashboard and other pages: ?new=1 opens the form, ?open=<id> opens a sale.
  if (query.new && sellers()) { strip('new'); saleForm({ customer: query.phone ? { phone: query.phone } : null, after: saved }); }
  else if (query.open) { strip('open'); openSale(query.open, changed).catch(e => toast(e.message, 'error')); }
}
function strip(key) { const q = { ...parseHash().query }; delete q[key]; delete q.phone; setQuery(q); }

const fact = (k, v) => (v === null || v === undefined || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${v}</dd>`);

/** Opens the sale drawer: details, payments, dispatch steps and history. */
export async function openSale(id, after = () => {}) {
  const gen = drawerGeneration();
  const s = await get(`/api/sales/${id}`);
  if (gen !== drawerGeneration()) return; // the user closed the drawer or moved on while this was loading
  const open = !s.imported && FLOW.includes(s.status) && FLOW.indexOf(s.status) < FLOW.indexOf('Dispatched');
  const canMove = !s.imported && can('admin', 'manager', 'dispatch') && FLOW.includes(s.status) && s.status !== 'Delivered';
  const next = FLOW[FLOW.indexOf(s.status) + 1];
  const canPay = sellers() && s.status !== 'Cancelled' && s.balance > 0;
  const overdue = s.balance > 0 && s.due_date && s.due_date < todayLocal() && s.status !== 'Cancelled';
  const refresh = () => { after(); openSale(id, after); };
  drawer({
    wide: true,
    title: `${s.sale_no} · ${s.customer_name}`,
    body: `
      <div class="status-line">${pill(s.status).__raw}${pill(overdue ? 'Overdue' : s.payment_status).__raw}<span class="muted">${esc(s.channel)}${s.platform ? ' · ' + esc(s.platform) : ''} · ${esc(fmtDate(s.sale_date))}</span></div>
      ${s.status === 'Cancelled' ? `<div class="notice warn">Cancelled: ${esc(s.cancel_reason)}</div>` : ''}
      <div class="btn-row">
        ${canMove && next ? `<button class="btn primary" type="button" data-move="${esc(next)}">${esc(NEXT_LABEL[next])}</button>` : ''}
        ${canMove && open && next !== 'Dispatched' ? '<button class="btn" type="button" data-move="Dispatched">Mark dispatched</button>' : ''}
        ${canPay ? '<button class="btn" type="button" id="pay-btn">Record payment</button>' : ''}
        ${can('admin') && s.status !== 'Cancelled' ? '<button class="btn" type="button" id="edit-btn">Edit sale</button>' : ''}
        ${sellers() && open ? '<button class="btn danger" type="button" id="cancel-btn">Cancel order</button>' : ''}
      </div>
      <div id="pay-slot"></div>
      <dl class="facts">
        ${fact('Customer', s.customer_id && sellers() ? `<a href="#/customer/${s.customer_id}">${esc(s.customer_name)}</a> <span class="muted">${esc(s.customer_code)}</span>` : esc(s.customer_name))}
        ${fact('Contact number', esc(s.customer_phone))}
        ${fact(s.channel === 'Onsite' ? 'Address' : 'Delivery address', esc(s.address))}
        ${fact('Order ID', esc(s.platform_order_id))}
        ${fact('Order sheet ID', s.import_ref ? `${esc(s.import_ref)} <span class="muted">imported history</span>` : '')}
        ${fact('Location', s.location_name ? `${esc(s.location_name)} <span class="muted">${esc(s.location_type)}</span>` : '')}
        ${fact('Contact person', esc(s.contact_person))}
        ${fact('Next visit', s.next_visit_date ? esc(fmtDate(s.next_visit_date)) : '')}
        ${fact('Sales person', esc(s.salesperson_name) + (s.created_by_name !== s.salesperson_name ? ` <span class="muted">entered by ${esc(s.created_by_name)}</span>` : ''))}
        ${fact('Remarks', esc(s.remarks))}
      </dl>
      <h3>Books</h3>
      ${table([
        { label: 'Book', cell: i => `${esc(i.book_name)}<span class="sub">${esc(i.sku)}</span>` },
        { label: 'Qty', cls: 'num', cell: i => String(i.qty) },
        { label: 'Unit price', cls: 'num', cell: i => esc(inr(i.unit_price)) },
        { label: 'Total', cls: 'num', cell: i => esc(inr(i.line_total)) },
      ], s.items)}
      <dl class="totals section-gap">
        ${s.delivery_charge || s.cod_charge ? `<dt>Books</dt><dd>${esc(inr(s.total_amount - s.delivery_charge - s.cod_charge))}</dd>${s.delivery_charge ? `<dt>Delivery charge</dt><dd>${esc(inr(s.delivery_charge))}</dd>` : ''}${s.cod_charge ? `<dt>COD charge</dt><dd>${esc(inr(s.cod_charge))}</dd>` : ''}` : ''}
        <dt>Total amount</dt><dd class="big">${esc(inr(s.total_amount))}</dd>
        <dt>Amount received</dt><dd>${esc(inr(s.amount_received))}</dd>
        <dt>Balance${s.due_date ? ` · due ${esc(fmtDate(s.due_date))}` : ''}</dt><dd class="${s.balance > 0 ? 'due' : ''}">${esc(inr(s.balance))}</dd>
        ${s.payment_method ? `<dt>Payment method</dt><dd>${esc(s.payment_method)}</dd>` : ''}
      </dl>
      <h3>Payments</h3>
      ${table([
        { label: 'Date', cell: p => esc(fmtDate(p.paid_on)) },
        { label: 'Method', cell: p => `${esc(p.method)}${p.note ? `<span class="sub">${esc(p.note)}</span>` : ''}` },
        { label: 'Amount', cls: 'num', cell: p => esc(inr(p.amount)) },
        { label: 'Recorded by', cell: p => esc(p.user_name) },
        ...(can('admin') ? [{ label: 'Actions', cls: 'cell-actions', cell: p => `<button class="btn small" type="button" data-pay-edit="${p.id}">Edit</button><button class="btn small danger" type="button" data-pay-del="${p.id}">Remove</button>` }] : []),
      ], s.payments, { empty: 'No payments recorded yet' })}
      <h3 class="section-gap">Stock</h3>
      <ul class="timeline">${s.stock.map(m => `<li><strong>${esc(m.type)}</strong> · ${esc(m.book_name)} × ${m.qty}<div class="muted">${esc(fmtStamp(m.at))}${m.user_name ? ' · ' + esc(m.user_name) : ''}</div></li>`).join('')}</ul>
      <h3 class="section-gap">History</h3>
      <ul class="timeline">${s.history.map(h => `<li><strong>${esc(h.action.replace(/_/g, ' '))}</strong>${h.after && h.before ? ' · ' + Object.keys(h.after).map(k => `${esc(k.replace(/_/g, ' '))}: ${esc(h.before[k])} → ${esc(h.after[k])}`).join(', ') : ''}${h.reason ? ' · ' + esc(h.reason) : ''}
        <div class="muted">${esc(h.user_name || 'system')} · ${esc(fmtStamp(h.at))}</div></li>`).join('')}</ul>`,
    onMount: d => {
      d.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api('POST', `/api/sales/${s.id}/status`, { status: b.dataset.move }); toast(`${s.sale_no} is now ${b.dataset.move}`); refresh(); }
        catch (e) { b.disabled = false; toast(e.message, 'error'); }
      }));
      d.querySelector('#pay-btn')?.addEventListener('click', () => paymentForm(d.querySelector('#pay-slot'), s, refresh));
      d.querySelector('#edit-btn')?.addEventListener('click', () => editSaleForm(s, refresh, () => openSale(id, after)));
      d.querySelectorAll('[data-pay-edit]').forEach(b => b.addEventListener('click', () => editPaymentForm(s, s.payments.find(p => String(p.id) === b.dataset.payEdit), refresh, () => openSale(id, after))));
      d.querySelectorAll('[data-pay-del]').forEach(b => b.addEventListener('click', () => {
        const p = s.payments.find(x => String(x.id) === b.dataset.payDel);
        reasonBox({ title: `Remove the ${inr(p.amount)} payment?`, message: `The balance on ${esc(s.sale_no)} goes up by ${esc(inr(p.amount))}.`, confirmLabel: 'Remove payment', danger: true, back: () => openSale(id, after),
          run: reason => api('DELETE', `/api/payments/${p.id}`, { reason }), then: () => { toast('Payment removed'); refresh(); } });
      }));
      d.querySelector('#cancel-btn')?.addEventListener('click', () => cancelForm(s, after, () => openSale(id, after)));
    },
  });
}

function paymentForm(slot, s, done) {
  if (slot.firstChild) { slot.querySelector('input')?.focus(); return; }
  slot.innerHTML = html`<form class="inline-form" id="pay-form" novalidate>
    <div class="grid3">
      <div class="field"><label for="p-amt">Amount *</label><div class="money"><span>₹</span><input id="p-amt" name="amount" type="number" inputmode="numeric" min="1" max="${s.balance}" step="1" value="${s.balance}" required></div></div>
      <div class="field"><label for="p-m">Payment method *</label><select id="p-m" name="method">${raw(options(payMethods(), s.payment_method === 'COD' ? 'Cash' : s.payment_method, 'Select'))}</select></div>
      <div class="field"><label for="p-d">Payment date</label><input id="p-d" name="paid_on" type="date" max="${todayLocal()}" value="${todayLocal()}"></div>
    </div>
    <div class="field"><label for="p-n">Note</label><input id="p-n" name="note" maxlength="300"></div>
    <div class="btn-row"><button class="btn primary" type="submit">Save payment</button><button class="btn" type="button" id="p-x">Close</button></div>
  </form>`;
  slot.querySelector('#p-x').addEventListener('click', () => { slot.innerHTML = ''; });
  onSubmit(slot.querySelector('#pay-form'), async v => { await api('POST', `/api/sales/${s.id}/payments`, v); toast('Payment recorded'); done(); });
  slot.querySelector('#p-amt').focus();
}

function cancelForm(s, after, back) {
  drawer({
    title: `Cancel ${s.sale_no}?`,
    body: html`<form id="c-form" novalidate>
      <p>The books reserved for this order go back to available stock. This cannot be undone.</p>
      ${raw(s.amount_received > 0 ? `<div class="notice warn">${esc(inr(s.amount_received))} has been received on this order. Refund it to the customer outside the app; the payment stays on record.</div>` : '')}
      <div class="field"><label for="c-r">Reason *</label><textarea id="c-r" name="reason" maxlength="300" required></textarea></div></form>`,
    foot: `<button class="btn" type="button" id="c-back">Keep order</button><button class="btn danger" type="submit" form="c-form">Cancel order</button>`,
    onMount: d => {
      d.querySelector('#c-back').addEventListener('click', back);
      onSubmit(d.querySelector('#c-form'), async v => { await api('POST', `/api/sales/${s.id}/cancel`, v); toast(`${s.sale_no} cancelled`); after(); back(); });
    },
  });
}

/** Admin: correct a payment. */
function editPaymentForm(s, p, done, back) {
  drawer({
    title: `Edit payment on ${s.sale_no}`,
    body: html`<form id="pe-form" novalidate>
      <div class="grid2">
        <div class="field"><label for="pe-a">Amount *</label><div class="money"><span>₹</span><input id="pe-a" name="amount" type="number" inputmode="numeric" min="1" step="1" value="${p.amount}" required></div><div class="hint">At most ${inr(s.balance + p.amount)}, the amount still owed plus this payment.</div></div>
        <div class="field"><label for="pe-m">Payment method *</label><select id="pe-m" name="method">${raw(options([...new Set([...payMethods(), p.method])], p.method))}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="pe-d">Payment date *</label><input id="pe-d" name="paid_on" type="date" max="${todayLocal()}" value="${p.paid_on}"></div>
        <div class="field"><label for="pe-n">Note</label><input id="pe-n" name="note" maxlength="300" value="${p.note}"></div>
      </div>
      <div class="field"><label for="pe-r">Reason for the change *</label><textarea id="pe-r" name="reason" maxlength="300" required></textarea></div></form>`,
    foot: `<button class="btn" type="button" id="pe-back">Back</button><button class="btn primary" type="submit" form="pe-form">Save payment</button>`,
    onMount: d => {
      d.querySelector('#pe-back').addEventListener('click', back);
      onSubmit(d.querySelector('#pe-form'), async v => { await api('PATCH', `/api/payments/${p.id}`, v); toast('Payment changed'); done(); });
    },
  });
}

/** Admin: correct a saved sale — its details and its books. Stock and totals follow. */
function editSaleForm(s, done, back) {
  const books = state.books.filter(b => b.active || s.items.some(i => i.book_id === b.id)).sort((a, b) => a.name.localeCompare(b.name));
  const line = i => `<tr><td class="c-book"><select aria-label="Book">${options(books.map(b => [b.id, b.name + (b.kind === 'Pack' ? ' (set)' : '')]), i?.book_id, 'Select book or set')}</select></td>
    <td class="c-qty"><input data-qty aria-label="Quantity" type="number" inputmode="numeric" min="1" step="1" value="${i?.qty ?? 1}"></td>
    <td class="c-price"><input data-price aria-label="Unit price" type="number" inputmode="numeric" min="0" step="1" value="${i?.unit_price ?? ''}"></td>
    <td class="c-total"></td><td class="c-x"><button class="btn small" type="button" data-remove aria-label="Remove this book">×</button></td></tr>`;
  drawer({
    wide: true, title: `Edit ${s.sale_no}`,
    body: html`<form id="es-form" novalidate>
      ${raw(s.imported ? '<div class="notice info">This order came from the old order sheet. Changing its books does not change stock.</div>' : `<div class="notice info">Changing the books also corrects stock for this ${esc(s.status.toLowerCase())} sale.</div>`)}
      <div class="grid2">
        <div class="field"><label for="es-date">${s.channel === 'Onsite' ? 'Visit date' : 'Sales date'}</label><input id="es-date" name="sale_date" type="date" max="${todayLocal()}" value="${s.sale_date}"></div>
        <div class="field"><label for="es-sp">Sales person</label><select id="es-sp" name="salesperson_id">${raw(options(state.people.map(p => [p.id, p.name + (p.active ? '' : ' (inactive)')]), s.salesperson_id))}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="es-name">Customer name *</label><input id="es-name" name="customer_name" maxlength="150" value="${s.customer_name}"></div>
        <div class="field"><label for="es-phone">Customer contact number</label><input id="es-phone" name="customer_phone" type="tel" maxlength="30" value="${s.customer_phone}">
          ${raw(s.channel === 'Onsite' ? '' : '<div class="hint">A different number moves the sale to that customer.</div>')}</div>
      </div>
      <div class="field"><label for="es-addr">Address</label><textarea id="es-addr" name="address" maxlength="500">${s.address}</textarea></div>
      ${raw(s.channel === 'Online' ? `<div class="field"><label for="es-oid">Order ID *</label><input id="es-oid" name="platform_order_id" maxlength="80" value="${esc(s.platform_order_id)}"></div>` : '')}
      <fieldset><legend>Books</legend>
        <table class="lines"><thead><tr><th scope="col">Book</th><th scope="col">Quantity</th><th scope="col">Unit price (₹)</th><th scope="col" class="c-total">Total</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody id="es-lines">${raw(s.items.map(line).join(''))}</tbody></table>
        <div class="btn-row"><button class="btn small" type="button" id="es-add">Add another book</button></div>
        ${raw(s.channel === 'Onsite' ? '' : `<div class="grid2">
          <div class="field"><label for="es-dc">Delivery charge</label><div class="money"><span>₹</span><input id="es-dc" name="delivery_charge" type="number" inputmode="numeric" min="0" step="1" value="${s.delivery_charge || 0}"></div></div>
          <div class="field"><label for="es-cc">COD charge</label><div class="money"><span>₹</span><input id="es-cc" name="cod_charge" type="number" inputmode="numeric" min="0" step="1" value="${s.cod_charge || 0}"></div><div class="hint">Only for a COD order.</div></div>
        </div>`)}
        <dl class="totals"><dt>New total</dt><dd class="big" id="es-total"></dd><dt>Already received</dt><dd>${inr(s.amount_received)}</dd><dt>New balance</dt><dd id="es-bal"></dd></dl>
      </fieldset>
      <div class="grid2">
        <div class="field"><label for="es-pm">Payment method</label><select id="es-pm" name="payment_method">${raw(options([...new Set([...state.lists.payment_methods, ...(s.payment_method ? [s.payment_method] : [])])], s.payment_method, 'Not set'))}</select></div>
        <div class="field"><label for="es-due">Due date</label><input id="es-due" name="due_date" type="date" value="${s.due_date}"></div>
      </div>
      <div class="field"><label for="es-rem">Remarks</label><textarea id="es-rem" name="remarks" maxlength="1000">${s.remarks}</textarea></div>
      <div class="field"><label for="es-reason">Reason for the change *</label><textarea id="es-reason" name="reason" maxlength="300" required></textarea><div class="hint">Kept in the sale's history with your name and the time.</div></div>
    </form>`,
    foot: `<button class="btn" type="button" id="es-back">Back</button><button class="btn primary" type="submit" form="es-form">Save changes</button>`,
    onMount: d => {
      const lines = d.querySelector('#es-lines');
      const recalc = () => {
        let total = 0;
        for (const r of lines.querySelectorAll('tr')) { const t = (Number(r.querySelector('[data-qty]').value) || 0) * (Number(r.querySelector('[data-price]').value) || 0); total += t; r.querySelector('.c-total').textContent = inr(t); }
        total += (Number(d.querySelector('#es-dc')?.value) || 0) + (Number(d.querySelector('#es-cc')?.value) || 0);
        d.querySelector('#es-total').textContent = inr(total); const bal = total - s.amount_received;
        d.querySelector('#es-bal').textContent = bal < 0 ? `${inr(-bal)} less than was received` : inr(bal); d.querySelector('#es-bal').classList.toggle('due', bal !== 0);
      };
      lines.addEventListener('input', recalc); d.querySelector('#es-dc')?.addEventListener('input', recalc); d.querySelector('#es-cc')?.addEventListener('input', recalc);
      lines.addEventListener('change', e => { if (e.target.tagName === 'SELECT') { const b = books.find(x => String(x.id) === e.target.value); const p = e.target.closest('tr').querySelector('[data-price]'); if (b && !p.value) p.value = b.price; recalc(); } });
      lines.addEventListener('click', e => { const x = e.target.closest('[data-remove]'); if (x && lines.querySelectorAll('tr').length > 1) { x.closest('tr').remove(); recalc(); } });
      d.querySelector('#es-add').addEventListener('click', () => { lines.insertAdjacentHTML('beforeend', line(null)); recalc(); });
      d.querySelector('#es-back').addEventListener('click', back);
      recalc();
      onSubmit(d.querySelector('#es-form'), async v => {
        const items = [...lines.querySelectorAll('tr')].map(r => ({ book_id: r.querySelector('select').value, qty: r.querySelector('[data-qty]').value, unit_price: r.querySelector('[data-price]').value })).filter(i => i.book_id);
        await api('PATCH', `/api/sales/${s.id}`, { ...v, items });
        toast(`${s.sale_no} changed`); window.dispatchEvent(new Event('nm:changed')); done();
      });
    },
  });
}
