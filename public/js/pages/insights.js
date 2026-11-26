// Tele-sales → Insights: where customers are, when they buy and answer the phone, how they buy, and what that means
// for the tele-sales team. All figures come from /api/insights.
import { api, get, esc, html, raw, table, drawer, onSubmit, options, toast, inr, state, canEdit, parseHash, qs, wireFilters } from '../core.js';

// Kerala districts as tiles, north to south (column, row), coast on the left.
const TILES = { Kasaragod: [1, 0], Kannur: [1, 1], Wayanad: [2, 1], Kozhikode: [1, 2], Malappuram: [2, 2], Thrissur: [1, 3], Palakkad: [2, 3],
  Ernakulam: [1, 4], Idukki: [2, 4], Alappuzha: [1, 5], Kottayam: [2, 5], Kollam: [1, 6], Pathanamthitta: [2, 6], Thiruvananthapuram: [1, 7] };
const METRICS = [['customers', 'Customers'], ['orders', 'Orders'], ['amount', 'Sales ₹'], ['repeat_pct', 'Repeat rate'], ['dormant', 'Nothing in 6 months']];
const RANGES = [['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['all', 'All time']];
const n = v => Number(v || 0).toLocaleString('en-IN');
// Short book names for the district table: "Nalla Malayalam - Bundle (Part 1 + Part 2)" → "NM Part 1 + 2".
const short = name => String(name || '').replace(/Nalla Malayalam - Bundle \(Part 1 \+ Part 2\)/, 'NM Part 1 + 2').replace(/Nalla Malayalam - /, 'NM ')
  .replace(/Kuttivayana /, 'KVS ').replace(/,? set of \d+\)/, ')').replace(/ \(set of \d+\)/, '').replace(/ \(\)$/, '');
const fmt = (k, v) => (k === 'amount' ? inr(v) : k === 'repeat_pct' ? `${v}%` : n(v));

export async function render(page, { query }) {
  const books = state.books.filter(b => b.active && b.sku !== 'OTHER').map(b => [b.id, b.name]);
  page.innerHTML = html`<div class="page-head"><div><h1>Insights</h1><div class="sub">Where customers are, when they buy and answer, and how to approach them.</div></div></div>
    <form class="filters" id="in-f">
      <div class="field"><label for="in-r">Period</label><select id="in-r" name="range">${raw(options(RANGES, query.range || '12m'))}</select></div>
      <div class="field"><label for="in-c">Channel</label><select id="in-c" name="channel">${raw(options(['Tele-sales', 'Online', 'Onsite'], query.channel, 'All channels'))}</select></div>
      <div class="field"><label for="in-b">Book or set</label><select id="in-b" name="book_id">${raw(options(books, query.book_id, 'All books'))}</select></div>
      <div class="field"><label for="in-m">Map shows</label><select id="in-m" name="map">${raw(options(METRICS, query.map || 'customers'))}</select></div>
    </form><div id="in-body"><p class="muted">Counting…</p></div>`;
  const body = page.querySelector('#in-body');
  const load = async () => {
    const f = parseHash().query;
    const d = await get('/api/insights' + qs({ range: f.range, channel: f.channel, book_id: f.book_id }));
    draw(body, d, f.map || 'customers');
  };
  wireFilters(page.querySelector('#in-f'), load);
  await load();
}

function draw(box, d, metric) {
  const cb = d.come_back; const c = d.calls;
  const cards = [
    c.best ? ['Best time to call', `${c.best.slot}, ${c.best.days.join(', ')}`, `${c.best.rate}% of calls answered then, against ${c.best.overall}% overall.`]
      : ['Best time to call', 'Not enough calls yet', `${n(c.total)} of ${n(c.needed)} calls logged in this period. Log every call and this fills in.`],
    cb.label ? ['When to call back', `${cb.label} after an order`, `${cb.share}% of second orders come then. ${n(cb.customers_now)} customers are in that window now.`] : ['When to call back', '—', 'No repeat orders yet.'],
    d.season ? ['Busy season', `${d.season.from}–${d.season.to}`, `${d.season.share}% of orders in these four months. Start calling in ${d.season.start_calling}.`] : ['Busy season', '—', 'No orders in this period.'],
    d.call_first.length ? ['Where to call first', d.call_first.map(x => x.place).join(', '), `${n(d.call_first.reduce((a, x) => a + x.dormant, 0))} customers there have bought nothing in 6 months.${d.call_first[0].cod_pct >= 25 ? ` ${d.call_first[0].place} often pays by COD (${d.call_first[0].cod_pct}%).` : ''}`] : ['Where to call first', '—', 'No district has quiet customers.'],
  ];
  const kd = d.where.filter(w => w.district); const vals = kd.map(w => w[metric]).sort((a, b) => a - b);
  const level = v => { if (!vals.length || !v) return 1; const r = vals.filter(x => x <= v).length / vals.length; return r > 0.8 ? 5 : r > 0.6 ? 4 : r > 0.4 ? 3 : r > 0.2 ? 2 : 1; };
  const tiles = Object.entries(TILES).map(([name, [col, row]]) => { const w = kd.find(x => x.place === name) || { [metric]: 0 };
    return `<div class="tile l${level(w[metric])}" data-col="${col + 1}" data-row="${row + 1}" title="${esc(name)}: ${esc(fmt(metric, w[metric]))}"><span>${esc(name)}</span><b>${esc(fmt(metric, w[metric]))}</b></div>`; }).join('');
  const maxM = Math.max(1, ...d.months.map(m => m.orders)); const topMonths = [...d.months].sort((a, b) => b.orders - a.orders).slice(0, 3).map(m => m.month);
  const maxG = Math.max(1, ...cb.buckets.map(b => b.customers));
  const wd = [...d.weekdays].sort((a, b) => b.orders - a.orders); const wdTotal = d.weekdays.reduce((a, x) => a + x.orders, 0);
  box.innerHTML = `<div class="adv">${cards.map(([t, b, s]) => `<div class="card"><span class="t">${esc(t)}</span><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>
    <section class="panel"><h2>Where</h2><p class="muted small">${n(d.customers)} customers with ${n(d.orders)} orders in this period. "Nothing in 6 months": customers who have bought before but not since ${esc(new Date(Date.parse(d.to) - 182 * 864e5).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}.</p>
      <div class="geo"><div><div class="tiles">${tiles}</div><div class="legend2">less <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i> more · ${esc(METRICS.find(m => m[0] === metric)[1].toLowerCase())}</div></div>
      <div>${table([
        { label: 'District', cell: w => `<b>${esc(w.place)}</b>` },
        { label: 'Customers', cls: 'num', cell: w => n(w.customers) },
        { label: 'Orders', cls: 'num', cell: w => n(w.orders) },
        { label: 'Repeat', cls: 'num', cell: w => `${w.repeat_pct}%` },
        { label: 'Avg order', cls: 'num', cell: w => esc(inr(w.avg_order)) },
        { label: 'Top book', cell: w => `<span title="${esc(w.top_book || '')}">${esc(short(w.top_book) || '—')}</span>` },
        { label: 'COD', cls: 'num', cell: w => `${w.cod_pct}%` },
        { label: 'Nothing in 6 months', cls: 'num', cell: w => `<b>${n(w.dormant)}</b>` },
        { label: 'Actions', cls: 'cell-actions', cell: w => (w.district && w.dormant && canEdit('customers') ? `<button class="btn small" type="button" data-list="${esc(w.place)}">Make a list</button>` : '') },
      ], d.where, { empty: 'No customers in this period' })}</div></div></section>
    <div class="cols top-gap">
      <section class="panel"><h2>When they answer the phone</h2>${c.grid ? `<p class="muted small">Share of calls answered, by day and time. ${n(c.total)} calls in this period; a blank cell has no calls.</p>
        <div class="table-wrap hm-wrap"><table class="hm"><thead><tr><th></th>${c.grid[0].days.map(x => `<th scope="col">${esc(x.day)}</th>`).join('')}</tr></thead>
        <tbody>${c.grid.map(g => `<tr><th scope="row">${esc(g.slot)}</th>${g.days.map(x => `<td class="${x.answered_pct === null ? '' : 'h' + Math.min(5, Math.max(1, Math.ceil((x.answered_pct - 25) / 10)))}" title="${x.calls} calls">${x.answered_pct === null ? '' : x.answered_pct + '%'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : `<div class="notice info">This shows once ${n(c.needed)} calls are logged in the period: ${n(c.total)} so far. Each call logged in Calls counts, with its time.</div>`}</section>
      <section class="panel"><h2>When they buy</h2><p class="muted small">Orders by month (all years in the period together). Darker: the busiest months.</p>
        <div class="vbars">${d.months.map(m => `<div class="vbar${topMonths.includes(m.month) && m.orders ? ' hi' : ''}" data-h="${Math.round((m.orders / maxM) * 100)}" title="${esc(m.month)}: ${n(m.orders)} orders"><span>${esc(m.month)}</span></div>`).join('')}</div>
        <p class="note">${wdTotal ? `${esc(wd[0].day)} and ${esc(wd[1].day)} bring ${Math.round(((wd[0].orders + wd[1].orders) / wdTotal) * 100)}% of orders; ${esc(wd[6].day)} the fewest.` : ''}</p></section>
    </div>
    <div class="cols top-gap">
      <section class="panel"><h2>When they come back</h2><p class="muted small">Time between a customer's first and second order (all time).</p>
        <div class="vbars">${cb.buckets.map(b => `<div class="vbar${cb.label && b.customers >= maxG * 0.8 ? ' hi' : ''}" data-h="${Math.round((b.customers / maxG) * 100)}" title="${esc(b.label)}: ${n(b.customers)} customers"><span>${esc(b.label)}</span></div>`).join('')}</div>
        <p class="note">${cb.median_days !== undefined ? `Half come back within ${Math.round(cb.median_days / 7)} weeks. ${cb.repeat_pct}% of customers have ordered more than once.` : 'No repeat orders yet.'}</p></section>
      <section class="panel"><h2>How they buy</h2>${table([
        { label: 'Pattern', cell: h => esc(h.label) },
        { label: 'Share', cls: 'num', cell: h => `${h.pct}%` },
      ], d.how, { empty: 'No orders in this period' })}</section>
    </div>`;
  // Sizes and places are set here, not inline (the page's security policy blocks inline styles).
  box.querySelectorAll('.tile').forEach(t => { t.style.gridColumn = t.dataset.col; t.style.gridRow = t.dataset.row; });
  box.querySelectorAll('.vbar').forEach(b => { b.style.height = Math.max(2, Number(b.dataset.h)) + '%'; });
  box.onclick = e => {
    const b = e.target.closest('[data-list]'); if (!b) return;
    const place = b.dataset.list; const w = d.where.find(x => x.place === place);
    const month = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    drawer({
      title: 'Make a follow-up list',
      body: html`<p>Customers in <strong>${place}</strong> who have bought before but nothing in the last 6 months (about ${n(w.dormant)}; records that still need an update are left out).</p>
        <form id="il-form" novalidate><div class="field"><label for="il-name">List name *</label><input id="il-name" name="name" required maxlength="120" value="${place}: nothing in 6 months — ${month}"></div>
        <div class="field"><label for="il-note">Note for the team</label><textarea id="il-note" name="note" rows="3" maxlength="500">${d.calls.best ? `Best time to call: ${d.calls.best.slot}, ${d.calls.best.days.join(', ')}.` : ''}${w.top_book ? ` Most bought here: ${w.top_book}.` : ''}</textarea></div></form>`,
      foot: '<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="il-form">Save list</button>',
      onMount: (dd, close) => onSubmit(dd.querySelector('#il-form'), async v => {
        const r = await api('POST', '/api/followups', { name: v.name, note: v.note, filters: { location: place, not_since: '6', sort: 'spent' } });
        close(); toast(`List saved with ${r.total.toLocaleString('en-IN')} customers`); location.hash = `#/followups/${r.id}`;
      }),
    });
  };
}
