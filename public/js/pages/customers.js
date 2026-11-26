import { api, get, esc, html, raw, inr, pill, table, drawer, onSubmit, options, toast, fmtDate, parseHash, wireFilters, qs, state, waLink, STATES, wide, canEdit, isAdmin } from '../core.js';
import { openSale } from './sales.js';
import { callsTable, callForm, wireCallActions } from './calls.js';
import { visitsTable, wireVisitActions } from './visits.js';
import { saleForm } from './sale-form.js';


// What counts as a bulk order, from Settings: many copies in one order, or a large order amount.
const bulkRule = () => { const c = state.charges || {}; return `an order of ${c.bulk_min_copies}+ copies${c.bulk_min_amount ? ` or ${inr(c.bulk_min_amount)}+` : ''}`; };

const SOURCES = ['Order sheet', 'Sales', 'WhatsApp group', 'Website', 'Calls', 'Visits'];
const REASONS = ['Name to check', 'Name in Malayalam', 'PIN missing', 'PIN wrong', 'Address missing', 'No order'];
const REASON_HELP = {
  'Name to check': 'The name looks like a remark or an address ("Confirmed order", "My address"), or could not be read.',
  'Name in Malayalam': 'Written in Malayalam script. Add the English spelling, or confirm the name is right.',
  'PIN missing': 'No PIN code. Needed for delivery.', 'PIN wrong': 'The PIN is not 6 digits.',
  'Address missing': 'No address, or too short to deliver to.', 'No order': 'Added from the WhatsApp group, but the post named no book, so no order was recorded.',
};
const ORDER_FILTER = [['repeat', 'Repeat customers (2 or more orders)'], ['twice', 'Ordered twice'], ['3plus', 'Ordered 3 or more times'], ['once', 'Ordered once']];
const sourceLabel = c => (c.source ? ` · ${esc(c.source)}` : '');
const reasonPills = c => (c.needs || []).map(r => `<span class="pill amber">${esc(r)}</span>`).join(' ');

export async function renderList(page, { query }) {
  const update = query.view === 'update';
  const [locations, sum] = await Promise.all([get('/api/customers/locations'), get('/api/customers/update-summary')]);
  const products = state.books.filter(b => b.active && b.sku !== 'OTHER').map(b => [b.id, b.name]);
  const n = v => Number(v || 0).toLocaleString('en-IN');
  const tabs = `<nav class="tabs" aria-label="Customer lists"><a href="#/customers" ${update ? '' : 'aria-current="page"'}>Customers <span class="count">${n(sum.complete)}</span></a>
    <a href="#/customers?view=update" ${update ? 'aria-current="page"' : ''}>Update needed <span class="count">${n(sum.needing + sum.sales_without_customer)}</span></a></nav>`;
  page.innerHTML = html`<div class="page-head"><div><h1>Customers</h1><div class="sub">${update ? 'Records that are missing a detail or need a check before they join the customer list.' : 'Complete customer records. A customer is recognised by their contact number.'}</div></div>
      <div class="actions">${raw(!update && wide() ? '<button class="btn" type="button" id="gc-dl">Download for Google Contacts</button>' : '')}${raw(update ? '' : '<button class="btn" type="button" id="wa-all">WhatsApp the customers shown</button>')}</div></div>
    ${raw(tabs)}
    ${raw(update ? `<div class="chips">${REASONS.map(r => `<a class="chip${query.reason === r ? ' on' : ''}" href="#/customers?view=update${query.reason === r ? '' : '&reason=' + encodeURIComponent(r)}" title="${esc(REASON_HELP[r])}">${esc(r)} <b>${n(sum.reasons[r])}</b></a>`).join('')}
      <a class="chip" href="#dup-sec">Possible duplicates <b id="dup-count">…</b></a><a class="chip" href="#nocust-sec">Sales with no customer <b>${n(sum.sales_without_customer)}</b></a></div>` : '')}
    <form class="filters" id="c-filters">
      ${raw(update ? '<input type="hidden" name="view" value="update">' : '')}
      <div class="field grow"><label for="cf-q">Search</label><input id="cf-q" name="q" type="search" placeholder="Name, phone or customer ID" value="${query.q}"></div>
      ${raw(update ? `<div class="field"><label for="cf-r">Reason</label><select id="cf-r" name="reason">${options(REASONS, query.reason, 'All reasons')}</select></div>` : '')}
      <div class="field"><label for="cf-src">Added from</label><select id="cf-src" name="source">${raw(options(SOURCES, query.source, 'Anywhere'))}</select></div>
      ${raw(update ? '' : `
      <div class="field"><label for="cf-ord">Repeat customers</label><select id="cf-ord" name="orders">${options(ORDER_FILTER, query.orders, 'Any number of orders')}</select></div>
      <div class="field"><label for="cf-bulk">Bulk orders</label><select id="cf-bulk" name="bulk">${options([['1', `Bulk order customers (${bulkRule()})`]], query.bulk, 'Any order size')}</select></div>
      <div class="field"><label for="cf-t">Customer type</label><select id="cf-t" name="type">${options(state.lists.customer_types, query.type, 'All types')}</select></div>
      <div class="field"><label for="cf-st">State</label><select id="cf-st" name="state">${options(STATES, query.state, 'All states')}</select></div>
      <div class="field"><label for="cf-l">District</label><select id="cf-l" name="location">${options(locations, query.location, 'All districts')}</select></div>
      <div class="field"><label for="cf-bo">Bought</label><select id="cf-bo" name="bought">${options(products, query.bought, 'Any book or set')}</select></div>
      <div class="field"><label for="cf-nb">But has not bought</label><select id="cf-nb" name="not_bought">${options(products, query.not_bought, 'No condition')}</select></div>
      <div class="field"><label for="cf-k">Show</label><select id="cf-k" name="kind">${options([['Lead', 'Leads (called, not bought yet)'], ['all', 'Customers and leads']], query.kind, 'Customers')}</select></div>
      <div class="field"><label for="cf-o">Payments</label><select id="cf-o" name="outstanding">${options([['1', 'Has an outstanding amount']], query.outstanding, 'All')}</select></div>`)}
      <button class="btn" type="button" data-clear>Clear filters</button>
    </form><p class="result-count" id="c-count"></p><div id="c-list"></div>
    ${raw(update ? `<section class="panel top-gap" id="dup-sec"><h2>Possible duplicates</h2><p class="muted">The same name and the same PIN on two records: usually one person who gave two numbers. Merging keeps the record with more orders, moves every order, call and visit to it, and keeps the other number as a second number.</p><div id="dup-list"><p class="muted">Loading…</p></div></section>
      <section class="panel top-gap" id="nocust-sec"><h2>Sales with no customer record</h2><p class="muted">These orders were saved without a contact number, so they belong to no customer. Open one and use <strong>Edit sale</strong> (Admin) to add the number: the order then joins that customer.</p>${table([
        { label: 'Sale', cell: x => `<a href="#/sales?open=${x.id}">${esc(x.sale_no)}</a><span class="sub">${esc(fmtDate(x.sale_date))}</span>` },
        { label: 'Name on the order', cell: x => `${esc(x.customer_name)}<span class="sub">${esc((x.address || '').slice(0, 80))}</span>` },
        { label: 'From', cell: x => esc(x.source) },
        { label: 'Amount', cls: 'num', cell: x => esc(inr(x.total_amount)) },
      ], sum.sales, { empty: 'Every sale has a customer' })}${sum.sales_without_customer > sum.sales.length ? `<p class="muted small">Showing the newest ${sum.sales.length}.</p>` : ''}</section>` : '')}`;
  let shown = [];
  page.querySelector('#gc-dl')?.addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await fetch('/api/customers/google-contacts.csv' + qs(parseHash().query), { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not prepare the file');
      const count = Number(res.headers.get('X-Contact-Count') || 0);
      if (!count) { toast('No customer in this list has a contact number', 'error'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'nalla-malayalam-contacts.csv';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      drawer({ title: `${count.toLocaleString('en-IN')} contacts downloaded`, body: `<p>The file <strong>nalla-malayalam-contacts.csv</strong> is in your Downloads folder. To add the contacts to your Google account:</p>
        <ol><li>Open <strong>contacts.google.com</strong> and sign in to the Google account you want them in.</li><li>Choose <strong>Import</strong> in the left menu.</li><li>Select the downloaded file and press <strong>Import</strong>.</li></ol>
        <p>Google puts them under the label <strong>Nalla Malayalam Customers</strong>, so they are easy to find or remove together. They then appear on any phone signed in to that account.</p>
        <p class="muted">Importing the same file twice makes duplicates; Google Contacts has a "Merge &amp; fix" option to tidy them.</p>`, foot: '<button class="btn primary" type="button" data-close>Done</button>' });
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
  page.querySelector('#wa-all')?.addEventListener('click', () => whatsappDrawer(shown.filter(c => waLink(c.phone))));
  const list = page.querySelector('#c-list');
  list.addEventListener('click', async e => {
    const w = e.target.closest('[data-wa]'); if (w) whatsappDrawer(shown.filter(c => String(c.id) === w.dataset.wa));
    const ok = e.target.closest('[data-name-ok]');
    if (ok) { ok.disabled = true; try { await api('PATCH', `/api/customers/${ok.dataset.nameOk}`, { name_ok: true }); toast('Name confirmed'); await load(); } catch (err) { ok.disabled = false; toast(err.message, 'error'); } }
  });
  const load = async () => {
    const q = parseHash().query; const r = await get('/api/customers' + qs(q)); shown = r.rows;
    const word = update ? 'record' : 'customer';
    page.querySelector('#c-count').textContent = r.truncated ? `${r.total.toLocaleString('en-IN')} ${word}s match. Showing the first 500${update ? '' : '; the Google Contacts download includes all of them'}.` : `${r.rows.length} ${word}${r.rows.length === 1 ? '' : 's'}${!update && q.q ? ' (the search also looks in Update needed)' : ''}`;
    const any = Object.keys(q).filter(k => k !== 'view').length;
    list.innerHTML = table([
      { label: 'Customer', cell: c => `<a href="#/customer/${c.id}">${esc(c.name)}</a>${c.kind === 'Lead' ? ' ' + pill('Lead', 'blue').__raw : ''}${!update && c.needs && c.needs.length ? ' <span class="pill amber">Update needed</span>' : ''}<span class="sub">${esc(c.code)} · ${esc(c.type)}${sourceLabel(c)}</span>` },
      { label: 'Contact number', cell: c => `${esc(c.phone)}${c.phone2 ? `<span class="sub">${esc(c.phone2)}</span>` : ''}` },
      ...(update ? [{ label: 'What is needed', cell: c => reasonPills(c) }, { label: 'Address', cell: c => `${esc((c.address || '—').slice(0, 70))}<span class="sub">${c.pin ? 'PIN ' + esc(c.pin) : ''}</span>` }]
        : [{ label: 'District', cell: c => `${esc(c.location || '—')}${c.state && c.state !== 'Kerala' ? `<span class="sub">${esc(c.state)}</span>` : ''}` }]),
      { label: 'Orders', cls: 'num', cell: c => `${c.total_orders}${c.largest_order ? `<span class="sub">largest ${esc(inr(c.largest_order))}</span>` : ''}` },
      ...(update ? [] : [{ label: 'Total purchases', cls: 'num', cell: c => esc(inr(c.total_purchase_amount)) },
        { label: 'Outstanding', cls: 'num', cell: c => (c.outstanding_amount ? `<span class="sub due">${esc(inr(c.outstanding_amount))}</span>` : '—') },
        { label: 'Last purchase', cell: c => (c.last_purchase_date ? esc(fmtDate(c.last_purchase_date)) : '—') }]),
      { label: update ? 'Actions' : 'Message', cls: 'cell-actions', cell: c => (update
        ? `<a class="btn small" href="#/customer/${c.id}">Open</a>${(c.needs || []).some(x => x.startsWith('Name')) && c.name !== 'Name not known' ? `<button class="btn small" type="button" data-name-ok="${c.id}">Name is correct</button>` : ''}`
        : (waLink(c.phone) ? `<button class="btn small" type="button" data-wa="${c.id}">WhatsApp</button>` : '')) },
    ], r.rows, { empty: update ? (any ? 'No records match these filters' : 'Nothing needs an update') : (any ? 'No customers match these filters' : 'No customers yet'),
      emptyHint: update ? '' : any ? 'Clear the filters to see everyone.' : 'Customers appear here when a sale with a contact number is recorded.' });
  };
  wireFilters(page.querySelector('#c-filters'), load);
  await load();
  if (update) await loadDuplicates(page);
}

/** The "Possible duplicates" section: pairs with a Merge button (Admin) and "Not the same person". */
async function loadDuplicates(page) {
  const box = page.querySelector('#dup-list'); const groups = await get('/api/customers/duplicates');
  page.querySelector('#dup-count').textContent = groups.length.toLocaleString('en-IN');
  const who = c => `<a href="#/customer/${c.id}">${esc(c.name)}</a><span class="sub">${esc(c.code)} · ${esc(c.phone)}${c.phone2 ? ' / ' + esc(c.phone2) : ''} · ${c.total_orders} order${c.total_orders === 1 ? '' : 's'}${sourceLabel(c)}</span><span class="sub">${esc((c.address || '—').slice(0, 70))}${c.pin ? ' · ' + esc(c.pin) : ''}</span>`;
  box.innerHTML = table([
    { label: 'Keep this record', cell: g => who(g[0]) },
    { label: 'Merge into it', cell: g => g.slice(1).map(who).join('<hr class="thin">') },
    { label: 'Actions', cls: 'cell-actions', cell: g => `${isAdmin() ? `<button class="btn small primary" type="button" data-merge="${groups.indexOf(g)}">Merge</button>` : ''}${wide() && canEdit('customers') ? `<button class="btn small" type="button" data-notdup="${groups.indexOf(g)}">Not the same person</button>` : ''}` },
  ], groups, { empty: 'No possible duplicates', emptyHint: isAdmin() ? '' : 'Only the Admin can merge records.' });
  box.onclick = async e => {
    const m = e.target.closest('[data-merge]'); const nd = e.target.closest('[data-notdup]');
    const g = groups[Number((m || nd || {}).dataset?.merge ?? (m || nd || {}).dataset?.notdup)];
    if (!g) return;
    const btn = m || nd; btn.disabled = true;
    try {
      if (m) { for (const other of g.slice(1)) await api('POST', `/api/customers/${g[0].id}/merge`, { other_id: other.id, reason: 'Same name and PIN: same person' }); toast(`Merged into ${g[0].code}`); }
      else { await api('POST', '/api/customers/duplicates/dismiss', { ids: g.map(c => c.id) }); toast('Marked as different people'); }
      window.dispatchEvent(new Event('nm:changed')); await renderList(page, { query: parseHash().query });
    } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
  };
}

export async function renderProfile(page, { id }) {
  const c = await get(`/api/customers/${id}`);
  const isPlace = state.lists.places.includes(c.type);
  const kpi = (l, v, cls = '') => `<div class="kpi ${cls}"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span></div>`;
  page.innerHTML = `<div class="page-head"><div><h1>${esc(c.name)}</h1><div class="sub">${c.kind === 'Lead' ? 'Lead · ' : ''}${esc(c.code)} · ${esc(c.type)}${c.source ? ' · added from ' + esc(c.source) : ''}${c.phone ? ' · ' + esc(c.phone) : ''}${c.phone2 ? ' / ' + esc(c.phone2) : ''}${c.location ? ' · ' + esc(c.location) : ''}${c.contact_person ? ' · contact: ' + esc(c.contact_person) : ''}</div></div>
      <div class="actions"><a class="btn" href="#/customers">All customers</a>${canEdit('customers') ? '<button class="btn" type="button" id="edit-c">Edit details</button>' : ''}${waLink(c.phone) ? '<button class="btn" type="button" id="wa-one">WhatsApp</button>' : ''}${canEdit('calls') ? '<button class="btn" type="button" id="call-one">Log a call</button>' : ''}
        ${isPlace && canEdit('visits') ? '<button class="btn primary" type="button" id="visit-one">Record a visit</button>' : c.phone && canEdit('sales') ? `<a class="btn primary" href="#/sales?new=1&phone=${encodeURIComponent(c.phone)}">Record a sale</a>` : ''}</div></div>
    ${c.address ? `<p class="muted">${esc(c.address)}${c.pin ? ' · PIN ' + esc(c.pin) : ''}</p>` : ''}
    ${c.notes ? `<div class="notice info">${esc(c.notes)}</div>` : ''}
    ${c.needs && c.needs.length ? `<div class="notice warn"><strong>Update needed:</strong> ${c.needs.map(r => `${esc(r)}: ${esc(REASON_HELP[r])}`).join(' ')} Use <strong>Edit details</strong>${c.needs.some(r => r.startsWith('Name')) ? ', or confirm the name is right' : ''}.${c.needs.some(r => r.startsWith('Name')) && c.name !== 'Name not known' ? ' <button class="btn small" type="button" id="name-ok">Name is correct</button>' : ''}</div>` : ''}
    <div class="kpis">
      ${kpi('Total orders', c.total_orders)}
      ${kpi('Total purchase amount', inr(c.total_purchase_amount))}
      ${kpi('Outstanding amount', inr(c.outstanding_amount), c.outstanding_amount ? 'bad' : '')}
      ${kpi('First / last purchase', c.first_purchase_date ? `${fmtDate(c.first_purchase_date).slice(4)} / ${fmtDate(c.last_purchase_date).slice(4)}` : '—')}
    </div>
    <div class="cols-3">
      <section class="panel"><h2>Orders</h2><div id="c-sales">${table([
        { label: 'Sale', cell: s => `<button class="linkbtn" type="button" data-open="${s.id}">${esc(s.sale_no)}</button><span class="sub">${esc(fmtDate(s.sale_date))} · ${esc(s.channel)}</span>` },
        { label: 'Books', cell: s => s.items.map(i => `${esc(i.book_name)} × ${i.qty}`).join('<br>') },
        { label: 'Amount', cls: 'num', cell: s => `${esc(inr(s.total_amount))}${s.balance > 0 && s.status !== 'Cancelled' ? `<span class="sub due">${esc(inr(s.balance))} due</span>` : ''}` },
        { label: 'Payment', cell: s => pill(s.payment_status).__raw },
        { label: 'Status', cell: s => pill(s.status).__raw },
      ], c.sales, { empty: 'No orders yet' })}</div></section>
      <div>
        <section class="panel"><h2>Books purchased</h2>${table([
          { label: 'Book', cell: b => esc(b.name) },
          { label: 'Copies', cls: 'num', cell: b => String(b.qty) },
          { label: 'Last', cell: b => esc(fmtDate(b.last_date).slice(4)) },
        ], c.books, { empty: 'Nothing purchased yet' })}</section>
        <section class="panel"><h2>Payments</h2>${table([
          { label: 'Date', cell: p => `${esc(fmtDate(p.paid_on).slice(4))}<span class="sub">${esc(p.sale_no)}</span>` },
          { label: 'Method', cell: p => esc(p.method) },
          { label: 'Amount', cls: 'num', cell: p => esc(inr(p.amount)) },
        ], c.payments, { empty: 'No payments yet' })}</section>
      </div>
    </div>
    ${c.visits.length || isPlace ? `<section class="panel top-gap" id="p-visits"><h2>Visits</h2>${visitsTable(c.visits, { place: false, empty: 'No visits recorded for this place' })}</section>` : ''}
    <section class="panel top-gap" id="p-calls"><h2>Calls and follow-ups</h2>${callsTable(c.calls, { who: false, empty: 'No calls recorded for this person' })}</section>`;
  const reload = () => renderProfile(page, { id });
  wireCallActions(page.querySelector('#p-calls'), () => c.calls, reload);
  if (page.querySelector('#p-visits')) wireVisitActions(page.querySelector('#p-visits'), () => c.visits, reload);
  page.querySelector('#visit-one')?.addEventListener('click', () => saleForm({ startChannel: 'Onsite', customer: { location_id: c.id }, after: reload }));
  page.querySelector('#call-one')?.addEventListener('click', () => callForm({ phone: c.phone, name: c.name, after: reload }));
  page.querySelector('#c-sales').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openSale(b.dataset.open, reload); });
  page.querySelector('#wa-one')?.addEventListener('click', () => whatsappDrawer([c]));
  page.querySelector('#name-ok')?.addEventListener('click', async () => { await api('PATCH', `/api/customers/${c.id}`, { name_ok: true }); toast('Name confirmed'); reload(); });
  page.querySelector('#edit-c')?.addEventListener('click', () => drawer({
    title: `Edit ${c.name}`,
    body: html`<form id="c-form" novalidate>
      <div class="field"><label for="c-name">Customer name *</label><input id="c-name" name="name" required maxlength="150" value="${c.name}"></div>
      <div class="grid2">
        <div class="field"><label for="c-phone">Contact number${isPlace ? '' : ' *'}</label><input id="c-phone" name="phone" type="tel" maxlength="30" value="${c.phone}"></div>
        <div class="field"><label for="c-type">Customer type *</label><select id="c-type" name="type">${raw(options(state.lists.customer_types, c.type))}</select></div>
      </div>
      <div class="field"><label for="c-phone2">Second number</label><input id="c-phone2" name="phone2" type="tel" maxlength="30" value="${c.phone2}"><div class="hint">Optional. Either number finds this customer.</div></div>
      <div class="field"><label for="c-addr">Address</label><textarea id="c-addr" name="address" maxlength="500">${c.address}</textarea></div>
      <div class="field"><label for="c-pin">PIN</label><input id="c-pin" name="pin" inputmode="numeric" maxlength="7" value="${c.pin}"></div>
      ${raw(isPlace ? `<div class="field"><label for="c-cp">Contact person</label><input id="c-cp" name="contact_person" maxlength="100" value="${esc(c.contact_person)}"></div>` : '')}
      <div class="field"><label for="c-loc">District</label><input id="c-loc" name="location" maxlength="100" value="${c.location}"></div>
      <div class="field"><label for="c-state">State</label><select id="c-state" name="state">${raw(options([...STATES, ...(c.state && !STATES.includes(c.state) ? [c.state] : [])], c.state, 'Not set'))}</select></div>
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="c-form">Save customer</button>`,
    onMount: (d, close) => onSubmit(d.querySelector('#c-form'), async v => { await api('PATCH', `/api/customers/${c.id}`, v); close(); toast('Customer saved'); reload(); }),
  }));
}

/**
 * WhatsApp, one customer at a time: write the message once, then open each chat with it typed in.
 * The app sends nothing itself; the person presses Send in WhatsApp.
 */
function whatsappDrawer(customers) {
  if (!customers.length) { toast('No customer here has a number WhatsApp can use', 'error'); return; }
  const books = state.books.filter(b => b.active);
  const text = b => (b ? `Hello {name}, greetings from Nalla Malayalam. Our book "${b.name}" is now available at ₹${b.price}. Reply to this message to order.` : 'Hello {name}, greetings from Nalla Malayalam.');
  drawer({
    wide: customers.length > 1,
    title: customers.length === 1 ? `WhatsApp ${customers[0].name}` : `WhatsApp ${customers.length} customers, one by one`,
    body: html`<div class="field"><label for="wa-book">Book to tell them about</label><select id="wa-book">${raw(options(books.map(b => [b.id, `${b.name} · ₹${b.price}`]), '', 'No book, just a greeting'))}</select></div>
      <div class="field"><label for="wa-text">Message</label><textarea id="wa-text" rows="5" maxlength="1000">${text(null)}</textarea>
        <div class="hint">{name} becomes each customer's name. Each button opens WhatsApp with this message typed in; you press Send there.</div></div>
      <div id="wa-list"></div>`,
    foot: '<button class="btn" type="button" data-close>Close</button>',
    onMount: d => {
      const ta = d.querySelector('#wa-text'); const list = d.querySelector('#wa-list'); const opened = new Set();
      const draw = () => {
        list.innerHTML = table([
          { label: 'Customer', cell: c => `${esc(c.name)}<span class="sub">${esc(c.phone)}</span>` },
          { label: 'Open', cls: 'cell-actions', cell: c => `${opened.has(c.id) ? '<span class="pill green">Opened</span> ' : ''}<a class="btn small ${opened.has(c.id) ? '' : 'primary'}" target="_blank" rel="noopener noreferrer" data-id="${c.id}" href="${esc(waLink(c.phone, ta.value.replaceAll('{name}', c.name.trim())))}">Open WhatsApp</a>` },
        ], customers);
      };
      d.querySelector('#wa-book').addEventListener('change', e => { ta.value = text(books.find(b => String(b.id) === e.target.value)); draw(); });
      ta.addEventListener('input', draw);
      list.addEventListener('click', e => { const a = e.target.closest('a[data-id]'); if (a) { opened.add(Number(a.dataset.id)); setTimeout(draw, 50); } });
      draw();
    },
  });
}
