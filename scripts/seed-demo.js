'use strict';
// Creates a SAMPLE database for trying the app. Never point this at the real database.
// Usage: node scripts/seed-demo.js [directory]   (default ./data/demo-pg; a separate local database)
//    or: DEMO_DATABASE_URL=postgres://... node scripts/seed-demo.js   (an EMPTY database you created for demos)
// Every customer, school and shop below is fictional. Book titles are placeholders.
const path = require('path');
const fs = require('fs');
const pg = require('pg');
const { createDb } = require('../src/db');
const { applyMigrations } = require('../src/migrate');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { today, addMinutes } = require('../src/util');

const dir = path.resolve(process.argv[2] || './data/demo-pg');
const PW = 'demo-password';

(async () => {
  let devDb = null;
  let cs = process.env.DEMO_DATABASE_URL;
  if (!cs) {
    fs.rmSync(dir, { recursive: true, force: true });
    const { NetlifyDB } = await import('@netlify/database-dev');
    devDb = new NetlifyDB({ directory: dir, logger: () => {} });
    cs = await devDb.start();
  }
  const pool = new pg.Pool({ connectionString: cs, max: 1 });
  await applyMigrations(pool);
  const db = createDb(pool);
  if ((await db.get('SELECT COUNT(*) n FROM users')).n) { console.error('Refusing to seed: this database already has users.'); process.exit(1); }
  const h = hashPassword(PW);
  const USERS = [['Demo Admin', 'admin', 'admin'], ['Demo Manager', 'manager', 'manager'], ['Demo Tele-sales', 'tele', 'telesales'],
    ['Demo Online', 'online', 'online'], ['Demo Onsite', 'onsite', 'onsite'], ['Demo Dispatch', 'dispatch', 'dispatch'], ['Demo Report Viewer', 'viewer', 'viewer']];
  for (const [name, who, role] of USERS) await db.run('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)', [name, `${who}@demo.local`, h, role]);

  const server = createApp(db).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  async function call(who, method, url, body) {
    if (!(who in jar)) { jar[who] = ''; await call(who, 'POST', '/api/login', { email: `${who}@demo.local`, password: PW }); }
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nm-app', Cookie: jar[who] }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    const d = await r.json();
    if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(d)}`);
    return d;
  }
  const day = n => addMinutes(`${today()}T00:00`, n * 1440).slice(0, 10);

  const B = {};
  for (const [sku, name, category, price, opening, min] of [
    ['NM-001', 'Maambazham', 'Series 1', 250, 180, 30], ['NM-002', 'Kozhunnthu', 'Series 1', 250, 120, 30],
    ['NM-003', 'Sample Book Three', 'Series 2', 300, 60, 20], ['NM-004', 'Sample Book Four', 'Series 2', 300, 14, 20],
    ['NM-005', 'Sample Activity Book', 'Activity', 150, 0, 10]]) {
    B[sku] = (await call('admin', 'POST', '/api/books', { sku, name, category, price, opening_stock: opening, min_stock: min })).id;
  }
  await call('admin', 'POST', '/api/inventory/movements', { book_id: B['NM-005'], type: 'Stock received', qty: 40, note: 'First print run' });
  await call('admin', 'POST', '/api/inventory/movements', { book_id: B['NM-003'], type: 'Damaged stock', qty: 2, note: 'Torn covers' });

  const tele = (d, name, phone, loc, items, pay = {}) => call('tele', 'POST', '/api/sales', { sale_date: day(d), customer_name: name, customer_phone: phone, address: `Sample address, ${loc}`, location: loc, items, ...pay });
  const t1 = await tele(-9, 'Demo Customer Anu', '90000 00001', 'Kochi', [{ book_id: B['NM-001'], qty: 1 }], { payment_method: 'UPI', amount_received: 250 });
  const t2 = await tele(-6, 'Demo Customer Biju', '90000 00002', 'Kozhikode', [{ book_id: B['NM-001'], qty: 2 }, { book_id: B['NM-002'], qty: 2 }], { payment_method: 'UPI', amount_received: 500, due_date: day(-1) });
  const t3 = await tele(-2, 'Demo Customer Chithra', '90000 00003', 'Thrissur', [{ book_id: B['NM-003'], qty: 1 }], { payment_method: 'COD' });
  await tele(0, 'Demo Customer Anu', '+91 90000 00001', 'Kochi', [{ book_id: B['NM-002'], qty: 1 }], { payment_method: 'Bank Transfer', amount_received: 250 });
  await tele(0, 'Demo Customer Divya', '90000 00004', 'Kollam', [{ book_id: B['NM-001'], qty: 1 }, { book_id: B['NM-005'], qty: 2 }]);
  const o1 = await call('online', 'POST', '/api/sales', { sale_date: day(-4), platform: 'Amazon', platform_order_id: 'DEMO-402-0000001', customer_name: 'Demo Amazon Buyer', items: [{ book_id: B['NM-001'], qty: 1 }], payment_method: 'Other', amount_received: 250 });
  await call('online', 'POST', '/api/sales', { sale_date: day(-1), platform: 'Website', platform_order_id: 'DEMO-WEB-1001', customer_name: 'Demo Customer Biju', customer_phone: '9000000002', address: 'Sample address, Kozhikode', items: [{ book_id: B['NM-004'], qty: 1 }], payment_method: 'UPI', amount_received: 300 });
  await call('onsite', 'POST', '/api/sales', { sale_date: day(-7), location_type: 'School', location_name: 'Demo Public School', contact_person: 'Demo Principal', customer_phone: '0480 0000001', address: 'Sample Road, Thrissur',
    items: [{ book_id: B['NM-001'], qty: 30 }, { book_id: B['NM-002'], qty: 30 }], payment_method: 'Bank Transfer', amount_received: 5000, due_date: day(10), next_visit_date: day(14) });
  await call('onsite', 'POST', '/api/sales', { sale_date: day(-3), location_type: 'Exhibition', location_name: 'Demo Book Fair', items: [{ book_id: B['NM-003'], qty: 6 }, { book_id: B['NM-005'], qty: 8 }], payment_method: 'Cash', amount_received: 3000 });
  await call('onsite', 'POST', '/api/sales', { sale_date: day(-1), location_type: 'Bookstore', location_name: 'Demo Book Stall', customer_phone: '0484 0000002', handed_over: false, items: [{ book_id: B['NM-004'], qty: 10 }], due_date: day(20) });

  await call('dispatch', 'POST', `/api/sales/${t1.id}/status`, { status: 'Delivered' });
  await call('dispatch', 'POST', `/api/sales/${o1.id}/status`, { status: 'Dispatched' });
  await call('dispatch', 'POST', `/api/sales/${t2.id}/status`, { status: 'Ready to Dispatch' });
  await call('dispatch', 'POST', `/api/sales/${t3.id}/status`, { status: 'Packing' });

  server.close(); await pool.end(); if (devDb) await devDb.stop();
  console.log(`Demo database ready${devDb ? ' in ' + dir : ''}.`);
  console.log('Sign in as admin@ / manager@ / tele@ / online@ / onsite@ / dispatch@demo.local — password: ' + PW);
  if (devDb) console.log(`Start it with:  LOCAL_DB_DIR=${path.relative(process.cwd(), dir)} npm start`);
})().catch(e => { console.error(e); process.exit(1); });
