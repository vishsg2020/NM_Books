import { api, get, esc, html, raw, inr, pill, table, drawer, onSubmit, options, toast, fmtStamp, parseHash, wireFilters, qs, state, canEdit, canView } from '../core.js';
import { movementForm } from './inventory.js';

export const stockPill = b => (!b.active ? pill('Inactive') : b.kind === 'Pack' && b.available > 0 ? pill('In stock') : b.available <= 0 ? pill('Out of stock') : b.available <= b.min_stock ? pill('Low stock') : pill('In stock'));

export async function render(page) {
  const admin = canEdit('books'); const stock = canEdit('stock');
  const all = await get('/api/books');
  const cats = [...new Set(all.map(b => b.category).filter(Boolean))].sort();
  const { query } = parseHash();
  page.innerHTML = html`<div class="page-head"><div><h1>Book Master</h1><div class="sub">Every book, its price and its stock. Available = in store − reserved for orders.</div></div>
    ${raw(admin ? '<div class="actions"><button class="btn primary" type="button" id="add-b">Add book</button></div>' : '')}</div>
    <form class="filters" id="b-filters">
      <div class="field grow"><label for="bf-q">Search</label><input id="bf-q" name="q" type="search" placeholder="Name or SKU" value="${query.q}"></div>
      <div class="field"><label for="bf-c">Category / Series</label><select id="bf-c" name="category">${raw(options(cats, query.category, 'All'))}</select></div>
      <div class="field"><label for="bf-a">Status</label><select id="bf-a" name="active">${raw(options([['1', 'Active'], ['0', 'Inactive']], query.active, 'All'))}</select></div>
      <div class="field"><label for="bf-l">Stock</label><select id="bf-l" name="low">${raw(options([['1', 'At or below minimum']], query.low, 'All'))}</select></div>
      <button class="btn" type="button" data-clear>Clear filters</button>
    </form><p class="result-count" id="b-count"></p><div id="b-list"></div>`;
  const list = page.querySelector('#b-list');
  let rows = []; let singles = all.filter(b => b.kind !== 'Pack');
  const load = async () => {
    rows = await get('/api/books' + qs(parseHash().query));
    page.querySelector('#b-count').textContent = `${rows.length} book${rows.length === 1 ? '' : 's'} · ${rows.reduce((s, b) => s + b.on_hand, 0)} copies in store`;
    singles = all.filter(b => b.kind !== 'Pack');
    list.innerHTML = table([
      { label: 'Book', cell: b => `${esc(b.name)}${b.kind === 'Pack' ? ' ' + pill('Set', 'blue').__raw : ''}<span class="sub">${esc(b.sku)}${b.category ? ' · ' + esc(b.category) : ''}</span>${b.contents ? `<span class="sub">Contains: ${esc(b.contents)}</span>` : ''}` },
      { label: 'Price', cls: 'num', cell: b => `${esc(inr(b.price))}${b.mrp && b.mrp !== b.price ? `<span class="sub">MRP ${esc(inr(b.mrp))}</span>` : ''}${b.prices ? Object.entries(b.prices).map(([k, v]) => `<span class="sub">${esc(k === 'Tele-sales' ? 'WhatsApp' : k === 'Amazon' ? 'Amazon/Flipkart' : k)} ${esc(inr(v))}</span>`).join('') : ''}` },
      { label: 'In store', cls: 'num', cell: b => (b.kind === 'Pack' ? '—' : String(b.on_hand)) },
      { label: 'Reserved', cls: 'num', cell: b => (b.kind === 'Pack' ? '—' : String(b.reserved)) },
      { label: 'Available', cls: 'num', cell: b => `<strong>${b.available}</strong><span class="sub">${b.kind === 'Pack' ? 'sets possible' : 'min ' + b.min_stock}</span>` },
      { label: 'Status', cell: b => stockPill(b).__raw },
      ...(admin || canView('stock') ? [{ label: 'Actions', cls: 'cell-actions', cell: b =>
        (stock && b.kind !== 'Pack' ? `<button class="btn small" type="button" data-stock="${b.id}">Stock</button>` : '') + (admin ? `<button class="btn small" type="button" data-edit="${b.id}">Edit</button>` : '') +
        (b.kind !== 'Pack' && canView('stock') ? `<a class="btn small" href="#/inventory?book_id=${b.id}">History</a>` : '') }] : []),
    ], rows, { empty: all.length ? 'No books match these filters' : 'No books yet', emptyHint: all.length ? 'Clear the filters to see every book.' : (admin ? 'Add the first book to start recording stock and sales.' : 'The Admin adds books here.') });
  };
  const changed = () => { window.dispatchEvent(new Event('nm:changed')); load(); };
  wireFilters(page.querySelector('#b-filters'), load);
  page.querySelector('#add-b')?.addEventListener('click', () => bookForm(null, changed, singles));
  list.addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'); const st = e.target.closest('[data-stock]');
    if (ed) bookForm(rows.find(b => String(b.id) === ed.dataset.edit), changed, singles);
    if (st) movementForm(rows.find(b => String(b.id) === st.dataset.stock), changed);
  });
  await load();
}

function bookForm(b, after, singles) {
  const editing = !!b; const isPack = b?.kind === 'Pack';
  drawer({
    title: editing ? `Edit ${b.name}` : 'Add book',
    body: html`<form id="b-form" novalidate>
      ${raw(editing ? '' : `<div class="seg" role="radiogroup" aria-label="Type"><label><input type="radio" name="kind" value="Book" checked><span>Single book</span></label><label><input type="radio" name="kind" value="Pack"><span>Set or combo</span></label></div>`)}
      <div class="grid2">
        <div class="field"><label for="b-sku">Book ID / SKU *</label><input id="b-sku" name="sku" required maxlength="40" value="${b?.sku}"></div>
        <div class="field"><label for="b-cat">Category / Series</label><input id="b-cat" name="category" maxlength="100" value="${b?.category}"></div>
      </div>
      <div class="field"><label for="b-name">Book name *</label><input id="b-name" name="name" required maxlength="200" value="${b?.name}"></div>
      <div class="grid2">
        <div class="field"><label for="b-mrp">MRP</label><div class="money"><span>₹</span><input id="b-mrp" name="mrp" type="number" inputmode="numeric" min="0" step="1" value="${b?.mrp}"></div></div>
        <div class="field"><label for="b-price">Selling price *</label><div class="money"><span>₹</span><input id="b-price" name="price" type="number" inputmode="numeric" min="0" step="1" required value="${b?.price}"></div></div>
      </div>
      <div class="field${isPack ? '' : ' hidden'}" id="b-dg-f"><label for="b-dg">Discount group</label><select id="b-dg" name="discount_group">${raw(options((state.discountGroups || []).map(g => [g[0], g[1]]), b?.discount_group, 'None: sells at MRP everywhere'))}</select>
        <div class="hint">For sets only. The group's discounts (Settings → Discounts) make its Website, WhatsApp and Amazon/Flipkart prices from the MRP.${raw(b?.prices ? ' Now: ' + Object.entries(b.prices).map(([k, v]) => `${k === 'Tele-sales' ? 'WhatsApp' : k === 'Amazon' ? 'Amazon/Flipkart' : k} ${inr(v)}`).join(', ') + '.' : '')}</div></div>
      <p class="hint">The selling price is the MRP for everything that has no discount: single books, single series, onsite and exhibition sales.</p>
      <fieldset id="b-items-f" class="${isPack ? '' : 'hidden'}"><legend>Books in the set</legend>
        <div class="hint">Selling one set takes one copy of each ticked book from stock.</div>
        <div id="b-items" class="chips top-gap">${raw(singles.filter(x => x.active || (isPack && b.contents)).map(x => `<label class="chip"><input type="checkbox" value="${x.id}"><span>${esc(x.name)}</span></label>`).join('') || '<span class="muted">Add the single books first.</span>')}</div><p></p>
      </fieldset>
      <div class="grid2" id="b-stock-f">
        <div class="field ${isPack ? 'hidden' : ''}"><label for="b-min">Minimum stock level</label><input id="b-min" name="min_stock" type="number" inputmode="numeric" min="0" step="1" value="${b?.min_stock ?? 0}">
          <div class="hint">The book is flagged as low when available copies reach this number.</div></div>
      </div>
      ${raw(editing ? (isPack ? `<p class="muted">${b.available} sets can be made from current stock.</p>` : `<p class="muted">In store ${b.on_hand} · reserved ${b.reserved} · available ${b.available}. Stock changes only through stock movements (the Stock button).</p>`)
        : `<div class="field" id="b-open-f"><label for="b-open">Opening stock</label><input id="b-open" name="opening_stock" type="number" inputmode="numeric" min="0" step="1" value="0">
            <div class="hint">Copies in the store room today. Recorded as the first stock movement.</div></div>`)}
      <div class="field"><label for="b-desc">Description</label><textarea id="b-desc" name="description" maxlength="2000">${b?.description}</textarea></div>
      ${raw(editing ? `<label class="check"><input type="checkbox" name="active" ${b.active ? 'checked' : ''}> Active (can be sold)</label>` : '')}
      ${raw(editing ? '<div id="b-history" class="top-gap"></div>' : '')}
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="b-form">${editing ? 'Save book' : 'Add book'}</button>`,
    onMount: (d, close) => {
      const boxes = () => [...d.querySelectorAll('#b-items input')];
      d.querySelectorAll('input[name=kind]').forEach(r => r.addEventListener('change', () => {
        const pack = r.value === 'Pack' && r.checked;
        d.querySelector('#b-items-f').classList.toggle('hidden', !pack);
        d.querySelector('#b-dg-f').classList.toggle('hidden', !pack);
        d.querySelector('#b-open-f')?.classList.toggle('hidden', pack);
        d.querySelector('#b-min').closest('.field').classList.toggle('hidden', pack);
      }));
      onSubmit(d.querySelector('#b-form'), async v => {
        if (isPack || v.kind === 'Pack') v.items = boxes().filter(x => x.checked).map(x => ({ book_id: x.value, qty: 1 }));
        if (v.mrp === '') v.mrp = null;
        if (editing) await api('PATCH', `/api/books/${b.id}`, v); else await api('POST', '/api/books', v);
        close(); toast(editing ? 'Book saved' : 'Book added'); after();
      });
      if (editing) get(`/api/books/${b.id}`).then(full => {
        for (const x of boxes()) x.checked = full.items.some(i => String(i.book_id) === x.value);
        const box = d.querySelector('#b-history'); if (!box || !full.history.length) return;
        const show = v => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : v);
        box.innerHTML = `<h3>Change history</h3><ul class="timeline">${full.history.map(h => `<li><strong>${esc(h.action)}</strong> by ${esc(h.user_name || 'system')} · ${esc(fmtStamp(h.at))}
          ${h.after && h.before ? `<div class="muted">${Object.keys(h.after).map(k => `${esc(k)}: ${esc(show(h.before[k]))} → ${esc(show(h.after[k]))}`).join(' · ')}</div>` : ''}</li>`).join('')}</ul>`;
      }).catch(() => {});
    },
  });
}
