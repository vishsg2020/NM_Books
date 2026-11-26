// Print page: /print.html?labels=1,2,3 (address labels, two per A4 page) or /print.html?bill=5 (a bill, one A4 page).
// Uses the signed-in session; the details come from Settings → General → Labels and bills.
import { code128 } from './barcode.js';

const q = new URLSearchParams(location.search);
const out = document.getElementById('pr');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const get = async url => {
  const r = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'nm-app' } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Please sign in to the app first, then print again.');
  if (!r.ok) throw new Error(d.error || 'Could not load this page');
  return d;
};
const phoneOf = p => { const d = String(p || '').replace(/\D/g, '').replace(/^0+/, ''); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p || ''; };
const lines = t => esc(t).replace(/\s*,\s*/g, ', ').replace(/\n/g, '<br>');
const barcodeInto = (el, text) => { if (el && text) el.append(code128(text)); };

function label(s, ship) {
  const cod = s.payment_method === 'COD' && s.balance > 0;
  const addr = [s.address || s.customer_address, [s.customer_district, s.customer_state].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  const pin = s.customer_pin || (String(s.address || '').match(/\b[1-9]\d{2}\s?\d{3}\b/) || [''])[0].replace(/\s/g, '');
  return `<section class="label">
    <div class="top">
      <div class="to"><div class="k">To Address</div><div class="name">${esc(s.customer_name)}</div><div class="addr">${lines(addr)}</div>
        <div class="big">PIN: ${esc(pin || '—')}</div><div class="big">Phone: ${esc(phoneOf(s.customer_phone))}</div></div>
      <div class="right">
        ${cod ? `<div class="pay cod">Payment: COD · Collect ${esc(inr(s.balance))} <span>in cash</span></div>` : '<div class="pay">Payment: PREPAID <span>· Do not collect cash</span></div>'}
        <div class="trk"><div class="k">${esc(s.courier || 'Courier')}</div>${s.tracking_no ? `<div class="bc" data-bc="${esc(s.tracking_no)}"></div><div class="n">${esc(s.tracking_no)}</div>` : '<div class="blank">Tracking number</div>'}</div>
        <div class="brand"><img src="/img/logo-green.png" alt="Nalla Malayalam"><b>“നല്ല മലയാളം”</b></div>
        <div class="ids"><div><span class="k">Booking Office</span><b>${esc(ship.booking_office)}</b></div><div><span class="k">Biller Name</span><b>${esc(ship.biller_name)}</b></div>
          <div><span class="k">SPCOD Biller ID</span><b>${esc(ship.spcod_biller_id)}</b></div><div><span class="k">Contract ID</span><b>${esc(ship.contract_id)}</b></div></div>
      </div>
    </div>
    <div class="od"><div class="h">Order Details</div>
      <div class="row"><div>Order ID</div><div class="oid">${esc(s.sale_no)}<span class="bc small" data-bc="${esc(s.sale_no)}"></span></div></div>
      <div class="row"><div>Books</div><div>${s.items.map(i => esc(i.book_name) + (i.qty > 1 ? ` × ${i.qty}` : '')).join(', ')}</div></div>
      <div class="row"><div>Gift pack</div><div>${s.gift_pack ? 'Yes' : 'No'}</div></div>
    </div>
    <div class="spacer"></div>
    <div class="from"><div class="k">From (if undelivered, return to)</div><b>${esc(ship.from_name)}</b><div class="small">${esc(ship.from_address)}${ship.from_phone ? ' · Mob: ' + esc(ship.from_phone) : ''}</div></div>
  </section>`;
}

function bill(s, ship, msg) {
  const books = s.total_amount - (s.delivery_charge || 0) - (s.cod_charge || 0);
  return `<section class="bill">
    <header><img src="/img/logo-green.png" alt=""><div><h1>Nalla Malayalam</h1><div>${esc(ship.from_name)}</div><div class="small">${esc(ship.from_address)}${ship.from_phone ? ' · ' + esc(ship.from_phone) : ''}</div></div>
      <div class="billno"><h2>Bill</h2><div><b>${esc(s.sale_no)}</b></div><div>${esc(fmtDate(s.sale_date))}</div></div></header>
    <div class="billto"><div class="k">Bill to</div><b>${esc(s.customer_name)}</b>${s.customer_phone ? `<div>${esc(phoneOf(s.customer_phone))}</div>` : ''}
      ${s.address ? `<div>${lines(s.address)}${s.customer_pin && !String(s.address).includes(s.customer_pin) ? ' · PIN ' + esc(s.customer_pin) : ''}</div>` : ''}
      ${s.platform_order_id ? `<div class="small">${esc(s.platform)} order ${esc(s.platform_order_id)}</div>` : ''}</div>
    <table><thead><tr><th>#</th><th>Book</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${s.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.book_name)}</td><td class="num">${i.qty}</td><td class="num">${esc(inr(i.unit_price))}</td><td class="num">${esc(inr(i.line_total))}</td></tr>`).join('')}</tbody></table>
    <dl class="sums">
      ${s.delivery_charge || s.cod_charge ? `<dt>Books</dt><dd>${esc(inr(books))}</dd>` : ''}
      ${s.delivery_charge ? `<dt>Delivery charge</dt><dd>${esc(inr(s.delivery_charge))}</dd>` : ''}${s.cod_charge ? `<dt>COD charge</dt><dd>${esc(inr(s.cod_charge))}</dd>` : ''}
      <dt class="total">Total</dt><dd class="total">${esc(inr(s.total_amount))}</dd>
      <dt>Paid</dt><dd>${esc(inr(s.amount_received))}</dd>
      <dt>${s.balance > 0 ? 'Balance to pay' : 'Balance'}</dt><dd>${esc(inr(s.balance))}</dd>
    </dl>
    <p class="small">${s.payment_method ? `Payment: ${esc(s.payment_method)}. ` : ''}${s.balance > 0 && msg.upi_id && s.payment_method !== 'COD' ? `Pay by UPI to <b>${esc(msg.upi_id)}</b>${msg.upi_name ? ' (' + esc(msg.upi_name) + ')' : ''}.` : ''}</p>
    <footer>Thank you for choosing Nalla Malayalam books. ${esc(msg.website_url || '')}</footer>
  </section>`;
}

async function main() {
  const st = await get('/api/settings/lists');
  const ship = st.shipping; const msg = st.messages;
  if (q.get('bill')) {
    const s = await get(`/api/sales/${encodeURIComponent(q.get('bill'))}`);
    document.title = `Bill ${s.sale_no} · Nalla Malayalam`;
    document.getElementById('pr-title').textContent = `Bill ${s.sale_no}`;
    out.className = 'bills'; out.innerHTML = bill(s, ship, msg);
  } else {
    const ids = (q.get('labels') || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).slice(0, 100);
    if (!ids.length) throw new Error('No orders chosen');
    const sales = [];
    for (const id of ids) sales.push(await get(`/api/sales/${id}`));
    document.getElementById('pr-title').textContent = `${sales.length} label${sales.length === 1 ? '' : 's'}`;
    out.className = 'labels';
    let html = '';
    for (let i = 0; i < sales.length; i += 2) html += `<div class="sheet">${sales.slice(i, i + 2).map(s => label(s, ship)).join('')}</div>`;
    out.innerHTML = html;
    out.querySelectorAll('[data-bc]').forEach(el => barcodeInto(el, el.dataset.bc));
  }
  await document.fonts.ready;
  await Promise.all([...document.images].map(img => (img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r; }))));
  if (q.get('auto') !== '0') setTimeout(() => window.print(), 300);
}

document.getElementById('pr-print').addEventListener('click', () => window.print());
document.getElementById('pr-close').addEventListener('click', () => window.close());
main().catch(e => { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; document.getElementById('pr-title').textContent = 'Could not print'; });
