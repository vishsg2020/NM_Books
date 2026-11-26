// Settings (Admin): theme, discounts, charges, and the choices offered in the app's dropdown lists.
import { api, esc, html, raw, onSubmit, toast, state, applyTheme } from '../core.js';
import * as users from './users.js';
import * as accessPage from './access.js';

const TABS = [['general', 'General'], ['users', 'Users'], ['access', 'Roles & access']];

const THEME_NAMES = { green: 'Nalla Malayalam green', blue: 'Blue', teal: 'Teal', maroon: 'Maroon', purple: 'Purple', orange: 'Orange', charcoal: 'Charcoal' };

const ORDER = ['payment_methods', 'call_statuses', 'call_outcomes', 'location_types', 'customer_types'];
const HELP = {
  payment_methods: 'Offered when a sale or a payment is recorded.',
  call_statuses: 'Offered when a call is logged. Every status except Answered counts as not answered in the report.',
  call_outcomes: 'Offered for an answered call.',
  location_types: 'Offered when a visit is recorded: every type except Exhibition, which has its own option on Record a sale.',
  customer_types: 'Offered on a customer\'s details. Onsite location types are added here automatically.',
};

const AMOUNTS = [
  ['delivery_charge', 'Delivery charge (₹)', 'Added to a tele-sales order. 0 switches delivery charges off.'],
  ['free_delivery_above', 'Free delivery above (₹)', 'No delivery charge when the books come to more than this. 0: always charge.'],
  ['cod_charge', 'COD charge (₹)', 'Added when the payment method is COD. 0 switches it off.'],
  ['bulk_min_copies', 'Bulk order: copies in one order', 'A customer with an order of this many copies or more is a bulk order customer.'],
  ['bulk_min_amount', 'Bulk order: order amount (₹)', 'An order of this amount or more also counts. 0 switches the amount rule off.'],
];

// Settings (Admin only) in three tabs: General, Users, Roles & access.
export async function render(page, ctx = {}) {
  const q = ctx.query || {};
  const tab = TABS.some(([k]) => k === q.tab) ? q.tab : 'general';
  page.innerHTML = html`<div class="page-head"><div><h1>Settings</h1><div class="sub">Changes apply for everyone at once.</div></div></div>
    <nav class="tabs" aria-label="Settings">${raw(TABS.map(([k, l]) => `<a href="#/settings${k === 'general' ? '' : '?tab=' + k}" ${k === tab ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join(''))}</nav>
    <div id="set-tab"></div>`;
  const sub = page.querySelector('#set-tab');
  await ({ general: renderGeneral, users: users.render, access: accessPage.render })[tab](sub, ctx);
}

async function renderGeneral(page) {
  const { lists, locked, listNames } = state; const ch = state.charges || {};
  const d = state.discounts || {}; const groups = state.discountGroups || []; const chans = state.discountChannels || [];
  const current = document.documentElement.dataset.theme || 'green';
  page.innerHTML = html`<section class="panel"><h2>Theme</h2><p class="muted">The colours of the whole app, the logo and the sign-in page included, for everyone. Others see it the next time they open the app.</p>
      <form id="f-theme" novalidate><div class="swatches" role="radiogroup" aria-label="Theme">${raw((state.themes || Object.keys(THEME_NAMES)).map(t => `<label class="swatch t-${t}"><input type="radio" name="name" value="${t}" ${t === current ? 'checked' : ''}><span class="chip-colour" aria-hidden="true"></span><span>${esc(THEME_NAMES[t] || t)}</span></label>`).join(''))}</div>
        <button class="btn primary" type="submit">Use this theme</button></form></section>
    <section class="panel"><h2>Discounts</h2><p class="muted">Percent off the MRP for each kind of set and channel. Single books, single series and onsite or exhibition sales sell at MRP. Which set belongs to which group is set in the Book Master.</p>
      <form id="f-disc" novalidate><div class="table-wrap"><table class="responsive"><thead><tr><th scope="col">Set</th>${raw(chans.map(([, l]) => `<th scope="col" class="num">${esc(l)} (%)</th>`).join(''))}</tr></thead>
        <tbody>${raw(groups.map(([g, gl]) => `<tr><td data-label="Set"><div>${esc(gl)}</div></td>${chans.map(([c, cl]) => `<td class="num" data-label="${esc(cl)}"><div><input class="pct" name="${g}:${c}" type="number" inputmode="decimal" min="0" max="90" step="0.5" aria-label="${esc(gl)}, ${esc(cl)}" value="${d[g] ? d[g][c] : ''}"></div></td>`).join('')}</tr>`).join(''))}</tbody></table></div>
        <button class="btn primary top-gap" type="submit">Save discounts</button></form></section>
    <section class="panel"><h2>Order charges and bulk orders</h2><p class="muted">The charges are added to a tele-sales order when ticked on the sale form. The bulk rule drives the "Bulk order customers" filter on the Customers page.</p>
      <form id="f-charges" novalidate><div class="grid2">${raw(AMOUNTS.map(([k, l, h]) => `<div class="field"><label for="a-${k}">${esc(l)}</label><input id="a-${k}" name="${k}" type="number" inputmode="numeric" min="0" step="1" value="${ch[k] ?? 0}"><div class="hint">${esc(h)}</div></div>`).join(''))}</div>
        <button class="btn primary" type="submit">Save charges and bulk rule</button></form></section>
    ${raw(ORDER.map(k => `<section class="panel"><h2>${esc(listNames[k])}</h2><p class="muted">${esc(HELP[k])}</p>
      <form id="f-${k}" data-list="${k}" novalidate>
        <div class="field"><label for="t-${k}">One choice per line</label><textarea id="t-${k}" name="values" rows="${Math.max(lists[k].length + 1, 4)}">${esc(lists[k].join('\n'))}</textarea>
          <div class="hint">Needed by the app and cannot be removed: ${esc(locked[k].join(', '))}. Removing a choice does not change records that already use it.</div></div>
        <button class="btn primary" type="submit">Save ${esc(listNames[k].toLowerCase())}</button></form></section>`).join(''))}
`;
  onSubmit(page.querySelector('#f-theme'), async v => { const r = await api('PUT', '/api/settings/theme', { name: v.name }); applyTheme(r.name); toast('Theme changed'); renderGeneral(page); });
  page.querySelector('#f-theme').addEventListener('change', e => { if (e.target.name === 'name') applyTheme(e.target.value); }); // a preview; saved with the button
  onSubmit(page.querySelector('#f-disc'), async v => {
    const body = {}; for (const [k, val] of Object.entries(v)) { const [g, c] = k.split(':'); (body[g] = body[g] || {})[c] = val; }
    state.discounts = await api('PUT', '/api/settings/discounts', body); window.dispatchEvent(new Event('nm:changed')); toast('Discounts saved'); renderGeneral(page);
  });
  onSubmit(page.querySelector('#f-charges'), async v => { state.charges = await api('PUT', '/api/settings/charges', v); toast('Saved'); renderGeneral(page); });
  page.querySelectorAll('form[data-list]').forEach(form => onSubmit(form, async v => {
    const r = await api('PUT', '/api/settings/lists', { [form.dataset.list]: v.values.split('\n') });
    state.lists = r.lists; toast('Saved'); renderGeneral(page);
  }));
}
