// Prices & links: everything to tell a customer. Prices on every platform (from the Book Master and Settings →
// Discounts), the offers and coupons running, and the links to share. The Admin keeps the links and the coupons here.
import { api, get, esc, html, raw, inr, table, drawer, onSubmit, options, toast, state, isAdmin, copyText, fmtDate, parseHash, wireFilters } from '../core.js';

const share = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
const STATE_PILL = { Running: 'green', Upcoming: 'blue', Ended: '', Stopped: '' };

export async function render(page, { query }) {
  const d = await get('/api/pricelist');
  const admin = isAdmin(); const ch = state.charges || {};
  const links = d.links.filter(l => l.url || admin);
  page.innerHTML = html`<div class="page-head"><div><h1>Prices &amp; links</h1><div class="sub">Everything to tell a customer: prices on each platform, offers running now, and links to share.</div></div>
      ${raw(admin ? '<div class="actions"><button class="btn" type="button" id="pl-links">Edit links</button><button class="btn primary" type="button" id="pl-add">Add coupon</button></div>' : '')}</div>
    <h2>Links to share</h2>
    <div class="links">${raw(links.map(l => `<div class="lk"><b>${esc(l.label)}</b><small>${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url.replace(/^https:\/\/(www\.)?/, ''))}</a>` : 'Not set yet'}</small>
      ${l.url ? `<button class="btn small" type="button" data-copy="${esc(l.url)}">Copy</button> <a class="btn small" href="${esc(share(l.url))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`).join(''))}</div>
    <h2>Offers and coupons</h2>
    ${raw(d.coupons.length ? `<div class="cps">${d.coupons.map(c => {
      const when = c.valid_from && c.valid_to ? `${fmtDate(c.valid_from)} – ${fmtDate(c.valid_to)}` : c.valid_to ? `Valid until ${fmtDate(c.valid_to)}` : c.valid_from ? `From ${fmtDate(c.valid_from)}` : 'No end date';
      const text = `Use code ${c.code}: ${c.offer}${c.conditions ? ` (${c.conditions})` : ''}.${c.valid_to ? ` Valid until ${fmtDate(c.valid_to)}.` : ''}`;
      return `<div class="cp${c.state === 'Running' ? '' : ' muted-card'}"><div class="cp-head"><code>${esc(c.code)}</code><span class="pill ${STATE_PILL[c.state]}">${esc(c.state)}</span></div>
        <div>${esc(c.offer)}</div>${c.conditions ? `<div class="small muted">${esc(c.conditions)}</div>` : ''}<div class="small muted">${esc(when)} · ${esc(c.works_on)}</div>
        <div class="btn-row top-gap-s"><button class="btn small" type="button" data-copy="${esc(c.code)}">Copy code</button><a class="btn small" href="${esc(share(text))}" target="_blank" rel="noopener">WhatsApp</a>${admin ? `<button class="btn small" type="button" data-coupon="${c.id}">Edit</button>` : ''}</div></div>`;
    }).join('')}</div>` : `<p class="muted">No offers running now.${admin ? ' Add one with Add coupon.' : ''}</p>`)}
    <section class="panel top-gap"><h2>Prices by platform</h2>
      <p class="muted small">Delivery ${esc(inr(ch.delivery_charge || 0))} when the books come to ${esc(inr(ch.free_delivery_above || 0))} or less, free above that. COD charge ${esc(inr(ch.cod_charge || 0))}. Onsite and exhibitions: MRP. The discounts are set in Settings.</p>
      <form class="filters" id="pl-f"><div class="field grow"><label for="pl-q">Search</label><input id="pl-q" name="q" type="search" placeholder="Book or bundle, English or Malayalam" value="${query.q || ''}"></div>
        <div class="field"><label for="pl-k">Show</label><select id="pl-k" name="kind">${raw(options([['Pack', 'Bundles'], ['Book', 'Books']], query.kind, 'Bundles and books'))}</select></div></form>
      <div id="pl-list"></div></section>`;
  const listBox = page.querySelector('#pl-list');
  const draw = () => {
    const f = parseHash().query; const q = (f.q || '').toLowerCase();
    const rows = state.books.filter(b => b.active && b.sku !== 'OTHER' && (!f.kind || b.kind === f.kind) && (!q || `${b.name} ${b.name_ml || ''} ${b.sku}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.kind === b.kind ? (b.mrp || b.price) - (a.mrp || a.price) : a.kind === 'Pack' ? -1 : 1));
    const mrp = b => b.mrp || b.price;
    const at = (b, k) => { const v = b.prices && b.prices[k] != null ? b.prices[k] : b.price; const off = mrp(b) && v < mrp(b) ? Math.round((1 - v / mrp(b)) * 100) : 0; return `<b>${esc(inr(v))}</b>${off ? `<span class="sub">${off}% off</span>` : ''}`; };
    listBox.innerHTML = table([
      { label: 'Book or bundle', cell: b => `<b>${esc(b.name)}</b>${b.name_ml ? `<span class="ml" lang="ml">${esc(b.name_ml)}</span>` : ''}${b.kind === 'Pack' && b.contents ? `<span class="sub">${b.contents.split(', ').length} books</span>` : ''}` },
      { label: 'MRP', cls: 'num', cell: b => esc(inr(mrp(b))) },
      { label: 'Website', cls: 'num', cell: b => at(b, 'Website') },
      { label: 'WhatsApp / phone', cls: 'num', cell: b => at(b, 'Tele-sales') },
      { label: 'Amazon / Flipkart', cls: 'num', cell: b => at(b, 'Amazon') },
      { label: 'Onsite', cls: 'num', cell: b => esc(inr(b.price)) },
      { label: 'Share', cls: 'cell-actions', cell: b => `${b.website_url ? `<button class="btn small" type="button" data-copy="${esc(b.website_url)}">Website link</button>` : ''}${b.amazon_url ? `<button class="btn small" type="button" data-copy="${esc(b.amazon_url)}">Amazon link</button>` : ''}` },
    ], rows, { empty: 'Nothing matches', emptyHint: 'Clear the search.' });
  };
  wireFilters(page.querySelector('#pl-f'), draw);
  draw();
  page.addEventListener('click', e => {
    const c = e.target.closest('[data-copy]'); if (c) { copyText(c.dataset.copy, 'Copied'); return; }
    const ed = e.target.closest('[data-coupon]'); if (ed) couponForm(d, d.coupons.find(x => String(x.id) === ed.dataset.coupon), () => render(page, { query: parseHash().query }));
  });
  page.querySelector('#pl-add')?.addEventListener('click', () => couponForm(d, null, () => render(page, { query: parseHash().query })));
  page.querySelector('#pl-links')?.addEventListener('click', () => drawer({
    title: 'Links to share',
    body: html`<form id="lk-form" novalidate>${raw(d.links.map(l => `<div class="field"><label for="lk-${l.key}">${esc(l.label)}</label><input id="lk-${l.key}" name="${l.key}" type="url" maxlength="500" placeholder="https://…" value="${esc(l.url)}"></div>`).join(''))}
      <p class="muted small">Each book's own website and Amazon links are set in the Book Master.</p></form>`,
    foot: '<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="lk-form">Save links</button>',
    onMount: (dd, close) => onSubmit(dd.querySelector('#lk-form'), async v => { await api('PUT', '/api/settings/links', v); close(); toast('Links saved'); render(page, { query: parseHash().query }); }),
  }));
}

function couponForm(d, c, after) {
  drawer({
    title: c ? `Edit ${c.code}` : 'Add coupon',
    body: html`<form id="cp-form" novalidate>
      <div class="grid2"><div class="field"><label for="cp-code">Code *</label><input id="cp-code" name="code" required maxlength="40" autocomplete="off" value="${c?.code}" placeholder="THANKYOU10"></div>
        <div class="field"><label for="cp-on">Works on</label><select id="cp-on" name="works_on">${raw(options(d.works_on, c?.works_on || 'Website'))}</select></div></div>
      <div class="field"><label for="cp-offer">What it gives *</label><input id="cp-offer" name="offer" required maxlength="200" value="${c?.offer}" placeholder="10% off your next order"></div>
      <div class="field"><label for="cp-cond">Conditions</label><input id="cp-cond" name="conditions" maxlength="300" value="${c?.conditions}" placeholder="After a website review; once per customer"></div>
      <div class="grid2"><div class="field"><label for="cp-from">Valid from</label><input id="cp-from" name="valid_from" type="date" value="${c?.valid_from}"></div>
        <div class="field"><label for="cp-to">Valid until</label><input id="cp-to" name="valid_to" type="date" value="${c?.valid_to}"><div class="hint">Empty: no end date.</div></div></div>
      ${raw(c ? `<label class="check"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Offered (untick to stop it now)</label>` : '')}
      <p class="muted small">This is the list the team tells customers about. Create the same code on the website (or Amazon), where it is applied.</p></form>`,
    foot: '<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="cp-form">Save coupon</button>',
    onMount: (dd, close) => onSubmit(dd.querySelector('#cp-form'), async v => {
      const body = { ...v, valid_from: v.valid_from || null, valid_to: v.valid_to || null };
      if (c) await api('PATCH', `/api/coupons/${c.id}`, body); else await api('POST', '/api/coupons', body);
      close(); toast('Coupon saved'); after();
    }),
  });
}
