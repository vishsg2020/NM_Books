'use strict';
// Brings the orders exported from the OLD website (WooCommerce "Orders" export) into the app as HISTORY.
//   npm run import:website -- "/path/to/old_website_orders.xlsx"          (add --dry-run to only see the summary)
// Stop the app first when you use the built-in local database: it allows one program at a time.
// Import the Google order sheet first (npm run import:orders): this script uses it to leave out website orders
// that the team had also typed into the order sheet.
//
// What it does:
//   - one sale per Order Number: channel Online, platform Website, the website's order number as the Order ID;
//   - real order lines and prices. The books listed at ₹0 under a set are the set's contents and are not repeated;
//   - a delivery charge is kept inside the order amount (added to the first line), as in the order-sheet import;
//   - customers are matched or created by phone number;
//   - every order is saved as Delivered and paid by card. It NEVER changes stock.
// Safe to run again: orders already imported are left alone.
require('./load-env');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { hashPassword } = require('../src/auth');
const { ensureCatalogue } = require('./catalogue');
const { phoneKey } = require('../src/routes/customers');
const { withDb, txt, insertMany, reserve, inr } = require('./import-db');

/** Website item name → catalogue key. */
function productKey(name) {
  const t = name.toLowerCase().replace(/\s+/g, '');
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
const num = v => { const n = Number(txt(v)); return Number.isFinite(n) ? n : 0; };

async function readOrders(file) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0]; let head = null; const orders = new Map();
  ws.eachRow({ includeEmpty: false }, row => {
    const v = row.values.slice(1);
    if (!head) { head = Object.fromEntries(v.map((h, i) => [txt(h), i])); return; }
    const g = k => v[head[k]];
    const no = txt(g('Order Number')); if (!no) return;
    if (!orders.has(no)) {
      const d = g('Order Date'); const at = d instanceof Date ? d.toISOString() : new Date(txt(d).replace(' ', 'T') + 'Z').toISOString();
      const join = (...ks) => ks.map(k => txt(g(k))).filter(Boolean).join(' ');
      orders.set(no, {
        no, at, date: at.slice(0, 10), status: txt(g('Order Status')),
        name: (join('First Name (Shipping)', 'Last Name (Shipping)') || join('First Name (Billing)', 'Last Name (Billing)')).replace(/\s+/g, ' ').slice(0, 150) || 'Name not recorded',
        address: [txt(g('Address 1&2 (Shipping)')) || txt(g('Address 1&2 (Billing)')), txt(g('City (Shipping)')) || txt(g('City (Billing)'))].filter(Boolean).join(', ').replace(/\s*\n\s*/g, ', ').slice(0, 500) || null,
        city: (txt(g('City (Shipping)')) || txt(g('City (Billing)'))).slice(0, 100) || null,
        pin: (txt(g('Postcode (Shipping)')) || txt(g('Postcode (Billing)'))).replace(/\D/g, '').slice(0, 6) || null,
        phone: (k => (k.length === 10 ? k : null))(phoneKey(txt(g('Phone (Billing)')))),
        note: txt(g('Customer Note')).replace(/\s+/g, ' ').slice(0, 300),
        total: Math.round(num(g('Order Total Amount'))), shipping: Math.round(num(g('Order Shipping Amount'))), refund: Math.round(num(g('Order Refund Amount'))),
        items: [],
      });
    }
    orders.get(no).items.push({ name: txt(g('Item Name')), qty: Math.max(1, Math.round(num(g('Quantity (- Refund)')))), cost: Math.round(num(g('Item Cost'))) });
  });
  if (!head || head['Order Number'] === undefined || head['Item Name'] === undefined) throw new Error('This does not look like the website order export: the "Order Number" and "Item Name" columns are missing.');
  return [...orders.values()];
}

async function main() {
  const args = process.argv.slice(2); const dry = args.includes('--dry-run');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Give the path of the website export:  npm run import:website -- "/path/to/old_website_orders.xlsx"'); process.exit(1); }
  const orders = await readOrders(path.resolve(file));
  const sum = { inFile: orders.length, alreadyImported: 0, alsoInSheet: 0, refunded: 0, imported: 0, amount: 0, shipping: 0, newCustomers: 0, noPhone: 0, toOtherTitles: 0, alsoInSheetOtherAmount: 0, otherAmount: [], numbers: [], sheetOrders: 0, byProduct: {} };

  await withDb(async (db, admin) => {
    await db.tx(async t => {
      const { products } = await ensureCatalogue(t);
      const bookName = Object.fromEntries((await t.all('SELECT id, name FROM books')).map(b => [b.id, b.name]));
      const done = new Set((await t.all(`SELECT import_ref FROM sales WHERE import_ref LIKE 'WEB-%'`)).map(r => r.import_ref));
      const custs = new Map((await t.all('SELECT id, phone_norm FROM customers')).map(c => [c.phone_norm, c.id]));
      // Orders already in the app for the same phone number (from the order sheet or entered by hand).
      const earlier = new Map();
      for (const r of await t.all(`SELECT c.phone_norm AS p, s.sale_no, s.sale_date, s.total_amount FROM sales s JOIN customers c ON c.id = s.customer_id
          WHERE s.status <> 'Cancelled' AND (s.import_ref IS NULL OR s.import_ref NOT LIKE 'WEB-%')`)) { if (!earlier.has(r.p)) earlier.set(r.p, []); earlier.get(r.p).push(r); }
      sum.sheetOrders = (await t.get(`SELECT COUNT(*) AS n FROM sales WHERE import_ref IS NOT NULL AND import_ref NOT LIKE 'WEB-%'`)).n;
      const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

      const todo = [];
      for (const o of orders) {
        const ref = 'WEB-' + o.no;
        if (done.has(ref)) { sum.alreadyImported++; continue; }
        if (o.refund >= o.total && o.total > 0) { sum.refunded++; continue; }
        // The team typed most website orders into the Google order sheet as well, usually within a few days.
        // Same phone number with an order from the day before to two weeks after: it is taken to be that order.
        const near = (o.phone && earlier.get(o.phone) || []).filter(s => days(o.date, s.sale_date) >= -1 && days(o.date, s.sale_date) <= 14);
        if (near.length) {
          if (near.some(s => s.total_amount === o.total || s.total_amount === o.total - o.shipping)) sum.alsoInSheet++;
          else { sum.alsoInSheetOtherAmount++; sum.otherAmount.push(`website order ${o.no} (${o.date}, ${inr(o.total)}) ↔ ${near.map(s => `${s.sale_no} (${s.sale_date}, ${inr(s.total_amount)})`).join(', ')}`); }
          continue;
        }
        const lines = new Map();
        for (const it of o.items) {
          if (it.cost <= 0) continue; // the contents of a set, listed at ₹0
          const key = productKey(it.name); if (key === 'OTHER') sum.toOtherTitles++;
          const id = products[key].id; const l = lines.get(id) || { id, qty: 0, total: 0 };
          l.qty += it.qty; l.total += it.cost * it.qty; lines.set(id, l);
        }
        if (!lines.size) lines.set(products.OTHER.id, { id: products.OTHER.id, qty: 1, total: 0 });
        const list = [...lines.values()];
        // Whatever the lines do not explain (the delivery charge) goes on a single-copy line, so lines add up to the order amount.
        const gap = o.total - list.reduce((a, l) => a + l.total, 0);
        const host = list.find(l => l.qty === 1 && l.total + gap >= 0);
        if (gap !== 0 && host) host.total += gap;
        const rows = list.map(l => ({ id: l.id, qty: l.qty, price: Math.floor(l.total / l.qty) }));
        const amount = rows.reduce((a, l) => a + l.qty * l.price, 0);
        for (const l of rows) sum.byProduct[bookName[l.id]] = (sum.byProduct[bookName[l.id]] || 0) + l.qty;
        sum.imported++; sum.numbers.push(o.no); sum.amount += amount; sum.shipping += o.shipping; if (!o.phone) sum.noPhone++;
        todo.push({ ...o, ref, rows, amount, remarks: `Imported from the old website (order ${o.no}, status there: ${o.status || '—'}). Items: ${o.items.filter(i => i.cost > 0).map(i => i.name).join('; ')}.${o.shipping ? ` Includes ₹${o.shipping} delivery charge.` : ''}${o.note ? ` Customer note: ${o.note}` : ''} Not found in the Google order sheet.`.slice(0, 1000) });
      }

      const fresh = new Map();
      for (const o of todo) if (o.phone && !custs.has(o.phone) && !fresh.has(o.phone)) fresh.set(o.phone, o);
      sum.newCustomers = fresh.size;
      if (!dry && fresh.size) {
        let n = await reserve(t, 'customer_number_seq', fresh.size);
        const made = await insertMany(t, 'customers', ['code', 'name', 'phone', 'phone_norm', 'address', 'location', 'pin'],
          [...fresh.values()].map(o => ['C-' + String(n++).padStart(5, '0'), o.name, o.phone, o.phone, o.address, o.city, o.pin]), 'RETURNING id, phone_norm');
        for (const c of made) custs.set(c.phone_norm, c.id);
      }
      if (!dry && todo.length) {
        // An inactive account that holds the website's sales history.
        let web = await t.get(`SELECT id FROM users WHERE lower(email) = 'website@imported.invalid'`);
        if (!web) web = await t.get(`INSERT INTO users (name, email, password_hash, role, active) VALUES ('Website', 'website@imported.invalid', ?, 'online', 0) RETURNING id`, [hashPassword(crypto.randomBytes(24).toString('base64url'))]);
        let n = await reserve(t, 'sale_number_seq', todo.length);
        const saved = await insertMany(t, 'sales', ['sale_no', 'sale_date', 'channel', 'salesperson_id', 'customer_id', 'customer_name', 'customer_phone', 'address', 'platform', 'platform_order_id', 'status',
          'total_amount', 'amount_received', 'payment_method', 'payment_status', 'remarks', 'import_ref', 'created_by', 'created_at'],
        todo.map(o => ['S-' + String(n++).padStart(6, '0'), o.date, 'Online', web.id, o.phone ? custs.get(o.phone) : null, o.name, o.phone, o.address, 'Website', o.no, 'Delivered',
          o.amount, o.amount, 'Card', 'Paid', o.remarks, o.ref, admin.id, o.at]), 'RETURNING id, import_ref');
        const saleId = new Map(saved.map(r => [r.import_ref, r.id]));
        await insertMany(t, 'sale_items', ['sale_id', 'book_id', 'qty', 'unit_price', 'line_total'], todo.flatMap(o => o.rows.map(l => [saleId.get(o.ref), l.id, l.qty, l.price, l.qty * l.price])));
        await insertMany(t, 'payments', ['sale_id', 'amount', 'method', 'paid_on', 'note', 'user_id'],
          todo.filter(o => o.amount > 0).map(o => [saleId.get(o.ref), o.amount, 'Card', o.date, 'Paid on the website (imported)', admin.id]));
        await t.run(`UPDATE customers SET kind = 'Customer' WHERE kind = 'Lead' AND id IN (SELECT customer_id FROM sales WHERE customer_id IS NOT NULL)`);
        await t.run(`INSERT INTO audit_events (user_id, entity, action, after_json) VALUES (?,?,?,?)`, [admin.id, 'import', 'website_orders_imported', JSON.stringify({ file: path.basename(file), ...sum, byProduct: undefined, otherAmount: undefined })]);
      }
      if (dry) throw Object.assign(new Error('dry'), { dry: true });
    }).catch(e => { if (!e.dry) throw e; });
  });

  console.log(dry ? '\nDRY RUN — nothing was saved.\n' : '\nImport finished.\n');
  console.log(`Orders in the website file            ${sum.inFile}`);
  console.log(`  already imported earlier            ${sum.alreadyImported}`);
  console.log(`  already in the order sheet, left out ${sum.alsoInSheet + sum.alsoInSheetOtherAmount}   (same amount ${sum.alsoInSheet}, different amount ${sum.alsoInSheetOtherAmount})`);
  console.log(`  fully refunded, left out            ${sum.refunded}`);
  console.log(`Orders ${dry ? 'that would be imported' : 'imported'}               ${sum.imported}   (${inr(sum.amount)}, of which delivery charges ${inr(sum.shipping)})`);
  console.log(`  new customers                       ${sum.newCustomers}`);
  console.log(`  orders without a usable phone       ${sum.noPhone}  (kept, with no customer record)`);
  console.log(`  items not recognised → Other titles ${sum.toOtherTitles}`);
  if (!sum.sheetOrders) console.log('\nNote: the Google order sheet is not in this database yet. Import it first (npm run import:orders),\nor website orders that were also typed into the sheet will be counted twice.');
  if (sum.numbers.length) console.log(`\nWebsite order numbers ${dry ? 'that would be imported' : 'imported'}: ${sum.numbers.join(', ')}`);
  if (sum.otherAmount.length) console.log(`\nLeft out as already in the order sheet, but the amounts differ (please check):\n  ${sum.otherAmount.join('\n  ')}`);
  console.log('\nCopies by product:');
  for (const [k, v] of Object.entries(sum.byProduct).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
