// Dispatch report: books and sets sent out, by day or month. Replaces the "Daily Dispatch - Report" Google Form:
// days before the app come from the imported form answers, later days from orders moved to "Dispatched".
import { api, get, esc, html, raw, fmtDate, fmtMonth, table, options, parseHash, formData, qs, todayLocal, drawer, onSubmit, toast, canEdit } from '../core.js';
import { columnChart, barList } from '../charts.js';

const RANGES = [['month', 'This month'], ['3m', 'Last 3 months'], ['12m', 'Last 12 months'], ['all', 'All time'], ['custom', 'Custom dates']];
const monthStart = (date, back = 0) => { let [y, m] = date.split('-').map(Number); m -= back; while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}-01`; };
const n = v => Number(v || 0).toLocaleString('en-IN');

export async function render(page, { query }) {
  const today = todayLocal(); const range = query.range || '3m'; const group = query.group === 'month' ? 'month' : 'day';
  const from = range === 'month' ? monthStart(today) : range === '3m' ? monthStart(today, 2) : range === '12m' ? monthStart(today, 11) : range === 'custom' ? (query.date_from || '') : '';
  const to = range === 'custom' ? (query.date_to || '') : range === 'all' ? '' : today;
  const d = await get('/api/dispatch-report' + qs({ date_from: from, date_to: to, group }));
  const kpi = (l, v, s = '') => `<div class="kpi"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span><span class="s">${esc(s)}</span></div>`;
  const label = p => (group === 'month' ? fmtMonth(p) : fmtDate(p));
  const f = d.sources.form, a = d.sources.app, mn = d.sources.manual;
  const source = [mn ? `${n(mn.qty)} from daily reports entered here` : '', f ? `${n(f.qty)} from the old dispatch form (${fmtDate(f.first_day)} to ${fmtDate(f.last_day)})` : '', a ? `${n(a.qty)} from orders dispatched in this app` : ''].filter(Boolean).join(' and ');
  const chartRows = [...d.rows].reverse().map(r => ({ label: group === 'month' ? fmtMonth(r.period).slice(0, 3) : String(Number(r.period.slice(8))), sub: group === 'month' ? r.period.slice(0, 4) : '', value: r.total, tip: `${label(r.period)}: ${n(r.total)} books and sets` }));
  page.innerHTML = html`<div class="page-head"><div><h1>Dispatch report</h1><div class="sub">Books and sets sent out, by ${group}. A set counts as one.</div></div>
      ${raw(canEdit('dispatch') ? '<div class="btn-row"><button class="btn primary" type="button" id="dp-add">Add daily report</button></div>' : '')}</div>
    <form class="filters" id="dp-filters">
      <div class="field"><label for="dp-r">Period</label><select id="dp-r" name="range">${raw(options(RANGES, range))}</select></div>
      ${raw(range === 'custom' ? `<div class="field"><label for="dp-f">From</label><input id="dp-f" name="date_from" type="date" value="${esc(from)}"></div><div class="field"><label for="dp-t">To</label><input id="dp-t" name="date_to" type="date" value="${esc(to)}"></div>` : '')}
      <div class="field"><label for="dp-g">Show by</label><select id="dp-g" name="group">${raw(options([['day', 'Day'], ['month', 'Month']], group))}</select></div>
    </form>
    <div class="kpis">
      ${raw(kpi('Books and sets sent', n(d.total)))}
      ${raw(kpi('Days with a dispatch', n(d.days)))}
      ${raw(kpi('Average per dispatch day', d.days ? n(Math.round(d.total / d.days)) : '—'))}
      ${raw(kpi('Busiest day', d.busiest ? n(d.busiest.qty) : '—', d.busiest ? fmtDate(d.busiest.day) : ''))}
    </div>
    <section class="panel"><div class="trend-head"><h2>Sent out by ${group}</h2></div>
      <div class="chart-scroll">${raw(columnChart(chartRows, { money: false, title: `Books and sets sent out by ${group}` }))}</div></section>
    <div class="chart-grid">
      <section class="panel"><h2>By book or set</h2>${raw(barList(d.items.slice(0, 20).map(i => ({ label: i.name, value: i.qty, note: i.set ? 'set' : '' })), { money: false, title: 'Sent out by book or set' }))}</section>
      <section class="panel"><h2>Where the figures come from</h2><p>${esc(source ? `In this period: ${source}.` : 'Nothing was sent out in this period.')}</p>
        <p class="muted small">Two ways to record a day: press "Add daily report" and type the counts, as in the old Google Form, or move each order to Dispatched and let the app count its books. Use one way for a day, not both, or that day is counted twice.</p></section>
    </div>
    <h2 class="top-gap">${group === 'month' ? 'Month by month' : 'Day by day'}</h2>
    ${raw(table([
      { label: group === 'month' ? 'Month' : 'Date', cell: r => esc(label(r.period)) },
      ...d.columns.map(c => ({ label: c.label, cls: 'num', cell: r => {
        const v = r.cols[c.key]; if (!v) return '<span class="muted">·</span>';
        const det = r.detail.filter(x => x.col === c.key);
        return det.length ? `${n(v)}<span class="sub">${esc(det.map(x => `${x.name} ${x.qty}`).join(', '))}</span>` : n(v);
      } })),
      { label: 'Total', cls: 'num', cell: r => `<strong>${n(r.total)}</strong>` },
      ...(group === 'day' && canEdit('dispatch') ? [{ label: 'Actions', cls: 'cell-actions', cell: r => `<button class="btn small" type="button" data-day="${esc(r.period)}">Edit</button>` }] : []),
    ], d.rows, { empty: 'Nothing was sent out in this period', emptyHint: 'Choose a longer period.' }))}`;
  const form = page.querySelector('#dp-filters');
  form.addEventListener('change', () => { const v = formData(form); location.hash = '/dispatch' + qs({ ...v, range: v.range === '3m' ? '' : v.range, group: v.group === 'day' ? '' : v.group }); });
  form.addEventListener('submit', e => e.preventDefault());
  const again = () => render(page, { query: parseHash().query });
  page.querySelector('#dp-add')?.addEventListener('click', () => dayForm(today, again));
  page.addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) dayForm(b.dataset.day, again); });
}

/** The daily dispatch report: one count per book or set for a day, as in the old Google Form. */
function dayForm(date, after) {
  drawer({
    wide: true, title: 'Daily dispatch report',
    body: html`<form id="day-form" novalidate>
      <div class="field"><label for="dd-date">Date</label><input id="dd-date" name="date" type="date" max="${todayLocal()}" value="${date}" required></div>
      <div id="dd-body"><p class="muted">Loading…</p></div></form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="day-form">Save report</button>`,
    onMount: (d, close) => {
      const form = d.querySelector('#day-form'); const body = d.querySelector('#dd-body'); const dateEl = d.querySelector('#dd-date');
      let seq = 0;
      const qty = (name, label, v) => `<div class="field"><label for="dd-${name}">${esc(label)}</label><input id="dd-${name}" name="${name}" type="number" inputmode="numeric" min="0" step="1" value="${v || ''}" placeholder="0"></div>`;
      const total = () => { let t = 0; for (const el of form.querySelectorAll('input[type=number]')) t += Math.max(0, Math.round(Number(el.value) || 0)); d.querySelector('#dd-total').textContent = t.toLocaleString('en-IN'); };
      const load = async () => {
        const mine = ++seq; if (!dateEl.value) return;
        body.innerHTML = '<p class="muted">Loading…</p>';
        let r; try { r = await get('/api/dispatch-report/day' + qs({ date: dateEl.value })); } catch (err) { if (mine === seq) body.innerHTML = `<div class="notice info">${esc(err.message)}</div>`; return; }
        if (mine !== seq) return;
        const have = Object.fromEntries(r.items.map(i => [i.book_id, i.qty]));
        const sets = r.products.filter(p => p.kind === 'Pack'), books = r.products.filter(p => p.kind !== 'Pack');
        const other = [...r.other, { label: '', qty: '' }, { label: '', qty: '' }, { label: '', qty: '' }].slice(0, Math.max(3, r.other.length + 1));
        body.innerHTML = `${r.exists ? `<div class="notice info">${esc(fmtDate(r.date))} already has a report${r.source === 'form' ? ' from the old Google Form' : ''}. Saving replaces it; clear every count to remove it.</div>` : ''}
          ${r.from_orders ? `<div class="notice info">${r.from_orders.toLocaleString('en-IN')} books and sets are already counted for this day from orders moved to Dispatched. Add here only what those orders do not cover.</div>` : ''}
          <fieldset><legend>Sets</legend><div class="grid3">${sets.map(p => qty('b' + p.id, p.name, have[p.id])).join('')}</div></fieldset>
          <fieldset><legend>Single books</legend><div class="grid3">${books.map(p => qty('b' + p.id, p.name, have[p.id])).join('')}</div></fieldset>
          <fieldset><legend>Other items</legend><p class="muted small">Anything not in the list above, such as KG Combo, copy books or reading cards.</p>
            ${other.map((o, i) => `<div class="grid2"><div class="field"><label for="dd-ol${i}">Item ${i + 1}</label><input id="dd-ol${i}" name="ol${i}" maxlength="60" value="${esc(o.label)}"></div>${qty('oq' + i, 'How many', o.qty)}</div>`).join('')}</fieldset>
          <dl class="totals"><dt>Total for the day</dt><dd id="dd-total">0</dd></dl>`;
        total();
      };
      dateEl.addEventListener('change', load); form.addEventListener('input', e => { if (e.target !== dateEl && d.querySelector('#dd-total')) total(); });
      load();
      onSubmit(form, async v => {
        if (!d.querySelector('#dd-total')) throw new Error('Choose a valid date first');
        const items = Object.keys(v).filter(k => /^b\d+$/.test(k) && Number(v[k]) > 0).map(k => ({ book_id: Number(k.slice(1)), qty: Number(v[k]) }));
        const other = Object.keys(v).filter(k => /^ol\d+$/.test(k)).map(k => ({ label: v[k].trim(), qty: Number(v['oq' + k.slice(2)]) || 0 })).filter(o => o.label || o.qty);
        const r = await api('PUT', '/api/dispatch-report/day', { date: v.date, items, other });
        close(); toast(r.removed ? `Report for ${fmtDate(r.date)} removed` : `Report for ${fmtDate(r.date)} saved: ${r.total.toLocaleString('en-IN')} sent`); after();
      });
    },
  });
}
