import { get, esc, html, raw, inr, fmtDate, fmtMonth, pill, state, table, options, parseHash, setQuery, formData, qs, addDays, canEdit, canView } from '../core.js';
import { columnChart, barList } from '../charts.js';

const metric = (label, value, href, tone = '') =>
  `<a class="metric ${tone}" href="${href}"><span class="metric-label">${esc(label)}</span><span class="metric-value">${esc(value)}</span></a>`;
const group = (title, items) => `<section class="metric-group" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${items.join('')}</section>`;

const recentTable = (rows, showPerson) => table([
  { label: 'Sale', cell: r => `<a href="#/sales?open=${r.id}">${esc(r.sale_no)}</a><span class="sub">${esc(fmtDate(r.sale_date))}</span>` },
  { label: 'Customer', cell: r => `${esc(r.customer_name)}<span class="sub">${esc(r.channel)}${showPerson ? ' · ' + esc(r.salesperson_name) : ''}</span>` },
  { label: 'Amount', cls: 'num', cell: r => esc(inr(r.total_amount)) },
  { label: 'Payment', cell: r => pill(r.payment_status).__raw },
], rows, { empty: 'No sales yet', emptyHint: 'Sales appear here as soon as they are recorded.' });

const lowStockTable = rows => table([
  { label: 'Book', cell: b => `${esc(b.name)}<span class="sub">${esc(b.sku)}</span>` },
  { label: 'Available', cls: 'num', cell: b => `${b.available}${b.reserved ? `<span class="sub">${b.reserved} reserved</span>` : ''}` },
  { label: 'Minimum', cls: 'num', cell: b => String(b.min_stock) },
  { label: 'Status', cell: b => pill(b.available <= 0 ? 'Out of stock' : 'Low stock').__raw },
], rows, { empty: 'No books are running low' });

export async function render(page) {
  const d = await get('/api/dashboard');
  // Monthly reminder: the website's orders are due for upload until someone uploads them this month.
  const due = canEdit('webimport') ? await get('/api/imports/website').catch(() => null) : null;
  const reminder = due && due.due ? `<div class="notice warn"><strong>Monthly reminder.</strong> Download the ${esc(due.month)} orders from the website and upload them here. Orders already in the app are ignored. <a href="#/webimport">Upload website orders</a></div>` : '';
  const m = d.metrics; const month = fmtMonth(d.month); const m1 = `${d.month}-01`;
  const head = `<div class="page-head"><div><h1>Good to see you, ${esc(state.me.name.split(' ')[0])}</h1><div class="sub">${esc(fmtDate(d.today))}</div></div>
    ${canEdit('sales') && state.me.role !== 'dispatch' ? (state.me.role === 'onsite' && canEdit('visits') ? '<div class="actions"><a class="btn primary" href="#/visits?new=1">Record a visit</a></div>' : '<div class="actions"><a class="btn primary" href="#/sales?new=1">Record a sale</a></div>') : ''}</div>` + reminder;
  const dispatchGroup = () => group('Orders to dispatch', [
    metric('Awaiting packing', m.awaiting_packing, '#/sales?status=Confirmed', m.awaiting_packing ? 'attention' : ''),
    metric('Packing', m.packing, '#/sales?status=Packing'),
    metric('Ready to dispatch', m.ready, '#/sales?status=Ready%20to%20Dispatch', m.ready ? 'attention' : ''),
    metric('Dispatched, not yet delivered', m.dispatched, '#/sales?status=Dispatched'),
  ]);

  if (d.role === 'dispatch') {
    page.innerHTML = head + `<div class="metric-groups">${dispatchGroup()}
      ${group('Stock', [metric('Books at or below minimum', m.low_stock, '#/books?low=1', m.low_stock ? 'attention' : '')])}</div>
      <section class="panel"><h2>Low stock</h2>${lowStockTable(d.low_stock)}</section>`;
    return;
  }

  const mine = !d.channels; // a sales team member sees their own figures
  const salesGroups = [
    group(mine ? 'My sales' : 'Sales', [
      metric('Today', inr(m.sales_today), `#/sales?date_from=${d.today}&date_to=${d.today}`),
      metric('Orders today', m.orders_today, `#/sales?date_from=${d.today}&date_to=${d.today}`),
      metric(`${month}`, inr(m.sales_month), `#/sales?date_from=${m1}`),
      metric(`Orders in ${month}`, m.orders_month, `#/sales?date_from=${m1}`),
      metric(`Books sold in ${month}`, m.books_month, `#/sales?date_from=${m1}`),
    ]),
    group('Collections', [
      metric(`Collected in ${month}`, inr(m.collected_month), `#/sales?date_from=${m1}`),
      metric('Outstanding', inr(m.outstanding), '#/sales?payment_status=outstanding', m.outstanding ? 'attention' : ''),
      metric('Orders with a balance', m.outstanding_orders, '#/sales?payment_status=outstanding'),
      metric('Overdue orders', m.overdue_orders, '#/sales?payment_status=overdue', m.overdue_orders ? 'alert' : ''),
    ]),
  ];
  if (mine) {
    page.innerHTML = head + `<div class="metric-groups">${salesGroups.join('')}</div>
      <section class="panel"><h2>My recent sales</h2>${recentTable(d.recent, false)}</section>`;
    return;
  }
  page.innerHTML = head + `<div class="metric-groups">${salesGroups.join('')}
      ${group(`Channels in ${month}`, d.channels.map(c => metric(`${c.channel} · ${c.orders} order${c.orders === 1 ? '' : 's'}`, inr(c.amount), `#/sales?channel=${encodeURIComponent(c.channel)}&date_from=${m1}`)))}
      ${dispatchGroup()}
      ${group('Books & customers', [
        metric('Books at or below minimum', m.low_stock, '#/books?low=1', m.low_stock ? 'attention' : ''),
        metric('Customers', m.customers, '#/customers'),
      ])}
    </div>
    <div id="trends"></div>
    <div class="cols top-gap">
      <section class="panel"><h2>Recent sales</h2>${recentTable(d.recent, true)}</section>
      <section class="panel"><h2>Low stock</h2>${lowStockTable(d.low_stock)}</section>
    </div>`;
  if (canView('reports')) await renderTrends(page.querySelector('#trends'), d.today);
}

// ---------- Sales trends (charts) ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RANGES = [['month', 'This month'], ['last_month', 'Last month'], ['3m', 'Last 3 months'], ['12m', 'Last 12 months'], ['all', 'All time'], ['custom', 'Custom dates']];
const monthStart = (date, back = 0) => { let [y, m] = date.split('-').map(Number); m -= back; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}-01`; };
function rangeDates(range, today, q) {
  if (range === 'month') return [monthStart(today), today];
  if (range === 'last_month') return [monthStart(today, 1), addDays(monthStart(today), -1)];
  if (range === '3m') return [monthStart(today, 2), today];
  if (range === '12m') return [monthStart(today, 11), today];
  if (range === 'custom') return [q.date_from || '', q.date_to || ''];
  return ['', ''];
}

async function renderTrends(box, today) {
  const q = parseHash().query; const range = q.range || '12m';
  box.innerHTML = html`<form class="filters top-gap" id="t-filters">
      <div class="field"><label for="t-range">Period</label><select id="t-range" name="range">${raw(options(RANGES, range))}</select></div>
      <div class="field ${range === 'custom' ? '' : 'hidden'}" data-custom><label for="t-from">From</label><input id="t-from" name="date_from" type="date" value="${q.date_from}"></div>
      <div class="field ${range === 'custom' ? '' : 'hidden'}" data-custom><label for="t-to">To</label><input id="t-to" name="date_to" type="date" value="${q.date_to}"></div>
      <div class="field"><label for="t-group">Show by</label><select id="t-group" name="group">${raw(options([['day', 'Day'], ['week', 'Week'], ['month', 'Month']], q.group, 'Automatic'))}</select></div>
      <div class="field"><label for="t-ch">Channel</label><select id="t-ch" name="channel">${raw(options(['Tele-sales', 'Online', 'Onsite'], q.channel, 'All channels'))}</select></div>
      <div class="field"><label for="t-sp">Sales person</label><select id="t-sp" name="salesperson">${raw(options(state.people.map(p => [p.id, p.name]), q.salesperson, 'Everyone'))}</select></div>
      <div class="field"><label for="t-b">Book or set</label><select id="t-b" name="book_id">${raw(options(state.books.map(b => [b.id, b.name]), q.book_id, 'All'))}</select></div>
    </form><div id="t-body"></div>`;
  const form = box.querySelector('#t-filters'); const body = box.querySelector('#t-body');
  let seq = 0;
  const load = async () => {
    const f = formData(form); const mine = ++seq;
    box.querySelectorAll('[data-custom]').forEach(el => el.classList.toggle('hidden', f.range !== 'custom'));
    const [from, to] = rangeDates(f.range, today, f);
    setQuery({ ...f, range: f.range === '12m' ? '' : f.range, date_from: f.range === 'custom' ? f.date_from : '', date_to: f.range === 'custom' ? f.date_to : '' });
    const common = { channel: f.channel, salesperson: f.salesperson, book_id: f.book_id };
    let t;
    try { t = await get('/api/dashboard/trends' + qs({ date_from: from, date_to: to, group: f.group, ...common })); }
    catch (e) { if (mine === seq) body.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; return; }
    if (mine !== seq) return; // a newer choice was made while this was loading
    const link = extra => '#/sales' + qs({ date_from: from, date_to: to, ...common, ...extra });
    const tt = t.totals;
    const periodRow = r => {
      const p = r.period; let label, sub = '', a, b;
      if (t.group === 'month') { const [y, m] = p.split('-').map(Number); label = MON[m - 1]; sub = String(y); a = p + '-01'; b = addDays(monthStart(a, -1), -1); }
      else if (t.group === 'week') { const [, m, dd] = p.split('-').map(Number); label = `${dd} ${MON[m - 1]}`; a = p; b = addDays(p, 6); }
      else { const [, m, dd] = p.split('-').map(Number); label = String(dd); sub = MON[m - 1]; a = b = p; }
      if (from && a < from) a = from; if (to && b > to) b = to;
      return { label, sub, value: r.amount, tip: `${t.group === 'week' ? 'Week of ' : ''}${label} ${t.group === 'day' ? sub : t.group === 'month' ? sub : ''}: ${inr(r.amount)} · ${r.orders} order${r.orders === 1 ? '' : 's'}`, href: link({ date_from: a, date_to: b }) };
    };
    const unit = { day: 'day', week: 'week', month: 'month' }[t.group];
    const kpi = (l, v, s2 = '') => `<div class="kpi"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span><span class="s">${esc(s2)}</span></div>`;
    const orders = r => `${r.orders} order${r.orders === 1 ? '' : 's'}`;
    body.innerHTML = `
      <div class="kpis">
        ${kpi('Sales', inr(tt.amount), tt.first_date ? `${fmtDate(tt.first_date).slice(4)} to ${fmtDate(tt.last_date).slice(4)}` : '')}
        ${kpi('Orders', tt.orders.toLocaleString('en-IN'), tt.orders ? `average ${inr(Math.round(tt.amount / tt.orders))}` : '')}
        ${kpi('Collected', inr(tt.received), tt.outstanding ? `${inr(tt.outstanding)} outstanding` : 'nothing outstanding')}
        ${kpi('Customers', (tt.new_customers + tt.repeat_customers).toLocaleString('en-IN'), `${tt.new_customers.toLocaleString('en-IN')} new · ${tt.repeat_customers.toLocaleString('en-IN')} returning`)}
      </div>
      <section class="panel"><div class="trend-head"><h2>Sales by ${unit}</h2><span class="muted small">Cancelled orders are left out. Click a bar to see its orders.</span></div>
        <div class="chart-scroll">${columnChart(t.series.map(periodRow), { title: `Sales by ${unit}` })}</div></section>
      <div class="chart-grid">
        <section class="panel"><h2>Sales by product</h2>${barList(t.byProduct.map(r => ({ label: r.label, value: r.amount, note: `${r.qty} sold`, href: link({ book_id: r.id }) })), { title: 'Sales by product' })}</section>
        <section class="panel"><h2>Sales by person</h2>${barList(t.byPerson.map(r => ({ label: r.label, value: r.amount, note: orders(r), href: link({ salesperson: r.id }) })), { title: 'Sales by person' })}</section>
        <section class="panel"><h2>Sales by district</h2>${barList(t.byLocation.map(r => ({ label: r.label, value: r.amount, note: orders(r) })), { title: 'Sales by district' })}</section>
        <section class="panel"><h2>Sales by channel</h2>${barList(t.byChannel.map(r => ({ label: r.label, value: r.amount, note: orders(r), href: link({ channel: r.label }) })), { title: 'Sales by channel' })}
          <h2 class="top-gap">Payment</h2>${barList(t.byPayment.map(r => ({ label: r.label, value: r.amount, note: orders(r) })), { title: 'Payment' })}</section>
      </div>`;
  };
  form.addEventListener('change', load);
  form.addEventListener('submit', e => e.preventDefault());
  await load();
}

