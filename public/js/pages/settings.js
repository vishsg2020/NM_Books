// Settings (Admin): theme, discounts, charges, and the choices offered in the app's dropdown lists.
import { api, esc, html, raw, onSubmit, toast, state, applyTheme, options } from '../core.js';
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
    <section class="panel"><h2>Customer messages</h2><p class="muted">The WhatsApp messages the team sends from Customers and Follow-up lists. In a message, these are filled in for each customer: {name} their first name, {link} their own feedback link, {review_link}, {website}, {coupon}, {product} and {price} (the book chosen, at the WhatsApp price), {academy_text}, {academy_link}. In the order messages also {order_no}, {date}, {items}, {charges}, {total}, {payment} (how to pay, from the UPI ID), {courier}, {tracking}, {tracking_link}.</p>
      <form id="f-msg" novalidate>
        <div class="grid2">${raw((state.messageFields || []).map(([k, l]) => `<div class="field${k === 'academy_text' ? ' span2' : ''}"><label for="m-${k}">${esc(l)}</label>${k === 'academy_text' ? `<textarea id="m-${k}" name="${k}" rows="2" maxlength="600">${esc(state.messages[k] || '')}</textarea>` : `<input id="m-${k}" name="${k}" maxlength="600" value="${esc(state.messages[k] || '')}" ${k.endsWith('_url') ? 'type="url" placeholder="https://…"' : ''}>`}
          ${k === 'coupon' ? '<div class="hint">Sent once a customer shows their website review. For example: THANKYOU10 (10% off your next order on the website).</div>' : k === 'review_url' ? '<div class="hint">Where customers write a review. Empty: the website address is used.</div>' : ''}</div>`).join(''))}</div>
        ${raw([...(state.messageKinds || []), ...(state.orderKinds || [])].map(([k, l, h]) => `<div class="field"><label for="mt-${k}">${esc(l)}</label><textarea id="mt-${k}" name="t:${k}" rows="3" maxlength="1000">${esc(state.messages.templates[k] || '')}</textarea><div class="hint">${esc(h)}</div></div>`).join(''))}
        <button class="btn primary" type="submit">Save customer messages</button></form></section>
    <section class="panel"><h2>Labels and bills</h2><p class="muted">Printed on every address label and bill.</p>
      <form id="f-ship" novalidate><div class="grid2">${raw((state.shippingFields || []).map(([k, l]) => `<div class="field${k === 'from_address' ? ' span2' : ''}"><label for="sh-${k}">${esc(l)}</label><input id="sh-${k}" name="${k}" maxlength="300" value="${esc(state.shipping[k] || '')}"></div>`).join(''))}</div>
        <div class="field"><label for="sh-cour">Couriers, one per line: name | tracking page</label><textarea id="sh-cour" name="couriers" rows="3">${esc(state.shipping.couriers.map(c => `${c.name} | ${c.url}`).join('\n'))}</textarea>
          <div class="hint">The tracking page is sent in the Dispatched message.</div></div>
        <button class="btn primary" type="submit">Save label details</button></form></section>
    <section class="panel"><h2>Next book</h2><p class="muted">Customers → Next book lists customers who have the first book of a step but not the next one, and have bought nothing for the waiting time.</p>
      <form id="f-next" novalidate>
        <div class="field"><label for="nb-m">Waiting time after their last purchase</label><select id="nb-m" name="months">${raw([1, 2, 3, 6].map(m => `<option value="${m}" ${m === state.nextBook.months ? 'selected' : ''}>${m} month${m === 1 ? '' : 's'}</option>`).join(''))}</select></div>
        <div id="nb-steps"></div>
        <div class="btn-row"><button class="btn small" type="button" id="nb-add">Add a step</button><button class="btn primary" type="submit">Save next-book steps</button></div></form></section>
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
  onSubmit(page.querySelector('#f-ship'), async v => { state.shipping = await api('PUT', '/api/settings/shipping', v); toast('Label details saved'); renderGeneral(page); });
  // Next-book steps: a row per step, "first book → next book".
  const books = state.books.filter(b => b.active && b.sku !== 'OTHER').map(b => [b.sku, b.name]);
  const stepsBox = page.querySelector('#nb-steps');
  const stepRow = ([a, b] = ['', '']) => `<div class="nb-row"><label class="sr-only">First book</label><select data-a>${options(books, a, 'Choose')}</select><span aria-hidden="true">→</span><label class="sr-only">Next book</label><select data-b>${options(books, b, 'Choose')}</select><button class="btn small" type="button" data-del aria-label="Remove this step">×</button></div>`;
  stepsBox.innerHTML = state.nextBook.steps.map(stepRow).join('');
  page.querySelector('#nb-add').addEventListener('click', () => stepsBox.insertAdjacentHTML('beforeend', stepRow()));
  stepsBox.addEventListener('click', e => { if (e.target.closest('[data-del]')) e.target.closest('.nb-row').remove(); });
  onSubmit(page.querySelector('#f-next'), async v => {
    const steps = [...stepsBox.querySelectorAll('.nb-row')].map(r => [r.querySelector('[data-a]').value, r.querySelector('[data-b]').value]).filter(([a, b]) => a || b);
    state.nextBook = await api('PUT', '/api/settings/next-book', { months: Number(v.months), steps }); toast('Next-book steps saved'); renderGeneral(page);
  });
  onSubmit(page.querySelector('#f-msg'), async v => {
    const body = { templates: {} };
    for (const [k, val] of Object.entries(v)) { if (k.startsWith('t:')) body.templates[k.slice(2)] = val; else body[k] = val; }
    state.messages = await api('PUT', '/api/settings/messages', body); toast('Customer messages saved'); renderGeneral(page);
  });
  onSubmit(page.querySelector('#f-charges'), async v => { state.charges = await api('PUT', '/api/settings/charges', v); toast('Saved'); renderGeneral(page); });
  page.querySelectorAll('form[data-list]').forEach(form => onSubmit(form, async v => {
    const r = await api('PUT', '/api/settings/lists', { [form.dataset.list]: v.values.split('\n') });
    state.lists = r.lists; toast('Saved'); renderGeneral(page);
  }));
}
