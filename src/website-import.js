'use strict';
// Website order export (WooCommerce "Orders" export, CSV or Excel) → sales in the app.
// Used by the upload page (src/routes/imports.js) and by `npm run import:website`.
//
// Two layouts are understood:
//   - the OLD website (WooCommerce): one row per item, with phone, address and item names;
//   - the NEW website: one row per order: Order, Customer, Email, Amount, Payment, Status, Date. It has no phone,
//     address or items, so no customer record is made and the book is worked out from the amount when exactly one
//     book or set has that website price (otherwise the order goes under "Other titles").
//
// Rules:
//   - one sale per Order Number: channel Online, platform Website, the website's order number as the Order ID;
//   - only paid orders (old site: Processing or Completed; new site: payment CAPTURED and not cancelled, failed
//     or refunded); the others are left out and counted;
//   - duplicates are ignored: an order number already in the app, and an order whose phone number already has
//     an order from the day before to two weeks after (the team used to type website orders in by hand as well);
//   - books listed at ₹0 under a set are the set's contents and are not repeated;
//   - a delivery charge stays inside the order amount (added to a single-copy line);
//   - saved as Delivered and paid by card. Stock is NEVER changed.
const crypto = require('crypto');
const { hashPassword } = require('./auth');
const { bad, today } = require('./util');
const { write } = require('./settings');

const PAID = ['processing', 'completed'];
const SKU = { NMCOMBO: 'NM-COMBO', KVSCOMBO: 'KVS-COMBO', KVS1: 'KVS1', KVS2: 'KVS2', KVS3: 'KVS3', NM1: 'NM-P1', NM2: 'NM-P2',
  MAMB: 'KVS1-1', CHAN: 'KVS1-2', MITT: 'KVS1-3', AKSH: 'KVS1-4', DOLP: 'KVS2-1', PACH: 'KVS2-2', KOOT: 'KVS2-3', NAKS: 'KVS2-4', OTHER: 'OTHER' };

/** Website item name → product key. */
function productKey(name) {
  const t = String(name).toLowerCase().replace(/\s+/g, '');
  if (t.includes('8bookcombo')) return 'KVSCOMBO';
  if (t.includes('combo') && t.includes('part')) return 'NMCOMBO';
  if (t.includes('സീരീസ്1') || t.includes('series1')) return 'KVS1';
  if (t.includes('സീരീസ്2') || t.includes('series2')) return 'KVS2';
  if (t.includes('സീരീസ്3') || t.includes('series3')) return 'KVS3';
  if (t.includes('part1')) return 'NM1';
  if (t.includes('part2')) return 'NM2';
  const singles = [['മാമ്പഴക്കള്ള', 'MAMB'], ['ചങ്ങാത്ത', 'CHAN'], ['മിട്ടു', 'MITT'], ['അക്ഷര', 'AKSH'], ['ഡോർഫി', 'DOLP'], ['ഡോൾഫി', 'DOLP'], ['പച്ചക്കറി', 'PACH'], ['കൂട്ടി', 'KOOT'], ['നക്ഷത്ര', 'NAKS']];
  for (const [k, key] of singles) if (t.includes(k)) return key;
  return 'OTHER';
}

/** CSV text → rows of cells. Handles quotes, commas and line breaks inside quotes. */
function parseCsv(text) {
  const s = String(text).replace(/^﻿/, ''); const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

/** Excel file (Buffer) → rows of cells, first sheet. */
async function parseXlsx(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0]; const rows = []; if (!ws) return rows;
  const txt = v => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
    if (typeof v === 'object') { if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join(''); if (v.text !== undefined) return txt(v.text); if (v.result !== undefined) return txt(v.result); return ''; }
    return String(v);
  };
  ws.eachRow({ includeEmpty: false }, row => rows.push(row.values.slice(1).map(txt)));
  return rows;
}

const phoneKey = p => { const d = String(p || '').replace(/\D/g, '').replace(/^0+/, ''); return d.length === 12 && d.startsWith('91') ? d.slice(2) : d; };
const num = v => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

/** Rows of cells (first row = headings) → one order per Order Number. */
function readOrders(rows) {
  if (!rows.length) throw bad('The file is empty');
  const head = Object.fromEntries(rows[0].map((h, i) => [String(h ?? '').trim(), i]));
  if (head['Order Number'] === undefined && ['Order', 'Amount', 'Payment', 'Status', 'Date'].every(k => head[k] !== undefined)) return readSimple(rows, head);
  for (const need of ['Order Number', 'Order Date', 'Order Total Amount', 'Item Name']) if (head[need] === undefined) throw bad(`This does not look like the website's order export: the "${need}" column is missing`);
  const orders = new Map(); const unreadable = [];
  for (const v of rows.slice(1)) {
    const g = k => (head[k] === undefined ? '' : String(v[head[k]] ?? '').trim());
    const no = g('Order Number').replace(/^#/, ''); if (!no) continue;
    if (!orders.has(no)) {
      const raw = g('Order Date'); const t = Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d/.test(raw) ? raw.replace(' ', 'T').slice(0, 19) + 'Z' : raw);
      if (Number.isNaN(t)) { unreadable.push(`order ${no}: date "${raw.slice(0, 20)}"`); continue; }
      const at = new Date(t).toISOString(); const join = (...ks) => ks.map(g).filter(Boolean).join(' ');
      const phone = phoneKey(g('Phone (Billing)'));
      orders.set(no, {
        no: no.slice(0, 40), at, date: at.slice(0, 10), status: g('Order Status'), paid: !g('Order Status') || PAID.includes(g('Order Status').toLowerCase()), email: g('Email (Billing)').slice(0, 120),
        name: (join('First Name (Shipping)', 'Last Name (Shipping)') || join('First Name (Billing)', 'Last Name (Billing)')).replace(/\s+/g, ' ').slice(0, 150) || 'Name not recorded',
        address: [g('Address 1&2 (Shipping)') || g('Address 1&2 (Billing)'), g('City (Shipping)') || g('City (Billing)')].filter(Boolean).join(', ').replace(/\s*\n\s*/g, ', ').slice(0, 500) || null,
        city: (g('City (Shipping)') || g('City (Billing)')).slice(0, 100) || null,
        pin: (g('Postcode (Shipping)') || g('Postcode (Billing)')).replace(/\D/g, '').slice(0, 6) || null,
        phone: phone.length === 10 ? phone : null,
        note: g('Customer Note').replace(/\s+/g, ' ').slice(0, 300),
        total: Math.round(num(g('Order Total Amount'))), shipping: Math.round(num(g('Order Shipping Amount'))), refund: Math.round(num(g('Order Refund Amount'))),
        items: [],
      });
    }
    if (orders.has(no)) orders.get(no).items.push({ name: g('Item Name'), qty: Math.max(1, Math.round(num(g('Quantity (- Refund)')) || 1)), cost: Math.round(num(g('Item Cost'))) });
  }
  return { orders: [...orders.values()], unreadable };
}

/** The new website's layout: one row per order, no items. Its dates are UTC; the sale date is the day in India. */
function readSimple(rows, head) {
  const orders = new Map(); const unreadable = [];
  for (const v of rows.slice(1)) {
    const g = k => (head[k] === undefined ? '' : String(v[head[k]] ?? '').trim());
    const no = g('Order').replace(/^#/, ''); if (!no || orders.has(no)) continue;
    const t = Date.parse(g('Date'));
    if (Number.isNaN(t)) { unreadable.push(`order ${no}: date "${g('Date').slice(0, 24)}"`); continue; }
    const status = g('Status'), payment = g('Payment');
    orders.set(no, {
      no: no.slice(0, 40), at: new Date(t).toISOString(), date: new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10),
      status: payment.toUpperCase() === 'CAPTURED' ? status : `${status || '—'}, payment ${payment || '—'}`,
      paid: payment.toUpperCase() === 'CAPTURED' && !['cancelled', 'canceled', 'failed', 'refunded'].includes(status.toLowerCase()),
      name: g('Customer').replace(/\s+/g, ' ').slice(0, 150) || 'Name not recorded', email: g('Email').slice(0, 120),
      address: null, city: null, pin: null, phone: null, note: '', total: Math.round(num(g('Amount'))), shipping: 0, refund: 0, items: [], simple: true,
    });
  }
  return { orders: [...orders.values()], unreadable };
}

async function insertMany(t, table, cols, rows, returning = '') {
  const out = [];
  for (let i = 0; i < rows.length; i += 250) {
    const part = rows.slice(i, i + 250);
    const r = await t.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${part.map(() => `(${cols.map(() => '?').join(',')})`).join(', ')} ${returning}`, part.flat());
    out.push(...r.rows);
  }
  return out;
}
async function reserve(t, seq, n) {
  const { v } = await t.get(`SELECT nextval('${seq}') AS v`);
  if (n > 1) await t.get(`SELECT setval('${seq}', ?) AS v`, [Number(v) + n - 1]);
  return Number(v);
}
const inr = n => '₹' + Number(n).toLocaleString('en-IN');

/**
 * Saves the orders (or, with dry: true, only works out what would happen). Returns the summary.
 * `user` is who uploads; `file` is the file name, for the history.
 */
async function importWebsiteOrders(db, user, orders, { dry = false, file = '' } = {}) {
  const sum = { file, in_file: orders.length, already_imported: 0, already_in_app: 0, other_amount: [], not_paid: 0, not_paid_by_status: {}, refunded: 0,
    imported: 0, amount: 0, shipping: 0, new_customers: 0, no_phone: 0, other_titles: 0, guessed: 0, simple: orders.some(o => o.simple), numbers: [], first_date: null, last_date: null, by_product: {}, saved: !dry };
  await db.tx(async t => {
    const books = new Map((await t.all('SELECT id, name, lower(sku) AS sku FROM books')).map(b => [b.sku, b]));
    if (!books.has('other')) throw bad('The Book Master has no "Other titles" entry (SKU OTHER). Add it, then upload again.');
    const book = key => books.get(SKU[key].toLowerCase()) || books.get('other');
    const done = new Set((await t.all(`SELECT import_ref FROM sales WHERE import_ref LIKE 'WEB-%'`)).map(r => r.import_ref));
    const typed = new Set((await t.all(`SELECT lower(platform_order_id) AS o FROM sales WHERE platform = 'Website' AND platform_order_id IS NOT NULL AND status <> 'Cancelled'`)).map(r => r.o));
    const custs = new Map((await t.all('SELECT id, phone_norm FROM customers')).map(c => [c.phone_norm, c.id]));
    const earlier = new Map();
    for (const r of await t.all(`SELECT c.phone_norm AS p, s.sale_no, s.sale_date, s.total_amount FROM sales s JOIN customers c ON c.id = s.customer_id
        WHERE s.status <> 'Cancelled' AND (s.import_ref IS NULL OR s.import_ref NOT LIKE 'WEB-%')`)) { if (!earlier.has(r.p)) earlier.set(r.p, []); earlier.get(r.p).push(r); }
    // For an order without items: the book or set whose website price is exactly the order amount, when there is only one.
    const byPrice = new Map();
    for (const b of await t.all(`SELECT b.id, b.name, COALESCE(bp.price, b.price) AS price FROM books b LEFT JOIN book_prices bp ON bp.book_id = b.id AND bp.channel_key = 'Website'
        WHERE b.active = 1 AND lower(b.sku) <> 'other'`)) { if (!byPrice.has(b.price)) byPrice.set(b.price, []); byPrice.get(b.price).push(b); }
    const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

    const todo = [];
    for (const o of orders) {
      const ref = 'WEB-' + o.no;
      if (done.has(ref) || typed.has(o.no.toLowerCase())) { sum.already_imported++; continue; }
      if (!o.paid) { sum.not_paid++; sum.not_paid_by_status[o.status] = (sum.not_paid_by_status[o.status] || 0) + 1; continue; }
      if (o.refund >= o.total && o.total > 0) { sum.refunded++; continue; }
      const near = (o.phone && earlier.get(o.phone) || []).filter(s => days(o.date, s.sale_date) >= -1 && days(o.date, s.sale_date) <= 14);
      if (near.length) {
        sum.already_in_app++;
        if (!near.some(s => s.total_amount === o.total || s.total_amount === o.total - o.shipping)) sum.other_amount.push({ order: o.no, date: o.date, amount: o.total, matches: near.map(s => ({ sale_no: s.sale_no, date: s.sale_date, amount: s.total_amount })) });
        continue;
      }
      const lines = new Map();
      for (const it of o.items) {
        if (it.cost <= 0) continue; // the contents of a set, listed at ₹0
        const key = productKey(it.name); const b = book(key); if (b.sku === 'other') sum.other_titles++;
        const l = lines.get(b.id) || { id: b.id, name: b.name, qty: 0, total: 0 };
        l.qty += it.qty; l.total += it.cost * it.qty; lines.set(b.id, l);
      }
      let guessed = false;
      if (!lines.size) {
        const hit = o.simple && o.total > 0 ? byPrice.get(o.total) : null;
        const b = hit && hit.length === 1 ? hit[0] : books.get('other');
        if (o.simple) { if (b === books.get('other')) sum.other_titles++; else { sum.guessed++; guessed = true; } }
        lines.set(b.id, { id: b.id, name: b.name, qty: 1, total: 0 });
      }
      const list = [...lines.values()];
      const gap = o.total - list.reduce((a, l) => a + l.total, 0);
      const host = list.find(l => l.qty === 1 && l.total + gap >= 0);
      if (gap !== 0 && host) host.total += gap;
      const rows = list.map(l => ({ id: l.id, name: l.name, qty: l.qty, price: Math.floor(l.total / l.qty) }));
      const amount = rows.reduce((a, l) => a + l.qty * l.price, 0);
      for (const l of rows) sum.by_product[l.name] = (sum.by_product[l.name] || 0) + l.qty;
      sum.imported++; sum.numbers.push(o.no); sum.amount += amount; sum.shipping += o.shipping; if (!o.phone) sum.no_phone++;
      if (!sum.first_date || o.date < sum.first_date) sum.first_date = o.date;
      if (!sum.last_date || o.date > sum.last_date) sum.last_date = o.date;
      todo.push({ ...o, ref, rows, amount, remarks: `From the website (order ${o.no}, status there: ${o.status || '—'}).${o.simple ? (guessed ? ' The file has no items: the book was worked out from the amount.' : ' The file has no items: book not known.') : ` Items: ${o.items.filter(i => i.cost > 0).map(i => i.name).join('; ')}.`}${o.email ? ` Email: ${o.email}.` : ''}${o.shipping ? ` Includes ₹${o.shipping} delivery charge.` : ''}${o.note ? ` Customer note: ${o.note}` : ''}`.slice(0, 1000) });
    }
    const fresh = new Map();
    for (const o of todo) if (o.phone && !custs.has(o.phone) && !fresh.has(o.phone)) fresh.set(o.phone, o);
    sum.new_customers = fresh.size;
    if (dry) return;

    if (fresh.size) {
      let n = await reserve(t, 'customer_number_seq', fresh.size);
      const made = await insertMany(t, 'customers', ['code', 'name', 'phone', 'phone_norm', 'address', 'location', 'pin'],
        [...fresh.values()].map(o => ['C-' + String(n++).padStart(5, '0'), o.name, o.phone, o.phone, o.address, o.city, o.pin]), 'RETURNING id, phone_norm');
      for (const c of made) custs.set(c.phone_norm, c.id);
    }
    if (todo.length) {
      // An inactive account that holds the website's sales.
      let web = await t.get(`SELECT id FROM users WHERE lower(email) = 'website@imported.invalid'`);
      if (!web) web = await t.get(`INSERT INTO users (name, email, password_hash, role, active) VALUES ('Website', 'website@imported.invalid', ?, 'online', 0) RETURNING id`, [hashPassword(crypto.randomBytes(24).toString('base64url'))]);
      let n = await reserve(t, 'sale_number_seq', todo.length);
      const saved = await insertMany(t, 'sales', ['sale_no', 'sale_date', 'channel', 'salesperson_id', 'customer_id', 'customer_name', 'customer_phone', 'address', 'platform', 'platform_order_id', 'status',
        'total_amount', 'amount_received', 'payment_method', 'payment_status', 'remarks', 'import_ref', 'created_by', 'created_at'],
      todo.map(o => ['S-' + String(n++).padStart(6, '0'), o.date, 'Online', web.id, o.phone ? custs.get(o.phone) : null, o.name, o.phone, o.address, 'Website', o.no, 'Delivered',
        o.amount, o.amount, 'Card', 'Paid', o.remarks, o.ref, user.id, o.at]), 'RETURNING id, import_ref');
      const saleId = new Map(saved.map(r => [r.import_ref, r.id]));
      await insertMany(t, 'sale_items', ['sale_id', 'book_id', 'qty', 'unit_price', 'line_total'], todo.flatMap(o => o.rows.map(l => [saleId.get(o.ref), l.id, l.qty, l.price, l.qty * l.price])));
      await insertMany(t, 'payments', ['sale_id', 'amount', 'method', 'paid_on', 'note', 'user_id'],
        todo.filter(o => o.amount > 0).map(o => [saleId.get(o.ref), o.amount, 'Card', o.date, 'Paid on the website', user.id]));
      await t.run(`UPDATE customers SET kind = 'Customer' WHERE kind = 'Lead' AND id IN (SELECT customer_id FROM sales WHERE customer_id IS NOT NULL)`);
    }
    const record = { on: today(), by: user.name || null, file: String(file).slice(0, 120), in_file: sum.in_file, imported: sum.imported, amount: sum.amount,
      duplicates: sum.already_imported + sum.already_in_app, not_paid: sum.not_paid, first_date: sum.first_date, last_date: sum.last_date };
    await write(t, 'website_upload', record);
    await t.run(`INSERT INTO audit_events (user_id, entity, action, after_json) VALUES (?,?,?,?)`, [user.id, 'import', 'website_orders_imported', JSON.stringify(record)]);
  });
  return sum;
}

module.exports = { parseCsv, parseXlsx, readOrders, importWebsiteOrders, productKey, inr };
