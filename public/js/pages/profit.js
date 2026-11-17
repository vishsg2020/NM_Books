// Costs & profit: cost of each book or set, profit per copy at each price, and estimated profit on what was sold.
import { api, get, esc, html, raw, inr, pill, table, drawer, onSubmit, options, toast, can, parseHash, formData, qs, todayLocal, addDays, fmtDate } from '../core.js';

const money = n => (n === null || n === undefined ? '—' : (n < 0 ? '−₹' : '₹') + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pct = n => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%');
const tone = p => (p.profit < 0 ? 'due' : '');
const cell = p => `<span class="${p.profit < 0 ? 'sub due' : ''}">${money(p.profit)}</span><span class="sub">${pct(p.margin)} at ${money(p.price)}</span>`;
const RANGES = [['month', 'This month'], ['3m', 'Last 3 months'], ['12m', 'Last 12 months'], ['all', 'All time'], ['custom', 'Custom dates']];
const monthStart = (date, back = 0) => { let [y, m] = date.split('-').map(Number); m -= back; while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}-01`; };

// The same rules as the server (src/routes/profit.js), for the "try a price" box.
function unitCost(c, price, mode, rules) {
  const on = new Set(rules[mode] || []); let cost = 0;
  for (const k of ['printing', 'packing', 'postal', 'misc', 'ad_cost', 'amazon_fee']) if (on.has(k)) cost += c[k];
  if (on.has('royalty')) cost += (c.royalty_pct / 100) * price;
  if (on.has('commission')) cost += (c.commission_pct / 100) * price;
  return cost;
}
const PARTS = [['printing', 'Printing'], ['packing', 'Packing'], ['postal', 'Postal'], ['misc', 'Misc'], ['ad_cost', 'Ad cost'], ['amazon_fee', 'Amazon fee'], ['royalty', 'Royalty'], ['commission', 'Commission']];
const MODES = [['tele', 'Tele-sales'], ['website', 'Website'], ['amazon', 'Amazon'], ['onsite', 'Onsite']];

export async function render(page, { query }) {
  const today = todayLocal(); const range = query.range || '12m';
  const from = range === 'month' ? monthStart(today) : range === '3m' ? monthStart(today, 2) : range === '12m' ? monthStart(today, 11) : range === 'custom' ? (query.date_from || '') : '';
  const to = range === 'custom' ? (query.date_to || '') : range === 'all' ? '' : today;
  const d = await get('/api/profit' + qs({ date_from: from, date_to: to }));
  const admin = can('admin'); const t = d.total;
  const kpi = (l, v, s = '') => `<div class="kpi"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span><span class="s">${esc(s)}</span></div>`;
  const costed = d.rows.filter(r => r.has_costs); const sold = costed.filter(r => r.sold.qty > 0).sort((a, b) => b.sold.profit - a.sold.profit);
  page.innerHTML = html`<div class="page-head"><div><h1>Costs &amp; profit</h1><div class="sub">What each book or set costs, what is left at each price, and an estimate of profit on what was sold.</div></div></div>
    <h2>Profit per copy</h2>
    ${raw(table([
      { label: 'Book or set', cell: r => `${esc(r.name)}${r.kind === 'Pack' ? ' ' + pill('Set', 'blue').__raw : ''}<span class="sub">MRP ${r.mrp ? money(r.mrp) : '—'} · sells at ${money(r.price)}</span>${r.has_costs ? '' : '<span class="sub due">Costs not entered</span>'}` },
      { label: 'Total cost', cls: 'num', cell: r => (r.has_costs ? `${money(r.tele.cost)}<span class="sub">printing ${money(r.costs.printing)}</span>` : '—') },
      { label: 'Profit (tele-sales)', cls: 'num', cell: r => (r.has_costs ? cell(r.tele) : '—') },
      { label: 'Without ad cost', cls: 'num', cell: r => (r.has_costs ? money(r.no_ads) : '—') },
      { label: 'Website', cls: 'num', cell: r => (r.has_costs ? cell(r.website) : '—') },
      { label: 'Amazon', cls: 'num', cell: r => (r.has_costs ? cell(r.amazon) : '—') },
      { label: 'Onsite', cls: 'num', cell: r => (r.has_costs ? cell(r.onsite) : '—') },
      { label: 'Break-even price', cls: 'num', cell: r => (r.has_costs && r.break_even ? `${money(r.break_even)}<span class="sub">${r.mrp ? pct(Math.max(0, (1 - r.break_even / r.mrp) * 100)) + ' off MRP at most' : ''}</span>` : '—') },
      ...(admin ? [{ label: 'Actions', cls: 'cell-actions', cell: r => `<button class="btn small" type="button" data-costs="${r.id}">${r.has_costs ? 'Edit costs' : 'Enter costs'}</button>` }] : []),
    ], d.rows.filter(r => r.active), { empty: 'No books yet' }))}
    <p class="muted small">${raw(MODES.map(([m, l]) => `${l} counts ${d.rules[m].length ? PARTS.filter(p => d.rules[m].includes(p[0])).map(p => p[1].toLowerCase()).join(', ') : 'no costs'}.`).join(' '))}
      Break-even is the lowest tele-sales price that still covers every cost.</p>
    ${raw(admin ? '<div class="btn-row"><button class="btn small" type="button" id="rules-btn">Change which costs count for each channel</button></div>' : '')}

    <div class="trend-head top-gap"><h2>Estimated profit on what was sold</h2></div>
    <form class="filters" id="pf-filters">
      <div class="field"><label for="pf-r">Period</label><select id="pf-r" name="range">${raw(options(RANGES, range))}</select></div>
      ${raw(range === 'custom' ? `<div class="field"><label for="pf-f">From</label><input id="pf-f" name="date_from" type="date" value="${esc(from)}"></div><div class="field"><label for="pf-t">To</label><input id="pf-t" name="date_to" type="date" value="${esc(to)}"></div>` : '')}
    </form>
    <div class="kpis">
      ${raw(kpi('Sales of costed books', money(t.revenue), `${t.qty.toLocaleString('en-IN')} copies or sets`))}
      ${raw(kpi('Estimated cost', money(Math.round(t.cost))))}
      ${raw(kpi('Estimated profit', money(Math.round(t.profit)), t.revenue ? `${pct((t.profit / t.revenue) * 100)} of sales` : ''))}
      ${raw(kpi('Sales with no costs entered', money(d.uncosted_revenue), 'left out of the estimate'))}
    </div>
    ${raw(table([
      { label: 'Book or set', cell: r => esc(r.name) },
      { label: 'Sold', cls: 'num', cell: r => r.sold.qty.toLocaleString('en-IN') },
      { label: 'Sales', cls: 'num', cell: r => money(r.sold.revenue) },
      { label: 'Estimated cost', cls: 'num', cell: r => money(Math.round(r.sold.cost)) },
      { label: 'Estimated profit', cls: 'num', cell: r => `<span class="${r.sold.profit < 0 ? 'sub due' : ''}">${money(Math.round(r.sold.profit))}</span>` },
      { label: 'Margin', cls: 'num', cell: r => pct(r.sold.revenue ? (r.sold.profit / r.sold.revenue) * 100 : null) },
    ], sold, { empty: 'Nothing sold in this period', emptyHint: 'Choose a longer period.' }))}
    <p class="muted small">An estimate: every copy sold is given today's costs, by the channel it was sold through. Ad cost, packing and postal are counted once per book or set, as in the costing sheet, so an order with several items is charged them more than once.</p>`;
  const form = page.querySelector('#pf-filters');
  form.addEventListener('change', () => { const f = formData(form); location.hash = '/profit' + qs({ ...f, range: f.range === '12m' ? '' : f.range }); });
  form.addEventListener('submit', e => e.preventDefault());
  const again = () => render(page, { query: parseHash().query });
  page.querySelector('#rules-btn')?.addEventListener('click', () => rulesForm(d.rules, again));
  page.addEventListener('click', e => { const b = e.target.closest('[data-costs]'); if (b) costForm(d.rows.find(r => String(r.id) === b.dataset.costs), again, d.rules); });
}

const FIELDS = [['printing', 'Printing'], ['packing', 'Packing'], ['postal', 'Postal'], ['misc', 'Misc'], ['ad_cost', 'Ad cost'], ['amazon_fee', 'Amazon fee']];

function costForm(r, after, rules) {
  drawer({
    title: `Costs: ${r.name}`,
    body: html`<form id="cost-form" novalidate>
      <p class="muted">Rupees for one copy${r.kind === 'Pack' ? ' of the set' : ''}. MRP ${r.mrp ? money(r.mrp) : '—'}, sells at ${money(r.price)}.</p>
      <div class="grid3">${raw(FIELDS.map(([k, l]) => `<div class="field"><label for="k-${k}">${l}</label><input id="k-${k}" name="${k}" type="number" inputmode="decimal" min="0" step="0.01" value="${r.costs[k]}"></div>`).join(''))}</div>
      <div class="grid2">
        <div class="field"><label for="k-roy">Royalty %</label><input id="k-roy" name="royalty_pct" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="${r.costs.royalty_pct}"><div class="hint">Of the price the copy is sold at.</div></div>
        <div class="field"><label for="k-com">Commission %</label><input id="k-com" name="commission_pct" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="${r.costs.commission_pct}"><div class="hint">Sales commission, tele-sales only.</div></div>
      </div>
      <fieldset><legend>Try a price</legend>
        <div class="field"><label for="k-try">Price</label><div class="money"><span>₹</span><input id="k-try" type="number" inputmode="numeric" min="0" step="1" value="${r.price}"></div>
          <div class="hint">For a school or bookstall rate: see what is left before you quote it.</div></div>
        <div id="k-out"></div><p></p>
      </fieldset>
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="cost-form">Save costs</button>`,
    onMount: (d, close) => {
      const form = d.querySelector('#cost-form');
      const show = () => {
        const v = formData(form); const c = {}; for (const k of [...FIELDS.map(f => f[0]), 'royalty_pct', 'commission_pct']) c[k] = Number(v[k]) || 0;
        const price = Number(d.querySelector('#k-try').value) || 0;
        const line = (label, mode) => { const p = price - unitCost(c, price, mode, rules); return `<dt>${label}</dt><dd class="${p < 0 ? 'due' : ''}">${money(Math.round(p * 100) / 100)} <span class="muted small">${price ? pct((p / price) * 100) : ''}</span></dd>`; };
        d.querySelector('#k-out').innerHTML = `<dl class="totals">${r.mrp ? `<dt>Discount on MRP</dt><dd>${pct(Math.max(0, (1 - price / r.mrp) * 100))}</dd>` : ''}${line('Profit by tele-sales', 'tele')}${line('Profit on the website', 'website')}${line('Profit on Amazon', 'amazon')}${line('Profit onsite (school, bookstall)', 'onsite')}</dl>`;
      };
      form.addEventListener('input', show); show();
      onSubmit(form, async v => { await api('PUT', `/api/books/${r.id}/costs`, v); close(); toast('Costs saved'); after(); });
    },
  });
}

/** Admin: which costs count for each channel. */
function rulesForm(rules, after) {
  drawer({
    wide: true, title: 'Costs counted for each channel',
    body: html`<form id="rules-form" novalidate><p class="muted">Tick the costs that apply when a book is sold through each channel. The profit figures on this page follow at once.</p>
      ${raw(table([{ label: 'Cost', cell: p => esc(p[1]) }, ...MODES.map(([m, l]) => ({ label: l, cls: 'center', cell: p => `<input type="checkbox" name="${m}:${p[0]}" aria-label="${esc(p[1])} for ${esc(l)}" ${rules[m].includes(p[0]) ? 'checked' : ''}>` }))], PARTS))}</form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="rules-form">Save rules</button>`,
    onMount: (d, close) => onSubmit(d.querySelector('#rules-form'), async v => {
      const body = {}; for (const [m] of MODES) body[m] = PARTS.map(p => p[0]).filter(k => v[`${m}:${k}`]);
      await api('PUT', '/api/settings/cost-rules', body); close(); toast('Cost rules saved'); after();
    }),
  });
}
