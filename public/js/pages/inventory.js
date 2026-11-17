import { api, get, esc, html, raw, table, drawer, onSubmit, options, toast, can, fmtStamp, parseHash, wireFilters, qs, state } from '../core.js';

const TYPES = ['Opening stock', 'Stock received', 'Stock issued', 'Stock reserved', 'Reservation released', 'Stock dispatched', 'Onsite sale', 'Stock returned', 'Damaged stock', 'Stock adjustment'];
const MANUAL = [
  ['Stock received', 'Stock received — new copies arrived'],
  ['Stock returned', 'Stock returned — checked and put back'],
  ['Stock issued', 'Stock issued — samples, gifts, other use'],
  ['Damaged stock', 'Damaged stock — written off'],
  ['Stock adjustment', 'Stock adjustment — correct a count'],
];
const signed = n => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0');

export async function render(page) {
  const { query } = parseHash();
  const books = state.books.filter(b => b.kind !== 'Pack');
  page.innerHTML = html`<div class="page-head"><div><h1>Stock movements</h1><div class="sub">Every change to stock, newest first. Orders reserve and dispatch stock automatically.</div></div>
    ${raw(can('admin') ? '<div class="actions"><button class="btn primary" type="button" id="add-m">Record stock movement</button></div>' : '')}</div>
    <form class="filters" id="m-filters">
      <div class="field grow"><label for="mf-b">Book</label><select id="mf-b" name="book_id">${raw(options(books.map(b => [b.id, b.name]), query.book_id, 'All books'))}</select></div>
      <div class="field"><label for="mf-t">Type</label><select id="mf-t" name="type">${raw(options(TYPES, query.type, 'All types'))}</select></div>
      <div class="field"><label for="mf-f">From</label><input id="mf-f" name="date_from" type="date" value="${query.date_from}"></div>
      <div class="field"><label for="mf-to">To</label><input id="mf-to" name="date_to" type="date" value="${query.date_to}"></div>
      <button class="btn" type="button" data-clear>Clear filters</button>
    </form><p class="result-count" id="m-count"></p><div id="m-list"></div>`;
  const load = async () => {
    const r = await get('/api/inventory/movements' + qs(parseHash().query));
    page.querySelector('#m-count').textContent = r.truncated ? 'Showing the newest 500 movements. Narrow the filters to see older ones.' : `${r.rows.length} movement${r.rows.length === 1 ? '' : 's'}`;
    page.querySelector('#m-list').innerHTML = table([
      { label: 'When', cell: m => esc(fmtStamp(m.at)) },
      { label: 'Book', cell: m => `${esc(m.book_name)}<span class="sub">${esc(m.sku)}</span>` },
      { label: 'Movement', cell: m => `${esc(m.type)}${m.sale_no ? `<span class="sub"><a href="#/sales?open=${m.sale_id}">${esc(m.sale_no)}</a></span>` : ''}${m.note ? `<span class="sub">${esc(m.note)}</span>` : ''}` },
      { label: 'Copies', cls: 'num', cell: m => String(m.qty) },
      { label: 'In store', cls: 'num', cell: m => `${signed(m.on_hand_delta)}<span class="sub">now ${m.on_hand_after}</span>` },
      { label: 'Reserved', cls: 'num', cell: m => `${signed(m.reserved_delta)}<span class="sub">now ${m.reserved_after}</span>` },
      { label: 'By', cell: m => esc(m.user_name || '—') },
    ], r.rows, { empty: 'No stock movements match', emptyHint: 'Movements appear when stock is received, sold, dispatched or adjusted.' });
  };
  wireFilters(page.querySelector('#m-filters'), load);
  page.querySelector('#add-m')?.addEventListener('click', () => movementForm(books.find(b => String(b.id) === parseHash().query.book_id), () => { window.dispatchEvent(new Event('nm:changed')); load(); }));
  await load();
}

/** Drawer for recording a manual stock movement. `book` preselects the book. */
export function movementForm(book, after) {
  const books = state.books.filter(b => b.kind !== 'Pack' && (b.active || b.id === book?.id));
  drawer({
    title: book ? `Stock: ${book.name}` : 'Record stock movement',
    body: html`<form id="m-form" novalidate>
      ${raw(book ? `<p class="muted">In store ${book.on_hand} · reserved ${book.reserved} · available ${book.available}</p><input type="hidden" name="book_id" value="${book.id}">`
        : `<div class="field"><label for="m-book">Book *</label><select id="m-book" name="book_id" required>${options(books.map(b => [b.id, `${b.name} (${b.available} available)`]), '', 'Select book')}</select></div>`)}
      <div class="field"><label for="m-type">Movement type *</label><select id="m-type" name="type">${raw(options(MANUAL, 'Stock received'))}</select></div>
      <div class="field hidden" id="m-dir-f"><label for="m-dir">Adjustment *</label><select id="m-dir" name="direction">${raw(options([['add', 'Add copies (count was too low)'], ['remove', 'Remove copies (count was too high)']], 'add'))}</select></div>
      <div class="field"><label for="m-qty">Quantity *</label><input id="m-qty" name="qty" type="number" inputmode="numeric" min="1" step="1" required></div>
      <div class="field hidden" id="m-sale-f"><label for="m-sale">Order number</label><input id="m-sale" name="sale_no" maxlength="20" placeholder="S-000123">
        <div class="hint">Optional. Links the return to the order it came from.</div></div>
      <div class="field"><label for="m-note" id="m-note-l">Note</label><textarea id="m-note" name="note" maxlength="500"></textarea></div>
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="m-form">Record movement</button>`,
    onMount: (d, close) => {
      const type = d.querySelector('#m-type');
      const sync = () => {
        d.querySelector('#m-dir-f').classList.toggle('hidden', type.value !== 'Stock adjustment');
        d.querySelector('#m-sale-f').classList.toggle('hidden', type.value !== 'Stock returned');
        d.querySelector('#m-note-l').textContent = ['Stock issued', 'Damaged stock', 'Stock adjustment'].includes(type.value) ? 'Note *' : 'Note';
      };
      type.addEventListener('change', sync); sync();
      onSubmit(d.querySelector('#m-form'), async v => {
        if (v.type !== 'Stock adjustment') delete v.direction;
        if (v.type !== 'Stock returned') delete v.sale_no;
        const r = await api('POST', '/api/inventory/movements', v);
        close(); toast(`Recorded. Now ${r.on_hand} in store, ${r.available} available.`); after();
      });
    },
  });
}
