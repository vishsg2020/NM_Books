// Delivery check (Dispatch → Delivery check): call customers a few days after their parcel went out, check the books
// arrived and they are happy, and note how it went. Tabs: To call · Needs action · Couldn't reach · Checked.
import { api, get, esc, html, raw, table, pill, drawer, onSubmit, toast, fmtDate, fmtStamp, fmtMonth, canEdit, waLink, setQuery, state } from '../core.js';

export const RESULT_NAMES = { happy: 'Delivered, happy', not_happy: 'Delivered, not happy', not_delivered: 'Not delivered yet', no_answer: 'No answer', wrong_number: 'Wrong or switched-off number', returned: 'Returned to us' };
/** The delivery-check calls of an order or a customer, as a short list (order drawer, customer page). */
export const checksList = ks => `<ul class="timeline">${ks.map(k => `<li>${pill(RESULT_NAMES[k.result] || k.result, TONE[k.result]).__raw}${k.sale_no ? ` <span class="muted">${esc(k.sale_no)}</span>` : ''}${k.note ? ` · ${esc(k.note)}` : ''}
  <span class="muted small">· ${esc(k.checked_by_name)}, ${esc(fmtStamp(k.checked_at))}</span>${k.sorted_at ? `<div class="muted small">Sorted: ${esc(k.sorted_note)} (${esc(k.sorted_by_name || '')}, ${esc(fmtStamp(k.sorted_at))})</div>` : ''}</li>`).join('')}</ul>`;
const TABS = [['call', 'To call'], ['action', 'Needs action'], ['unreachable', "Couldn't reach"], ['checked', 'Checked']];
const TONE = { happy: 'green', not_happy: 'red', not_delivered: 'amber', no_answer: 'amber', wrong_number: 'red', returned: 'red' };
const HELP = {
  happy: 'The order moves to Delivered',
  not_happy: 'Say why · goes to Needs action',
  not_delivered: "Say what's wrong · back on the list in 2 days",
  no_answer: "Back tomorrow · after 3 tries: Couldn't reach",
  wrong_number: "Goes to Couldn't reach",
  returned: 'Say why · goes to Needs action',
};
const n = v => Number(v || 0).toLocaleString('en-IN');
const days = d => (d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`);
const tel = p => String(p || '').replace(/[^\d+]/g, '');

export async function render(page, { query }) {
  const tab = TABS.some(t => t[0] === query.tab) ? query.tab : 'call';
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : '';
  const d = await get('/api/delivery-checks' + (month ? '?month=' + month : ''));
  const R = Object.fromEntries(d.results);
  const edit = canEdit('delivery');
  const resultPill = k => pill(R[k.result], TONE[k.result]).__raw;
  const courierLink = o => {
    if (!o.courier && !o.tracking_no) return '<span class="muted">—</span>';
    const c = (state.shipping.couriers || []).find(x => x.name === o.courier);
    const no = o.tracking_no ? (c && c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(o.tracking_no)}</a>` : esc(o.tracking_no)) : '';
    return `${esc(o.courier || 'Courier')}${no ? `<span class="sub">${no}</span>` : ''}`;
  };
  const who = o => `<a href="#/customer/${o.customer_id}">${esc(o.customer_name)}</a><span class="sub">${esc([o.customer_phone, o.district].filter(Boolean).join(' · '))}</span>`;
  const order = o => `<a href="#/sales?open=${o.id}">${esc(o.sale_no)}</a><span class="sub">${esc(o.books || '')}</span>`;
  const tries = o => (o.last ? `${pill(`${R[o.last.result]}${o.last.result === 'no_answer' && o.tries > 1 ? ` ×${o.tries}` : ''}`, TONE[o.last.result]).__raw}<span class="sub">${esc(fmtStamp(o.last.checked_at))}</span>${o.last.note ? `<span class="sub">${esc(o.last.note)}</span>` : ''}` : '—');
  const callBtns = o => `${o.customer_phone ? `<a class="btn small" href="tel:${esc(tel(o.customer_phone))}">Call</a>` : ''}${waLink(o.customer_phone) ? `<a class="btn small" href="${esc(waLink(o.customer_phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${edit ? `<button class="btn small primary" type="button" data-rec="${o.id}">Record result</button>` : ''}`;

  const kpi = (l, v, s) => `<div class="kpi"><span class="l">${esc(l)}</span><span class="v">${esc(v)}</span><span class="s">${esc(s)}</span></div>`;
  const c = d.counts;
  const tabLink = ([k, l]) => `<a href="#/delivery?tab=${k}" ${k === tab ? 'aria-current="page"' : ''}>${esc(l)}${k !== 'checked' ? ` <span class="count">${n(c[k])}</span>` : ''}</a>`;

  let body = '';
  if (tab === 'call') {
    body = table([
      { label: 'Customer', cell: who },
      { label: 'Order', cell: order },
      { label: 'Sent', cell: o => `${esc(fmtDate(o.sent_day))}<span class="sub">${esc(days(o.days_since))}</span>` },
      { label: 'Courier', cell: courierLink },
      { label: 'Earlier tries', cell: tries },
      { label: 'Actions', cls: 'cell-actions', cell: callBtns },
    ], d.call, { empty: 'No one to call today', emptyHint: `Orders show up here ${d.days} days after they are marked Dispatched.` });
  } else if (tab === 'action') {
    body = table([
      { label: 'Customer', cell: k => who(k.order) },
      { label: 'Order', cell: k => order(k.order) },
      { label: 'Result', cell: resultPill },
      { label: 'What they said', cell: k => esc(k.note || '') },
      { label: 'Called', cell: k => `${esc(k.checked_by_name)}<span class="sub">${esc(fmtStamp(k.checked_at))}</span>` },
      { label: 'Actions', cls: 'cell-actions', cell: k => `${k.order.customer_phone ? `<a class="btn small" href="tel:${esc(tel(k.order.customer_phone))}">Call</a>` : ''}${edit ? `<button class="btn small" type="button" data-sort="${k.id}">Mark sorted</button>` : ''}` },
    ], d.action, { empty: 'Nothing needs action', emptyHint: 'Not happy, not delivered and returned parcels wait here until someone marks them sorted.' });
  } else if (tab === 'unreachable') {
    body = table([
      { label: 'Customer', cell: who },
      { label: 'Order', cell: order },
      { label: 'Sent', cell: o => `${esc(fmtDate(o.sent_day))}<span class="sub">${esc(days(o.days_since))}</span>` },
      { label: 'Last try', cell: tries },
      { label: 'Actions', cls: 'cell-actions', cell: callBtns },
    ], d.unreachable, { empty: "Everyone was reached", emptyHint: `An order comes here after ${d.max_no_answer} calls with no answer, or a wrong or switched-off number. If they call back, record the result here.` });
  } else {
    body = `<form class="filters" id="dc-month"><div class="field"><label for="dc-m">Month</label><input id="dc-m" name="month" type="month" value="${esc(d.month)}"></div></form>
      ${table([
        { label: 'Called', cell: k => `${esc(fmtStamp(k.checked_at))}<span class="sub">${esc(k.checked_by_name)}</span>` },
        { label: 'Customer', cell: k => `<a href="#/customer/${k.customer_id}">${esc(k.customer_name)}</a><span class="sub">${esc(k.customer_phone || '')}</span>` },
        { label: 'Order', cell: k => `<a href="#/sales?open=${k.sale_id}">${esc(k.sale_no)}</a><span class="sub">${esc(k.books || '')}</span>` },
        { label: 'Result', cell: resultPill },
        { label: 'Note', cell: k => `${esc(k.note || '')}${k.sorted_at ? `<span class="sub">Sorted: ${esc(k.sorted_note)} · ${esc(k.sorted_by_name || '')}</span>` : ''}` },
      ], d.checked, { empty: `No calls in ${fmtMonth(d.month)}` })}`;
  }

  page.innerHTML = html`<div class="page-head"><div><h1>Delivery check</h1><div class="sub">Our own parcels (India Post, DTDC) sent ${d.days} or more days ago. Call, check the books arrived, and note how it went. Amazon and Flipkart orders are not here.</div></div></div>
    <div class="kpis">
      ${raw(kpi('To call today', n(c.call), c.second ? `${n(c.second)} ${c.second === 1 ? 'is a second try' : 'are second tries'}` : (c.call === 1 ? 'a first call' : 'first calls')))}
      ${raw(kpi('Needs action', n(c.action), 'not happy, not delivered, returned'))}
      ${raw(kpi("Couldn't reach", n(c.unreachable), `no answer ${d.max_no_answer} times, or a wrong number`))}
      ${raw(kpi(tab === 'checked' && month ? `Delivered, ${fmtMonth(d.month)}` : 'Checked this month', n(c.checked), c.checked ? `${n(c.happy)} happy (${Math.round(c.happy * 100 / c.checked)}%)` : 'no deliveries checked yet'))}
    </div>
    <nav class="tabs" aria-label="Delivery check lists">${raw(TABS.map(tabLink).join(''))}</nav>
    ${raw(body)}`;

  const reload = () => render(page, { query: { ...query } });
  const rows = [...d.call, ...d.unreachable];
  page.querySelectorAll('[data-rec]').forEach(b => b.addEventListener('click', () => recordForm(rows.find(o => o.id === Number(b.dataset.rec)), d, reload)));
  page.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => sortForm(d.action.find(k => k.id === Number(b.dataset.sort)), R, reload)));
  page.querySelector('#dc-m')?.addEventListener('change', e => { const q = { tab: 'checked', month: e.target.value }; setQuery(q); render(page, { query: q }); });
}

function recordForm(o, d, after) {
  const R = d.results;
  drawer({
    title: `Record result · ${o.customer_name}`,
    body: html`<p class="muted small">${o.sale_no} · ${o.books || ''} · sent ${fmtDate(o.sent_day)}${o.courier ? ` by ${o.courier}` : ''}${o.tracking_no ? ` (${o.tracking_no})` : ''}</p>
      <form id="dc-form" novalidate>
        <fieldset class="msg-types" aria-label="Result">${raw(R.map(([k, l], i) => `<label class="msg-type"><input type="radio" name="result" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${esc(l)}</b><small>${esc(HELP[k])}</small></span></label>`).join(''))}</fieldset>
        <div class="field"><label for="dc-note" id="dc-note-l">Note</label><textarea id="dc-note" name="note" rows="3" maxlength="500" placeholder="What the customer said"></textarea>
          <div class="hint">Needed for not happy, not delivered and returned.</div></div>
      </form>`,
    foot: '<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="dc-form">Save result</button>',
    onMount: (dd, close) => {
      const form = dd.querySelector('#dc-form'); const label = dd.querySelector('#dc-note-l');
      const sync = () => { const k = form.querySelector('input[name=result]:checked').value; label.textContent = d.needs_note.includes(k) ? 'Note *' : 'Note'; };
      form.addEventListener('change', sync); sync();
      onSubmit(form, async v => {
        await api('POST', '/api/delivery-checks', { sale_id: o.id, result: v.result, note: v.note });
        close(); toast(v.result === 'happy' ? 'Saved. The order is Delivered.' : 'Result saved'); after();
      });
    },
  });
}

function sortForm(k, R, after) {
  drawer({
    title: `Mark sorted · ${k.order.customer_name}`,
    body: html`<p><span class="pill">${R[k.result]}</span> ${k.note || ''}</p><p class="muted small">${k.order.sale_no} · called by ${k.checked_by_name}, ${fmtStamp(k.checked_at)}</p>
      <form id="ds-form" novalidate><div class="field"><label for="ds-note">What was done *</label><textarea id="ds-note" name="note" rows="3" maxlength="500" required placeholder="For example: sent again by DTDC, replaced the torn book, refunded"></textarea></div></form>`,
    foot: '<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="ds-form">Mark sorted</button>',
    onMount: (dd, close) => onSubmit(dd.querySelector('#ds-form'), async v => {
      await api('POST', `/api/delivery-checks/${k.id}/sorted`, { note: v.note });
      close(); toast('Marked sorted'); after();
    }),
  });
}
