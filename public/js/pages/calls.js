// Tele-sales: log calls, work through follow-ups, and see the day / week / month report.
import { api, get, esc, html, raw, inr, pill, table, drawer, onSubmit, options, toast, fmtDate, fmtDT, parseHash, setQuery, wireFilters, formData, qs, state, todayLocal, addDays, uid, debounce, reasonBox, wide, canEdit, isAdmin } from '../core.js';
import { saleForm } from './sale-form.js';

const statuses = () => state.lists.call_statuses; const outcomes = () => state.lists.call_outcomes;
const tone = { Answered: 'green', 'Not Answered': 'amber', Busy: 'amber', 'Switched Off': '', 'Wrong Number': 'red', Interested: 'green', 'Not Interested': '', 'Follow-up': 'blue', Sale: 'green', Overdue: 'red', Today: 'amber', Upcoming: '' };
const cpill = t => (t ? pill(t, tone[t] ?? '').__raw : '');
const fuText = c => (c.followup_at ? (c.followup_at.endsWith('T00:00') ? fmtDate(c.followup_date) : fmtDT(c.followup_at)) : '');
const manager = () => wide();

/** Table of calls, used on the Calls page and on a customer's profile. */
export function callsTable(rows, { person = true, who = true, empty = 'No calls yet' } = {}) {
  return table([
    { label: 'When', cell: c => `${esc(fmtDT(c.called_at))}<span class="sub">${esc(c.call_no)}</span>` },
    ...(who ? [{ label: 'Customer', cell: c => `<a href="#/customer/${c.customer_id}">${esc(c.customer_name)}</a>${c.customer_kind === 'Lead' ? ' ' + pill('Lead', 'blue').__raw : ''}<span class="sub">${esc(c.phone)}</span>` }] : []),
    { label: 'Call', cell: c => `${cpill(c.status)} ${cpill(c.outcome)}${c.sale_no ? `<span class="sub"><a href="#/sales?open=${c.sale_id}">${esc(c.sale_no)}</a> · ${esc(inr(c.sale_amount))}</span>` : ''}` },
    { label: 'Remarks', cell: c => esc(c.remarks || '') },
    { label: 'Follow-up', cell: c => (c.followup_at ? `${esc(fuText(c))}<span class="sub">${c.followup_done_by ? 'Completed' : 'Pending'}</span>` : '') },
    ...(person ? [{ label: 'By', cell: c => esc(c.salesperson_name) }] : []),
    // Correct a call: your own on the day it was made; Manager and Admin any time. Only the Admin can remove one.
    { label: 'Actions', cls: 'cell-actions', cell: c => (canEdit('calls') && (manager() || c.salesperson_id === state.me.id && c.call_date === todayLocal()) ? `<button class="btn small" type="button" data-call-edit="${c.id}">Edit</button>` : '') +
      (isAdmin() ? `<button class="btn small danger" type="button" data-call-del="${c.id}">Remove</button>` : '') },
  ], rows, { empty, emptyHint: '' });
}

/** Wires the Edit and Remove buttons of a calls table. `rows` are the calls shown; `after` reloads the list. */
export function wireCallActions(box, getRows, after) {
  box.addEventListener('click', e => {
    const ed = e.target.closest('[data-call-edit]'); const del = e.target.closest('[data-call-del]');
    if (ed) editCallForm(getRows().find(c => String(c.id) === ed.dataset.callEdit), after);
    if (del) { const c = getRows().find(x => String(x.id) === del.dataset.callDel);
      reasonBox({ title: `Remove call ${c.call_no}?`, message: 'The call is taken out of the lists and reports. A follow-up it had completed goes back to waiting.', confirmLabel: 'Remove call', danger: true,
        run: reason => api('DELETE', `/api/calls/${c.id}`, { reason }), then: () => { toast('Call removed'); after(); } }); }
  });
}

function editCallForm(c, after) {
  drawer({
    title: `Edit call ${c.call_no}`,
    body: html`<form id="ce-form" novalidate><p class="muted">${c.customer_name} · ${c.phone} · ${fmtDT(c.called_at)}</p>
      <div class="grid2">
        <div class="field"><label for="ce-st">Call status *</label><select id="ce-st" name="status">${raw(options([...new Set([...statuses(), c.status])], c.status))}</select></div>
        <div class="field" id="ce-out-f"><label for="ce-out">Call outcome *</label><select id="ce-out" name="outcome">${raw(options([...new Set([...outcomes(), ...(c.outcome ? [c.outcome] : [])])], c.outcome, 'Select'))}</select></div>
      </div>
      <div class="field"><label for="ce-rem">Discussion remarks</label><textarea id="ce-rem" name="remarks" maxlength="2000">${c.remarks}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="ce-fd">Next follow-up date</label><input id="ce-fd" name="followup_date" type="date" value="${c.followup_date}"></div>
        <div class="field"><label for="ce-ft">Next follow-up time</label><input id="ce-ft" name="followup_time" type="time" value="${c.followup_at && !c.followup_at.endsWith('T00:00') ? c.followup_at.slice(11) : ''}"></div>
      </div></form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="ce-form">Save call</button>`,
    onMount: (d, close) => {
      const st = d.querySelector('#ce-st'); const sync = () => d.querySelector('#ce-out-f').classList.toggle('hidden', st.value !== 'Answered');
      st.addEventListener('change', sync); sync();
      onSubmit(d.querySelector('#ce-form'), async v => { if (v.status !== 'Answered') delete v.outcome; await api('PATCH', `/api/calls/${c.id}`, v); close(); toast('Call saved'); after(); });
    },
  });
}

export async function renderList(page, { query }) {
  page.innerHTML = html`<div class="page-head"><div><h1>Calls</h1><div class="sub">${manager() ? 'Every call made by the tele-sales team.' : 'Your calls and the follow-ups waiting for you.'}</div></div>
      <div class="actions"><a class="btn" href="#/callreport">Report</a>${raw(canEdit('calls') ? '<button class="btn primary" type="button" id="add-call">Log a call</button>' : '')}</div></div>
    <section class="panel" id="fu-panel"><h2>Follow-ups to make</h2><div id="fu"></div></section>
    <form class="filters top-gap" id="cl-filters">
      <div class="field grow"><label for="cf-q">Search</label><input id="cf-q" name="q" type="search" placeholder="Name, phone or remarks" value="${query.q}"></div>
      ${raw(manager() ? `<div class="field"><label for="cf-sp">Sales person</label><select id="cf-sp" name="salesperson">${options(state.people.map(p => [p.id, p.name]), query.salesperson, 'Everyone')}</select></div>` : '')}
      <div class="field"><label for="cf-st">Call status</label><select id="cf-st" name="status">${raw(options([...statuses(), ['unanswered', 'All not answered']], query.status, 'All'))}</select></div>
      <div class="field"><label for="cf-o">Outcome</label><select id="cf-o" name="outcome">${raw(options(outcomes(), query.outcome, 'All'))}</select></div>
      <div class="field"><label for="cf-f">From</label><input id="cf-f" name="date_from" type="date" value="${query.date_from}"></div>
      <div class="field"><label for="cf-t">To</label><input id="cf-t" name="date_to" type="date" value="${query.date_to}"></div>
      <button class="btn" type="button" data-clear>Clear filters</button>
    </form><p class="result-count" id="cl-count"></p><div id="cl-list"></div>`;
  let shownCalls = [];
  const loadFu = async () => {
    const f = await get('/api/calls/followups' + qs({ salesperson: parseHash().query.salesperson }));
    page.querySelector('#fu').innerHTML = table([
      { label: 'Due', cell: c => `${cpill(c.due)}<span class="sub">${esc(fuText(c))}</span>` },
      { label: 'Customer', cell: c => `<a href="#/customer/${c.customer_id}">${esc(c.customer_name)}</a>${c.customer_kind === 'Lead' ? ' ' + pill('Lead', 'blue').__raw : ''}<span class="sub">${esc(c.phone)}</span>` },
      { label: 'Last call', cell: c => `${cpill(c.outcome || c.status)}<span class="sub">${esc(c.remarks || '')}</span>` },
      ...(manager() ? [{ label: 'By', cell: c => esc(c.salesperson_name) }] : []),
      { label: 'Action', cls: 'cell-actions', cell: c => `<button class="btn small primary" type="button" data-call="${esc(c.phone)}" data-name="${esc(c.customer_name)}">Call now</button>` },
    ], f.rows, { empty: 'No follow-ups waiting', emptyHint: 'A follow-up appears here when a call is saved with a next follow-up date.' });
  };
  const load = async () => {
    const q = { ...parseHash().query }; delete q.new; delete q.phone;
    const r = await get('/api/calls' + qs(q));
    page.querySelector('#cl-count').textContent = r.truncated ? 'Showing the newest 500 calls. Narrow the filters to see older ones.' : `${r.rows.length} call${r.rows.length === 1 ? '' : 's'}`;
    shownCalls = r.rows;
    page.querySelector('#cl-list').innerHTML = callsTable(r.rows, { person: manager(), empty: Object.keys(q).length ? 'No calls match these filters' : 'No calls logged yet' });
  };
  const reload = async () => { await Promise.all([loadFu(), load()]); };
  wireFilters(page.querySelector('#cl-filters'), reload);
  wireCallActions(page.querySelector('#cl-list'), () => shownCalls, reload);
  page.querySelector('#add-call')?.addEventListener('click', () => callForm({ after: reload }));
  page.querySelector('#fu').addEventListener('click', e => { const b = e.target.closest('[data-call]'); if (b) callForm({ phone: b.dataset.call, name: b.dataset.name, after: reload }); });
  await reload();
  if (query.new) { const q = { ...parseHash().query }; delete q.new; delete q.phone; setQuery(q); callForm({ phone: query.phone, after: reload }); }
}

/** The call entry form. Starts from the contact number and shows the person's history. */
export function callForm({ phone = '', name = '', after = () => {} } = {}) {
  const key = uid();
  drawer({
    wide: true, title: 'Log a call',
    body: html`<form id="call-form" novalidate>
      <div class="grid2">
        <div class="field"><label for="k-phone">Contact number *</label><input id="k-phone" name="phone" type="tel" inputmode="tel" maxlength="30" autocomplete="off" value="${phone}"></div>
        <div class="field"><label for="k-name">Customer name</label><input id="k-name" name="customer_name" maxlength="150" value="${name === 'Name not known' ? '' : name}"></div>
      </div>
      <div id="k-who"></div>
      <fieldset><legend>Call status *</legend><div class="chips">${raw(statuses().map(s => `<label class="chip"><input type="radio" name="status" value="${s}"><span>${s}</span></label>`).join(''))}</div><p></p></fieldset>
      <fieldset id="k-out-f" class="hidden"><legend>Call outcome *</legend><div class="chips">${raw(outcomes().map(s => `<label class="chip"><input type="radio" name="outcome" value="${s}"><span>${s}</span></label>`).join(''))}</div><p></p></fieldset>
      <div class="field"><label for="k-rem">Discussion remarks</label><textarea id="k-rem" name="remarks" maxlength="2000"></textarea></div>
      <div class="grid2">
        <div class="field"><label for="k-fd" id="k-fd-l">Next follow-up date</label><input id="k-fd" name="followup_date" type="date" min="${todayLocal()}"></div>
        <div class="field"><label for="k-ft">Next follow-up time</label><input id="k-ft" name="followup_time" type="time"></div>
      </div>
      <div class="btn-row"><button class="btn small" type="button" data-fu="1">Tomorrow</button><button class="btn small" type="button" data-fu="3">In 3 days</button><button class="btn small" type="button" data-fu="7">In a week</button></div>
      <details><summary class="muted small">Logging an earlier call?</summary>
        <div class="field top-gap"><label for="k-at">Call date and time</label><input id="k-at" name="called_at" type="datetime-local" max="${todayLocal()}T23:59"><div class="hint">Leave empty for a call made just now.</div></div></details>
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="call-form" id="k-save">Save call</button>`,
    onMount: (d, close) => {
      const form = d.querySelector('#call-form'); const $ = s => d.querySelector(s);
      const sync = () => {
        const st = form.querySelector('input[name=status]:checked')?.value; const out = form.querySelector('input[name=outcome]:checked')?.value;
        $('#k-out-f').classList.toggle('hidden', st !== 'Answered');
        $('#k-fd-l').textContent = st === 'Answered' && out === 'Follow-up' ? 'Next follow-up date *' : 'Next follow-up date';
        $('#k-save').textContent = st === 'Answered' && out === 'Sale' ? 'Save call and record the sale' : 'Save call';
      };
      form.addEventListener('change', sync);
      d.querySelectorAll('[data-fu]').forEach(b => b.addEventListener('click', () => { $('#k-fd').value = addDays(todayLocal(), Number(b.dataset.fu)); }));
      const who = debounce(async () => {
        const ph = $('#k-phone').value; const box = $('#k-who');
        if (ph.replace(/\D/g, '').length < 7) { box.innerHTML = ''; return; }
        try {
          const { customer: c } = await get('/api/customers/lookup?phone=' + encodeURIComponent(ph));
          if ($('#k-phone').value !== ph) return;
          if (!c) { box.innerHTML = '<div class="notice info">New number. It is saved as a lead and becomes a customer with the first purchase.</div>'; return; }
          if (!$('#k-name').value && c.name !== 'Name not known') $('#k-name').value = c.name;
          // A customer of another team member ("Own only"): the basics from the lookup, without their history.
          const full = await get(`/api/customers/${c.id}`).catch(() => ({ books: [], calls: [], other: true }));
          const last = full.calls.slice(0, 3).map(k => `<li>${esc(fmtDT(k.called_at))} · ${esc(k.outcome || k.status)}${k.remarks ? ' · ' + esc(k.remarks) : ''} <span class="muted">${esc(k.salesperson_name)}</span></li>`).join('');
          box.innerHTML = `<div class="notice info"><strong>${esc(c.name)}</strong> · ${c.kind === 'Lead' ? 'Lead, no purchase yet' : `${c.total_orders} order${c.total_orders === 1 ? '' : 's'}, ${esc(inr(c.total_purchase_amount))}${c.last_purchase_date ? ', last on ' + esc(fmtDate(c.last_purchase_date)) : ''}`}${c.outstanding_amount ? ` · <strong>${esc(inr(c.outstanding_amount))} outstanding</strong>` : ''}
            ${full.books.length ? `<div>Bought: ${esc(full.books.map(b => b.name).join(', '))}</div>` : ''}
            ${full.other ? '<div>With another team member. Logging this call makes them yours too.</div>' : last ? `<div>${full.calls.length} earlier call${full.calls.length === 1 ? '' : 's'}:</div><ul>${last}</ul>` : '<div>No earlier calls.</div>'}</div>`;
        } catch { box.innerHTML = ''; }
      }, 350);
      $('#k-phone').addEventListener('input', who);
      if (phone) who();
      onSubmit(form, async v => {
        if (!v.status) throw new Error('Choose the call status');
        if (v.status !== 'Answered') delete v.outcome;
        if (v.called_at) v.called_at = v.called_at.slice(0, 16); else delete v.called_at;
        const call = await api('POST', '/api/calls', { ...v, request_key: key });
        close(); toast(`${call.call_no} saved`); after();
        if (call.outcome === 'Sale') saleForm({ customer: { phone: call.phone, name: call.customer_name }, callId: call.id, after: () => after() });
      });
    },
  });
}

// ---------- Report: day / week / month from the same records ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monday = d => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const monthEnd = d => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const VIEWS = { day: 'Daily', week: 'Weekly', month: 'Monthly', custom: 'Custom dates' };

export async function renderReport(page, { query }) {
  const today = todayLocal(); const view = VIEWS[query.view] ? query.view : 'day'; const anchor = query.date || today;
  let from, to, by, title, prev, next;
  if (view === 'day') { from = to = anchor; by = 'day'; title = fmtDate(anchor); prev = addDays(anchor, -1); next = addDays(anchor, 1); }
  else if (view === 'week') { from = monday(anchor); to = addDays(from, 6); by = 'day'; title = `Week of ${fmtDate(from).slice(4)} to ${fmtDate(to).slice(4)}`; prev = addDays(from, -7); next = addDays(from, 7); }
  else if (view === 'month') { from = anchor.slice(0, 7) + '-01'; to = monthEnd(from); by = 'week'; title = `${MON[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`; prev = addDays(from, -1); next = addDays(to, 1); }
  else { from = query.date_from || monday(today); to = query.date_to || today; by = 'day'; title = `${fmtDate(from).slice(4)} to ${fmtDate(to).slice(4)}`; }
  const team = manager() && query.by === 'person'; if (team) by = 'person';
  const r = await get('/api/calls/report' + qs({ date_from: from, date_to: to, by, salesperson: query.salesperson }));
  const link = o => '#/callreport' + qs({ view, date: anchor, salesperson: query.salesperson, by: query.by, ...o });
  const span = x => [x.key < from ? from : x.key, addDays(x.key, 6) > to ? to : addDays(x.key, 6)];
  const rowLabel = x => {
    if (r.by === 'person') return esc(x.label);
    if (r.by === 'week') { const [a, e] = span(x); return `${esc(fmtDate(a).slice(4, -5))} to ${esc(fmtDate(e).slice(4, -5))}`; }
    return esc(fmtDate(x.key).slice(0, -5));
  };
  const callsLink = x => {
    let a = from, b = to, sp = query.salesperson;
    if (r.by === 'day') a = b = x.key; else if (r.by === 'week') [a, b] = span(x); else sp = x.key;
    return '#/calls' + qs({ date_from: a, date_to: b, salesperson: manager() ? sp : '' });
  };
  // Conversion: of the calls that were answered, how many ended in a sale.
  const pct = x => (x.answered ? Math.round((x.converted / x.answered) * 100) + '%' : '—');
  const cols = [
    { label: r.by === 'person' ? 'Sales person' : r.by === 'week' ? 'Week' : 'Day', cls: 'nowrap', cell: x => (x.total ? '<strong>Total</strong>' : rowLabel(x)) },
    { label: 'Total calls', cls: 'num', cell: x => (x.total || !x.calls ? String(x.calls) : `<a href="${callsLink(x)}">${x.calls}</a>`) },
    { label: 'Answered', cls: 'num', cell: x => String(x.answered) },
    { label: 'Not answered', cls: 'num', cell: x => String(x.unanswered) },
    { label: 'Interested', cls: 'num', cell: x => String(x.interested) },
    { label: 'Follow-ups required', cls: 'num', cell: x => String(x.followups_required) },
    { label: 'Follow-ups completed', cls: 'num', cell: x => String(x.followups_completed) },
    { label: 'Orders', cls: 'num', cell: x => String(x.orders) },
    { label: 'Books sold', cls: 'num', cell: x => String(x.books) },
    { label: 'Total sales', cls: 'num', cell: x => esc(inr(x.sales)) },
    { label: 'Collected', cls: 'num', cell: x => esc(inr(x.collected)) },
    { label: 'Outstanding', cls: 'num', cell: x => esc(inr(x.outstanding)) },
    { label: 'Conversion', cls: 'num', cell: x => pct(x) },
  ];
  const t = r.total; const kpi = (l, v, s = '') => `<div class="kpi"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span><span class="s">${esc(s)}</span></div>`;
  const rows = view === 'day' && !team ? [] : [...r.rows, { ...t, total: true }];
  page.innerHTML = html`<div class="page-head"><div><h1>Tele-sales report</h1><div class="sub">Built from the calls and sales recorded. Nothing is typed in at the end of the day.</div></div>
      <div class="actions"><a class="btn" href="#/calls">Calls</a></div></div>
    <form class="filters" id="rp-filters">
      <div class="field wide"><span class="label">Report</span><div class="seg">${raw(Object.entries(VIEWS).map(([k, l]) => `<label><input type="radio" name="view" value="${k}" ${k === view ? 'checked' : ''}><span>${l}</span></label>`).join(''))}</div></div>
      ${raw(view === 'custom' ? `<div class="field"><label for="rp-f">From</label><input id="rp-f" name="date_from" type="date" value="${from}"></div><div class="field"><label for="rp-t">To</label><input id="rp-t" name="date_to" type="date" value="${to}"></div>`
        : `<div class="field"><label for="rp-d">${view === 'day' ? 'Date' : 'Any date in the ' + view}</label><input id="rp-d" name="date" type="date" value="${anchor}"></div>`)}
      ${raw(manager() ? `<div class="field"><label for="rp-sp">Sales person</label><select id="rp-sp" name="salesperson">${options(state.people.map(p => [p.id, p.name]), query.salesperson, 'Whole team')}</select></div>
        <div class="field"><label for="rp-by">Rows</label><select id="rp-by" name="by">${options([['person', 'One per sales person']], team ? 'person' : '', view === 'month' ? 'One per week' : 'One per day')}</select></div>` : '')}
    </form>
    <div class="trend-head"><h2>${title}</h2>${raw(prev ? `<a class="btn small" href="${link({ date: prev })}">Previous</a><a class="btn small" href="${link({ date: next })}">Next</a>` : '')}</div>
    <div class="kpis">
      ${raw(kpi('Total calls', t.calls, `${t.answered} answered · ${t.unanswered} not answered`))}
      ${raw(kpi('Interested', t.interested, `follow-ups: ${t.followups_completed} of ${t.followups_required} completed`))}
      ${raw(kpi('Orders', t.orders, `${t.books} books · conversion ${pct(t)}`))}
      ${raw(kpi('Total sales', inr(t.sales), `${inr(t.collected)} collected · ${inr(t.outstanding)} outstanding`))}
    </div>
    ${raw(rows.length ? table(cols, rows) : '')}`;
  const form = page.querySelector('#rp-filters');
  form.addEventListener('change', () => { location.hash = '/callreport' + qs(formData(form)); });
  form.addEventListener('submit', e => e.preventDefault());
}
