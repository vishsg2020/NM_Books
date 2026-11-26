'use strict';
// API acceptance tests for Phase 1, mapped to the BA document's business rules. Run: npm test
process.env.TODAY_OVERRIDE = '2026-11-16';
const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('pg');
const { createDb } = require('../src/db');
const { applyMigrations } = require('../src/migrate');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

let server, base, db, devDb, pool;
const pw = 'correct-horse-1';

function client() {
  let cookie = '';
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nm-app', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return {
    send: (m, u, b) => call(m, u, b), get: u => call('GET', u), post: (u, b) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b),
    login: async email => { const r = await call('POST', '/api/login', { email, password: pw }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r; },
  };
}

// A raw call for methods the test client has no shortcut for.
async function fetchJson(c, method, url, body) { return c.send(method, url, body); }
const A = client(), M = client(), T = client(), O = client(), S = client(), D = client(), anon = client();
const ids = {};
let maam, kozh, puzha; // books
const stock = async id => { const b = (await A.get(`/api/books/${id}`)).data; return [b.on_hand, b.reserved, b.available]; };
const ok = (r, status = 201) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

test.before(async () => {
  const { NetlifyDB } = await import('@netlify/database-dev');
  devDb = new NetlifyDB({ logger: () => {} });
  pool = new pg.Pool({ connectionString: await devDb.start(), max: 1 }); // the local test database is one shared session
  await applyMigrations(pool);
  db = createDb(pool);
  await db.run(`INSERT INTO users (name,email,password_hash,role) VALUES ('Asha Admin','a@x.in',?,'admin')`, [hashPassword(pw)]);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await A.login('a@x.in');
});
test.after(async () => { server.close(); await pool.end(); await devDb.stop(); });

test('unauthenticated and cross-site style requests are rejected', async () => {
  assert.equal((await anon.get('/api/books')).status, 401);
  assert.equal((await anon.get('/api/sales')).status, 401);
  const r = await fetch(base + '/api/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  const bad = await anon.post('/api/login', { email: 'a@x.in', password: 'wrong-password' });
  assert.equal(bad.status, 401);
});

test('Admin creates an individual login for each role; only Admin manages users', async () => {
  for (const [role, email, c] of [['manager', 'm@x.in', M], ['telesales', 't@x.in', T], ['online', 'o@x.in', O], ['onsite', 's@x.in', S], ['dispatch', 'd@x.in', D]]) {
    ids[role] = ok(await A.post('/api/users', { name: role + ' user', email, password: pw, role })).id;
    await c.login(email);
  }
  assert.equal((await A.post('/api/users', { name: 'Dup', email: 'T@x.in', password: pw, role: 'telesales' })).status, 409);
  assert.equal((await A.post('/api/users', { name: 'Short', email: 'z@x.in', password: 'short', role: 'telesales' })).status, 400);
  assert.equal((await M.get('/api/users')).status, 403);
  assert.equal((await T.post('/api/users', { name: 'X', email: 'x@x.in', password: pw, role: 'admin' })).status, 403);
  const me = (await A.get('/api/me')).data.user;
  assert.equal((await A.patch(`/api/users/${me.id}`, { active: false })).status, 400); // last admin / self
  // a deactivated user is signed out at once
  const tmp = client();
  const tid = ok(await A.post('/api/users', { name: 'Temp', email: 'tmp@x.in', password: pw, role: 'online' })).id;
  await tmp.login('tmp@x.in');
  ok(await A.patch(`/api/users/${tid}`, { active: false }), 200);
  assert.equal((await tmp.get('/api/me')).status, 401);
});

test('Book Master: Admin adds and edits books; opening stock becomes a stock movement', async () => {
  maam = ok(await A.post('/api/books', { sku: 'NM-001', name: 'Maambazham', category: 'Series 1', price: 250, opening_stock: 100, min_stock: 20 }));
  kozh = ok(await A.post('/api/books', { sku: 'NM-002', name: 'Kozhunnthu', category: 'Series 1', price: 300, opening_stock: 10, min_stock: 5 }));
  puzha = ok(await A.post('/api/books', { sku: 'NM-003', name: 'Puzha', price: 150 }));
  assert.deepEqual([maam.on_hand, maam.reserved, maam.available], [100, 0, 100]);
  assert.deepEqual([puzha.on_hand, puzha.available], [0, 0]);
  assert.equal((await A.post('/api/books', { sku: 'nm-001', name: 'Other', price: 10 })).status, 409);
  assert.equal((await A.post('/api/books', { sku: 'NM-009', name: 'maambazham', price: 10 })).status, 409);
  assert.equal((await A.post('/api/books', { sku: 'NM-010', name: 'No price' })).status, 400);
  assert.equal((await M.post('/api/books', { sku: 'NM-011', name: 'Manager book', price: 10 })).status, 403);
  assert.equal((await T.patch(`/api/books/${maam.id}`, { price: 1 })).status, 403);
  const e = ok(await A.patch(`/api/books/${maam.id}`, { price: 260, on_hand: 9999 }), 200);
  assert.equal(e.price, 260); assert.equal(e.on_hand, 100); // stock cannot be edited directly
  const detail = (await A.get(`/api/books/${maam.id}`)).data;
  assert.ok(detail.history.some(h => h.action === 'updated' && h.after.price === 260)); // audit trail
  const mv = (await A.get(`/api/inventory/movements?book_id=${maam.id}`)).data.rows;
  assert.equal(mv.length, 1); assert.equal(mv[0].type, 'Opening stock'); assert.equal(mv[0].on_hand_after, 100);
  assert.equal((await T.get('/api/books?active=1')).data.length, 3); // every role can read the Book Master
});

test('Inventory: manual movements update stock and keep a history; stock can never go negative', async () => {
  ok(await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Stock received', qty: 40, note: 'Print run 1' }));
  ok(await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Damaged stock', qty: 3, note: 'Water damage' }));
  ok(await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Stock issued', qty: 2, note: 'Review copies' }));
  ok(await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Stock adjustment', qty: 5, direction: 'remove', note: 'Stock count' }));
  assert.deepEqual(await stock(puzha.id), [30, 0, 30]);
  assert.equal((await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Damaged stock', qty: 3 })).status, 400); // note required
  assert.equal((await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Stock issued', qty: 31, note: 'x' })).status, 422);
  assert.equal((await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Stock reserved', qty: 1 })).status, 400); // not a manual type
  assert.equal((await M.post('/api/inventory/movements', { book_id: puzha.id, type: 'Stock received', qty: 1 })).status, 403);
  assert.equal((await T.get('/api/inventory/movements')).status, 403);
  assert.equal((await M.get(`/api/inventory/movements?book_id=${puzha.id}`)).data.rows.length, 4);
  assert.deepEqual(await stock(puzha.id), [30, 0, 30]);
});

let teleSale;
test('Tele-sales order: several books, automatic totals, customer created, stock reserved (not deducted)', async () => {
  const body = { request_key: 'k-tele-1', customer_name: 'Lakshmi Nair', customer_phone: '+91 98470 12345', address: '12 MG Road, Kochi', location: 'Kochi',
    items: [{ book_id: maam.id, qty: 2 }, { book_id: kozh.id, qty: 1, unit_price: 280 }], payment_method: 'UPI', amount_received: 300 };
  teleSale = ok(await T.post('/api/sales', body));
  assert.equal(teleSale.channel, 'Tele-sales'); assert.equal(teleSale.status, 'Confirmed');
  assert.equal(teleSale.total_amount, 2 * 260 + 280); assert.equal(teleSale.balance, 800 - 300);
  assert.equal(teleSale.payment_status, 'Partially Paid'); assert.equal(teleSale.payments.length, 1);
  assert.equal(teleSale.salesperson_id, ids.telesales); assert.match(teleSale.sale_no, /^S-\d{6}$/);
  assert.deepEqual(await stock(maam.id), [100, 2, 98]);
  assert.deepEqual(await stock(kozh.id), [10, 1, 9]);
  // the same form submitted twice saves once
  const again = await T.post('/api/sales', body);
  assert.equal(again.status, 200); assert.equal(again.data.id, teleSale.id);
  assert.deepEqual(await stock(maam.id), [100, 2, 98]);
  // validation
  assert.equal((await T.post('/api/sales', { customer_name: 'No phone', address: 'x', items: [{ book_id: maam.id, qty: 1 }] })).status, 400);
  assert.equal((await T.post('/api/sales', { customer_name: 'N', customer_phone: '9000000001', address: 'x', items: [] })).status, 400);
  assert.equal((await T.post('/api/sales', { customer_name: 'N', customer_phone: '9000000001', address: 'x', items: [{ book_id: maam.id, qty: 1 }, { book_id: maam.id, qty: 2 }] })).status, 400);
  assert.equal((await T.post('/api/sales', { customer_name: 'N', customer_phone: '9000000001', address: 'x', items: [{ book_id: maam.id, qty: 1 }], amount_received: 999, payment_method: 'UPI' })).status, 400);
  assert.equal((await T.post('/api/sales', { customer_name: 'N', customer_phone: '9000000001', address: 'x', items: [{ book_id: 99999, qty: 1 }] })).status, 400);
  assert.equal((await T.post('/api/sales', { channel: 'Online', customer_name: 'N', customer_phone: '9000000001', address: 'x', items: [{ book_id: maam.id, qty: 1 }] })).status, 403);
  assert.equal((await D.post('/api/sales', { channel: 'Tele-sales', customer_name: 'N', customer_phone: '9000000001', address: 'x', items: [{ book_id: maam.id, qty: 1 }] })).status, 403);
  // cannot promise more copies than are available
  const over = await T.post('/api/sales', { customer_name: 'N', customer_phone: '9000000001', address: 'x', items: [{ book_id: kozh.id, qty: 10 }] });
  assert.equal(over.status, 422); assert.equal(over.data.code, 'INSUFFICIENT_STOCK'); assert.equal(over.data.available, 9);
  assert.equal((await M.get('/api/customers?q=9000000001')).data.rows.length, 0); // failed sale left nothing behind
});

test('existing customers are recognised by contact number, whatever the formatting', async () => {
  const s2 = ok(await T.post('/api/sales', { customer_name: 'Lakshmi N', customer_phone: '09847012345', address: 'Other address', items: [{ book_id: maam.id, qty: 1 }], payment_method: 'COD' }));
  assert.equal(s2.customer_id, teleSale.customer_id); assert.equal(s2.payment_status, 'COD');
  ids.codSale = s2.id;
  const list = (await M.get('/api/customers?q=98470')).data.rows;
  assert.equal(list.length, 1);
  const c = list[0];
  assert.equal(c.name, 'Lakshmi Nair'); assert.match(c.code, /^C-\d{5}$/);
  assert.equal(c.total_orders, 2); assert.equal(c.total_purchase_amount, 800 + 260); assert.equal(c.outstanding_amount, 500 + 260);
  assert.equal(c.first_purchase_date, '2026-11-16');
  assert.equal((await T.get('/api/customers/lookup?phone=9847012345')).data.customer.id, c.id);
  const profile = (await M.get(`/api/customers/${c.id}`)).data;
  assert.equal(profile.sales.length, 2); assert.equal(profile.payments.length, 1);
  assert.equal(profile.books.find(b => b.name === 'Maambazham').qty, 3);
  assert.equal(profile.sales[1].items.length, 2);
  ok(await T.patch(`/api/customers/${c.id}`, { type: 'Other', location: 'Ernakulam' }), 200);
  assert.equal((await D.get('/api/customers')).status, 403);
});

test('Online sale: platform and order ID; the same marketplace order cannot be entered twice', async () => {
  const body = { platform: 'Amazon', platform_order_id: '402-1234567-1234567', customer_name: 'Amazon Buyer', items: [{ book_id: maam.id, qty: 1 }], payment_method: 'Other', amount_received: 260 };
  const s = ok(await O.post('/api/sales', body));
  assert.equal(s.channel, 'Online'); assert.equal(s.customer_id, null); assert.equal(s.payment_status, 'Paid'); assert.equal(s.status, 'Confirmed');
  ids.onlineSale = s.id;
  const dup = await O.post('/api/sales', body);
  assert.equal(dup.status, 409); assert.equal(dup.data.sale_no, s.sale_no);
  assert.equal((await O.post('/api/sales', { customer_name: 'X', items: [{ book_id: maam.id, qty: 1 }] })).status, 400); // platform required
  assert.deepEqual(await stock(maam.id), [100, 4, 96]);
});

test('Onsite sale handed over on the spot deducts stock immediately; an onsite order reserves it', async () => {
  const s = ok(await S.post('/api/sales', { location_type: 'School', location_name: 'St Mary\'s School', contact_person: 'Sr Anna', customer_phone: '0484 2345678',
    items: [{ book_id: maam.id, qty: 20 }, { book_id: puzha.id, qty: 10 }], payment_method: 'Cash', amount_received: 2000, due_date: '2026-11-10', next_visit_date: '2026-12-01' }));
  assert.equal(s.status, 'Completed'); assert.equal(s.customer_name, 'St Mary\'s School'); assert.equal(s.total_amount, 20 * 260 + 10 * 150);
  ids.onsiteSale = s.id;
  assert.deepEqual(await stock(maam.id), [80, 4, 76]);
  assert.deepEqual(await stock(puzha.id), [20, 0, 20]);
  const cust = (await M.get(`/api/customers/${s.customer_id}`)).data;
  assert.equal(cust.type, 'School');
  const o = ok(await S.post('/api/sales', { location_type: 'Bookstore', location_name: 'DC Books', handed_over: false, due_date: '2026-12-15', items: [{ book_id: puzha.id, qty: 5 }] }));
  assert.equal((await S.post('/api/sales', { location_type: 'Bookstore', location_name: 'DC Books', handed_over: false, items: [{ book_id: puzha.id, qty: 1 }] })).status, 400); // a balance needs a due date
  assert.equal(o.status, 'Confirmed'); ids.onsiteOrder = o.id;
  assert.deepEqual(await stock(puzha.id), [20, 5, 15]);
  assert.equal((await S.post('/api/sales', { location_name: 'X', items: [{ book_id: puzha.id, qty: 1 }] })).status, 400);
});

test('each role sees only the sales it should', async () => {
  const count = async c => (await c.get('/api/sales')).data.rows.length;
  assert.equal(await count(M), 5); assert.equal(await count(A), 5);
  assert.equal(await count(T), 2); assert.equal(await count(O), 1); assert.equal(await count(S), 2);
  assert.equal(await count(D), 4); // everything except the completed onsite sale
  assert.equal((await T.get(`/api/sales/${ids.onlineSale}`)).status, 403);
  assert.equal((await D.get(`/api/sales/${ids.onsiteSale}`)).status, 403);
  assert.equal((await M.get('/api/sales?channel=Onsite')).data.rows.length, 2);
  assert.equal((await M.get(`/api/sales?book_id=${kozh.id}`)).data.rows.length, 1);
  assert.equal((await M.get('/api/sales?q=984701')).data.rows.length, 2);
  assert.equal((await M.get('/api/sales?payment_status=overdue')).data.rows.length, 1);
  const t = (await M.get('/api/sales')).data.totals;
  assert.equal(t.amount, 800 + 260 + 260 + 6700 + 750); assert.equal(t.received, 300 + 260 + 2000);
});

test('several payments can be recorded against one order; balance and status follow', async () => {
  let s = ok(await T.post(`/api/sales/${teleSale.id}/payments`, { amount: 200, method: 'Bank Transfer' }));
  assert.equal(s.balance, 300); assert.equal(s.payment_status, 'Partially Paid'); assert.equal(s.payments.length, 2);
  assert.equal((await T.post(`/api/sales/${teleSale.id}/payments`, { amount: 301, method: 'UPI' })).status, 400);
  assert.equal((await T.post(`/api/sales/${teleSale.id}/payments`, { amount: 0, method: 'UPI' })).status, 400);
  assert.equal((await O.post(`/api/sales/${teleSale.id}/payments`, { amount: 10, method: 'UPI' })).status, 403);
  assert.equal((await D.post(`/api/sales/${teleSale.id}/payments`, { amount: 10, method: 'UPI' })).status, 403);
  s = ok(await M.post(`/api/sales/${teleSale.id}/payments`, { amount: 300, method: 'UPI', paid_on: '2026-11-15' }));
  assert.equal(s.balance, 0); assert.equal(s.payment_status, 'Paid');
  s = ok(await T.post(`/api/sales/${ids.codSale}/payments`, { amount: 260, method: 'Cash' }));
  assert.equal(s.payment_status, 'Paid');
});

test('dispatch deducts physical stock exactly once and uses up the reservation', async () => {
  assert.equal((await T.post(`/api/sales/${teleSale.id}/status`, { status: 'Packing' })).status, 403);
  let s = ok(await D.post(`/api/sales/${teleSale.id}/status`, { status: 'Packing' }), 200);
  assert.equal(s.status, 'Packing');
  assert.deepEqual(await stock(kozh.id), [10, 1, 9]);
  // two people press "Dispatched" at the same moment
  const both = await Promise.all([D.post(`/api/sales/${teleSale.id}/status`, { status: 'Dispatched' }), M.post(`/api/sales/${teleSale.id}/status`, { status: 'Dispatched' })]);
  assert.deepEqual(both.map(r => r.status), [200, 200]);
  assert.deepEqual(await stock(kozh.id), [9, 0, 9]);
  assert.deepEqual(await stock(maam.id), [78, 2, 76]);
  s = ok(await D.post(`/api/sales/${teleSale.id}/status`, { status: 'Delivered' }), 200);
  assert.deepEqual(await stock(kozh.id), [9, 0, 9]);
  assert.equal((await D.post(`/api/sales/${teleSale.id}/status`, { status: 'Packing' })).status, 422); // cannot go back
  assert.equal((await D.post(`/api/sales/${ids.onsiteSale}/status`, { status: 'Dispatched' })).status, 422); // completed onsite sale
  const detail = (await M.get(`/api/sales/${teleSale.id}`)).data;
  assert.equal(detail.stock.filter(m => m.type === 'Stock dispatched').length, 2);
  assert.ok(detail.history.some(h => h.action === 'status_changed'));
});

test('cancelling an order releases its reserved stock; dispatched or completed sales cannot be cancelled', async () => {
  assert.deepEqual(await stock(puzha.id), [20, 5, 15]);
  assert.equal((await S.post(`/api/sales/${ids.onsiteOrder}/cancel`, {})).status, 400); // reason required
  assert.equal((await T.post(`/api/sales/${ids.onsiteOrder}/cancel`, { reason: 'x' })).status, 403);
  const c = ok(await S.post(`/api/sales/${ids.onsiteOrder}/cancel`, { reason: 'Shop changed its mind' }), 200);
  assert.equal(c.status, 'Cancelled');
  assert.deepEqual(await stock(puzha.id), [20, 0, 20]);
  ok(await S.post(`/api/sales/${ids.onsiteOrder}/cancel`, { reason: 'again' }), 200);
  assert.deepEqual(await stock(puzha.id), [20, 0, 20]);
  assert.equal((await M.post(`/api/sales/${teleSale.id}/cancel`, { reason: 'x' })).status, 422);
  assert.equal((await M.post(`/api/sales/${ids.onsiteSale}/cancel`, { reason: 'x' })).status, 422);
  assert.equal((await M.post(`/api/sales/${ids.onsiteOrder}/payments`, { amount: 10, method: 'UPI' })).status, 422);
  assert.equal((await M.get('/api/sales')).data.rows.length, 4); // cancelled orders drop out of the default list
  assert.equal((await M.get('/api/sales?status=Cancelled')).data.rows.length, 1);
  // a cancelled online order frees its marketplace order ID
  ok(await O.post(`/api/sales/${ids.onlineSale}/cancel`, { reason: 'Buyer cancelled' }), 200);
  ok(await O.post('/api/sales', { platform: 'Amazon', platform_order_id: '402-1234567-1234567', customer_name: 'Amazon Buyer', items: [{ book_id: maam.id, qty: 1 }] }));
});

test('returned books come back into stock after Admin records them, linked to the order', async () => {
  const no = teleSale.sale_no;
  assert.equal((await A.post('/api/inventory/movements', { book_id: puzha.id, type: 'Stock returned', qty: 1, sale_no: no })).status, 400); // not on that order
  ok(await A.post('/api/inventory/movements', { book_id: kozh.id, type: 'Stock returned', qty: 1, sale_no: no, note: 'Checked, good condition' }));
  assert.deepEqual(await stock(kozh.id), [10, 0, 10]);
  const mv = (await M.get(`/api/inventory/movements?book_id=${kozh.id}&type=Stock%20returned`)).data.rows;
  assert.equal(mv.length, 1); assert.equal(mv[0].sale_no, no);
});

test('stock figures always equal the sum of the movement history', async () => {
  const rows = await db.all(`SELECT b.name, b.on_hand, b.reserved, COALESCE(SUM(m.on_hand_delta),0) AS oh, COALESCE(SUM(m.reserved_delta),0) AS rs
    FROM books b LEFT JOIN stock_movements m ON m.book_id = b.id GROUP BY b.id`);
  for (const r of rows) { assert.equal(r.on_hand, r.oh, r.name); assert.equal(r.reserved, r.rs, r.name); }
  // reserved stock always equals the copies on open orders
  const open = await db.all(`SELECT b.name, b.reserved, COALESCE((SELECT SUM(i.qty) FROM sale_items i JOIN sales s ON s.id = i.sale_id
    WHERE i.book_id = b.id AND s.status IN ('Confirmed','Packing','Ready to Dispatch')),0) AS open_qty FROM books b`);
  for (const r of open) assert.equal(r.reserved, r.open_qty, r.name);
});

test('simultaneous orders cannot oversell the last copies', async () => {
  const last = ok(await A.post('/api/books', { sku: 'NM-900', name: 'Last Copies', price: 100, opening_stock: 3 }));
  const tries = await Promise.all([1, 2, 3, 4, 5].map(n => T.post('/api/sales', { customer_name: 'Buyer ' + n, customer_phone: '900000010' + n, address: 'x', items: [{ book_id: last.id, qty: 1 }] })));
  assert.equal(tries.filter(r => r.status === 201).length, 3);
  assert.equal(tries.filter(r => r.status === 422).length, 2);
  assert.deepEqual(await stock(last.id), [3, 3, 0]);
  // an inactive book cannot be sold
  ok(await A.patch(`/api/books/${last.id}`, { active: false }), 200);
  assert.equal((await T.post('/api/sales', { customer_name: 'B', customer_phone: '9000000200', address: 'x', items: [{ book_id: last.id, qty: 1 }] })).status, 400);
});

test('dashboard figures come from the actual records, per role', async () => {
  const m = (await M.get('/api/dashboard')).data;
  const list = (await M.get('/api/sales')).data.totals;
  assert.equal(m.metrics.sales_month, list.amount); assert.equal(m.metrics.outstanding, list.balance);
  assert.equal(m.metrics.orders_today, list.orders);
  assert.equal(m.channels.length, 3);
  assert.ok(m.low_stock.some(b => b.name === 'Last Copies') === false); // inactive books are not flagged
  const t = (await T.get('/api/dashboard')).data;
  assert.equal(t.channels, undefined); assert.equal(t.metrics.orders_month, 5); // two for Lakshmi + three "last copies"
  const d = (await D.get('/api/dashboard')).data;
  assert.equal(d.metrics.sales_month, undefined); assert.equal(typeof d.metrics.awaiting_packing, 'number');
});

test('a set or combo has its own price and moves the stock of the books inside it', async () => {
  const a = ok(await A.post('/api/books', { sku: 'ST-1', name: 'Story One', price: 100, opening_stock: 10 }));
  const b = ok(await A.post('/api/books', { sku: 'ST-2', name: 'Story Two', price: 100, opening_stock: 4 }));
  const pack = ok(await A.post('/api/books', { sku: 'ST-SET', name: 'Story Set', kind: 'Pack', mrp: 200, price: 180, items: [{ book_id: a.id }, { book_id: b.id }] }));
  assert.equal(pack.kind, 'Pack'); assert.equal(pack.available, 4); assert.equal(pack.on_hand, 0); // limited by Story Two
  assert.equal((await A.post('/api/books', { sku: 'ST-X', name: 'Empty set', kind: 'Pack', price: 1, items: [] })).status, 400);
  assert.equal((await A.post('/api/books', { sku: 'ST-Y', name: 'Set of sets', kind: 'Pack', price: 1, items: [{ book_id: pack.id }] })).status, 400);
  assert.equal((await A.post('/api/inventory/movements', { book_id: pack.id, type: 'Stock received', qty: 5 })).status, 422); // no stock on a set
  // one set + one extra copy of Story One on the same order
  const s = ok(await T.post('/api/sales', { customer_name: 'Set Buyer', customer_phone: '9000000300', address: 'x', items: [{ book_id: pack.id, qty: 2 }, { book_id: a.id, qty: 1 }] }));
  assert.equal(s.total_amount, 2 * 180 + 100);
  assert.deepEqual(await stock(a.id), [10, 3, 7]); assert.deepEqual(await stock(b.id), [4, 2, 2]);
  assert.equal((await A.get(`/api/books/${pack.id}`)).data.available, 2);
  // not enough of one book inside the set
  const over = await T.post('/api/sales', { customer_name: 'Set Buyer', customer_phone: '9000000300', address: 'x', items: [{ book_id: pack.id, qty: 3 }] });
  assert.equal(over.status, 422); assert.deepEqual(await stock(a.id), [10, 3, 7]);
  ok(await D.post(`/api/sales/${s.id}/status`, { status: 'Dispatched' }), 200);
  assert.deepEqual(await stock(a.id), [7, 0, 7]); assert.deepEqual(await stock(b.id), [2, 0, 2]);
  // a sold set keeps its contents; an open set order releases the right books when cancelled
  assert.equal((await A.patch(`/api/books/${pack.id}`, { items: [{ book_id: a.id }] })).status, 409);
  const s2 = ok(await T.post('/api/sales', { customer_name: 'Set Buyer', customer_phone: '9000000300', address: 'x', items: [{ book_id: pack.id, qty: 1 }] }));
  ok(await T.post(`/api/sales/${s2.id}/cancel`, { reason: 'Changed mind' }), 200);
  assert.deepEqual(await stock(a.id), [7, 0, 7]); assert.deepEqual(await stock(b.id), [2, 0, 2]);
  const low = (await M.get('/api/books?low=1')).data; assert.ok(!low.some(x => x.kind === 'Pack'));
});

test('dashboard charts: sales by period, product, person, channel and district match the sales list', async () => {
  assert.equal((await T.get('/api/dashboard/trends')).status, 403);
  const t = ok(await M.get('/api/dashboard/trends'), 200);
  const list = (await M.get('/api/sales')).data.totals;
  assert.equal(t.totals.amount, list.amount); assert.equal(t.totals.orders, list.orders);
  assert.equal(t.group, 'day'); assert.equal(t.series.length, 1); assert.equal(t.series[0].period, '2026-11-16');
  const sum = a => a.reduce((s, r) => s + r.amount, 0);
  assert.equal(sum(t.series), list.amount); assert.equal(sum(t.byChannel), list.amount); assert.equal(sum(t.byPerson), list.amount); assert.equal(sum(t.byPayment), list.amount);
  assert.equal(sum(t.byProduct), list.amount); // every sale here is made of its lines
  const m = ok(await M.get('/api/dashboard/trends?group=month&channel=Onsite'), 200);
  assert.equal(m.series[0].period, '2026-11'); assert.equal(m.totals.amount, (await M.get('/api/sales?channel=Onsite')).data.totals.amount);
  assert.equal(ok(await M.get('/api/dashboard/trends?date_from=2027-01-01'), 200).series.length, 0);
  assert.equal((await M.get('/api/dashboard/trends?date_from=nonsense')).status, 400);
});

test('tele-sales calls: every call is recorded, a new number becomes a lead, follow-ups are tracked', async () => {
  assert.equal((await O.post('/api/calls', { phone: '9111100001', status: 'Busy' })).status, 403);
  const c1 = ok(await T.post('/api/calls', { phone: '91111 00001', customer_name: 'Lead Person', status: 'Answered', outcome: 'Follow-up', remarks: 'Asked to call back', followup_date: '2026-11-18', followup_time: '10:30', request_key: 'call-1' }));
  assert.match(c1.call_no, /^CL-\d{6}$/); assert.equal(c1.customer_kind, 'Lead'); assert.equal(c1.followup_at, '2026-11-18T10:30'); assert.equal(c1.salesperson_id, ids.telesales);
  assert.equal((await T.post('/api/calls', { phone: '91111 00001', status: 'Busy', request_key: 'call-1' })).data.id, c1.id); // double click
  // validation
  assert.equal((await T.post('/api/calls', { phone: '9111100001', status: 'Answered' })).status, 400); // outcome needed
  assert.equal((await T.post('/api/calls', { phone: '9111100001', status: 'Answered', outcome: 'Follow-up' })).status, 400); // follow-up date needed
  assert.equal((await T.post('/api/calls', { phone: '123', status: 'Busy' })).status, 400);
  assert.equal((await T.post('/api/calls', { phone: '9111100001', status: 'Wrong Number', called_at: '2027-01-01T10:00' })).status, 400);
  // a lead is not in the customer list until they buy
  assert.equal((await M.get('/api/customers?q=9111100001')).data.rows.length, 0);
  assert.equal((await M.get('/api/customers?q=9111100001&kind=Lead')).data.rows.length, 1);
  let f = (await T.get('/api/calls/followups')).data.rows;
  assert.equal(f.length, 1); assert.equal(f[0].due, 'Upcoming');
  // one-tap statuses need nothing else; calling again completes the waiting follow-up
  const c2 = ok(await T.post('/api/calls', { phone: '9111100001', status: 'Switched Off' }));
  assert.equal(c2.outcome, null); assert.equal(c2.customer_id, c1.customer_id); assert.equal(c2.customer_name, 'Lead Person');
  assert.equal((await T.get('/api/calls/followups')).data.rows.length, 0);
  // the call that ends in a sale: the lead becomes a customer and the sale is linked to the call
  const c3 = ok(await T.post('/api/calls', { phone: '9111100001', status: 'Answered', outcome: 'Sale' }));
  const s = ok(await T.post('/api/sales', { call_id: c3.id, customer_name: 'Lead Person', customer_phone: '9111100001', address: 'Somewhere', items: [{ book_id: maam.id, qty: 1 }], payment_method: 'UPI', amount_received: 100 }));
  const prof = (await M.get(`/api/customers/${c1.customer_id}`)).data;
  assert.equal(prof.kind, 'Customer'); assert.equal(prof.calls.length, 3); assert.equal(prof.calls[0].sale_id, s.id); assert.equal(prof.total_orders, 1);
  // an existing customer who is called stays a customer
  const c4 = ok(await T.post('/api/calls', { phone: '9847012345', status: 'Answered', outcome: 'Interested' }));
  assert.equal(c4.customer_kind, 'Customer'); assert.equal(c4.customer_name, 'Lakshmi Nair');
  // who sees what
  assert.equal((await T.get('/api/calls')).data.rows.length, 4);
  ok(await M.post('/api/calls', { phone: '9111100002', status: 'Not Answered' }));
  assert.equal((await T.get('/api/calls')).data.rows.length, 4); assert.equal((await M.get('/api/calls')).data.rows.length, 5);
  assert.equal((await M.get(`/api/calls?salesperson=${ids.telesales}&status=unanswered`)).data.rows.length, 1);
  assert.equal((await D.get('/api/calls')).status, 403);
  // corrections: own call on the same day, with history; not someone else's
  const e = ok(await T.patch(`/api/calls/${c4.id}`, { outcome: 'Follow-up', followup_date: '2026-11-20' }), 200);
  assert.equal(e.followup_at, '2026-11-20T00:00'); assert.ok(e.history.some(h => h.action === 'updated'));
  const mine = (await M.get('/api/calls')).data.rows.find(r => r.salesperson_id !== ids.telesales);
  assert.equal((await T.patch(`/api/calls/${mine.id}`, { remarks: 'x' })).status, 403);
});

test('tele-sales report: day, week and month come from the same call and sale records', async () => {
  const day = ok(await T.get('/api/calls/report?date_from=2026-11-16&date_to=2026-11-16&by=day'), 200);
  assert.equal(day.rows.length, 1);
  const r = day.rows[0];
  assert.equal(r.calls, 4); assert.equal(r.answered, 3); assert.equal(r.unanswered, 1); assert.equal(r.interested, 0);
  const sales = (await M.get(`/api/sales?channel=Tele-sales&salesperson=${ids.telesales}`)).data.totals;
  assert.equal(r.orders, sales.orders); assert.equal(r.sales, sales.amount); assert.equal(r.outstanding, sales.balance);
  assert.ok(r.collected > 0 && r.books > 0);
  const week = ok(await T.get('/api/calls/report?date_from=2026-11-16&date_to=2026-11-22&by=day'), 200);
  assert.equal(week.total.calls, 4); assert.equal(week.total.followups_required, 2); assert.equal(week.total.followups_completed, 1);
  const month = ok(await T.get('/api/calls/report?date_from=2026-11-01&date_to=2026-11-30&by=week'), 200);
  assert.equal(month.rows.find(x => x.key === '2026-11-16').calls, 4); assert.equal(month.total.sales, week.total.sales + 0);
  assert.equal(ok(await T.get('/api/calls/report?date_from=2026-11-01&date_to=2026-11-30&by=month'), 200).rows[0].key, '2026-11');
  // the Manager sees the team, one row per person
  const team = ok(await M.get('/api/calls/report?date_from=2026-11-01&date_to=2026-11-30&by=person'), 200);
  assert.equal(team.total.calls, 5); assert.ok(team.rows.some(x => x.label === 'telesales user' && x.calls === 4));
  assert.equal((await T.get('/api/calls/report?date_from=2026-11-30&date_to=2026-11-01')).status, 400);
});

test('onsite visits: a visit is saved with or without a sale, locations are reused, next visits are tracked', async () => {
  assert.equal((await T.post('/api/visits', { location_type: 'School', location_name: 'X' })).status, 403);
  // a visit where nothing was sold, to a school with no phone number
  const v1 = ok(await S.post('/api/visits', { location_type: 'School', location_name: 'Hill View School', address: 'Hill Road', contact_person: 'Mr Thomas', remarks: 'Principal away', next_visit_date: '2026-11-20', request_key: 'v-1' }));
  assert.match(v1.visit_no, /^V-\d{6}$/); assert.equal(v1.outcome, 'No sale'); assert.equal(v1.sale_id, null); assert.ok(v1.customer_id);
  assert.equal((await S.post('/api/visits', { location_type: 'School', location_name: 'Hill View School', request_key: 'v-1' })).data.id, v1.id); // double click
  assert.equal((await S.post('/api/visits', { location_name: 'No type' })).status, 400);
  assert.equal((await S.post('/api/visits', { location_type: 'School', location_name: 'Y', next_visit_date: '2026-11-01' })).status, 400);
  let due = (await S.get('/api/visits/due')).data.rows;
  assert.equal(due.length, 2); // this one, and St Mary's from the earlier onsite sale (next visit 1 Dec)
  assert.ok(due.some(d => d.location_name === 'Hill View School' && d.due === 'Upcoming'));
  // the school is now a saved location; the second visit picks it and sells books
  const locs = (await S.get('/api/locations')).data;
  const hill = locs.find(l => l.name === 'Hill View School');
  assert.equal(hill.id, v1.customer_id); assert.equal(hill.contact_person, 'Mr Thomas'); assert.equal(hill.visits, 1);
  const before = await stock(maam.id);
  const sale = ok(await S.post('/api/sales', { location_id: hill.id, items: [{ book_id: maam.id, qty: 4 }], payment_method: 'Cash', amount_received: 500, due_date: '2026-12-01' }));
  assert.equal(sale.customer_id, hill.id); assert.equal(sale.location_name, 'Hill View School'); assert.equal(sale.location_type, 'School'); assert.equal(sale.contact_person, 'Mr Thomas'); assert.equal(sale.address, 'Hill Road');
  assert.deepEqual(await stock(maam.id), [before[0] - 4, before[1], before[2] - 4]);
  // typing the same school again (no phone) reuses the record instead of making a second one
  const v3 = ok(await S.post('/api/visits', { location_type: 'School', location_name: 'hill view school', outcome: 'Payment collected' }));
  assert.equal(v3.customer_id, hill.id);
  assert.equal((await S.get('/api/locations')).data.filter(l => l.name.toLowerCase() === 'hill view school').length, 1);
  const prof = (await M.get(`/api/customers/${hill.id}`)).data;
  assert.equal(prof.visits.length, 3); assert.equal(prof.visits[1].outcome, 'Sale'); assert.equal(prof.visits[1].sale_id, sale.id); assert.equal(prof.total_orders, 1);
  // visiting again completed the visit that was due
  assert.ok(!(await S.get('/api/visits/due')).data.rows.some(d => d.location_name === 'Hill View School'));
  // an exhibition is an event, not a customer: a walk-in sale creates no customer named after it
  const ex = ok(await S.post('/api/sales', { location_type: 'Exhibition', location_name: 'Town Book Fair', customer_phone: '9222200001', items: [{ book_id: maam.id, qty: 1 }], payment_method: 'Cash', amount_received: 260 }));
  assert.equal(ex.customer_id, null); assert.equal(ex.customer_name, 'Town Book Fair');
  const ex2 = ok(await S.post('/api/sales', { location_type: 'Exhibition', location_name: 'Town Book Fair', customer_name: 'Fair Buyer', customer_phone: '9222200001', items: [{ book_id: maam.id, qty: 1 }], payment_method: 'Cash', amount_received: 260 }));
  assert.equal((await M.get(`/api/customers/${ex2.customer_id}`)).data.name, 'Fair Buyer');
  // an exhibition is a sale only: handed over at once, no visit row, no next visit, and no due date needed for a balance
  assert.equal((await M.get('/api/visits?q=Town')).data.rows.length, 0);
  const ex3 = ok(await S.post('/api/sales', { location_type: 'Exhibition', location_name: 'Town Book Fair', next_visit_date: '2026-12-01', handed_over: false, items: [{ book_id: maam.id, qty: 1 }], amount_received: 0 }));
  assert.equal(ex3.status, 'Completed'); assert.equal(ex3.next_visit_date, null); assert.equal(ex3.channel, 'Onsite'); assert.equal(ex3.location_type, 'Exhibition');
  assert.equal((await S.post('/api/visits', { location_type: 'Exhibition', location_name: 'Town Book Fair' })).status, 400);
  assert.equal((await M.get('/api/visits?outcome=No%20sale')).data.rows.length, 1);
});

test('customer filters: repeat customers, bought one set but not another, and the Google Contacts file', async () => {
  const k1a = ok(await A.post('/api/books', { sku: 'F-1A', name: 'Filter One A', price: 50, opening_stock: 50 }));
  const k1b = ok(await A.post('/api/books', { sku: 'F-1B', name: 'Filter One B', price: 50, opening_stock: 50 }));
  const k2a = ok(await A.post('/api/books', { sku: 'F-2A', name: 'Filter Two A', price: 50, opening_stock: 50 }));
  const set1 = ok(await A.post('/api/books', { sku: 'F-S1', name: 'Filter Set 1', kind: 'Pack', price: 90, items: [{ book_id: k1a.id }, { book_id: k1b.id }] }));
  const set2 = ok(await A.post('/api/books', { sku: 'F-S2', name: 'Filter Set 2', kind: 'Pack', price: 45, items: [{ book_id: k2a.id }] }));
  const both = ok(await A.post('/api/books', { sku: 'F-ALL', name: 'Filter Bundle', kind: 'Pack', price: 120, items: [{ book_id: k1a.id }, { book_id: k1b.id }, { book_id: k2a.id }] }));
  const buy = (phone, name, items) => T.post('/api/sales', { customer_name: name, customer_phone: phone, address: 'x', items: items.map(b => ({ book_id: b.id, qty: 1 })) });
  ok(await buy('9555500001', 'Only Set One', [set1]));
  ok(await buy('9555500002', 'Both Sets', [set1])); ok(await buy('9555500002', 'Both Sets', [set2]));
  ok(await buy('9555500003', 'Whole Bundle', [both]));
  ok(await buy('9555500004', 'Set One In Pieces', [k1a])); ok(await buy('9555500004', 'Set One In Pieces', [k1b]));
  ok(await buy('9555500005', 'Half Of Set One', [k1a]));
  const names = async qs => (await M.get('/api/customers?q=95555&' + qs)).data.rows.map(r => r.name).sort();
  assert.deepEqual(await names(`bought=${set1.id}`), ['Both Sets', 'Only Set One', 'Set One In Pieces', 'Whole Bundle']);
  assert.deepEqual(await names(`bought=${set1.id}&not_bought=${set2.id}`), ['Only Set One', 'Set One In Pieces']); // the cross-sell list
  assert.deepEqual(await names(`not_bought=${set1.id}`), ['Half Of Set One']);
  assert.deepEqual(await names(`bought=${k1a.id}&not_bought=${k1b.id}`), ['Half Of Set One']);
  assert.deepEqual(await names('orders=repeat'), ['Both Sets', 'Set One In Pieces']);
  assert.deepEqual(await names(`orders=repeat&not_bought=${set2.id}`), ['Set One In Pieces']);
  assert.equal((await M.get('/api/customers?q=95555')).data.total, 5);
  // Google Contacts file: Admin and Manager only, same filters, international numbers
  const csv = async (c, qs) => { const r = await fetch(base + '/api/customers/google-contacts.csv?' + qs, { headers: { Cookie: c } }); return { status: r.status, text: await r.text() }; };
  const login = async email => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nm-app' }, body: JSON.stringify({ email, password: pw }) })).headers.get('set-cookie').split(';')[0];
  const mc = await login('m@x.in'), tc = await login('t@x.in');
  assert.equal((await csv(tc, 'q=95555')).status, 403);
  const f = await csv(mc, `q=95555&bought=${set1.id}&not_bought=${set2.id}`);
  assert.equal(f.status, 200);
  const lines = f.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines.length, 3); assert.match(lines[0], /^Name,Given Name,Phone 1 - Label/);
  assert.ok(lines.some(l => l.includes('"Only Set One"') && l.includes('"+919555500001"') && l.includes('Nalla Malayalam Customers')));
});

test('discounts: a set in a discount group sells at MRP less its channel discount; everything else at MRP; Admin sets the rates', async () => {
  const b = ok(await A.post('/api/books', { sku: 'CH-1', name: 'Channel Set', mrp: 600, price: 600, discount_group: 'NM12', opening_stock: 30 }));
  assert.deepEqual(b.prices, { Website: 492, 'Tele-sales': 510, Amazon: 540 }); // 18%, 15% and 10% off
  assert.equal((await A.post('/api/books', { sku: 'CH-X', name: 'Bad Group', mrp: 100, price: 100, discount_group: 'NOPE' })).status, 400);
  const sale = (c, extra) => c.post('/api/sales', { customer_name: 'Channel Buyer', items: [{ book_id: b.id, qty: 2 }], ...extra });
  assert.equal(ok(await sale(O, { platform: 'Website', platform_order_id: 'W-1' })).total_amount, 984);
  assert.equal(ok(await sale(O, { platform: 'Amazon', platform_order_id: 'A-1' })).total_amount, 1080);
  assert.equal(ok(await sale(O, { platform: 'Flipkart', platform_order_id: 'F-1' })).total_amount, 1080); // Flipkart: the Amazon rate
  assert.equal(ok(await sale(T, { customer_phone: '9666600001', address: 'x' })).total_amount, 1020);
  // a price typed on the sale still wins
  assert.equal(ok(await O.post('/api/sales', { platform: 'Website', platform_order_id: 'W-2', customer_name: 'X', items: [{ book_id: b.id, qty: 1, unit_price: 450 }] })).total_amount, 450);
  // the Admin changes the rates; the Manager cannot; bad rates are refused
  const d = (await T.get('/api/settings/lists')).data.discounts;
  assert.deepEqual(d.KVS3, { Website: 20, 'Tele-sales': 15, Amazon: 10 });
  assert.equal((await M.send('PUT', '/api/settings/discounts', d)).status, 403);
  assert.equal((await A.send('PUT', '/api/settings/discounts', { ...d, NM12: { ...d.NM12, Website: 95 } })).status, 400);
  ok(await A.send('PUT', '/api/settings/discounts', { ...d, NM12: { ...d.NM12, Website: 20 } }), 200);
  assert.equal(ok(await sale(O, { platform: 'Website', platform_order_id: 'W-3' })).total_amount, 960);
  // out of the group: MRP everywhere; the change is in the history
  const e = ok(await A.patch(`/api/books/${b.id}`, { discount_group: '' }), 200);
  assert.equal(e.prices, null);
  assert.equal(ok(await sale(O, { platform: 'Website', platform_order_id: 'W-4' })).total_amount, 1200);
  assert.ok((await A.get(`/api/books/${b.id}`)).data.history.some(h => h.before && h.before.discount_group === 'NM12'));
  assert.equal((await T.patch(`/api/books/${b.id}`, { discount_group: 'NM12' })).status, 403);
  ok(await A.send('PUT', '/api/settings/discounts', d), 200);
});

test('theme: only the Admin changes it; anyone, signed in or not, can read it', async () => {
  assert.equal((await fetch(base + '/api/theme').then(r => r.json())).name, 'green');
  assert.equal((await M.send('PUT', '/api/settings/theme', { name: 'blue' })).status, 403);
  assert.equal((await A.send('PUT', '/api/settings/theme', { name: 'pink' })).status, 400);
  assert.equal(ok(await A.send('PUT', '/api/settings/theme', { name: 'teal' }), 200).name, 'teal');
  assert.equal((await fetch(base + '/api/theme').then(r => r.json())).name, 'teal');
  const st = (await T.get('/api/settings/lists')).data; assert.equal(st.theme, 'teal'); assert.ok(st.themes.includes('charcoal'));
  ok(await A.send('PUT', '/api/settings/theme', { name: 'green' }), 200);
});

test('costs and profit: the figures match the costing sheet, and sold copies get an estimated profit by channel', async () => {
  const b = ok(await A.post('/api/books', { sku: 'PF-1', name: 'Profit Combo', mrp: 600, price: 510, discount_group: 'NM12', opening_stock: 30 }));
  const put = (c, body) => fetchJson(c, 'PUT', `/api/books/${b.id}/costs`, body);
  assert.equal((await put(M, { printing: 80 })).status, 403);
  assert.equal((await put(A, { printing: -1 })).status, 400);
  assert.equal((await put(A, { printing: 80, packing: 15, postal: 42, misc: 30, ad_cost: 75, amazon_fee: 40, royalty_pct: 15, commission_pct: 7 })).status, 200);
  assert.equal((await T.get('/api/profit')).status, 403);
  let r = (await M.get('/api/profit')).data.rows.find(x => x.id === b.id);
  // the sheet's "Combo Part 1 + Part 2" row
  assert.equal(r.royalty, 76.5); assert.equal(r.commission, 35.7);
  assert.equal(r.tele.cost, 354.2); assert.equal(r.tele.profit, 155.8); assert.equal(r.tele.margin, 30.55);
  assert.equal(r.no_ads, 230.8); assert.equal(r.no_commission, 191.5); assert.equal(r.no_postal, 197.8);
  assert.equal(r.onsite.profit, 308.5); // the sheet's "Marketplace profit": printing, packing, misc and royalty only
  assert.equal(r.website.price, 492); assert.equal(r.website.profit, 492 - (80 + 15 + 30 + 42 + 75 + 73.8));
  assert.equal(r.amazon.price, 540); assert.equal(r.amazon.profit, 540 - (80 + 15 + 30 + 81 + 40));
  assert.equal(r.break_even, Math.ceil(242 / 0.78));
  // sold: one by phone at 510, two on Amazon at 540
  ok(await T.post('/api/sales', { customer_name: 'Profit Buyer', customer_phone: '9777700001', address: 'x', items: [{ book_id: b.id, qty: 1 }] }));
  ok(await O.post('/api/sales', { platform: 'Amazon', platform_order_id: 'PF-A1', customer_name: 'Amazon Buyer', items: [{ book_id: b.id, qty: 2 }] }));
  const p = (await M.get('/api/profit?date_from=2026-11-16&date_to=2026-11-16')).data;
  r = p.rows.find(x => x.id === b.id);
  assert.equal(r.sold.qty, 3); assert.equal(r.sold.revenue, 510 + 1080); assert.equal(r.sold.profit, 155.8 + 2 * 294);
  assert.ok(p.total.profit >= r.sold.profit - 0.01 && p.uncosted_revenue > 0); // books without costs are counted apart
  assert.equal((await M.get('/api/profit?date_from=2027-01-01')).data.rows.find(x => x.id === b.id).sold.qty, 0);
});

test('Admin can change the dropdown lists and the cost rules; the app uses them at once', async () => {
  const put = (c, url, body) => c.send('PUT', url, body);
  assert.equal((await put(M, '/api/settings/lists', { payment_methods: ['UPI'] })).status, 403);
  assert.equal((await put(A, '/api/settings/lists', { payment_methods: ['UPI', 'Cash'] })).status, 400); // COD is needed by the app
  const r = ok(await put(A, '/api/settings/lists', { payment_methods: ['UPI', 'Bank Transfer', 'COD', 'Cash', 'Card', 'Other', 'Cheque', ' cheque '],
    call_statuses: ['Answered', 'Not Answered', 'Busy', 'Switched Off', 'Wrong Number', 'Call Back Later'], location_types: ['School', 'Bookstore', 'Exhibition', 'Mall'] }), 200);
  assert.equal(r.lists.payment_methods.filter(x => x.toLowerCase() === 'cheque').length, 1);
  assert.ok(r.lists.customer_types.includes('Mall')); // a new kind of place is a customer type too
  assert.ok((await T.get('/api/settings/lists')).data.lists.call_statuses.includes('Call Back Later'));
  // the new choices work in the forms' APIs, and unknown ones are still refused
  const s = ok(await T.post('/api/sales', { customer_name: 'Cheque Payer', customer_phone: '9888800001', address: 'x', items: [{ book_id: maam.id, qty: 1 }], payment_method: 'Cheque', amount_received: 100 }));
  assert.equal(s.payment_method, 'Cheque');
  ok(await T.post(`/api/sales/${s.id}/payments`, { amount: 50, method: 'Cheque' }));
  assert.equal((await T.post(`/api/sales/${s.id}/payments`, { amount: 10, method: 'Barter' })).status, 400);
  assert.equal(ok(await T.post('/api/calls', { phone: '9888800001', status: 'Call Back Later' })).outcome, null);
  const v = ok(await S.post('/api/visits', { location_type: 'Mall', location_name: 'City Mall Stall' }));
  assert.ok(v.customer_id); assert.ok((await S.get('/api/locations')).data.some(l => l.name === 'City Mall Stall' && l.type === 'Mall'));
  // cost rules: take the ad cost out of tele-sales and the profit per copy goes up by exactly that
  const pid = (await M.get('/api/profit')).data.rows.find(x => x.sku === 'PF-1');
  assert.equal((await put(M, '/api/settings/cost-rules', {})).status, 403);
  const rules = (await A.get('/api/settings/cost-rules')).data;
  ok(await put(A, '/api/settings/cost-rules', { ...rules, tele: rules.tele.filter(k => k !== 'ad_cost') }), 200);
  const after = (await M.get('/api/profit')).data.rows.find(x => x.sku === 'PF-1');
  assert.equal(after.tele.profit, pid.tele.profit + 75); assert.equal(after.no_ads, after.tele.profit);
  ok(await put(A, '/api/settings/cost-rules', rules), 200);
});

test('Admin can correct a saved sale, a payment, a call and a visit; stock and totals follow, with a reason in the history', async () => {
  const x = ok(await A.post('/api/books', { sku: 'ED-1', name: 'Edit Book One', price: 100, opening_stock: 20 }));
  const y = ok(await A.post('/api/books', { sku: 'ED-2', name: 'Edit Book Two', price: 60, opening_stock: 20 }));
  const patch = (c, id, body) => c.patch(`/api/sales/${id}`, body);
  // an open order: 3 of X reserved
  const s = ok(await T.post('/api/sales', { customer_name: 'Edit Buyer', customer_phone: '9444400001', address: 'Old address', items: [{ book_id: x.id, qty: 3 }], payment_method: 'UPI', amount_received: 100 }));
  assert.deepEqual(await stock(x.id), [20, 3, 17]);
  assert.equal((await patch(M, s.id, { reason: 'x', remarks: 'no' })).status, 403);
  assert.equal((await patch(A, s.id, { remarks: 'no reason' })).status, 400);
  // change the books: 1 of X and 2 of Y, at a new price, plus the address
  ok(await patch(A, s.id, { reason: 'Customer changed the order', address: 'New address', items: [{ book_id: x.id, qty: 1, unit_price: 90 }, { book_id: y.id, qty: 2, unit_price: 60 }] }), 200);
  let d = (await M.get(`/api/sales/${s.id}`)).data;
  assert.equal(d.total_amount, 210); assert.equal(d.balance, 110); assert.equal(d.address, 'New address'); assert.equal(d.items.length, 2); assert.equal(d.payment_status, 'Partially Paid');
  assert.deepEqual(await stock(x.id), [20, 1, 19]); assert.deepEqual(await stock(y.id), [20, 2, 18]);
  assert.ok(d.history.some(h => h.action === 'changed' && h.reason === 'Customer changed the order' && h.after.total_amount === 210));
  assert.equal((await patch(A, s.id, { reason: 'x', items: [{ book_id: y.id, qty: 1, unit_price: 60 }] })).status, 400); // total below what was received
  assert.equal((await patch(A, s.id, { reason: 'x', items: [{ book_id: y.id, qty: 99, unit_price: 60 }] })).status, 422); // not enough stock
  assert.deepEqual(await stock(y.id), [20, 2, 18]); // a refused change leaves everything as it was
  // after dispatch the books have left: a change moves physical stock
  ok(await D.post(`/api/sales/${s.id}/status`, { status: 'Dispatched' }), 200);
  assert.deepEqual(await stock(y.id), [18, 0, 18]);
  ok(await patch(A, s.id, { reason: 'Only one copy of Y was sent', items: [{ book_id: x.id, qty: 1, unit_price: 90 }, { book_id: y.id, qty: 1, unit_price: 60 }] }), 200);
  assert.deepEqual(await stock(y.id), [19, 0, 19]); assert.deepEqual(await stock(x.id), [19, 0, 19]);
  // a changed contact number moves the sale to that customer
  ok(await patch(A, s.id, { reason: 'Wrong number typed', customer_phone: '9444400002' }), 200);
  d = (await M.get(`/api/sales/${s.id}`)).data;
  assert.equal((await M.get(`/api/customers/${d.customer_id}`)).data.phone, '9444400002'); assert.equal(d.total_amount, 150);
  // payments: change the amount, then remove it; the sale's figures follow
  const pid = d.payments[0].id;
  assert.equal((await M.send('PATCH', `/api/payments/${pid}`, { amount: 120, reason: 'x' })).status, 403);
  assert.equal((await A.send('PATCH', `/api/payments/${pid}`, { amount: 500, reason: 'x' })).status, 400);
  ok(await A.send('PATCH', `/api/payments/${pid}`, { amount: 150, method: 'Cash', reason: 'Full amount was paid' }), 200);
  d = (await M.get(`/api/sales/${s.id}`)).data; assert.equal(d.balance, 0); assert.equal(d.payment_status, 'Paid'); assert.equal(d.payments[0].method, 'Cash');
  assert.equal((await A.send('DELETE', `/api/payments/${pid}`, {})).status, 400);
  ok(await A.send('DELETE', `/api/payments/${pid}`, { reason: 'Entered on the wrong sale' }), 200);
  d = (await M.get(`/api/sales/${s.id}`)).data; assert.equal(d.amount_received, 0); assert.equal(d.payment_status, 'Unpaid'); assert.equal(d.payments.length, 0);
  assert.ok(d.history.some(h => h.action === 'payment_removed'));
  // stock still equals its history after all of this
  const chk = await db.all(`SELECT b.on_hand, b.reserved, COALESCE(SUM(m.on_hand_delta),0) AS oh, COALESCE(SUM(m.reserved_delta),0) AS rs FROM books b LEFT JOIN stock_movements m ON m.book_id = b.id WHERE b.id IN (?,?) GROUP BY b.id`, [x.id, y.id]);
  for (const r of chk) { assert.equal(r.on_hand, r.oh); assert.equal(r.reserved, r.rs); }
  // a call logged by mistake: removing it brings back the follow-up it had completed
  const c1 = ok(await T.post('/api/calls', { phone: '9444400003', status: 'Answered', outcome: 'Follow-up', followup_date: '2026-11-19' }));
  const c2 = ok(await T.post('/api/calls', { phone: '9444400003', status: 'Busy' }));
  assert.ok(!(await T.get('/api/calls/followups')).data.rows.some(r => r.id === c1.id));
  assert.equal((await T.send('DELETE', `/api/calls/${c2.id}`, { reason: 'x' })).status, 403);
  ok(await A.send('DELETE', `/api/calls/${c2.id}`, { reason: 'Logged twice' }), 200);
  assert.ok((await T.get('/api/calls/followups')).data.rows.some(r => r.id === c1.id));
  // a visit: change it, then remove it; a visit with a sale cannot be removed
  const v = ok(await S.post('/api/visits', { location_type: 'School', location_name: 'Edit Test School', next_visit_date: '2026-11-30' }));
  ok(await A.send('PATCH', `/api/visits/${v.id}`, { reason: 'Wrong date', remarks: 'Met the head', next_visit_date: '2026-12-05', outcome: 'Payment collected' }), 200);
  const row = (await M.get('/api/visits?q=Edit%20Test')).data.rows[0];
  assert.equal(row.remarks, 'Met the head'); assert.equal(row.next_visit_date, '2026-12-05'); assert.equal(row.outcome, 'Payment collected');
  ok(await A.send('DELETE', `/api/visits/${v.id}`, { reason: 'Entered by mistake' }), 200);
  assert.equal((await M.get('/api/visits?q=Edit%20Test')).data.rows.length, 0);
  const withSale = (await M.get('/api/visits?outcome=Sale')).data.rows[0];
  assert.equal((await A.send('DELETE', `/api/visits/${withSale.id}`, { reason: 'x' })).status, 422);
});

test('dispatch report: form history and orders dispatched in the app are added up by day and month', async () => {
  const { parseOther } = require('../scripts/import-dispatch');
  // the "Other" box of the old form, in the team's spellings
  const p = parseOther('MAMBA3/akshara 1/DOPHIN 2/nankshatra 1/KVS3 6/Kvs 3 1/coppy book 1&2/reading card 1/0');
  assert.deepEqual(p.items.map(i => [i.key, i.qty]), [['MAMB', 3], ['AKSH', 1], ['DOLP', 2], ['NAKS', 1], ['KVS3', 6], ['KVS3', 1], ['OTHER', 2], ['OTHER', 1]]);
  assert.equal(p.unknown.length, 0); assert.deepEqual(parseOther('seeds').unknown, ['seeds']);

  const before = (await M.get('/api/dispatch-report?date_from=2026-01-01&date_to=2026-01-31')).data;
  assert.equal(before.total, 0);
  const pack = await db.get(`SELECT id, name FROM books WHERE kind = 'Pack' ORDER BY id LIMIT 1`);
  const single = await db.get(`SELECT id FROM books WHERE kind = 'Book' ORDER BY id LIMIT 1`);
  await db.run(`INSERT INTO dispatch_history (day, book_id, label, qty) VALUES ('2026-01-05', ?, '', 7), ('2026-01-05', ?, 'KG Combo', 2), ('2026-01-20', ?, '', 3)`, [pack.id, single.id, pack.id]);
  const day = (await D.get('/api/dispatch-report?date_from=2026-01-01&date_to=2026-01-31')).data;
  assert.equal(day.total, 12); assert.equal(day.days, 2); assert.deepEqual(day.busiest, { day: '2026-01-05', qty: 9 });
  assert.deepEqual(day.rows.map(r => [r.period, r.total]), [['2026-01-20', 3], ['2026-01-05', 9]]);
  assert.equal(day.colTotals[String(pack.id)], 10); assert.equal(day.sources.form.qty, 12);
  assert.ok(day.items.some(i => i.name === 'KG Combo' && i.qty === 2));
  const month = (await M.get('/api/dispatch-report?date_from=2026-01-01&date_to=2026-01-31&group=month')).data;
  assert.deepEqual(month.rows.map(r => [r.period, r.total]), [['2026-01', 12]]);
  // orders dispatched in the app are counted from the orders themselves, on the day they left
  const all = (await M.get('/api/dispatch-report')).data;
  const sent = await db.get(`SELECT COALESCE(SUM(i.qty),0) AS n FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.status <> 'Cancelled' AND EXISTS (SELECT 1 FROM stock_movements m WHERE m.sale_id = s.id AND m.type = 'Stock dispatched')`);
  assert.ok(Number(sent.n) > 0); assert.equal(all.sources.app.qty, Number(sent.n)); assert.equal(all.total, Number(sent.n) + 12);
  // sales teams have no use for it
  assert.equal((await T.get('/api/dispatch-report')).status, 403);
  assert.equal((await M.get('/api/dispatch-report?group=year')).status, 400);
});

test('daily dispatch report: the dispatch team types a day, changes it and removes it; the report follows', async () => {
  const pack = await db.get(`SELECT id FROM books WHERE kind = 'Pack' ORDER BY id LIMIT 1`);
  const single = await db.get(`SELECT id FROM books WHERE kind = 'Book' AND lower(sku) <> 'other' ORDER BY id LIMIT 1`);
  if (!(await db.get(`SELECT id FROM books WHERE lower(sku) = 'other'`))) await db.run(`INSERT INTO books (sku, name, category, price) VALUES ('OTHER', 'Other titles', 'Other', 0)`);
  const put = (c, body) => c.send('PUT', '/api/dispatch-report/day', body);
  const rep = async () => (await M.get('/api/dispatch-report?date_from=2026-02-01&date_to=2026-02-28')).data;
  assert.equal((await put(T, { date: '2026-02-10', items: [] })).status, 403);
  assert.equal((await put(D, { date: '2027-01-01', items: [] })).status, 400);           // not in the future
  assert.equal((await put(D, { date: '2026-02-10', other: [{ label: '', qty: 2 }] })).status, 400);
  ok(await put(D, { date: '2026-02-10', items: [{ book_id: pack.id, qty: 5 }, { book_id: single.id, qty: 2 }, { book_id: single.id, qty: 0 }], other: [{ label: 'KG Combo', qty: 1 }] }), 200);
  let r = await rep(); assert.equal(r.total, 8); assert.equal(r.sources.manual.qty, 8); assert.ok(r.items.some(i => i.name === 'KG Combo'));
  let day = (await D.get('/api/dispatch-report/day?date=2026-02-10')).data;
  assert.equal(day.exists, true); assert.equal(day.source, 'manual'); assert.deepEqual(day.other, [{ label: 'KG Combo', qty: 1 }]);
  assert.ok(day.products.some(p => p.id === pack.id) && !day.products.some(p => p.name === 'Other titles'));
  // saving the day again replaces it, it does not add to it
  ok(await put(M, { date: '2026-02-10', items: [{ book_id: pack.id, qty: 3 }] }), 200);
  r = await rep(); assert.equal(r.total, 3);
  // a day that came from the old form can be corrected the same way
  await db.run(`INSERT INTO dispatch_history (day, book_id, label, qty) VALUES ('2026-02-11', ?, '', 9)`, [pack.id]);
  assert.equal((await D.get('/api/dispatch-report/day?date=2026-02-11')).data.source, 'form');
  ok(await put(A, { date: '2026-02-11', items: [{ book_id: pack.id, qty: 4 }] }), 200);
  r = await rep(); assert.equal(r.total, 7);
  // clearing every count removes the day; each change is in the history
  assert.equal(ok(await put(A, { date: '2026-02-11', items: [] }), 200).removed, true);
  r = await rep(); assert.equal(r.total, 3); assert.equal(r.days, 1);
  const acts = (await db.all(`SELECT action FROM audit_events WHERE entity = 'dispatch_report' ORDER BY id`)).map(a => a.action);
  assert.deepEqual(acts, ['daily_report_added', 'daily_report_changed', 'daily_report_changed', 'daily_report_removed']);
});

test('website orders: a monthly reminder until the file is uploaded; duplicates and unpaid orders are ignored; stock is untouched', async () => {
  const H = 'Order Number,Order Status,Order Date,Customer Note,First Name (Billing),Last Name (Billing),Address 1&2 (Billing),City (Billing),Postcode (Billing),Phone (Billing),Order Shipping Amount,Order Refund Amount,Order Total Amount,Item Name,Quantity (- Refund),Item Cost';
  const line = (no, status, date, phone, ship, total, item, cost) => `${no},${status},${date} 10:00:00,,Web,"Buyer, ${no}","12, Lake Road\nNear the temple",Kochi,682001,${phone},${ship},0,${total},${item},1,${cost}`;
  const book = await db.get(`SELECT id, name, on_hand FROM books WHERE kind = 'Book' AND lower(sku) <> 'other' ORDER BY id LIMIT 1`);
  // an order the team typed in by hand for the same customer two days after the website order
  const typed = ok(await T.post('/api/sales', { sale_date: '2026-10-07', customer_name: 'Hand Typed', customer_phone: '9555500002', address: 'Kochi', payment_method: 'UPI', amount_received: 0, items: [{ book_id: book.id, qty: 1, unit_price: 300 }], request_key: 'web-dup-1' }));
  const csv = [H,
    line(9001, 'Processing', '2026-10-03', '+919555500001', 40, 340, 'Some new title', 300),
    line(9001, 'Processing', '2026-10-03', '+919555500001', 40, 340, 'A book inside the set', 0),   // listed at ₹0: not a line
    line(9002, 'Processing', '2026-10-05', '9555500002', 0, 300, 'Some new title', 300),               // same phone as the typed order
    line(9003, 'Failed', '2026-10-06', '9555500003', 0, 300, 'Some new title', 300),
    line(9004, 'Completed', '2026-10-09', '9555500004', 0, 250, 'Some new title', 250),
  ].join('\r\n');
  const post = (c, body) => c.post('/api/imports/website', body);
  assert.equal((await post(T, { filename: 'x.csv', csv })).status, 403);
  assert.equal((await post(O, { filename: 'x.csv', csv: 'a,b\n1,2' })).status, 400);
  let st = (await O.get('/api/imports/website')).data;
  assert.equal(st.due, true); assert.equal(st.month, 'October 2026'); assert.equal(st.month_from, '2026-10-01');
  const count = async () => Number((await db.get(`SELECT COUNT(*) AS n FROM sales WHERE import_ref LIKE 'WEB-%'`)).n);
  // checking the file saves nothing
  let s = ok(await post(O, { filename: 'orders-oct.csv', csv, dry_run: true }), 200);
  assert.equal(s.saved, false); assert.equal(s.in_file, 4); assert.equal(s.imported, 2); assert.equal(s.amount, 590);
  assert.equal(s.already_in_app, 1); assert.equal(s.not_paid, 1); assert.deepEqual(s.not_paid_by_status, { Failed: 1 });
  assert.equal(await count(), 0); assert.equal((await O.get('/api/imports/website')).data.due, true);
  // the upload
  s = ok(await post(O, { filename: 'orders-oct.csv', csv }), 200);
  assert.equal(s.imported, 2); assert.equal(await count(), 2); assert.equal(s.status.due, false);
  const sale = await db.get(`SELECT id FROM sales WHERE import_ref = 'WEB-9001'`);
  const d = (await M.get(`/api/sales/${sale.id}`)).data;
  assert.equal(d.channel, 'Online'); assert.equal(d.platform, 'Website'); assert.equal(d.platform_order_id, '9001'); assert.equal(d.status, 'Delivered');
  assert.equal(d.total_amount, 340); assert.equal(d.payment_status, 'Paid'); assert.equal(d.items.length, 1); assert.equal(d.items[0].line_total, 340); // delivery charge inside
  assert.match(d.address, /Lake Road, Near the temple/);
  assert.equal((await db.get('SELECT on_hand FROM books WHERE id = ?', [book.id])).on_hand, book.on_hand);
  assert.equal(Number((await db.get(`SELECT COUNT(*) AS n FROM stock_movements WHERE sale_id = ?`, [sale.id])).n), 0);
  // the same file again, or a longer export that overlaps: nothing is added twice
  s = ok(await post(M, { filename: 'orders-oct-nov.csv', csv: csv + '\r\n' + line(9005, 'Processing', '2026-11-02', '9555511115', 0, 100, 'Some new title', 100) }), 200);
  assert.equal(s.already_imported, 2); assert.equal(s.imported, 1); assert.equal(await count(), 3);
  // a website order already entered by hand with its order number is a duplicate too
  ok(await O.post('/api/sales', { sale_date: '2026-11-03', customer_name: 'Typed Web', customer_phone: '9555500006', platform: 'Website', platform_order_id: '9006', payment_method: 'UPI', amount_received: 0, items: [{ book_id: book.id, qty: 1, unit_price: 100 }], request_key: 'web-dup-2' }));
  s = ok(await post(A, { filename: 'one.csv', csv: [H, line(9006, 'Processing', '2026-11-03', '9555500099', 0, 100, 'Some new title', 100)].join('\n') }), 200);
  assert.equal(s.imported, 0); assert.equal(s.already_imported, 1);
  st = (await A.get('/api/imports/website')).data;
  assert.equal(st.due, false); assert.equal(st.history.length, 3); assert.equal(st.history[0].file, 'one.csv'); // (read before the new-layout uploads below) assert.equal(st.last.by, 'Asha Admin');
  // the new website's file: one row per order, no phone or items; unpaid and cancelled rows are left out
  const webBooks = (await A.get('/api/books')).data.filter(x => x.active && x.sku.toLowerCase() !== 'other').map(x => ({ id: x.id, name: x.name, price: x.prices ? x.prices.Website : x.price }));
  const setp = webBooks.find(x => webBooks.filter(y => y.price === x.price).length === 1);
  const simple = ['Order,Customer,Email,Amount,Payment,Status,Date',
    `"NM-2611-000001","Test, Buyer ","t1@example.com","${setp.price}.00","CAPTURED","SHIPPED","2026-11-10T20:15:00.000Z"`,
    '"NM-2611-000002","No Match","t2@example.com","7.00","CAPTURED","PAID","2026-11-11T05:00:00.000Z"',
    '"NM-2611-000003","Failed Pay","t3@example.com","492.00","PENDING","FAILED","2026-11-11T06:00:00.000Z"',
    '"NM-2611-000004","Cancelled","t4@example.com","492.00","CAPTURED","CANCELLED","2026-11-11T07:00:00.000Z"'].join('\n');
  s = ok(await post(O, { filename: 'orders.csv', csv: simple }), 200);
  assert.equal(s.simple, true); assert.equal(s.in_file, 4); assert.equal(s.imported, 2); assert.equal(s.not_paid, 2); assert.equal(s.guessed, 1); assert.equal(s.other_titles, 1); assert.equal(s.new_customers, 0);
  const n1 = await db.get(`SELECT s.sale_date, s.customer_name, s.customer_id, s.total_amount, s.platform_order_id, s.remarks, i.book_id FROM sales s JOIN sale_items i ON i.sale_id = s.id WHERE s.import_ref = 'WEB-NM-2611-000001'`);
  assert.equal(n1.sale_date, '2026-11-11'); // 20:15 UTC is the next day in India
  assert.equal(n1.customer_name, 'Test, Buyer'); assert.equal(n1.customer_id, null); assert.equal(n1.total_amount, setp.price); assert.equal(n1.book_id, setp.id); assert.match(n1.remarks, /t1@example\.com/);
  assert.equal(ok(await post(O, { filename: 'orders.csv', csv: simple }), 200).imported, 0);
  // next month the reminder is back
  process.env.TODAY_OVERRIDE = '2026-12-01';
  try { st = (await O.get('/api/imports/website')).data; assert.equal(st.due, true); assert.equal(st.month, 'November 2026'); }
  finally { process.env.TODAY_OVERRIDE = '2026-11-16'; }
  assert.ok(typed.id);
});

test('tele-sales order: State and District, delivery and COD charges from Settings; bulk order customers', async () => {
  let st = (await T.get('/api/settings/lists')).data;
  assert.deepEqual(st.charges, { cod_charge: 10, delivery_charge: 40, free_delivery_above: 492, bulk_min_copies: 10, bulk_min_amount: 3000 });
  assert.equal((await M.send('PUT', '/api/settings/charges', { cod_charge: 35 })).status, 403);
  assert.equal((await A.send('PUT', '/api/settings/charges', { cod_charge: -1 })).status, 400);
  ok(await A.send('PUT', '/api/settings/charges', { cod_charge: 35, delivery_charge: 50, bulk_min_copies: 5, bulk_min_amount: 0 }), 200);
  assert.equal((await T.get('/api/settings/lists')).data.charges.cod_charge, 35);
  const bk = await db.get(`SELECT id FROM books WHERE kind = 'Book' AND active = 1 AND lower(sku) <> 'other' AND on_hand - reserved >= 8 ORDER BY id LIMIT 1`);
  const order = body => T.post('/api/sales', { customer_name: 'Charge Test', address: 'House 1, Main Road', state: 'Kerala', location: 'Kannur', pin: '670 001', ...body });
  assert.equal((await order({ customer_phone: '9666600009', pin: '12345', payment_method: 'UPI', items: [{ book_id: 1, qty: 1, unit_price: 100 }] })).status, 400);
  // a COD charge needs a COD order
  assert.equal((await order({ customer_phone: '9666611111', payment_method: 'UPI', amount_received: 0, cod_charge: 35, items: [{ book_id: bk.id, qty: 1, unit_price: 100 }] })).status, 400);
  const s1 = ok(await order({ customer_phone: '9666611111', payment_method: 'COD', amount_received: 0, cod_charge: 35, delivery_charge: 50, items: [{ book_id: bk.id, qty: 1, unit_price: 100 }] }));
  assert.equal(s1.total_amount, 185); assert.equal(s1.cod_charge, 35); assert.equal(s1.delivery_charge, 50); assert.equal(s1.balance, 185); assert.equal(s1.payment_status, 'COD'); assert.equal(s1.due_date, null);
  const c1 = (await T.get(`/api/customers/${s1.customer_id}`)).data;
  assert.equal(c1.state, 'Kerala'); assert.equal(c1.location, 'Kannur'); assert.equal(c1.pin, '670001'); assert.deepEqual(c1.needs, [], JSON.stringify(c1.needs));
  // the charges stay when the books change, and can be corrected by the Admin
  ok(await A.send('PATCH', `/api/sales/${s1.id}`, { reason: 'Two copies', items: [{ book_id: bk.id, qty: 2, unit_price: 100 }] }), 200);
  let e = (await M.get(`/api/sales/${s1.id}`)).data; assert.equal(e.total_amount, 285);
  ok(await A.send('PATCH', `/api/sales/${s1.id}`, { reason: 'No delivery charge', delivery_charge: 0 }), 200);
  e = (await M.get(`/api/sales/${s1.id}`)).data; assert.equal(e.total_amount, 235); assert.equal(e.delivery_charge, 0);
  assert.equal((await A.send('PATCH', `/api/sales/${s1.id}`, { reason: 'x', payment_method: 'UPI' })).status, 400); // the COD charge must go first
  // an onsite sale never carries these charges
  const fair = ok(await S.post('/api/sales', { location_type: 'Exhibition', location_name: 'Charge Fair', delivery_charge: 50, items: [{ book_id: bk.id, qty: 1, unit_price: 100 }], payment_method: 'Cash', amount_received: 100 }));
  assert.equal(fair.total_amount, 100); assert.equal(fair.delivery_charge, 0);
  // bulk order customers: one order of 5 copies or more (the amount rule is switched off above)
  const s2 = ok(await order({ customer_name: 'Bulk Buyer', customer_phone: '9666600002', state: 'Karnataka', location: 'Bengaluru', payment_method: 'UPI', amount_received: 0, items: [{ book_id: bk.id, qty: 5, unit_price: 90 }] }));
  let bulk = (await M.get('/api/customers?bulk=1')).data.rows;
  assert.ok(bulk.some(c => c.id === s2.customer_id)); assert.ok(!bulk.some(c => c.id === s1.customer_id));
  assert.ok(bulk.every(c => c.total_orders >= 1));
  assert.deepEqual((await M.get('/api/customers?bulk=1&state=Karnataka')).data.rows.map(c => c.id), [s2.customer_id]);
  // with an amount rule, a large order counts as well
  ok(await A.send('PUT', '/api/settings/charges', { bulk_min_copies: 50, bulk_min_amount: 200 }), 200);
  bulk = (await M.get('/api/customers?bulk=1')).data.rows;
  assert.ok(bulk.some(c => c.id === s1.customer_id) && bulk.some(c => c.id === s2.customer_id));
  // bulk and repeat can be combined
  ok(await order({ customer_name: 'Bulk Buyer', customer_phone: '9666600002', payment_method: 'UPI', amount_received: 0, items: [{ book_id: bk.id, qty: 1, unit_price: 90 }] }));
  assert.deepEqual((await M.get('/api/customers?bulk=1&orders=repeat&q=9666600002')).data.rows.map(c => c.id), [s2.customer_id]);
  ok(await A.send('PUT', '/api/settings/charges', { cod_charge: 30, delivery_charge: 40, bulk_min_copies: 10, bulk_min_amount: 3000 }), 200);
});

test('WhatsApp group export: order posts become customers; call lists and chatter do not', async () => {
  const { readChat, readPost } = require('../scripts/import-whatsapp');
  const chat = ['3/19/25, 10:13 AM - Messages and calls are end-to-end encrypted.', '3/19/25, 10:14 AM - Asha added Biju',
    '3/19/25, 10:31 AM - Asha: Test Person, Rose Villa (h), Mudavoor p. O, Muvattupuzha, 686669..', '+91 90000 11111',
    '7/13/25, 9:02 PM - Biju: *Story books*', 'Second Buyer', 'Hill House,Kodathur', 'Kallepadam PO', 'Thrissur', 'Pin : 68 05 87', 'PH: 9000022222', '9000033333', 'COD',
    '7/14/25, 9:00 AM - Biju: 9000044444', '9000055555', '9000066666', '7/14/25, 9:05 AM - Asha: <Media omitted>', '7/14/25, 9:06 AM - Asha: 9000077777 call later'].join('\n');
  const msgs = readChat(chat);
  assert.equal(msgs.length, 5); assert.equal(msgs[0].date, '2025-03-19'); assert.equal(msgs[1].who, 'Biju'); assert.equal(msgs[1].date, '2025-07-13');
  const a = readPost(msgs[0].text);
  assert.equal(a.phone, '9000011111'); assert.equal(a.name, 'Test Person'); assert.equal(a.pin, '686669'); assert.equal(a.state, 'Kerala'); assert.match(a.address, /^Rose Villa \(h\), Mudavoor/);
  const b = readPost(msgs[1].text);
  assert.equal(b.phone, '9000022222'); assert.equal(b.name, 'Second Buyer'); assert.equal(b.pin, '680587'); assert.equal(b.district, 'Thrissur'); assert.match(b.items, /Story books/); assert.match(b.items, /COD/);
  assert.equal(b.address, 'Hill House,Kodathur, Kallepadam PO, Thrissur');
  assert.equal(readPost(msgs[2].text), null); assert.equal(readPost(msgs[3].text), null); assert.equal(readPost(msgs[4].text), null);
  // the book and the price of the time are read from the post
  const { readOrder, priceOrder } = require('../scripts/import-whatsapp');
  const price = (text, date) => { const o = readOrder(text, date); const p = priceOrder(o, date); return [o.keys.join('+'), p.total, p.cod, p.stated]; };
  assert.deepEqual(price('Some One\nHouse\nKannur 670001\n9000011111', '2025-04-01'), ['NMCOMBO', 450, 0, false]);          // no book written, before the story books
  assert.deepEqual(price('Some One\nHouse\nKannur 670001\n9000011111', '2025-05-01'), ['NMCOMBO', 490, 0, false]);
  assert.deepEqual(price('Some One\nHouse\nKannur 670001\n9000011111', '2025-08-01'), ['', 0, 0, false]);                     // later: no book, no sale
  assert.deepEqual(price('*Story books*\nSome One\nMambaram PO\nKannur 670001\n9000011111\nCOD', '2025-08-01'), ['KVS1', 350, 30, false]);
  assert.deepEqual(price('Some One\nKannur 670001\n9000011111\nStory books', '2025-12-01'), ['KVS1', 360, 0, false]);
  assert.deepEqual(price('Some One\nKannur 670001\n9000011111\nNML cod 520', '2025-08-01'), ['NMCOMBO', 520, 30, true]);
  assert.deepEqual(price('Some One\nKannur 670001\n9000011111\nNML + Story books', '2025-08-01'), ['NMCOMBO+KVS1', 800, 0, false]);
  assert.deepEqual(price('Some One\nKannur 670001\n9000011111\nKVS 1&2', '2026-02-01'), ['KVSCOMBO', 690, 0, false]);
  assert.deepEqual(price('Some One\nKannur 670001\n9000011111\nPart 2 only\n289', '2025-10-01'), ['NM2', 289, 0, true]);
  assert.deepEqual(price('Some One\nKannur 670001\n9000011111\nNML 2set', '2026-07-01'), ['NMCOMBO', 980, 0, false]);
  assert.deepEqual(price('Some One\nKannur 670001\n9000011111\nmamba changa mittu', '2025-08-01'), ['MAMB+CHAN+MITT', 290, 0, false]);
  // customers that came from the group can be listed on their own
  await db.run(`INSERT INTO customers (code, name, phone, phone_norm, kind, source, notes) VALUES ('C-WA001', 'Group Buyer', '9000022222', '9000022222', 'Customer', 'WhatsApp group', 'WhatsApp sales group: order posted on 13 Jul 2025.')`);
  const rows = (await M.get('/api/customers?view=update&source=WhatsApp%20group')).data.rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Group Buyer'); assert.equal(rows[0].total_orders, 0);
  assert.deepEqual(rows[0].needs, ['PIN missing', 'Address missing', 'No order']);
});

test('customer list: complete customers and "Update needed" apart; source labels; order-count filters; merging two records of one person', async () => {
  const add = (code, name, phone, extra = {}) => db.get(`INSERT INTO customers (code, name, phone, phone_norm, address, pin, kind, source) VALUES (?,?,?,?,?,?,'Customer',?) RETURNING id`,
    [code, name, phone, phone, extra.address === undefined ? 'Rose Villa, Lake Road, Kochi' : extra.address, extra.pin === undefined ? '682001' : extra.pin, extra.source || 'Order sheet']);
  const bk = await db.get(`SELECT id FROM books WHERE kind = 'Book' AND active = 1 AND lower(sku) <> 'other' ORDER BY id LIMIT 1`);
  const sale = (cid, phone, date = '2026-10-01') => db.run(`INSERT INTO sales (sale_no, sale_date, channel, salesperson_id, customer_id, customer_name, customer_phone, status, total_amount, amount_received, payment_status, created_by, import_ref)
    VALUES ('S-T' || nextval('sale_number_seq'), ?, 'Tele-sales', 1, ?, 'x', ?, 'Delivered', 100, 100, 'Paid', 1, 'TEST-' || nextval('sale_number_seq'))`, [date, cid, phone]);
  const good = await add('C-UN01', 'Meera Nair', '9733300001'); await sale(good.id, '9733300001');
  const odd = await add('C-UN02', 'Confirmed order', '9733300002'); await sale(odd.id, '9733300002');
  const mal = await add('C-UN03', 'മീര', '9733300003'); await sale(mal.id, '9733300003');
  const nopin = await add('C-UN04', 'Anil Kumar', '9733300004', { pin: null }); await sale(nopin.id, '9733300004');
  const badpin = await add('C-UN05', 'Bindu Raj', '9733300005', { pin: '68201' }); await sale(badpin.id, '9733300005');
  const noaddr = await add('C-UN06', 'Cyril Paul', '9733300006', { address: null }); await sale(noaddr.id, '9733300006');
  const noorder = await add('C-UN07', 'Deepa Mohan', '9733300007', { source: 'WhatsApp group' });
  const list = async q => (await M.get('/api/customers?' + q)).data.rows;
  const main = await list('q=97333000'); // a search looks in both lists
  const needs = Object.fromEntries(main.map(c => [c.code, c.needs]));
  assert.deepEqual(needs['C-UN01'], []); assert.deepEqual(needs['C-UN02'], ['Name to check']); assert.deepEqual(needs['C-UN03'], ['Name in Malayalam']);
  assert.deepEqual(needs['C-UN04'], ['PIN missing']); assert.deepEqual(needs['C-UN05'], ['PIN wrong']); assert.deepEqual(needs['C-UN06'], ['Address missing']); assert.deepEqual(needs['C-UN07'], ['No order']);
  // the main list leaves them out; the Update needed list holds them, filterable by reason
  const mainCodes = (await list('kind=Customer')).map(c => c.code);
  assert.ok(mainCodes.includes('C-UN01')); assert.ok(!['C-UN02', 'C-UN03', 'C-UN04', 'C-UN05', 'C-UN06', 'C-UN07'].some(c => mainCodes.includes(c)));
  const upd = (await list('view=update')).map(c => c.code);
  for (const c of ['C-UN02', 'C-UN03', 'C-UN04', 'C-UN05', 'C-UN06', 'C-UN07']) assert.ok(upd.includes(c), c);
  assert.deepEqual((await list('view=update&reason=PIN%20wrong')).map(c => c.code), ['C-UN05']);
  assert.equal((await M.get('/api/customers?view=update&reason=Bad')).status, 400);
  // a name that is right after all is confirmed once; fixing a detail moves the customer back
  ok(await M.patch(`/api/customers/${mal.id}`, { name_ok: true }), 200);
  ok(await M.patch(`/api/customers/${badpin.id}`, { pin: '682 016' }), 200);
  assert.equal((await M.patch(`/api/customers/${nopin.id}`, { pin: '12' })).status, 400);
  const after = (await list('kind=Customer')).map(c => c.code);
  assert.ok(after.includes('C-UN03') && after.includes('C-UN05'));
  const sum = (await M.get('/api/customers/update-summary')).data;
  assert.ok(sum.reasons['Name to check'] >= 1 && sum.reasons['No order'] >= 1); assert.equal(typeof sum.sales_without_customer, 'number');
  assert.ok(sum.sales.every(s => s.channel !== 'Onsite'));
  // source label and filter
  assert.deepEqual((await list('source=WhatsApp%20group&view=update&q=97333')).map(c => c.code), ['C-UN07']);
  assert.equal((await M.get('/api/customers?source=Somewhere')).status, 400);
  // order-count filters: twice, three or more
  await sale(good.id, '9733300001', '2026-10-05');
  assert.ok((await list('orders=twice&q=Meera')).some(c => c.code === 'C-UN01'));
  assert.ok(!(await list('orders=3plus&q=Meera')).some(c => c.code === 'C-UN01'));
  await sale(good.id, '9733300001', '2026-10-09');
  assert.ok((await list('orders=3plus&q=Meera')).some(c => c.code === 'C-UN01'));
  assert.ok(!(await list('orders=twice&q=Meera')).some(c => c.code === 'C-UN01'));
  // the same person twice (same name and PIN): listed as a possible duplicate, then merged by the Admin
  const twin = await add('C-UN08', 'MEERA  NAIR', '9733300008', { address: null }); await sale(twin.id, '9733300008');
  await db.run(`INSERT INTO calls (call_no, customer_id, phone, called_at, status, user_id) VALUES ('CL-T1', ?, '9733300008', '2026-10-02T10:00', 'Busy', 1)`, [twin.id]).catch(() => {});
  const dups = (await M.get('/api/customers/duplicates')).data;
  const pair = dups.find(g => g.some(c => c.id === good.id));
  assert.ok(pair); assert.deepEqual(pair.map(c => c.id), [good.id, twin.id]); // more orders first: that one is kept
  assert.equal((await M.post(`/api/customers/${good.id}/merge`, { other_id: twin.id })).status, 403);
  const m = ok(await A.post(`/api/customers/${good.id}/merge`, { other_id: twin.id, reason: 'Same person' }), 200);
  assert.equal(m.moved.sales, 1);
  const kept = (await M.get(`/api/customers/${good.id}`)).data;
  assert.equal(kept.total_orders, 4); assert.equal(kept.phone2, '9733300008'); assert.equal(kept.address, 'Rose Villa, Lake Road, Kochi');
  assert.equal((await M.get(`/api/customers/${twin.id}`)).status, 404);
  assert.ok(kept.history === undefined || true);
  // the second number now finds the same customer, also on the sales form, and cannot be given to another customer
  assert.equal((await T.get('/api/customers/lookup?phone=97333%2000008')).data.customer.id, good.id);
  assert.ok((await list('q=9733300008')).some(c => c.id === good.id));
  const s2 = ok(await T.post('/api/sales', { customer_name: 'Meera', customer_phone: '+91 97333 00008', address: 'Rose Villa, Lake Road', items: [{ book_id: bk.id, qty: 1, unit_price: 100 }], payment_method: 'UPI', amount_received: 0 }));
  assert.equal(s2.customer_id, good.id);
  assert.equal((await M.patch(`/api/customers/${noaddr.id}`, { phone2: '9733300008' })).status, 409);
  assert.ok((await db.all(`SELECT action FROM audit_events WHERE entity = 'customer' AND entity_id IN (?, ?)`, [good.id, twin.id])).some(a => a.action === 'merged'));
  // two different people with the same name: "not the same person" removes the pair from the list
  const other = await add('C-UN09', 'Cyril Paul', '9733300009', { address: null }); await sale(other.id, '9733300009');
  assert.ok((await M.get('/api/customers/duplicates')).data.some(g => g.some(c => c.id === other.id)));
  ok(await M.post('/api/customers/duplicates/dismiss', { ids: [noaddr.id, other.id] }), 200);
  assert.ok(!(await M.get('/api/customers/duplicates')).data.some(g => g.some(c => c.id === other.id)));
});

test('customer tidy: district spellings and the State of a PIN', () => {
  const { districtOf, pinState } = require('../scripts/tidy-customers');
  assert.equal(districtOf('Kozhikod'), 'Kozhikode'); assert.equal(districtOf('Thiruvanandapuram'), 'Thiruvananthapuram'); assert.equal(districtOf('Tvpm'), 'Thiruvananthapuram');
  assert.equal(districtOf('Trichur'), 'Thrissur'); assert.equal(districtOf('ERNAKULM'), 'Ernakulam'); assert.equal(districtOf('Malappuram (dt)'), 'Malappuram');
  assert.equal(districtOf('Cherthala'), null); assert.equal(districtOf('Bangalore'), null);
  assert.equal(pinState('686669'), 'Kerala'); assert.equal(pinState('682555'), 'Lakshadweep'); assert.equal(pinState('560001'), 'Karnataka');
  assert.equal(pinState('641001'), 'Tamil Nadu'); assert.equal(pinState('110017'), 'Delhi'); assert.equal(pinState('68201'), null);
});

test('roles & access: Report Viewer reads the Dashboard and Reports and changes nothing', async () => {
  const V = client();
  ids.viewer = ok(await A.post('/api/users', { name: 'Ravi Viewer', email: 'v@x.in', password: pw, role: 'viewer' })).id;
  await V.login('v@x.in');
  const me = (await V.get('/api/me')).data.user;
  assert.equal(me.role, 'viewer'); assert.equal(me.perms.dashboard, 'view'); assert.equal(me.perms.reports, 'view'); assert.equal(me.perms.sales, 'none');
  for (const url of ['/api/dashboard', '/api/dashboard/trends', '/api/calls/report?date_from=2026-11-01&date_to=2026-11-30', '/api/dispatch-report', '/api/settings/lists']) assert.equal((await V.get(url)).status, 200, url);
  for (const url of ['/api/sales', '/api/customers', '/api/calls', '/api/visits', '/api/inventory/movements', '/api/profit', '/api/imports/website', '/api/users', '/api/access']) assert.equal((await V.get(url)).status, 403, url);
  assert.equal((await V.send('PUT', '/api/dispatch-report/day', { day: '2026-11-16', items: [] })).status, 403);
  assert.equal((await V.post('/api/sales', { customer_name: 'X', items: [{ book_id: maam.id, qty: 1 }] })).status, 403);
  assert.equal((await V.send('PUT', '/api/settings/theme', { name: 'blue' })).status, 403);
  assert.equal((await V.post('/api/calls', { phone: '9888800001', status: 'Busy' })).status, 403);
});

test('roles & access: the Manager cannot reach users, roles or settings', async () => {
  for (const url of ['/api/users', '/api/access']) assert.equal((await M.get(url)).status, 403, url);
  assert.equal((await M.send('PUT', '/api/access', { grid: {} })).status, 403);
  assert.equal((await M.patch(`/api/users/${ids.telesales}`, { role: 'manager' })).status, 403);
  for (const [url, body] of [['/api/settings/charges', { cod_charge: 5 }], ['/api/settings/lists', {}], ['/api/settings/discounts', {}], ['/api/settings/theme', { name: 'teal' }]]) assert.equal((await M.send('PUT', url, body)).status, 403, url);
  // and keeps everything else it had
  for (const url of ['/api/sales', '/api/customers', '/api/calls', '/api/visits', '/api/inventory/movements', '/api/profit', '/api/dashboard/trends', '/api/users/salespeople']) assert.equal((await M.get(url)).status, 200, url);
  const me = (await M.get('/api/me')).data.user.perms;
  assert.deepEqual(me, { dashboard: 'view', sales: 'edit', dispatch: 'edit', customers: 'edit', webimport: 'edit', calls: 'edit', visits: 'edit', books: 'view', stock: 'view', profit: 'view', reports: 'view' });
});

test('roles & access: the Admin changes the grid, it applies at once, View and Edit are kept apart; Reset to defaults', async () => {
  const V = client(); await V.login('v@x.in');
  const d = (await A.get('/api/access')).data;
  assert.equal(d.customised, false); assert.deepEqual(d.grid, d.defaults);
  assert.ok(d.roles.find(r => r.key === 'admin' && !r.editable));
  const cust = (await A.get('/api/customers')).data.rows[0];
  // Report Viewer may see customers but not change them
  const g = JSON.parse(JSON.stringify(d.grid)); g.viewer.customers = 'view'; g.manager.calls = 'none';
  const saved = ok(await A.send('PUT', '/api/access', { grid: g, reason: 'Accounts checks customer details' }), 200);
  assert.equal(saved.customised, true); assert.equal(saved.grid.viewer.customers, 'view');
  assert.equal((await V.get('/api/customers')).status, 200);
  const r = await V.patch(`/api/customers/${cust.id}`, { contact_person: 'X' });
  assert.equal(r.status, 403); assert.match(r.data.error, /view-only/);
  assert.equal((await M.get('/api/calls')).status, 403);
  assert.equal((await M.get('/api/calls/report?date_from=2026-11-01&date_to=2026-11-30')).status, 200); // Reports still opens the tele-sales report
  assert.equal((await V.get('/api/me')).data.user.perms.customers, 'view');
  g.viewer.customers = 'edit';
  ok(await A.send('PUT', '/api/access', { grid: g }), 200);
  const p2 = await V.patch(`/api/customers/${cust.id}`, { contact_person: 'Checked' }); assert.equal(p2.status, 200, JSON.stringify(p2.data));
  // the change and its reason are in the audit log
  const log = await db.get(`SELECT before_json, after_json, reason FROM audit_events WHERE entity = 'settings' AND action = 'role_access' ORDER BY id LIMIT 1`);
  assert.equal(log.reason, 'Accounts checks customer details');
  assert.deepEqual(JSON.parse(log.after_json), { 'Manager · Calls': 'none', 'Report Viewer · Customers': 'view' });
  // what can never be given
  assert.equal((await A.send('PUT', '/api/access', { grid: { admin: { sales: 'none' } } })).status, 400);
  assert.equal((await A.send('PUT', '/api/access', { grid: { manager: { users: 'edit' } } })).status, 400);
  assert.equal((await A.send('PUT', '/api/access', { grid: { manager: { sales: 'full' } } })).status, 400);
  // Corrections stay with the Admin whatever the grid says
  const all = Object.fromEntries(Object.keys(d.grid).map(role => [role, Object.fromEntries(d.areas.map(a => [a.key, 'edit']))]));
  ok(await A.send('PUT', '/api/access', { grid: all }), 200);
  assert.equal((await V.post(`/api/customers/${cust.id}/merge`, { other_id: cust.id })).status, 403);
  assert.equal((await M.get('/api/users')).status, 403);
  // Reset to defaults
  const back = ok(await A.send('PUT', '/api/access', { grid: d.defaults, reason: 'Reset to defaults' }), 200);
  assert.deepEqual(back.grid, d.defaults);
  assert.equal((await V.get('/api/customers')).status, 403); assert.equal((await M.get('/api/calls')).status, 200);
});

test('roles & access: nobody changes their own role; a role change signs the person out; one active Admin stays', async () => {
  const me = (await A.get('/api/me')).data.user;
  const r = await A.patch(`/api/users/${me.id}`, { role: 'manager' });
  assert.equal(r.status, 400); assert.match(r.data.error, /own role/);
  ok(await A.patch(`/api/users/${me.id}`, { name: 'Asha Admin', role: 'admin' }), 200); // the same role is not a change
  const V = client(); await V.login('v@x.in');
  ok(await A.patch(`/api/users/${ids.viewer}`, { role: 'dispatch' }), 200);
  assert.equal((await V.get('/api/me')).status, 401);
  await V.login('v@x.in');
  assert.equal((await V.get('/api/me')).data.user.perms.dispatch, 'edit');
  // a second Admin cannot remove the only other Admin's role while they are the last one left... and every role can be chosen
  const A2 = client();
  const a2 = ok(await A.post('/api/users', { name: 'Second Admin', email: 'a2@x.in', password: pw, role: 'admin' })).id;
  await A2.login('a2@x.in');
  ok(await A2.patch(`/api/users/${me.id}`, { role: 'viewer' }), 200);
  assert.equal((await A.get('/api/me')).status, 401); // signed out by the change
  const last = await A2.patch(`/api/users/${a2}`, { active: false });
  assert.equal(last.status, 400);
  ok(await A2.patch(`/api/users/${me.id}`, { role: 'admin' }), 200);
  await A.login('a@x.in');
  ok(await A.patch(`/api/users/${a2}`, { active: false }), 200);
});

test('customers: sort, and "not bought since"', async () => {
  const byName = (await A.get('/api/customers?sort=name')).data.rows.map(c => c.name.toLowerCase());
  assert.deepEqual(byName, [...byName].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  const spent = (await A.get('/api/customers?sort=spent')).data.rows.map(c => c.total_purchase_amount);
  assert.deepEqual(spent, [...spent].sort((a, b) => b - a));
  assert.equal((await A.get('/api/customers?sort=shoe-size')).status, 400);
  const old = (await A.get('/api/customers?not_since=6')).data.rows;
  assert.ok(old.every(c => c.last_purchase_date && c.last_purchase_date < '2026-05-16'));
  assert.equal((await A.get('/api/customers?not_since=5')).status, 400);
});

test('follow-up lists: saved from the filters; statuses from messages, calls, feedback and orders; the public feedback page', async () => {
  for (const [phone, name] of [['9700000001', 'Follow One'], ['9700000002', 'Follow Two']]) ok(await T.post('/api/calls', { phone, customer_name: name, status: 'Busy' }));
  const filters = { q: '97000000', kind: 'all' };
  assert.equal((await D.post('/api/followups', { name: 'X', filters })).status, 403);
  assert.equal((await T.post('/api/followups', { name: 'Nobody', filters: { q: 'no-such-person-zz' } })).status, 400);
  const made = ok(await T.post('/api/followups', { name: 'Leads to call again', note: 'Offer the NM set', filters }));
  assert.equal(made.total, 2);
  // pretend the list was made a day ago, so an order today counts as "ordered again"
  await db.run(`UPDATE follow_up_lists SET created_at = '2026-11-15T00:00:00.000Z' WHERE id = ?`, [made.id]);
  let l = ok(await T.get(`/api/followups/${made.id}`), 200);
  assert.equal(l.members.length, 2); assert.ok(l.members.every(m => m.status === 'Not contacted yet'));
  const [one, two] = ['Follow One', 'Follow Two'].map(nm => l.members.find(m => m.name === nm));
  assert.equal(one.last_contact.how, 'Call: Busy');
  // a WhatsApp feedback request, then the customer answers on the public page
  assert.equal((await T.post(`/api/customers/${one.id}/messages`, { kind: 'poem' })).status, 400);
  ok(await T.post(`/api/customers/${one.id}/messages`, { kind: 'feedback', list_id: made.id }));
  const links = ok(await T.post('/api/feedback/links', { customer_ids: [one.id] }), 200).links;
  const token = links[one.id]; assert.match(token, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(ok(await T.post('/api/feedback/links', { customer_ids: [one.id] }), 200).links[one.id], token); // reused until answered
  l = (await T.get(`/api/followups/${made.id}`)).data;
  assert.equal(l.members.find(m => m.id === one.id).status, 'Feedback requested');
  assert.match(l.members.find(m => m.id === one.id).last_contact.how, /Feedback request/);
  const pub = ok(await anon.get(`/api/public/feedback/${token}`), 200);
  assert.equal(pub.first_name, 'Follow'); assert.equal(pub.submitted, false);
  assert.ok(!JSON.stringify(pub).includes('9700000001'));
  assert.equal((await anon.get('/api/public/feedback/not-a-real-token-at-all')).status, 404);
  assert.equal((await anon.post(`/api/public/feedback/${token}`, { liked: ['Pictures'] })).status, 400); // no stars
  const r = await fetch(`${base}/api/public/feedback/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stars":5}' });
  assert.equal(r.status, 403); // no cross-site posts
  const ans = ok(await anon.post(`/api/public/feedback/${token}`, { stars: 5, liked: ['Pictures', '<script>'], reasons: ['As a gift'], comment: 'Lovely' }), 200);
  assert.equal(ans.submitted, true); assert.deepEqual(ans.liked, ['Pictures']); assert.equal(ans.can_change, true);
  l = (await T.get(`/api/followups/${made.id}`)).data;
  assert.equal(l.members.find(m => m.id === one.id).status, 'Feedback received');
  assert.equal(l.members.find(m => m.id === one.id).stars, 5);
  const fb = (await M.get('/api/feedback')).data;
  assert.ok(fb.answered >= 1 && fb.rows.some(x => x.customer_id === one.id && x.comment === 'Lovely'));
  assert.equal((await T.get(`/api/customers/${one.id}`)).data.feedback[0].stars, 5);
  // a missed call is "No answer"; an order after the list was made is "Ordered again", found by the app
  ok(await T.post('/api/calls', { phone: '9700000002', status: 'Not Answered' }));
  assert.equal((await T.get(`/api/followups/${made.id}`)).data.members.find(m => m.id === two.id).status, 'No answer');
  const sale = ok(await T.post('/api/sales', { customer_name: 'Follow Two', customer_phone: '9700000002', address: 'House 12, Main Road', state: 'Kerala', location: 'Kannur', pin: '670001', items: [{ book_id: maam.id, qty: 1 }] }));
  l = (await T.get(`/api/followups/${made.id}`)).data;
  const t2 = l.members.find(m => m.id === two.id);
  assert.equal(t2.status, 'Ordered again'); assert.equal(t2.sale_no, sale.sale_no); assert.equal(t2.status_by_name, null);
  assert.equal(l.counts['Ordered again'], 1);
  // the team sets a status by hand; a closed list cannot be changed
  assert.equal((await T.patch(`/api/followups/${made.id}/members/${one.id}`, { status: 'Done-ish' })).status, 400);
  ok(await T.patch(`/api/followups/${made.id}/members/${one.id}`, { status: 'Review requested' }), 200);
  ok(await T.post(`/api/followups/${made.id}/close`), 200);
  assert.equal((await T.patch(`/api/followups/${made.id}/members/${one.id}`, { status: 'Contacted' })).status, 409);
  ok(await T.post(`/api/followups/${made.id}/reopen`), 200);
  const all = (await M.get('/api/followups')).data.lists.find(x => x.id === made.id);
  assert.equal(all.total, 2); assert.equal(all.counts['Ordered again'], 1);
  assert.equal((await D.get('/api/followups')).status, 403);
});

test('customer messages: the Admin sets the wording; everyone signed in reads it', async () => {
  const st = (await T.get('/api/settings/lists')).data;
  assert.match(st.messages.templates.feedback, /\{link\}/); assert.equal(st.messages.website_url, 'https://www.nallamalayalam.in');
  assert.ok(st.message_kinds.some(k => k[0] === 'academy'));
  const body = { ...st.messages, review_url: 'https://www.nallamalayalam.in/reviews', coupon: 'THANKYOU10' };
  assert.equal((await M.send('PUT', '/api/settings/messages', body)).status, 403);
  assert.equal((await A.send('PUT', '/api/settings/messages', { ...body, templates: { ...body.templates, feedback: 'No link here' } })).status, 400);
  assert.equal((await A.send('PUT', '/api/settings/messages', { ...body, review_url: 'http://insecure.example' })).status, 400);
  const saved = ok(await A.send('PUT', '/api/settings/messages', body), 200);
  assert.equal(saved.coupon, 'THANKYOU10');
  const tok = (await db.get('SELECT token FROM feedback ORDER BY id LIMIT 1')).token;
  assert.equal((await anon.get(`/api/public/feedback/${tok}`)).data.review_url, 'https://www.nallamalayalam.in/reviews');
});

test('labels and bills: label details in Settings, gift pack, courier and tracking number, order messages', async () => {
  const st = (await T.get('/api/settings/lists')).data;
  assert.equal(st.shipping.booking_office, 'Kodakara SO 680684'); assert.deepEqual(st.shipping.couriers.map(c => c.name), ['India Post (Speed Post)', 'DTDC']);
  assert.ok(st.order_kinds.some(k => k[0] === 'dispatched')); assert.match(st.messages.templates.order, /\{payment\}/);
  assert.equal((await M.send('PUT', '/api/settings/shipping', st.shipping)).status, 403);
  assert.equal((await A.send('PUT', '/api/settings/shipping', { ...st.shipping, couriers: 'DTDC | http://dtdc.in' })).status, 400);
  ok(await A.send('PUT', '/api/settings/shipping', { ...st.shipping, couriers: 'India Post (Speed Post) | https://www.indiapost.gov.in\nDTDC | https://www.dtdc.in' }), 200);
  // a tele-sales order with a gift pack
  const s = ok(await T.post('/api/sales', { customer_name: 'Gift Buyer', customer_phone: '9700000011', address: 'House 4, Market Road', state: 'Kerala', location: 'Thrissur', pin: '680684', gift_pack: true, payment_method: 'COD', amount_received: 0, items: [{ book_id: maam.id, qty: 1 }] }));
  assert.equal(s.gift_pack, 1); assert.equal(s.customer_pin, '680684'); assert.equal(s.customer_district, 'Thrissur');
  // dispatch adds the courier and tracking number before printing; sales people cannot
  assert.equal((await T.patch(`/api/sales/${s.id}/shipping`, { courier: 'DTDC', tracking_no: 'D1' })).status, 403);
  assert.equal((await D.patch(`/api/sales/${s.id}/shipping`, { courier: 'Blue Dart', tracking_no: 'D1' })).status, 400);
  assert.equal((await D.patch(`/api/sales/${s.id}/shipping`, { courier: 'DTDC', tracking_no: 'D1 <x>' })).status, 400);
  const sh = ok(await D.patch(`/api/sales/${s.id}/shipping`, { courier: 'DTDC', tracking_no: 'd59213847' }), 200);
  assert.equal(sh.tracking_no, 'D59213847'); assert.equal(sh.courier, 'DTDC'); assert.equal(sh.gift_pack, 1);
  // marking Dispatched can change them
  const disp = ok(await D.post(`/api/sales/${s.id}/status`, { status: 'Dispatched', courier: 'India Post (Speed Post)', tracking_no: 'EL900217276IN' }), 200);
  assert.equal(disp.status, 'Dispatched'); assert.equal(disp.courier, 'India Post (Speed Post)'); assert.equal(disp.tracking_no, 'EL900217276IN');
  // order messages are noted on the customer but move nobody in a follow-up list
  ok(await T.post(`/api/customers/${s.customer_id}/messages`, { kind: 'order', sale_id: s.id }));
  assert.equal((await T.post(`/api/customers/${s.customer_id}/messages`, { kind: 'dispatched', sale_id: maam.id + 999999 })).status, 400);
  const c = (await T.get(`/api/customers/${s.customer_id}`)).data;
  assert.equal(c.messages[0].kind, 'order');
});

test('next book: customers with the first book but not the next, after the waiting time; a list made for the step', async () => {
  const b1 = ok(await A.post('/api/books', { sku: 'NB-1', name: 'Next Book One', mrp: 100, price: 100, opening_stock: 20 }));
  const b2 = ok(await A.post('/api/books', { sku: 'NB-2', name: 'Next Book Two', mrp: 100, price: 100, opening_stock: 20 }));
  assert.equal((await A.send('PUT', '/api/settings/next-book', { months: 5, steps: [['NB-1', 'NB-2']] })).status, 400);
  assert.equal((await A.send('PUT', '/api/settings/next-book', { months: 1, steps: [['NB-1', 'NO-SUCH']] })).status, 400);
  assert.equal((await M.send('PUT', '/api/settings/next-book', { months: 1, steps: [['NB-1', 'NB-2']] })).status, 403);
  ok(await A.send('PUT', '/api/settings/next-book', { months: 1, steps: [['NB-1', 'NB-2']] }), 200);
  const buy = (phone, name, book, date) => T.post('/api/sales', { customer_name: name, customer_phone: phone, address: 'House 9, Hill Road', state: 'Kerala', location: 'Kollam', pin: '691001', sale_date: date, items: [{ book_id: book, qty: 1 }] });
  ok(await buy('9700000021', 'Ready Reader', b1.id, '2026-09-01'));       // ready: NB-1 two months ago
  ok(await buy('9700000022', 'Recent Reader', b1.id, '2026-11-10'));      // not yet: bought last week
  ok(await buy('9700000023', 'Done Reader', b1.id, '2026-08-01')); ok(await buy('9700000023', 'Done Reader', b2.id, '2026-08-05')); // has both
  const key = 'NB-1>NB-2';
  const names = (await T.get('/api/customers?ready_for=' + encodeURIComponent(key))).data.rows.map(r => r.name);
  assert.deepEqual(names, ['Ready Reader']);
  assert.equal((await T.get('/api/customers?ready_for=NB-9>NB-2')).status, 400);
  let nb = ok(await T.get('/api/customers/next-book'), 200);
  assert.equal(nb.months, 1); assert.equal(nb.steps[0].ready, 1); assert.equal(nb.steps[0].to.name, 'Next Book Two');
  const list = ok(await T.post('/api/followups', { name: 'Ready for NB-2', filters: { ready_for: key } }));
  assert.equal(list.total, 1);
  nb = (await T.get('/api/customers/next-book')).data;
  assert.equal(nb.steps[0].ready, 0); // already in an open list for this step
  ok(await T.post(`/api/followups/${list.id}/close`), 200);
  assert.equal((await T.get('/api/customers/next-book')).data.steps[0].ready, 1);
  assert.equal((await D.get('/api/customers/next-book')).status, 403);
});
