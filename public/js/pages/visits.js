// Onsite: visits to schools, bookstores and exhibitions, with or without a sale, and the visits still to make.
import { api, get, esc, html, raw, inr, pill, table, options, can, fmtDate, parseHash, setQuery, wireFilters, qs, state, drawer, onSubmit, toast, reasonBox, todayLocal } from '../core.js';
import { saleForm } from './sale-form.js';

const tone = { Sale: 'green', 'Order taken': 'blue', 'No sale': '', 'Payment collected': 'green', Overdue: 'red', Today: 'amber', Upcoming: '' };
const vpill = t => pill(t, tone[t] ?? '').__raw;
const manager = () => can('admin', 'manager');

/** Table of visits, used on the Visits page and on a school's or bookstore's profile. */
export function visitsTable(rows, { place = true, person = true, empty = 'No visits yet' } = {}) {
  return table([
    { label: 'Visit', cell: v => `${esc(fmtDate(v.visit_date))}<span class="sub">${esc(v.visit_no)}</span>` },
    ...(place ? [{ label: 'Place', cell: v => `${v.customer_id ? `<a href="#/customer/${v.customer_id}">${esc(v.location_name)}</a>` : esc(v.location_name)}<span class="sub">${esc(v.location_type)}${v.contact_person ? ' · ' + esc(v.contact_person) : ''}</span>` }] : []),
    { label: 'Result', cell: v => `${vpill(v.outcome)}${v.sale_no ? `<span class="sub"><a href="#/sales?open=${v.sale_id}">${esc(v.sale_no)}</a> · ${esc(inr(v.sale_amount))}${v.sale_balance > 0 && v.sale_status !== 'Cancelled' ? ` · <span class="sub due">${esc(inr(v.sale_balance))} due</span>` : ''}</span>` : ''}` },
    { label: 'Remarks', cell: v => esc(v.remarks || '') },
    { label: 'Next visit', cell: v => (v.next_visit_date ? `${esc(fmtDate(v.next_visit_date))}<span class="sub">${v.next_visit_done_by ? 'Done' : 'Pending'}</span>` : '') },
    ...(person ? [{ label: 'By', cell: v => esc(v.salesperson_name) }] : []),
    ...(can('admin') ? [{ label: 'Actions', cls: 'cell-actions', cell: v => `<button class="btn small" type="button" data-visit-edit="${v.id}">Edit</button>${v.sale_id ? '' : `<button class="btn small danger" type="button" data-visit-del="${v.id}">Remove</button>`}` }] : []),
  ], rows, { empty, emptyHint: '' });
}

/** Wires the Admin's Edit and Remove buttons of a visits table. */
export function wireVisitActions(box, getRows, after) {
  box.addEventListener('click', e => {
    const ed = e.target.closest('[data-visit-edit]'); const del = e.target.closest('[data-visit-del]');
    if (ed) editVisitForm(getRows().find(v => String(v.id) === ed.dataset.visitEdit), after);
    if (del) { const v = getRows().find(x => String(x.id) === del.dataset.visitDel);
      reasonBox({ title: `Remove visit ${v.visit_no}?`, message: `The visit to ${esc(v.location_name)} is taken out of the lists.`, confirmLabel: 'Remove visit', danger: true,
        run: reason => api('DELETE', `/api/visits/${v.id}`, { reason }), then: () => { toast('Visit removed'); after(); } }); }
  });
}

function editVisitForm(v, after) {
  drawer({
    title: `Edit visit ${v.visit_no}`,
    body: html`<form id="ve-form" novalidate><p class="muted">${v.location_name} · ${v.location_type}${v.sale_no ? ` · sale ${v.sale_no} (change the books from the sale)` : ''}</p>
      <div class="grid2">
        <div class="field"><label for="ve-d">Visit date *</label><input id="ve-d" name="visit_date" type="date" max="${todayLocal()}" value="${v.visit_date}"></div>
        ${raw(v.sale_id ? '' : `<div class="field"><label for="ve-o">Result</label><select id="ve-o" name="outcome">${options(['No sale', 'Payment collected'], v.outcome)}</select></div>`)}
      </div>
      <div class="grid2">
        <div class="field"><label for="ve-cp">Contact person</label><input id="ve-cp" name="contact_person" maxlength="100" value="${v.contact_person}"></div>
        <div class="field"><label for="ve-n">Next visit date</label><input id="ve-n" name="next_visit_date" type="date" value="${v.next_visit_date}"></div>
      </div>
      <div class="field"><label for="ve-r">Remarks</label><textarea id="ve-r" name="remarks" maxlength="1000">${v.remarks}</textarea></div>
      <div class="field"><label for="ve-why">Reason for the change *</label><textarea id="ve-why" name="reason" maxlength="300" required></textarea></div></form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="ve-form">Save visit</button>`,
    onMount: (d, close) => onSubmit(d.querySelector('#ve-form'), async f => { await api('PATCH', `/api/visits/${v.id}`, f); close(); toast('Visit saved'); after(); }),
  });
}

export async function renderList(page, { query }) {
  const people = state.people.filter(p => ['admin', 'manager', 'onsite'].includes(p.role));
  page.innerHTML = html`<div class="page-head"><div><h1>Visits</h1><div class="sub">Every visit to a school or bookstore, whether or not books were sold. An exhibition is recorded from Record a sale.</div></div>
      <div class="actions"><button class="btn primary" type="button" id="add-v">Record a visit</button></div></div>
    <section class="panel"><h2>Visits to make</h2><div id="v-due"></div></section>
    <form class="filters top-gap" id="v-filters">
      <div class="field grow"><label for="vf-q">Search</label><input id="vf-q" name="q" type="search" placeholder="Place, contact person or remarks" value="${query.q}"></div>
      <div class="field"><label for="vf-lt">Location type</label><select id="vf-lt" name="location_type">${raw(options(state.lists.places, query.location_type, 'All'))}</select></div>
      <div class="field"><label for="vf-o">Result</label><select id="vf-o" name="outcome">${raw(options(['Sale', 'Order taken', 'No sale', 'Payment collected'], query.outcome, 'All'))}</select></div>
      ${raw(manager() ? `<div class="field"><label for="vf-sp">Sales person</label><select id="vf-sp" name="salesperson">${options(people.map(p => [p.id, p.name]), query.salesperson, 'Everyone')}</select></div>` : '')}
      <div class="field"><label for="vf-f">From</label><input id="vf-f" name="date_from" type="date" value="${query.date_from}"></div>
      <div class="field"><label for="vf-t">To</label><input id="vf-t" name="date_to" type="date" value="${query.date_to}"></div>
      <button class="btn" type="button" data-clear>Clear filters</button>
    </form><p class="list-totals" id="v-totals"></p><div id="v-list"></div>`;
  let shownVisits = [];
  const loadDue = async () => {
    const d = await get('/api/visits/due' + qs({ salesperson: parseHash().query.salesperson }));
    page.querySelector('#v-due').innerHTML = table([
      { label: 'Due', cell: v => `${vpill(v.due)}<span class="sub">${esc(fmtDate(v.next_visit_date))}</span>` },
      { label: 'Place', cell: v => `${v.customer_id ? `<a href="#/customer/${v.customer_id}">${esc(v.location_name)}</a>` : esc(v.location_name)}<span class="sub">${esc(v.location_type)}${v.contact_person ? ' · ' + esc(v.contact_person) : ''}${v.contact_phone ? ' · ' + esc(v.contact_phone) : ''}</span>` },
      { label: 'Last visit', cell: v => `${esc(fmtDate(v.visit_date))} · ${vpill(v.outcome)}<span class="sub">${esc(v.remarks || '')}</span>` },
      { label: 'Outstanding', cls: 'num', cell: v => (v.outstanding ? `<span class="sub due">${esc(inr(v.outstanding))}</span>` : '—') },
      ...(manager() ? [{ label: 'By', cell: v => esc(v.salesperson_name) }] : []),
      { label: 'Action', cls: 'cell-actions', cell: v => (v.customer_id ? `<button class="btn small primary" type="button" data-visit="${v.customer_id}">Record visit</button>` : '') },
    ], d.rows, { empty: 'No visits waiting', emptyHint: 'A place appears here when a visit is saved with a next visit date.' });
  };
  const load = async () => {
    const q = { ...parseHash().query }; delete q.new;
    const r = await get('/api/visits' + qs(q)); const t = r.totals;
    page.querySelector('#v-totals').innerHTML = `<span><b>${t.visits}</b> visit${t.visits === 1 ? '' : 's'}</span><span><b>${t.locations}</b> place${t.locations === 1 ? '' : 's'}</span><span><b>${t.with_sale}</b> with a sale or order</span><span>Sales <b>${esc(inr(t.sales))}</b></span>${r.truncated ? '<span>Showing the newest 500.</span>' : ''}`;
    shownVisits = r.rows;
    page.querySelector('#v-list').innerHTML = visitsTable(r.rows, { empty: Object.keys(q).length ? 'No visits match these filters' : 'No visits recorded yet' });
  };
  const reload = async () => { window.dispatchEvent(new Event('nm:changed')); await Promise.all([loadDue(), load()]); };
  const open = locationId => saleForm({ startChannel: 'Onsite', customer: locationId ? { location_id: locationId } : null, after: reload });
  wireFilters(page.querySelector('#v-filters'), () => Promise.all([loadDue(), load()]));
  wireVisitActions(page.querySelector('#v-list'), () => shownVisits, reload);
  page.querySelector('#add-v').addEventListener('click', () => open(null));
  page.querySelector('#v-due').addEventListener('click', e => { const b = e.target.closest('[data-visit]'); if (b) open(b.dataset.visit); });
  await Promise.all([loadDue(), load()]);
  if (query.new) { const q = { ...parseHash().query }; delete q.new; setQuery(q); open(null); }
}
