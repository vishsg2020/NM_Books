// Settings (Admin): the choices offered in the app's dropdown lists.
import { api, esc, html, raw, onSubmit, toast, state } from '../core.js';

const ORDER = ['payment_methods', 'call_statuses', 'call_outcomes', 'location_types', 'customer_types'];
const HELP = {
  payment_methods: 'Offered when a sale or a payment is recorded.',
  call_statuses: 'Offered when a call is logged. Every status except Answered counts as not answered in the report.',
  call_outcomes: 'Offered for an answered call.',
  location_types: 'Offered when a visit is recorded. Every type except Exhibition is a saved place, like a school.',
  customer_types: 'Offered on a customer\'s details. Onsite location types are added here automatically.',
};

export async function render(page) {
  const { lists, locked, listNames } = state;
  page.innerHTML = html`<div class="page-head"><div><h1>Settings</h1><div class="sub">The choices offered in the app's lists. Changes apply for everyone at once.</div></div></div>
    ${raw(ORDER.map(k => `<section class="panel"><h2>${esc(listNames[k])}</h2><p class="muted">${esc(HELP[k])}</p>
      <form id="f-${k}" data-list="${k}" novalidate>
        <div class="field"><label for="t-${k}">One choice per line</label><textarea id="t-${k}" name="values" rows="${Math.max(lists[k].length + 1, 4)}">${esc(lists[k].join('\n'))}</textarea>
          <div class="hint">Needed by the app and cannot be removed: ${esc(locked[k].join(', '))}. Removing a choice does not change records that already use it.</div></div>
        <button class="btn primary" type="submit">Save ${esc(listNames[k].toLowerCase())}</button></form></section>`).join(''))}
    <p class="muted small top-gap">Which costs count for each channel is set on the Costs &amp; profit page.</p>`;
  page.querySelectorAll('form[data-list]').forEach(form => onSubmit(form, async v => {
    const r = await api('PUT', '/api/settings/lists', { [form.dataset.list]: v.values.split('\n') });
    state.lists = r.lists; toast('Saved'); render(page);
  }));
}
