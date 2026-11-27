'use strict';
// API acceptance tests, part 2: roles & access and the features added since (customers, follow-up lists, messages,
// labels, next book, insights, Book Master links, Prices & links, delivery check). Run: npm test or npm run test:features.
// Its own database: the users and a book are set up here, as part 1 does in its first tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pw, client, ok, startApp } = require('./helpers');

let db, base, stop;
const A = client(), M = client(), T = client(), O = client(), S = client(), D = client(), anon = client();
const ids = {};
let maam; // a book with stock

test.before(async () => {
  ({ db, base, stop } = await startApp());
  await A.login('a@x.in');
  for (const [role, email, c] of [['manager', 'm@x.in', M], ['telesales', 't@x.in', T], ['online', 'o@x.in', O], ['onsite', 's@x.in', S], ['dispatch', 'd@x.in', D]]) {
    ids[role] = ok(await A.post('/api/users', { name: role + ' user', email, password: pw, role })).id;
    await c.login(email);
  }
  maam = ok(await A.post('/api/books', { sku: 'NM-001', name: 'Maambazham', category: 'Series 1', price: 250, opening_stock: 100, min_stock: 20 }));
  // one customer, from a tele-sales order
  ok(await T.post('/api/sales', { customer_name: 'First Customer', customer_phone: '9800000001', address: 'House 1, Main Road', state: 'Kerala', location: 'Thrissur', pin: '680001', items: [{ book_id: maam.id, qty: 1 }] }));
});
test.after(() => stop());

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
  assert.deepEqual(me, { dashboard: 'view', sales: 'edit', dispatch: 'edit', delivery: 'edit', customers: 'edit', webimport: 'edit', calls: 'edit', visits: 'edit', books: 'view', stock: 'view', profit: 'view', reports: 'view', insights: 'view', prices: 'view' });
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

test('insights: where, when and how customers buy; who can see it', async () => {
  const V = client(); await V.login('v@x.in').catch(() => null);
  const d = ok(await T.get('/api/insights?range=all'), 200);
  assert.equal(d.months.length, 12); assert.equal(d.weekdays.length, 7); assert.equal(d.come_back.buckets.length, 7);
  assert.ok(d.orders > 0 && d.customers > 0);
  const kannur = d.where.find(w => w.place === 'Kannur');
  assert.ok(kannur && kannur.district && kannur.customers >= 1 && kannur.orders >= kannur.customers);
  assert.ok(d.where.every(w => w.repeat_pct >= 0 && w.repeat_pct <= 100 && w.cod_pct >= 0 && w.cod_pct <= 100));
  assert.equal(d.districts.length, 14);
  // too few calls: no grid, no "best time"
  assert.equal(d.calls.enough, false); assert.equal(d.calls.grid, null); assert.equal(d.calls.best, null); assert.equal(d.calls.needed, 200);
  assert.ok(d.how.some(h => /Paid by/.test(h.label)));
  // the filters
  const tele = ok(await M.get('/api/insights?range=all&channel=Tele-sales'), 200);
  assert.ok(tele.orders <= d.orders);
  const one = ok(await M.get(`/api/insights?range=all&book_id=${maam.id}`), 200);
  assert.ok(one.orders <= d.orders);
  assert.equal((await M.get('/api/insights?range=5y')).status, 400);
  // who: Manager, Tele-sales and Report Viewer; not Dispatch, Online or Onsite
  for (const c of [D, O, S]) assert.equal((await c.get('/api/insights')).status, 403);
  assert.equal((await T.get('/api/me')).data.user.perms.insights, 'view');
});

test('Book Master: Malayalam title, author and links; Prices & links: coupons with validity and links to share', async () => {
  assert.equal((await A.post('/api/books', { sku: 'ML-1', name: 'Malayalam Title Book', name_ml: 'മലയാളം പുസ്തകം', author: 'Test Author', mrp: 100, price: 100, website_url: 'http://insecure.example' })).status, 400);
  const b = ok(await A.post('/api/books', { sku: 'ML-1', name: 'Malayalam Title Book', name_ml: 'മലയാളം പുസ്തകം', author: 'Test Author', mrp: 100, price: 100, website_url: 'https://www.nallamalayalam.in/books/ml-1' }));
  assert.equal(b.name_ml, 'മലയാളം പുസ്തകം'); assert.equal(b.author, 'Test Author'); assert.equal(b.amazon_url, null);
  assert.ok((await T.get('/api/books?q=' + encodeURIComponent('മലയാളം'))).data.some(x => x.id === b.id));
  assert.ok((await T.get('/api/books?q=test%20author')).data.some(x => x.id === b.id));
  const e = ok(await A.patch(`/api/books/${b.id}`, { amazon_url: 'https://www.amazon.in/dp/X1' }), 200);
  assert.equal(e.amazon_url, 'https://www.amazon.in/dp/X1'); assert.equal(e.name_ml, 'മലയാളം പുസ്തകം'); // untouched fields stay
  // coupons: the Admin keeps the list
  assert.equal((await M.post('/api/coupons', { code: 'X1', offer: 'x' })).status, 403);
  assert.equal((await A.post('/api/coupons', { code: 'BAD CODE', offer: '10% off' })).status, 400);
  assert.equal((await A.post('/api/coupons', { code: 'DATES', offer: '10% off', valid_from: '2026-12-10', valid_to: '2026-12-01' })).status, 400);
  const run = ok(await A.post('/api/coupons', { code: 'thankyou10', offer: '10% off your next order', conditions: 'after a website review', valid_to: '2026-12-31' }));
  assert.equal(run.code, 'THANKYOU10'); assert.equal(run.state, 'Running');
  assert.equal((await A.post('/api/coupons', { code: 'ThankYou10', offer: 'again' })).status, 409);
  ok(await A.post('/api/coupons', { code: 'ONAM100', offer: '₹100 off any bundle', valid_from: '2027-08-01', valid_to: '2027-09-15', works_on: 'Everywhere' }));
  ok(await A.post('/api/coupons', { code: 'OLD5', offer: '5% off', valid_to: '2026-01-31' }));
  let t = ok(await T.get('/api/pricelist'), 200);
  assert.deepEqual(t.coupons.map(c => [c.code, c.state]).sort(), [['ONAM100', 'Upcoming'], ['THANKYOU10', 'Running']]); // ended ones are not offered
  assert.equal((await A.get('/api/pricelist')).data.coupons.length, 3); // the Admin sees all
  ok(await A.patch(`/api/coupons/${run.id}`, { active: false }), 200);
  t = (await T.get('/api/pricelist')).data;
  assert.ok(!t.coupons.some(c => c.code === 'THANKYOU10'));
  // links
  assert.equal(t.links.find(l => l.key === 'website').url, 'https://www.nallamalayalam.in');
  assert.equal((await M.send('PUT', '/api/settings/links', { website: 'https://x.in' })).status, 403);
  assert.equal((await A.send('PUT', '/api/settings/links', { youtube: 'youtube.com/x' })).status, 400);
  ok(await A.send('PUT', '/api/settings/links', { website: 'https://www.nallamalayalam.in', youtube: 'https://www.youtube.com/@nallamalayalam', instagram: 'https://www.instagram.com/nallamalayalam/' }), 200);
  assert.equal((await O.get('/api/pricelist')).data.links.find(l => l.key === 'youtube').url, 'https://www.youtube.com/@nallamalayalam');
  // who: the sales teams and Report Viewer; not Dispatch
  assert.equal((await D.get('/api/pricelist')).status, 403);
  assert.equal((await S.get('/api/pricelist')).status, 200);
});

test('delivery check: our own parcels a few days after dispatch; results, retries, needs action, settings and access', async () => {
  ok(await A.post('/api/inventory/movements', { book_id: maam.id, type: 'Stock received', qty: 10, note: 'delivery check' }));
  const order = async (name, phone) => {
    const s = ok(await T.post('/api/sales', { customer_name: name, customer_phone: phone, address: 'House 9, Temple Road', state: 'Kerala', location: 'Thrissur', pin: '680001', payment_method: 'UPI', amount_received: 0, items: [{ book_id: maam.id, qty: 1 }] }));
    ok(await D.post(`/api/sales/${s.id}/status`, { status: 'Dispatched', courier: 'DTDC', tracking_no: 'D7000' + s.id }), 200);
    return s;
  };
  const sent = (id, day) => db.run(`UPDATE stock_movements SET at = ? WHERE sale_id = ? AND type = 'Stock dispatched'`, [day + 'T06:00:00.000Z', id]);
  const called = (id, day) => db.run('UPDATE delivery_checks SET checked_at = ? WHERE sale_id = ?', [day + 'T06:00:00.000Z', id]);
  const a = await order('Happy Parent', '9700000101'), b = await order('Quiet Parent', '9700000102'), c = await order('Waiting Parent', '9700000103');
  const d = await order('Recent Parent', '9700000104'), amz = await order('Amazon Buyer', '9700000105');
  for (const s of [a, b, c, amz]) await sent(s.id, '2026-11-10'); // today is 16 Nov: 6 days ago
  await sent(d.id, '2026-11-14');
  await db.run(`UPDATE sales SET platform = 'Amazon' WHERE id = ?`, [amz.id]);
  let r = ok(await D.get('/api/delivery-checks'), 200);
  const ids = x => x.map(o => o.id);
  assert.equal(r.days, 4);
  assert.ok([a, b, c].every(s => ids(r.call).includes(s.id)));
  assert.ok(!ids(r.call).includes(d.id) && !ids(r.call).includes(amz.id)); // too recent; Amazon delivers its own
  const row = r.call.find(o => o.id === a.id); assert.equal(row.sent_day, '2026-11-10'); assert.equal(row.days_since, 6); assert.equal(row.courier, 'DTDC');
  // who: Dispatch, Manager and Admin record; Report Viewer reads; Tele-sales none
  assert.equal((await T.get('/api/delivery-checks')).status, 403);
  ok(await A.post('/api/users', { name: 'Dev Viewer', email: 'dv@x.in', password: pw, role: 'viewer' }));
  const V = client(); await V.login('dv@x.in');
  ok(await V.get('/api/delivery-checks'), 200);
  assert.equal((await V.post('/api/delivery-checks', { sale_id: a.id, result: 'happy' })).status, 403);
  // a note is needed for not happy, not delivered and returned
  assert.equal((await D.post('/api/delivery-checks', { sale_id: a.id, result: 'not_happy' })).status, 400);
  assert.equal((await D.post('/api/delivery-checks', { sale_id: a.id, result: 'lost' })).status, 400);
  assert.equal((await D.post('/api/delivery-checks', { sale_id: amz.id, result: 'happy' })).status, 422);
  // delivered and happy: the order is Delivered and leaves the list
  ok(await D.post('/api/delivery-checks', { sale_id: a.id, result: 'happy' }));
  assert.equal((await A.get(`/api/sales/${a.id}`)).data.status, 'Delivered');
  assert.equal((await A.get(`/api/sales/${a.id}`)).data.delivery_checks[0].result, 'happy');
  // no answer: back the next day; after three, Couldn't reach
  ok(await D.post('/api/delivery-checks', { sale_id: b.id, result: 'no_answer' }));
  await called(b.id, '2026-11-16');
  r = (await D.get('/api/delivery-checks')).data;
  assert.ok(!ids(r.call).includes(a.id) && !ids(r.call).includes(b.id));
  await called(b.id, '2026-11-15');
  r = (await D.get('/api/delivery-checks')).data;
  assert.equal(r.call.find(o => o.id === b.id).tries, 1); assert.equal(r.counts.second, 1);
  ok(await D.post('/api/delivery-checks', { sale_id: b.id, result: 'no_answer' }));
  ok(await D.post('/api/delivery-checks', { sale_id: b.id, result: 'no_answer' }));
  r = (await D.get('/api/delivery-checks')).data;
  assert.ok(ids(r.unreachable).includes(b.id) && !ids(r.call).includes(b.id));
  // not delivered: Needs action, and back on the list 2 days later; a later "happy" sorts it
  ok(await D.post('/api/delivery-checks', { sale_id: c.id, result: 'not_delivered', note: 'India Post says out for delivery' }));
  r = (await D.get('/api/delivery-checks')).data;
  assert.ok(r.action.some(k => k.sale_id === c.id) && !ids(r.call).includes(c.id));
  await called(c.id, '2026-11-14');
  r = (await D.get('/api/delivery-checks')).data;
  assert.ok(ids(r.call).includes(c.id));
  ok(await M.post('/api/delivery-checks', { sale_id: c.id, result: 'not_happy', note: 'Cover torn' }));
  r = (await D.get('/api/delivery-checks')).data;
  assert.ok(!r.action.some(k => k.sale_id === c.id && k.result === 'not_delivered'));
  const torn = r.action.find(k => k.sale_id === c.id && k.result === 'not_happy'); assert.ok(torn);
  assert.equal((await D.post(`/api/delivery-checks/${torn.id}/sorted`, {})).status, 400);
  ok(await D.post(`/api/delivery-checks/${torn.id}/sorted`, { note: 'Sent a new copy' }), 200);
  r = (await D.get('/api/delivery-checks')).data;
  assert.equal(r.action.filter(k => k.sale_id === c.id).length, 0);
  assert.ok(r.checked.length >= 6); assert.ok(r.counts.checked >= 2 && r.counts.happy >= 1);
  // the customer page shows the calls
  const cust = (await A.get(`/api/customers/${(await A.get(`/api/sales/${c.id}`)).data.customer_id}`)).data;
  assert.ok(cust.delivery_checks.some(k => k.result === 'not_happy'));
  // Settings: days after dispatch (Admin only)
  assert.equal((await M.send('PUT', '/api/settings/delivery-check', { days: 7 })).status, 403);
  assert.equal((await A.send('PUT', '/api/settings/delivery-check', { days: 9 })).status, 400);
  ok(await A.send('PUT', '/api/settings/delivery-check', { days: 2 }), 200);
  assert.ok(ids((await D.get('/api/delivery-checks')).data.call).includes(d.id));
  ok(await A.send('PUT', '/api/settings/delivery-check', { days: 4 }), 200);
  assert.equal((await D.get('/api/settings/lists')).data.delivery_check.days, 4);
});

test('own only (Tele-sales): their own orders and customers; a full number finds others; Admin can switch to the whole channel; old order-sheet names', async () => {
  ok(await A.post('/api/users', { name: 'Tara Tele', email: 't2@x.in', password: pw, role: 'telesales' }));
  const T2 = client(); await T2.login('t2@x.in');
  assert.deepEqual((await T.get('/api/me')).data.user.own, { sales: true, customers: true });
  assert.deepEqual((await M.get('/api/me')).data.user.own, {});
  const sell = (c, name, phone) => c.post('/api/sales', { customer_name: name, customer_phone: phone, address: 'House 3, Lake Road', state: 'Kerala', location: 'Kollam', pin: '691001', items: [{ book_id: maam.id, qty: 1 }] });
  const mine = ok(await sell(T, 'Mine Customer', '9811111102'));
  const theirs = ok(await sell(T2, 'Their Customer', '9811111101'));
  // sales: only the orders they made
  const tSales = (await T.get('/api/sales')).data.rows.map(s => s.id);
  assert.ok(tSales.includes(mine.id) && !tSales.includes(theirs.id));
  assert.equal((await T.get(`/api/sales/${theirs.id}`)).status, 403);
  assert.equal((await T.post(`/api/sales/${theirs.id}/payments`, { amount: 10, method: 'UPI' })).status, 403);
  assert.ok((await M.get('/api/sales')).data.rows.some(s => s.id === theirs.id)); // the Manager sees everyone's
  // customers: only their own; a full number finds someone else's, with the basics only
  const names = async (c, q = '') => (await c.get('/api/customers?kind=all' + q)).data.rows.map(r => r.name);
  assert.ok((await names(T)).includes('Mine Customer')); assert.ok(!(await names(T)).includes('Their Customer'));
  assert.equal((await T.get(`/api/customers/${theirs.customer_id}`)).status, 403);
  assert.equal((await T.patch(`/api/customers/${theirs.customer_id}`, { contact_person: 'X' })).status, 403);
  let r = (await T.get('/api/customers?q=9811111101')).data;
  assert.equal(r.own, true); assert.equal(r.rows.length, 0);
  assert.deepEqual(r.found.map(f => [f.name, f.last_with]), [['Their Customer', 'Tara Tele']]);
  assert.equal(r.found[0].address, undefined); // the basics only
  assert.equal((await T.get('/api/customers?q=98111111')).data.found.length, 0); // not a full number
  // a call makes them theirs too
  ok(await T.post('/api/calls', { phone: '9811111101', status: 'Answered', outcome: 'Interested' }));
  assert.ok((await names(T)).includes('Their Customer'));
  ok(await T.get(`/api/customers/${theirs.customer_id}`), 200);
  // follow-up lists: their own
  const list = ok(await T2.post('/api/followups', { name: 'Tara list', filters: { q: '9811111101' } }));
  assert.ok(!(await T.get('/api/followups')).data.lists.some(l => l.id === list.id));
  assert.equal((await T.get(`/api/followups/${list.id}`)).status, 403);
  assert.equal((await T.post(`/api/followups/${list.id}/close`)).status, 403);
  // Admin: Whole channel for customers; only Tele-sales Sales and Customers can be set
  const acc = (await A.get('/api/access')).data;
  assert.deepEqual(acc.scopes, { telesales: { sales: 'own', customers: 'own' } });
  assert.equal((await A.send('PUT', '/api/access', { grid: acc.grid, scopes: { online: { sales: 'own' } } })).status, 400);
  assert.equal((await A.send('PUT', '/api/access', { grid: acc.grid, scopes: { telesales: { sales: 'mine' } } })).status, 400);
  assert.equal((await M.send('PUT', '/api/access', { grid: acc.grid, scopes: { telesales: { customers: 'all' } } })).status, 403);
  ok(await A.send('PUT', '/api/access', { grid: acc.grid, scopes: { telesales: { sales: 'own', customers: 'all' } }, reason: 'Team shares customers' }), 200);
  const log = await db.get(`SELECT after_json FROM audit_events WHERE entity = 'settings' AND action = 'role_access' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual(JSON.parse(log.after_json), { 'Tele-sales · Customers (whose)': 'all' });
  await new Promise(res => setTimeout(res, 50));
  assert.deepEqual((await T.get('/api/me')).data.user.own, { sales: true, customers: false });
  r = (await T.get('/api/customers?q=9811111101')).data; assert.equal(r.own, false); assert.equal(r.rows.length, 1);
  assert.ok(!(await T.get('/api/sales')).data.rows.some(s => s.id === theirs.id)); // sales still own only
  ok(await A.send('PUT', '/api/access', { grid: acc.grid, scopes: { telesales: { sales: 'own', customers: 'own' } } }), 200);
  // old order-sheet names: link one to a login; its orders and calls become theirs
  const old = await db.get(`INSERT INTO users (name, email, password_hash, role, active) VALUES ('Megha', 'megha@imported.invalid', 'x', 'telesales', 0) RETURNING id`);
  await db.run('UPDATE sales SET salesperson_id = ? WHERE id = ?', [old.id, theirs.id]);
  const olds = ok(await A.get('/api/users/old-names'), 200);
  assert.deepEqual(olds.map(o => [o.name, o.orders]), [['Megha', 1]]);
  assert.equal((await M.get('/api/users/old-names')).status, 403);
  const tid = (await A.get('/api/users')).data.find(u => u.email === 't@x.in').id;
  assert.equal((await A.post(`/api/users/${old.id}/link-old-name`, { old_id: old.id })).status, 400); // not a real login
  assert.equal((await A.post(`/api/users/${tid}/link-old-name`, { old_id: 999999 })).status, 400);
  const link = ok(await A.post(`/api/users/${tid}/link-old-name`, { old_id: old.id }), 200);
  assert.equal(link.orders, 1);
  ok(await T.get(`/api/sales/${theirs.id}`), 200);
  assert.equal((await A.get('/api/users/old-names')).data.length, 0);
  assert.equal((await A.get('/api/users')).data.find(u => u.id === tid).old_names, 'Megha');
});

test('follow-up lists: Admin or Manager assigns a list to several people; they work it but cannot close it', async () => {
  const T2 = client(); await T2.login('t2@x.in');
  const sale = ok(await T2.post('/api/sales', { customer_name: 'Assigned Customer', customer_phone: '9811111201', address: 'House 5, River Road', state: 'Kerala', location: 'Wayanad', pin: '673121', items: [{ book_id: maam.id, qty: 1 }] }));
  const list = ok(await M.post('/api/followups', { name: 'Wayanad call list', filters: { q: '9811111201' } }));
  assert.ok(!(await T.get('/api/followups')).data.lists.some(l => l.id === list.id));
  assert.equal((await T.get(`/api/followups/${list.id}`)).status, 403);
  // who can assign, and to whom
  assert.equal((await T.get('/api/followups/people')).status, 403);
  assert.equal((await T.send('PUT', `/api/followups/${list.id}/assignees`, { user_ids: [] })).status, 403);
  const people = ok(await M.get('/api/followups/people'), 200);
  const users = (await A.get('/api/users')).data; const idOf = e => users.find(u => u.email === e).id;
  assert.ok(people.some(p => p.id === idOf('t@x.in')) && people.some(p => p.id === idOf('m@x.in')) && !people.some(p => p.id === idOf('d@x.in')));
  assert.equal((await M.send('PUT', `/api/followups/${list.id}/assignees`, { user_ids: [idOf('d@x.in')] })).status, 400);
  const as = ok(await M.send('PUT', `/api/followups/${list.id}/assignees`, { user_ids: [idOf('t@x.in'), idOf('s@x.in')] }), 200);
  assert.deepEqual(as.assignees.map(a => a.name).sort(), ['onsite user', 'telesales user']);
  const log = await db.get(`SELECT after_json FROM audit_events WHERE entity = 'followup_list' AND entity_id = ? AND action = 'assigned' ORDER BY id DESC LIMIT 1`, [list.id]);
  assert.deepEqual(JSON.parse(log.after_json).assigned_to, ['onsite user', 'telesales user']);
  // the assigned Tele-sales person (Own only): the list is theirs to work, its customers are not added to their Customers
  const mine = (await T.get('/api/followups')).data.lists.find(l => l.id === list.id);
  assert.ok(mine.assigned_to_me); assert.equal(mine.assigned_by_name, 'manager user'); assert.equal(mine.can_manage, false);
  const d = ok(await T.get(`/api/followups/${list.id}`), 200);
  assert.equal(d.members[0].yours, false); assert.equal(d.can_assign, false); assert.equal(d.can_manage, false);
  ok(await T.patch(`/api/followups/${list.id}/members/${sale.customer_id}`, { status: 'No answer' }), 200);
  ok(await T.post(`/api/customers/${sale.customer_id}/messages`, { kind: 'feedback', list_id: list.id }));
  assert.equal((await T.post(`/api/customers/${sale.customer_id}/messages`, { kind: 'feedback' })).status, 403);
  assert.ok(!(await T.get('/api/customers?kind=all')).data.rows.some(c => c.id === sale.customer_id));
  assert.equal((await T.post(`/api/followups/${list.id}/close`)).status, 403);
  // the Manager closes and reopens it; the Admin can change who works it
  ok(await M.post(`/api/followups/${list.id}/close`), 200); ok(await M.post(`/api/followups/${list.id}/reopen`), 200);
  ok(await A.send('PUT', `/api/followups/${list.id}/assignees`, { user_ids: [] }), 200);
  assert.equal((await T.get(`/api/followups/${list.id}`)).status, 403);
  assert.deepEqual((await M.get('/api/followups')).data.lists.find(l => l.id === list.id).assignees, []);
});
