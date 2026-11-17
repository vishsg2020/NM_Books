'use strict';
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { getLists } = require('../settings');
const { bad, notFound, conflict, str, oneOf, idParam, normPhone } = require('../util');

const TYPES = ['Individual', 'School', 'Bookstore', 'Other'];
const VIEWERS = ['admin', 'manager', 'telesales', 'online', 'onsite'];

/** Digits only, without a leading 0 or India's 91 country code, so "+91 98470 12345" matches "09847012345". */
function phoneKey(p) {
  let d = normPhone(p);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  return d;
}
function validPhone(p, name = 'Contact number') {
  const key = phoneKey(p);
  if (key.length < 7 || key.length > 15) throw bad(`${name} must have 7 to 15 digits`, { field: name });
  return key;
}

// Purchase figures always come from the actual sales, never from stored totals. Cancelled orders do not count.
const STATS = `
  (SELECT MIN(s.sale_date) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS first_purchase_date,
  (SELECT MAX(s.sale_date) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS last_purchase_date,
  (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS total_orders,
  (SELECT COALESCE(SUM(s.total_amount),0) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS total_purchase_amount,
  (SELECT COALESCE(SUM(s.total_amount - s.amount_received),0) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS outstanding_amount`;

/**
 * Finds the customer with this contact number or creates one. `t` is a transaction handle.
 * An existing customer keeps their name; an empty address or location is filled in from the sale.
 */
async function findOrCreateCustomer(t, { name, phone, address, location, type, kind = 'Customer' }) {
  const key = validPhone(phone, 'Customer contact number');
  // Two sales for a new number at the same moment must not both create the customer.
  await t.get('SELECT pg_advisory_xact_lock(hashtext(?)) AS locked', ['customer:' + key]);
  const existing = await t.get('SELECT * FROM customers WHERE phone_norm = ?', [key]);
  if (existing) {
    if ((!existing.address && address) || (!existing.location && location)) {
      await t.run('UPDATE customers SET address = COALESCE(address, ?), location = COALESCE(location, ?), updated_at = now_iso() WHERE id = ?',
        [address || null, location || null, existing.id]);
    }
    // A lead becomes a customer with their first purchase; the record (and its call history) stays the same.
    if (kind === 'Customer' && existing.kind === 'Lead') {
      await t.run(`UPDATE customers SET kind = 'Customer', name = CASE WHEN name = 'Name not known' THEN ? ELSE name END, type = COALESCE(?, type), updated_at = now_iso() WHERE id = ?`, [name, type || null, existing.id]);
    }
    return { id: existing.id, created: false };
  }
  const { n } = await t.get(`SELECT nextval('customer_number_seq') AS n`);
  const r = await t.get(`INSERT INTO customers (code, name, phone, phone_norm, address, location, type, kind) VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    ['C-' + String(n).padStart(5, '0'), name, String(phone).trim(), key, address || null, location || null, type || 'Individual', kind]);
  return { id: r.id, created: true };
}

module.exports = (app, { db }) => {
  // "Has bought X": the customer owns the book, either bought on its own or inside a set. For a set, they own
  // every book in it (so a KVS Combo buyer counts as having bought KVS1 and KVS2). Cancelled orders do not count.
  const OWNS = bookExpr => `EXISTS (SELECT 1 FROM sales s JOIN sale_items i ON i.sale_id = s.id LEFT JOIN pack_items pk ON pk.pack_id = i.book_id
      WHERE s.customer_id = c.id AND s.status <> 'Cancelled' AND COALESCE(pk.book_id, i.book_id) = ${bookExpr})`;
  const BOUGHT = param => `NOT EXISTS (SELECT 1 FROM (SELECT book_id FROM pack_items WHERE pack_id = @${param}
      UNION ALL SELECT @${param}::int WHERE NOT EXISTS (SELECT 1 FROM pack_items WHERE pack_id = @${param})) part WHERE NOT ${OWNS('part.book_id')})`;
  const idList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10).map(idParam);

  /** The customer list query for the given filters (shared by the list and the Google Contacts download). */
  function customerQuery(q) {
    const where = []; const p = {};
    if (q.q) {
      const digits = phoneKey(q.q);
      p.q = '%' + String(q.q).replace(/[%_\\]/g, '\\$&') + '%';
      p.digits = digits.length >= 3 ? '%' + digits + '%' : null;
      where.push('(c.name ILIKE @q OR c.code ILIKE @q OR c.location ILIKE @q OR (@digits::text IS NOT NULL AND c.phone_norm LIKE @digits))');
    }
    // Customers have bought; leads have only been called. The list shows customers unless asked otherwise.
    if (q.kind === 'Lead') where.push(`c.kind = 'Lead'`); else if (q.kind !== 'all') where.push(`c.kind = 'Customer'`);
    if (q.type) { where.push('c.type = @type'); p.type = String(q.type); }
    if (q.location) { where.push('lower(c.location) = lower(@location)'); p.location = String(q.location); }
    // Purchase filters (BA section 7): bought every one of these, and not bought any of those.
    idList(q.bought).forEach((id, n) => { p['b' + n] = id; where.push(BOUGHT('b' + n)); });
    idList(q.not_bought).forEach((id, n) => { p['n' + n] = id; where.push('NOT ' + BOUGHT('n' + n)); });
    const outer = [];
    if (q.outstanding === '1') outer.push('outstanding_amount > 0');
    if (q.orders === 'repeat') outer.push('total_orders >= 2'); else if (q.orders === 'once') outer.push('total_orders = 1');
    const sql = `SELECT * FROM (SELECT c.*, ${STATS} FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) x
      ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''} ORDER BY last_purchase_date DESC NULLS LAST, name`;
    return { sql, p };
  }

  app.get('/api/customers', requireRole(...VIEWERS), async (req, res) => {
    const { sql, p } = customerQuery(req.query);
    const rows = await db.all(`${sql} LIMIT 501`, p);
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM (${sql}) y`, p);
    res.json({ rows: rows.slice(0, 500), truncated: rows.length > 500, total: n });
  });

  // The filtered customers as a file that Google Contacts can import (contacts.google.com → Import).
  // Admin and Manager only: it is the whole contact list in one download. Every download is logged.
  app.get('/api/customers/google-contacts.csv', requireRole('admin', 'manager'), async (req, res) => {
    const { sql, p } = customerQuery(req.query);
    const rows = (await db.all(sql, p)).filter(c => c.phone_norm);
    const label = str(req.query.label, { name: 'Label', max: 60 }) || 'Nalla Malayalam Customers';
    // Quote every cell; a cell that a spreadsheet could read as a formula gets a leading apostrophe.
    const cell = v => { let t = v === null || v === undefined ? '' : String(v).replace(/\r?\n/g, ', '); if (/^[=+\-@\t]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const intl = k => (k.length === 10 ? '+91' + k : '+' + k);
    const head = ['Name', 'Given Name', 'Phone 1 - Label', 'Phone 1 - Type', 'Phone 1 - Value', 'Address 1 - Formatted', 'Notes', 'Labels', 'Group Membership'];
    const lines = [head.join(',')];
    for (const c of rows) {
      const notes = `${c.code}${c.type !== 'Individual' ? ' · ' + c.type : ''}${c.location ? ' · ' + c.location : ''} · ${c.total_orders} order${c.total_orders === 1 ? '' : 's'}${c.last_purchase_date ? ', last ' + c.last_purchase_date : ''}`;
      lines.push([cell(c.name), cell(c.name), '"Mobile"', '"Mobile"', '"' + intl(c.phone_norm) + '"', cell(c.address), cell(notes), cell(`${label} ::: * myContacts`), cell(`${label} ::: * myContacts`)].join(','));
    }
    await audit(db, req.user, 'customer', null, 'contacts_exported', null, { count: rows.length, filters: req.query });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nalla-malayalam-contacts.csv"', 'Cache-Control': 'no-store', 'X-Contact-Count': String(rows.length) });
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  });

  // Used by the sales form: does this contact number already belong to a customer?
  app.get('/api/customers/lookup', requireRole(...VIEWERS), async (req, res) => {
    const key = phoneKey(req.query.phone);
    if (key.length < 7) return res.json({ customer: null });
    const c = await db.get(`SELECT c.*, ${STATS} FROM customers c WHERE c.phone_norm = ?`, [key]);
    res.json({ customer: c || null });
  });

  app.get('/api/customers/locations', requireRole(...VIEWERS), async (_req, res) => {
    res.json((await db.all(`SELECT location FROM customers WHERE location IS NOT NULL AND kind = 'Customer' GROUP BY location HAVING COUNT(*) >= 3 ORDER BY location`)).map(r => r.location));
  });

  // Profile with the full purchase and payment history.
  app.get('/api/customers/:id', requireRole(...VIEWERS), async (req, res) => {
    const c = await db.get(`SELECT c.*, ${STATS} FROM customers c WHERE c.id = ?`, [idParam(req.params.id)]);
    if (!c) throw notFound('Customer');
    const sales = await db.all(`SELECT s.id, s.sale_no, s.sale_date, s.channel, s.status, s.total_amount, s.amount_received,
        (s.total_amount - s.amount_received) AS balance, s.payment_status, s.due_date, u.name AS salesperson_name
      FROM sales s JOIN users u ON u.id = s.salesperson_id WHERE s.customer_id = ? ORDER BY s.sale_date DESC, s.id DESC`, [c.id]);
    const items = await db.all(`SELECT i.sale_id, i.qty, i.unit_price, i.line_total, b.name AS book_name, b.sku
      FROM sale_items i JOIN books b ON b.id = i.book_id JOIN sales s ON s.id = i.sale_id WHERE s.customer_id = ? ORDER BY i.id`, [c.id]);
    const payments = await db.all(`SELECT p.id, p.sale_id, p.amount, p.method, p.paid_on, p.note, s.sale_no
      FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.customer_id = ? ORDER BY p.paid_on DESC, p.id DESC`, [c.id]);
    const books = await db.all(`SELECT b.id, b.name, b.sku, SUM(i.qty) AS qty, MAX(s.sale_date) AS last_date
      FROM sale_items i JOIN books b ON b.id = i.book_id JOIN sales s ON s.id = i.sale_id
      WHERE s.customer_id = ? AND s.status <> 'Cancelled' GROUP BY b.id, b.name, b.sku ORDER BY b.name`, [c.id]);
    for (const s of sales) s.items = items.filter(i => i.sale_id === s.id);
    const calls = await db.all(`SELECT ${require('./calls').CALL_LIST} ${require('./calls').CALL_FROM} WHERE c.customer_id = ? ORDER BY c.called_at DESC, c.id DESC LIMIT 200`, [c.id]);
    const visits = await db.all(`SELECT ${require('./visits').VISIT_LIST} ${require('./visits').VISIT_FROM} WHERE v.customer_id = ? ORDER BY v.visit_date DESC, v.id DESC LIMIT 200`, [c.id]);
    res.json({ ...c, sales, payments, books, calls, visits });
  });

  app.patch('/api/customers/:id', requireRole(...VIEWERS), async (req, res) => {
    const before = await db.get('SELECT id, name, phone, phone_norm, address, location, type, contact_person FROM customers WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Customer');
    const b = req.body; const next = { ...before };
    if (b.name !== undefined) next.name = str(b.name, { required: true, name: 'Customer name', max: 150 });
    const lists = await getLists(db);
    if (b.type !== undefined) next.type = oneOf(b.type, lists.customer_types, { required: true, name: 'Customer type' });
    if (b.contact_person !== undefined) next.contact_person = str(b.contact_person, { name: 'Contact person', max: 100 });
    // A school or bookstore may have no number on record; everyone else needs one.
    if (b.phone !== undefined) {
      next.phone = str(b.phone, { required: !lists.places.includes(next.type), name: 'Contact number', max: 30 });
      next.phone_norm = next.phone ? validPhone(next.phone) : null;
    }
    if (b.address !== undefined) next.address = str(b.address, { name: 'Address', max: 500 });
    if (b.location !== undefined) next.location = str(b.location, { name: 'Location', max: 100 });
    if (next.phone_norm && next.phone_norm !== before.phone_norm && await db.get('SELECT 1 AS x FROM customers WHERE phone_norm = ? AND id <> ?', [next.phone_norm, before.id])) {
      throw conflict('Another customer already has this contact number', { field: 'Contact number' });
    }
    await db.tx(async t => {
      await t.run(`UPDATE customers SET name = ?, phone = ?, phone_norm = ?, address = ?, location = ?, type = ?, contact_person = ?, updated_at = now_iso() WHERE id = ?`,
        [next.name, next.phone, next.phone_norm, next.address, next.location, next.type, next.contact_person, before.id]);
      await audit(t, req.user, 'customer', before.id, 'updated', before, next);
    });
    res.json(await db.get(`SELECT c.*, ${STATS} FROM customers c WHERE c.id = ?`, [before.id]));
  });
};
module.exports.findOrCreateCustomer = findOrCreateCustomer;
module.exports.phoneKey = phoneKey;
module.exports.CUSTOMER_TYPES = TYPES;
