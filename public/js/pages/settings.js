// Settings (Admin): the choices offered in the app's dropdown lists.
import { api, esc, html, raw, onSubmit, toast, state } from '../core.js';

const ORDER = ['payment_methods', 'call_statuses', 'call_outcomes', 'location_types', 'customer_types'];
const HELP = {
  payment_methods: 'Offered when a sale or a payment is recorded.',
  call_statuses: 'Offered when a call is logged. Every status except Answered counts as not answered in the report.',
  call_outcomes: 'Offered for an answered call.',
  location_types: 'Offered when a visit is recorded: every type except Exhibition, which has its own option on Record a sale.',
  customer_types: 'Offered on a customer\'s details. Onsite location types are added here automatically.',
};

const AMOUNTS = [
  ['delivery_charge', 'Delivery charge (₹)', 'Offered as a tick box on a tele-sales order. 0 hides it.'],
  ['cod_charge', 'COD charge (₹)', 'Ticked automatically when the payment method is COD. 0 hides it.'],
  ['bulk_min_copies', 'Bulk order: copies in one order', 'A customer with an order of this many copies or more is a bulk order customer.'],
  ['bulk_min_amount', 'Bulk order: order amount (₹)', 'An order of this amount or more also counts. 0 switches the amount rule off.'],
];

export async function render(page) {
  const { lists, locked, listNames } = state; const ch = state.charges || {};
  page.innerHTML = html`<div class="page-head"><div><h1>Settings</h1><div class="sub">The choices offered in the app's lists. Changes apply for everyone at once.</div></div></div>
    <section class="panel"><h2>Order charges and bulk orders</h2><p class="muted">The charges are added to a tele-sales order when ticked on the sale form. The bulk rule drives the "Bulk order customers" filter on the Customers page.</p>
      <form id="f-charges" novalidate><div class="grid2">${raw(AMOUNTS.map(([k, l, h]) => `<div class="field"><label for="a-${k}">${esc(l)}</label><input id="a-${k}" name="${k}" type="number" inputmode="numeric" min="0" step="1" value="${ch[k] ?? 0}"><div class="hint">${esc(h)}</div></div>`).join(''))}</div>
        <button class="btn primary" type="submit">Save charges and bulk rule</button></form></section>
    ${raw(ORDER.map(k => `<section class="panel"><h2>${esc(listNames[k])}</h2><p class="muted">${esc(HELP[k])}</p>
      <form id="f-${k}" data-list="${k}" novalidate>
        <div class="field"><label for="t-${k}">One choice per line</label><textarea id="t-${k}" name="values" rows="${Math.max(lists[k].length + 1, 4)}">${esc(lists[k].join('\n'))}</textarea>
          <div class="hint">Needed by the app and cannot be removed: ${esc(locked[k].join(', '))}. Removing a choice does not change records that already use it.</div></div>
        <button class="btn primary" type="submit">Save ${esc(listNames[k].toLowerCase())}</button></form></section>`).join(''))}
    <p class="muted small top-gap">Which costs count for each channel is set on the Costs &amp; profit page.</p>`;
  onSubmit(page.querySelector('#f-charges'), async v => { state.charges = await api('PUT', '/api/settings/charges', v); toast('Saved'); render(page); });
  page.querySelectorAll('form[data-list]').forEach(form => onSubmit(form, async v => {
    const r = await api('PUT', '/api/settings/lists', { [form.dataset.list]: v.values.split('\n') });
    state.lists = r.lists; toast('Saved'); render(page);
  }));
}
