import { api, get, esc, html, raw, inr, pill, table, drawer, onSubmit, options, toast, fmtDate, parseHash, wireFilters, qs, state, waLink, can } from '../core.js';
import { openSale } from './sales.js';
import { callsTable, callForm, wireCallActions } from './calls.js';
import { visitsTable, wireVisitActions } from './visits.js';
import { saleForm } from './sale-form.js';


export async function renderList(page, { query }) {
  const locations = await get('/api/customers/locations');
  const products = state.books.filter(b => b.active && b.sku !== 'OTHER').map(b => [b.id, b.name]);
  page.innerHTML = html`<div class="page-head"><div><h1>Customers</h1><div class="sub">Created automatically from sales. A customer is recognised by their contact number.</div></div>
      <div class="actions">${raw(can('admin', 'manager') ? '<button class="btn" type="button" id="gc-dl">Download for Google Contacts</button>' : '')}<button class="btn" type="button" id="wa-all">WhatsApp the customers shown</button></div></div>
    <form class="filters" id="c-filters">
      <div class="field grow"><label for="cf-q">Search</label><input id="cf-q" name="q" type="search" placeholder="Name, phone or customer ID" value="${query.q}"></div>
      <div class="field"><label for="cf-t">Customer type</label><select id="cf-t" name="type">${raw(options(state.lists.customer_types, query.type, 'All types'))}</select></div>
      <div class="field"><label for="cf-l">Location</label><select id="cf-l" name="location">${raw(options(locations, query.location, 'All locations'))}</select></div>
      <div class="field"><label for="cf-ord">Orders</label><select id="cf-ord" name="orders">${raw(options([['repeat', 'Repeat customers (2 or more orders)'], ['once', 'Ordered once']], query.orders, 'Any'))}</select></div>
      <div class="field"><label for="cf-bo">Bought</label><select id="cf-bo" name="bought">${raw(options(products, query.bought, 'Any book or set'))}</select></div>
      <div class="field"><label for="cf-nb">But has not bought</label><select id="cf-nb" name="not_bought">${raw(options(products, query.not_bought, 'No condition'))}</select></div>
      <div class="field"><label for="cf-k">Show</label><select id="cf-k" name="kind">${raw(options([['Lead', 'Leads (called, not bought yet)'], ['all', 'Customers and leads']], query.kind, 'Customers'))}</select></div>
      <div class="field"><label for="cf-o">Payments</label><select id="cf-o" name="outstanding">${raw(options([['1', 'Has an outstanding amount']], query.outstanding, 'All'))}</select></div>
      <button class="btn" type="button" data-clear>Clear filters</button>
    </form><p class="result-count" id="c-count"></p><div id="c-list"></div>`;
  let shown = [];
  // Google Contacts: download the customers that match the current filters as a file to import at contacts.google.com.
  page.querySelector('#gc-dl')?.addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await fetch('/api/customers/google-contacts.csv' + qs(parseHash().query), { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not prepare the file');
      const n = Number(res.headers.get('X-Contact-Count') || 0);
      if (!n) { toast('No customer in this list has a contact number', 'error'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'nalla-malayalam-contacts.csv';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      drawer({ title: `${n.toLocaleString('en-IN')} contacts downloaded`, body: `<p>The file <strong>nalla-malayalam-contacts.csv</strong> is in your Downloads folder. To add the contacts to your Google account:</p>
        <ol><li>Open <strong>contacts.google.com</strong> and sign in to the Google account you want them in.</li><li>Choose <strong>Import</strong> in the left menu.</li><li>Select the downloaded file and press <strong>Import</strong>.</li></ol>
        <p>Google puts them under the label <strong>Nalla Malayalam Customers</strong>, so they are easy to find or remove together. They then appear on any phone signed in to that account.</p>
        <p class="muted">Importing the same file twice makes duplicates; Google Contacts has a "Merge &amp; fix" option to tidy them.</p>`, foot: '<button class="btn primary" type="button" data-close>Done</button>' });
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
  page.querySelector('#wa-all').addEventListener('click', () => whatsappDrawer(shown.filter(c => waLink(c.phone))));
  page.querySelector('#c-list').addEventListener('click', e => { const b = e.target.closest('[data-wa]'); if (b) whatsappDrawer(shown.filter(c => String(c.id) === b.dataset.wa)); });
  const load = async () => {
    const q = parseHash().query; const r = await get('/api/customers' + qs(q)); shown = r.rows;
    page.querySelector('#c-count').textContent = r.truncated ? `${r.total.toLocaleString('en-IN')} customers match. Showing the first 500; the Google Contacts download includes all of them.` : `${r.rows.length} customer${r.rows.length === 1 ? '' : 's'}`;
    const any = Object.keys(q).length;
    page.querySelector('#c-list').innerHTML = table([
      { label: 'Customer', cell: c => `<a href="#/customer/${c.id}">${esc(c.name)}</a>${c.kind === 'Lead' ? ' ' + pill('Lead', 'blue').__raw : ''}<span class="sub">${esc(c.code)} · ${esc(c.type)}</span>` },
      { label: 'Contact number', cell: c => esc(c.phone) },
      { label: 'Location', cell: c => esc(c.location || '—') },
      { label: 'Orders', cls: 'num', cell: c => String(c.total_orders) },
      { label: 'Total purchases', cls: 'num', cell: c => esc(inr(c.total_purchase_amount)) },
      { label: 'Outstanding', cls: 'num', cell: c => (c.outstanding_amount ? `<span class="sub due">${esc(inr(c.outstanding_amount))}</span>` : '—') },
      { label: 'Last purchase', cell: c => (c.last_purchase_date ? esc(fmtDate(c.last_purchase_date)) : '—') },
      { label: 'Message', cls: 'cell-actions', cell: c => (waLink(c.phone) ? `<button class="btn small" type="button" data-wa="${c.id}">WhatsApp</button>` : '') },
    ], r.rows, { empty: any ? 'No customers match these filters' : 'No customers yet', emptyHint: any ? 'Clear the filters to see everyone.' : 'Customers appear here when a sale with a contact number is recorded.' });
  };
  wireFilters(page.querySelector('#c-filters'), load);
  await load();
}

export async function renderProfile(page, { id }) {
  const c = await get(`/api/customers/${id}`);
  const isPlace = state.lists.places.includes(c.type);
  const kpi = (l, v, cls = '') => `<div class="kpi ${cls}"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span></div>`;
  page.innerHTML = `<div class="page-head"><div><h1>${esc(c.name)}</h1><div class="sub">${c.kind === 'Lead' ? 'Lead · ' : ''}${esc(c.code)} · ${esc(c.type)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.location ? ' · ' + esc(c.location) : ''}${c.contact_person ? ' · contact: ' + esc(c.contact_person) : ''}</div></div>
      <div class="actions"><a class="btn" href="#/customers">All customers</a><button class="btn" type="button" id="edit-c">Edit details</button>${waLink(c.phone) ? '<button class="btn" type="button" id="wa-one">WhatsApp</button>' : ''}${can('admin', 'manager', 'telesales') ? '<button class="btn" type="button" id="call-one">Log a call</button>' : ''}
        ${isPlace && can('admin', 'manager', 'onsite') ? '<button class="btn primary" type="button" id="visit-one">Record a visit</button>' : c.phone ? `<a class="btn primary" href="#/sales?new=1&phone=${encodeURIComponent(c.phone)}">Record a sale</a>` : ''}</div></div>
    ${c.address ? `<p class="muted">${esc(c.address)}</p>` : ''}
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
  page.querySelector('#edit-c').addEventListener('click', () => drawer({
    title: `Edit ${c.name}`,
    body: html`<form id="c-form" novalidate>
      <div class="field"><label for="c-name">Customer name *</label><input id="c-name" name="name" required maxlength="150" value="${c.name}"></div>
      <div class="grid2">
        <div class="field"><label for="c-phone">Contact number${isPlace ? '' : ' *'}</label><input id="c-phone" name="phone" type="tel" maxlength="30" value="${c.phone}"></div>
        <div class="field"><label for="c-type">Customer type *</label><select id="c-type" name="type">${raw(options(state.lists.customer_types, c.type))}</select></div>
      </div>
      <div class="field"><label for="c-addr">Address</label><textarea id="c-addr" name="address" maxlength="500">${c.address}</textarea></div>
      ${raw(isPlace ? `<div class="field"><label for="c-cp">Contact person</label><input id="c-cp" name="contact_person" maxlength="100" value="${esc(c.contact_person)}"></div>` : '')}
      <div class="field"><label for="c-loc">Location</label><input id="c-loc" name="location" maxlength="100" value="${c.location}"></div>
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
