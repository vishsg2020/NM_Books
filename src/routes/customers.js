'use strict';
const { audit } = require('../audit');
const { getLists, getCharges, getNextBook, read, write } = require('../settings');
const { bad, notFound, conflict, str, oneOf, idParam, normPhone, today } = require('../util');

const TYPES = ['Individual', 'School', 'Bookstore', 'Other'];

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
  (SELECT COALESCE(SUM(s.total_amount - s.amount_received),0) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS outstanding_amount,
  (SELECT MAX(s.total_amount) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS largest_order`;

// Where a customer came from (customers.source).
const SOURCES = ['Order sheet', 'Sales', 'WhatsApp group', 'Website', 'Calls', 'Visits'];

// (No '?' in this SQL: the database helper reads every '?' as a parameter.)
// A name that is probably not a person's name: a number in it, a remark ("Confirmed order"), an address word, a bare title.
const ODD_NAME = `(c.name ~ '[0-9]' OR length(c.name) > 45 OR length(btrim(c.name)) < 3 OR c.name ~ '^[^A-Za-z\\u0D00-\\u0D7F]'
  OR c.name ~* '^(to|hm|sir|madam|mr|mrs|ms|dr|teacher|principal|hi|hello|ok|my address|address)\\.{0,1}$'
  OR c.name ~* '\\m(order|ordered|confirmed|address|pincode|pin|mob|mobile|phone|ph|whatsapp|house|nagar|ayach|ayachal|ayakkanam|cod|nml|kvs|story|books{0,1}|part|urgent|vangum|venam|kittiyilla|po|post)\\M'
  OR c.name ~* '\\(h\\)')`;
const lit = v => "'" + String(v).replace(/'/g, "''") + "'";
/**
 * Why a customer's record needs an update, as a SQL text[] (empty when the record is complete). Leads are never flagged.
 * Schools and bookstores (the `places` types) are not asked for a PIN.
 */
function needsSql(places) {
  return `CASE WHEN c.kind <> 'Customer' THEN ARRAY[]::text[] ELSE array_remove(ARRAY[
    CASE WHEN c.name IN ('Name not known', 'Name not recorded') OR (c.name_ok = 0 AND ${ODD_NAME}) THEN 'Name to check' END,
    CASE WHEN c.name_ok = 0 AND c.name ~ '[\\u0D00-\\u0D7F]' THEN 'Name in Malayalam' END,
    CASE WHEN c.type = ANY(ARRAY[${places.map(lit).join(',') || "''"}]::text[]) THEN NULL WHEN c.pin IS NULL OR btrim(c.pin) = '' THEN 'PIN missing' WHEN c.pin !~ '^[1-9][0-9]{5}$' THEN 'PIN wrong' END,
    CASE WHEN c.address IS NULL OR length(btrim(c.address)) < 8 THEN 'Address missing' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') THEN 'No order' END
  ]::text[], NULL) END`;
}
// Sort orders for the customer list. "recent" is the default.
const SORTS = {
  recent: 'last_purchase_date DESC NULLS LAST, name', oldest: 'last_purchase_date ASC NULLS LAST, name',
  orders: 'total_orders DESC, last_purchase_date DESC NULLS LAST, name', spent: 'total_purchase_amount DESC, name',
  name: 'lower(name), id', newest: 'id DESC',
};
const NOT_SINCE = { 3: '3 months', 6: '6 months', 12: '12 months' };

// "Own only" customers (Roles & access, Tele-sales): people they sold to, called, or put in a follow-up list they made.
// Uses the named parameter @own_me (the person's user id). No '?' here: the database helper reads every '?' as a parameter.
const OWN = `(EXISTS (SELECT 1 FROM sales os WHERE os.customer_id = c.id AND (os.salesperson_id = @own_me OR os.created_by = @own_me))
  OR EXISTS (SELECT 1 FROM calls oc WHERE oc.customer_id = c.id AND oc.salesperson_id = @own_me)
  OR EXISTS (SELECT 1 FROM follow_up_members om JOIN follow_up_lists ol ON ol.id = om.list_id WHERE om.customer_id = c.id AND ol.created_by = @own_me))`;
const NOT_YOURS = 'This customer is with another team member. Find them by their full number to log a call or take an order.';
const REASONS = ['Name to check', 'Name in Malayalam', 'PIN missing', 'PIN wrong', 'Address missing', 'No order'];

/**
 * Merges customer `otherId` into `keepId` (t is a transaction handle). Sales, calls and visits move to the kept record;
 * its empty details are filled from the other; the other's number becomes the second number. The other record is deleted.
 */
async function mergeCustomers(t, keepId, otherId, user, reason) {
  if (keepId === otherId) throw bad('Choose two different customers');
  const rows = await t.all('SELECT * FROM customers WHERE id = ANY(?::int[]) ORDER BY id FOR UPDATE', [[keepId, otherId]]);
  const a = rows.find(r => r.id === keepId); const b = rows.find(r => r.id === otherId);
  if (!a || !b) throw notFound('Customer');
  // Numbers: the kept record's own, then one more. Any number beyond two is written into the notes.
  const numbers = [];
  for (const [ph, key] of [[a.phone, a.phone_norm], [a.phone2, a.phone2_norm], [b.phone, b.phone_norm], [b.phone2, b.phone2_norm]]) if (key && !numbers.some(n => n.key === key)) numbers.push({ ph, key });
  const extra = numbers.slice(2).map(n => n.ph);
  const unknown = n => !n || n === 'Name not known' || n === 'Name not recorded';
  const notes = [...new Set([a.notes, b.notes, extra.length ? `Other number${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}` : null].filter(Boolean))].join(' ').slice(0, 1000) || null;
  const next = {
    name: unknown(a.name) && !unknown(b.name) ? b.name : a.name,
    phone: numbers[0] ? numbers[0].ph : null, phone_norm: numbers[0] ? numbers[0].key : null,
    phone2: numbers[1] ? numbers[1].ph : null, phone2_norm: numbers[1] ? numbers[1].key : null,
    address: a.address || b.address, location: a.location || b.location, state: a.state || b.state, pin: a.pin || b.pin,
    contact_person: a.contact_person || b.contact_person, notes,
    kind: a.kind === 'Customer' || b.kind === 'Customer' ? 'Customer' : a.kind,
    source: a.created_at <= b.created_at ? a.source : b.source, created_at: a.created_at <= b.created_at ? a.created_at : b.created_at,
  };
  const moved = {};
  for (const table of ['sales', 'calls', 'visits', 'customer_messages', 'feedback']) moved[table] = (await t.run(`UPDATE ${table} SET customer_id = ? WHERE customer_id = ?`, [a.id, b.id])).rowCount;
  // Follow-up lists: a list holding both keeps the kept record's row; the other's rows move across.
  await t.run('DELETE FROM follow_up_members m WHERE m.customer_id = ? AND EXISTS (SELECT 1 FROM follow_up_members k WHERE k.list_id = m.list_id AND k.customer_id = ?)', [b.id, a.id]);
  await t.run('UPDATE follow_up_members SET customer_id = ? WHERE customer_id = ?', [a.id, b.id]);
  await t.run('DELETE FROM customers WHERE id = ?', [b.id]);
  await t.run(`UPDATE customers SET name = ?, phone = ?, phone_norm = ?, phone2 = ?, phone2_norm = ?, address = ?, location = ?, state = ?, pin = ?, contact_person = ?, notes = ?,
      kind = ?, source = ?, created_at = ?, updated_at = now_iso() WHERE id = ?`,
  [next.name, next.phone, next.phone_norm, next.phone2, next.phone2_norm, next.address, next.location, next.state, next.pin, next.contact_person, next.notes, next.kind, next.source, next.created_at, a.id]);
  const keep = k => ({ code: k.code, name: k.name, phone: k.phone, phone2: k.phone2, address: k.address, location: k.location, state: k.state, pin: k.pin });
  await audit(t, user, 'customer', a.id, 'merged', { ...keep(a), merged_from: keep(b) }, { ...next, phone_norm: undefined, phone2_norm: undefined, moved }, reason || 'Same person, two records');
  await audit(t, user, 'customer', b.id, 'merged_into', keep(b), { into: a.code }, reason || 'Same person, two records');
  return { kept: a.id, removed: b.code, moved };
}

/**
 * Finds the customer with this contact number or creates one. `t` is a transaction handle.
 * An existing customer keeps their name; an empty address or location is filled in from the sale.
 */
async function findOrCreateCustomer(t, { name, phone, address, location, state, pin, type, kind = 'Customer', source = 'Sales' }) {
  const key = validPhone(phone, 'Customer contact number');
  // Two sales for a new number at the same moment must not both create the customer.
  await t.get('SELECT pg_advisory_xact_lock(hashtext(?)) AS locked', ['customer:' + key]);
  const existing = await t.get('SELECT * FROM customers WHERE phone_norm = ? OR phone2_norm = ? ORDER BY (phone_norm = ?) DESC LIMIT 1', [key, key, key]);
  if (existing) {
    if ((!existing.address && address) || (!existing.location && location) || (!existing.state && state) || (!existing.pin && pin)) {
      await t.run('UPDATE customers SET address = COALESCE(address, ?), location = COALESCE(location, ?), state = COALESCE(state, ?), pin = COALESCE(pin, ?), updated_at = now_iso() WHERE id = ?',
        [address || null, location || null, state || null, pin || null, existing.id]);
    }
    // A lead becomes a customer with their first purchase; the record (and its call history) stays the same.
    if (kind === 'Customer' && existing.kind === 'Lead') {
      await t.run(`UPDATE customers SET kind = 'Customer', name = CASE WHEN name = 'Name not known' THEN ? ELSE name END, type = COALESCE(?, type), updated_at = now_iso() WHERE id = ?`, [name, type || null, existing.id]);
    }
    return { id: existing.id, created: false };
  }
  const { n } = await t.get(`SELECT nextval('customer_number_seq') AS n`);
  const r = await t.get(`INSERT INTO customers (code, name, phone, phone_norm, address, location, state, pin, type, kind, source) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    ['C-' + String(n).padStart(5, '0'), name, String(phone).trim(), key, address || null, location || null, state || null, pin || null, type || 'Individual', kind, source]);
  return { id: r.id, created: true };
}

module.exports = (app, { db, perm, requireAdmin, access }) => {
  /** The person's user id when they see only their own customers, else null. */
  const ownId = async user => (access && await access.isOwn(user, 'customers') ? user.id : null);
  /** Throws 403 when an "own only" person asks for a customer who is not theirs. */
  async function assertOwnCustomer(user, customerId) {
    const me = await ownId(user);
    if (me && !(await db.get(`SELECT 1 AS x FROM customers c WHERE c.id = @id AND ${OWN}`, { id: customerId, own_me: me }))) {
      const { HttpError } = require('../util'); throw new HttpError(403, NOT_YOURS);
    }
  }
  // "Has bought X": the customer owns the book, either bought on its own or inside a set. For a set, they own
  // every book in it (so a KVS Combo buyer counts as having bought KVS1 and KVS2). Cancelled orders do not count.
  const OWNS = bookExpr => `EXISTS (SELECT 1 FROM sales s JOIN sale_items i ON i.sale_id = s.id LEFT JOIN pack_items pk ON pk.pack_id = i.book_id
      WHERE s.customer_id = c.id AND s.status <> 'Cancelled' AND COALESCE(pk.book_id, i.book_id) = ${bookExpr})`;
  const BOUGHT = param => `NOT EXISTS (SELECT 1 FROM (SELECT book_id FROM pack_items WHERE pack_id = @${param}
      UNION ALL SELECT @${param}::int WHERE NOT EXISTS (SELECT 1 FROM pack_items WHERE pack_id = @${param})) part WHERE NOT ${OWNS('part.book_id')})`;
  const BULK = `(SELECT COALESCE(SUM(i.qty),0) FROM sale_items i WHERE i.sale_id = s.id) >= @bulk_copies OR (@bulk_amount > 0 AND s.total_amount >= @bulk_amount)`;
  const idList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10).map(idParam);

  /** The customer list query for the given filters (shared by the list and the Google Contacts download). */
  /** Everything customerQuery needs besides the filters. */
  async function queryArgs() {
    const nb = await getNextBook(db);
    const ids = new Map((await db.all('SELECT id, lower(sku) AS sku, name FROM books')).map(b => [b.sku, b]));
    const steps = nb.steps.map(([a, b]) => ({ key: `${a}>${b}`, from: ids.get(a.toLowerCase()), to: ids.get(b.toLowerCase()) })).filter(s => s.from && s.to);
    return [await getCharges(db), await getLists(db), { months: nb.months, steps }];
  }
  function customerQuery(q, charges, lists, next = { months: 1, steps: [] }, own = null) {
    const where = []; const p = {};
    if (own) { where.push(OWN); p.own_me = own; }
    if (q.source) { where.push('c.source = @source'); p.source = oneOf(q.source, SOURCES, { name: 'Added from' }); }
    // Bulk order customers: at least one order with many copies, or of a large amount (both set on the Settings page).
    if (q.bulk === '1') {
      p.bulk_copies = charges.bulk_min_copies; p.bulk_amount = charges.bulk_min_amount;
      where.push(`EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled' AND (${BULK}))`);
    }
    if (q.state) { where.push('lower(c.state) = lower(@state)'); p.state = String(q.state); }
    if (q.q) {
      const digits = phoneKey(q.q);
      p.q = '%' + String(q.q).replace(/[%_\\]/g, '\\$&') + '%';
      p.digits = digits.length >= 3 ? '%' + digits + '%' : null;
      where.push('(c.name ILIKE @q OR c.code ILIKE @q OR c.location ILIKE @q OR (@digits::text IS NOT NULL AND (c.phone_norm LIKE @digits OR c.phone2_norm LIKE @digits)))');
    }
    // Customers have bought; leads have only been called. The list shows customers unless asked otherwise.
    if (q.kind === 'Lead') where.push(`c.kind = 'Lead'`); else if (q.kind !== 'all') where.push(`c.kind = 'Customer'`);
    if (q.type) { where.push('c.type = @type'); p.type = String(q.type); }
    if (q.location) { where.push('lower(c.location) = lower(@location)'); p.location = String(q.location); }
    // Purchase filters (BA section 7): bought every one of these, and not bought any of those.
    idList(q.bought).forEach((id, n) => { p['b' + n] = id; where.push(BOUGHT('b' + n)); });
    idList(q.not_bought).forEach((id, n) => { p['n' + n] = id; where.push('NOT ' + BOUGHT('n' + n)); });
    // Next book: has the first book of the step, not the next one, has bought nothing for the waiting time, and is not
    // already in an open follow-up list made for this step.
    let readyCut = null;
    if (q.ready_for) {
      const step = next.steps.find(s => s.key === String(q.ready_for));
      if (!step) throw bad('That next-book step is not in Settings');
      p.rf_from = step.from.id; p.rf_to = step.to.id; p.rf_tag = '%' + JSON.stringify({ ready_for: step.key }).slice(1, -1).replace(/[%_\\]/g, '\\$&') + '%';
      where.push(BOUGHT('rf_from'), 'NOT ' + BOUGHT('rf_to'));
      where.push(`NOT EXISTS (SELECT 1 FROM follow_up_members fm JOIN follow_up_lists fl ON fl.id = fm.list_id WHERE fm.customer_id = c.id AND fl.closed_at IS NULL AND fl.filters_json LIKE @rf_tag)`);
      const d = new Date(today() + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - next.months); readyCut = d.toISOString().slice(0, 10);
    }
    const outer = [];
    if (q.outstanding === '1') outer.push('outstanding_amount > 0');
    const ORDERS = { repeat: 'total_orders >= 2', once: 'total_orders = 1', twice: 'total_orders = 2', '3plus': 'total_orders >= 3', none: 'total_orders = 0' };
    if (q.orders) outer.push(ORDERS[oneOf(q.orders, Object.keys(ORDERS), { name: 'Orders' })]);
    // Two lists: complete customers, and customers whose record needs an update. A search looks in both.
    if (q.view === 'update') outer.push('cardinality(needs) > 0');
    else if (!q.q) outer.push('cardinality(needs) = 0');
    if (q.reason) { outer.push('@reason = ANY(needs)'); p.reason = oneOf(q.reason, REASONS, { name: 'Reason' }); }
    if (readyCut) { outer.push('last_purchase_date <= @rf_cut'); p.rf_cut = readyCut; }
    // Not bought since: has ordered before, but nothing in the last 3, 6 or 12 months.
    if (q.not_since) {
      const months = Number(oneOf(String(q.not_since), Object.keys(NOT_SINCE), { name: 'Not bought since' }));
      const d = new Date(today() + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - months);
      outer.push('last_purchase_date < @since'); p.since = d.toISOString().slice(0, 10);
    }
    const sort = SORTS[q.sort ? oneOf(q.sort, Object.keys(SORTS), { name: 'Sort by' }) : 'recent'];
    const sql = `SELECT * FROM (SELECT c.*, ${STATS}, ${needsSql(lists.places)} AS needs FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) x
      ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''} ORDER BY ${sort}`;
    return { sql, p };
  }

  app.get('/api/customers', perm('customers'), async (req, res) => {
    const own = await ownId(req.user);
    const { sql, p } = customerQuery(req.query, ...(await queryArgs()), own);
    const rows = await db.all(`${sql} LIMIT 501`, p);
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM (${sql}) y`, p);
    // Own only: a full number typed in Search also finds a customer who is with someone else (the basics only).
    let found = [];
    const key = phoneKey(req.query.q || '');
    if (own && key.length >= 10) {
      found = await db.all(`SELECT c.id, c.code, c.name, c.phone, c.location, c.kind,
          (SELECT MAX(s.sale_date) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS last_purchase_date,
          (SELECT u.name FROM sales s JOIN users u ON u.id = s.salesperson_id WHERE s.customer_id = c.id AND s.status <> 'Cancelled' ORDER BY s.sale_date DESC, s.id DESC LIMIT 1) AS last_with
        FROM customers c WHERE (c.phone_norm = @key OR c.phone2_norm = @key) AND NOT ${OWN}`, { key, own_me: own });
    }
    res.json({ rows: rows.slice(0, 500), truncated: rows.length > 500, total: n, own: !!own, found });
  });

  // The filtered customers as a file that Google Contacts can import (contacts.google.com → Import).
  // Admin and Manager only: it is the whole contact list in one download. Every download is logged.
  app.get('/api/customers/google-contacts.csv', perm('customers', { wide: true }), async (req, res) => {
    const { sql, p } = customerQuery(req.query, ...(await queryArgs()));
    const rows = (await db.all(sql, p)).filter(c => c.phone_norm);
    const label = str(req.query.label, { name: 'Label', max: 60 }) || 'Nalla Malayalam Customers';
    // Quote every cell; a cell that a spreadsheet could read as a formula gets a leading apostrophe.
    const cell = v => { let t = v === null || v === undefined ? '' : String(v).replace(/\r?\n/g, ', '); if (/^[=+\-@\t]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const intl = k => (k.length === 10 ? '+91' + k : '+' + k);
    const head = ['Name', 'Given Name', 'Phone 1 - Label', 'Phone 1 - Type', 'Phone 1 - Value', 'Phone 2 - Label', 'Phone 2 - Type', 'Phone 2 - Value', 'Address 1 - Formatted', 'Notes', 'Labels', 'Group Membership'];
    const lines = [head.join(',')];
    for (const c of rows) {
      const notes = `${c.code}${c.type !== 'Individual' ? ' · ' + c.type : ''}${c.location ? ' · ' + c.location : ''} · ${c.total_orders} order${c.total_orders === 1 ? '' : 's'}${c.last_purchase_date ? ', last ' + c.last_purchase_date : ''}`;
      lines.push([cell(c.name), cell(c.name), '"Mobile"', '"Mobile"', '"' + intl(c.phone_norm) + '"', c.phone2_norm ? '"Mobile"' : '""', c.phone2_norm ? '"Mobile"' : '""', c.phone2_norm ? '"' + intl(c.phone2_norm) + '"' : '""', cell(c.address), cell(notes), cell(`${label} ::: * myContacts`), cell(`${label} ::: * myContacts`)].join(','));
    }
    await audit(db, req.user, 'customer', null, 'contacts_exported', null, { count: rows.length, filters: req.query });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nalla-malayalam-contacts.csv"', 'Cache-Control': 'no-store', 'X-Contact-Count': String(rows.length) });
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  });

  // Used by the sales form: does this contact number already belong to a customer?
  app.get('/api/customers/lookup', perm('customers'), async (req, res) => {
    const key = phoneKey(req.query.phone);
    if (key.length < 7) return res.json({ customer: null });
    const c = await db.get(`SELECT c.*, ${STATS} FROM customers c WHERE c.phone_norm = ? OR c.phone2_norm = ? ORDER BY (c.phone_norm = ?) DESC LIMIT 1`, [key, key, key]);
    res.json({ customer: c || null });
  });

  app.get('/api/customers/locations', perm('customers'), async (_req, res) => {
    res.json((await db.all(`SELECT location FROM customers WHERE location IS NOT NULL AND kind = 'Customer' GROUP BY location HAVING COUNT(*) >= 3 ORDER BY location`)).map(r => r.location));
  });

  // What the "Update needed" tab shows besides the list: counts by reason, and the sales that have no customer record.
  app.get('/api/customers/update-summary', perm('customers'), async (req, res) => {
    const lists = await getLists(db);
    const own = await ownId(req.user); const p = { own_me: own };
    const mine = own ? `AND ${OWN}` : ''; const mineS = own ? 'AND (s.salesperson_id = @own_me OR s.created_by = @own_me)' : '';
    const counts = await db.all(`SELECT r AS reason, COUNT(*) AS n FROM customers c, unnest(${needsSql(lists.places)}) r WHERE TRUE ${mine} GROUP BY r`, p);
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM customers c WHERE cardinality(${needsSql(lists.places)}) > 0 ${mine}`, p);
    const total = await db.get(`SELECT COUNT(*) AS n FROM customers c WHERE c.kind = 'Customer' ${mine}`, p);
    const noCustomer = await db.all(`SELECT s.id, s.sale_no, s.sale_date, s.channel, s.platform, s.customer_name, s.address, s.total_amount, s.status,
        CASE WHEN s.import_ref LIKE 'WEB-%' THEN 'Website' WHEN s.import_ref LIKE 'WA-%' THEN 'WhatsApp group' WHEN s.import_ref IS NOT NULL THEN 'Order sheet' ELSE 'Sales' END AS source
      FROM sales s WHERE s.customer_id IS NULL AND s.status <> 'Cancelled' AND s.channel <> 'Onsite' ${mineS} ORDER BY s.sale_date DESC, s.id DESC LIMIT 500`, p);
    const { m } = await db.get(`SELECT COUNT(*) AS m FROM sales s WHERE s.customer_id IS NULL AND s.status <> 'Cancelled' AND s.channel <> 'Onsite' ${mineS}`, p);
    res.json({ feedback: (await db.get('SELECT COUNT(*) AS n FROM feedback WHERE submitted_at IS NOT NULL')).n, needing: n, complete: total.n - n, reasons: Object.fromEntries(REASONS.map(r => [r, (counts.find(c => c.reason === r) || {}).n || 0])), sales_without_customer: m, sales: noCustomer });
  });

  // Possibly the same person twice: same name (letters only) and the same PIN. Pairs marked "not the same person" are left out.
  app.get('/api/customers/duplicates', perm('customers'), async (req, res) => {
    if (await ownId(req.user)) return res.json([]); // merging is the Admin's; an own-only list has no use for it
    const dismissed = new Set((await read(db, 'duplicates_dismissed')) || []);
    const groups = (await db.all(`SELECT array_agg(id ORDER BY id) AS ids FROM (
        SELECT c.id, lower(regexp_replace(c.name, '[^A-Za-z]', '', 'g')) AS nk, c.pin FROM customers c WHERE c.kind = 'Customer' AND c.pin ~ '^[1-9][0-9]{5}$') k
      WHERE length(nk) >= 5 GROUP BY nk, pin HAVING COUNT(*) > 1 ORDER BY MIN(id) LIMIT 300`)).map(g => g.ids).filter(ids => !dismissed.has(ids.join('-')));
    const ids = groups.flat();
    const rows = ids.length ? await db.all(`SELECT c.id, c.code, c.name, c.phone, c.phone2, c.address, c.pin, c.location, c.source, c.created_at, ${STATS} FROM customers c WHERE c.id = ANY(?::int[])`, [ids]) : [];
    const byId = new Map(rows.map(r => [r.id, r]));
    // The record kept on a merge: the one with more orders, then the older one.
    res.json(groups.map(g => g.map(id => byId.get(id)).sort((x, y) => y.total_orders - x.total_orders || x.id - y.id)));
  });
  app.post('/api/customers/duplicates/dismiss', perm('customers', { wide: true }), async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(idParam).filter(i => i > 0).sort((a, b) => a - b);
    if (ids.length < 2) throw bad('Choose the customers that are not the same person');
    const list = (await read(db, 'duplicates_dismissed')) || [];
    if (!list.includes(ids.join('-'))) list.push(ids.join('-'));
    await db.tx(async t => { await write(t, 'duplicates_dismissed', list); await audit(t, req.user, 'customer', ids[0], 'not_duplicates', null, { ids }); });
    res.json({ ok: true });
  });
  // Merge: the customer in the URL is kept; `other_id` is folded into it. Admin only, with a reason.
  app.post('/api/customers/:id/merge', requireAdmin, async (req, res) => {
    const keepId = idParam(req.params.id); const otherId = idParam(req.body.other_id);
    const reason = str(req.body.reason, { name: 'Reason', max: 300 }) || 'Same person, two records';
    const r = await db.tx(t => mergeCustomers(t, keepId, otherId, req.user, reason));
    res.json(r);
  });

  // Customers → Next book: how many customers are ready for each step.
  app.get('/api/customers/next-book', perm('customers'), async (req, res) => {
    const args = await queryArgs(); const out = []; const own = await ownId(req.user);
    for (const s of args[2].steps) {
      const { sql, p } = customerQuery({ ready_for: s.key }, ...args, own);
      out.push({ key: s.key, from: { id: s.from.id, name: s.from.name }, to: { id: s.to.id, name: s.to.name }, ready: (await db.get(`SELECT COUNT(*) AS n FROM (${sql}) y`, p)).n });
    }
    res.json({ months: args[2].months, steps: out });
  });

  // Profile with the full purchase and payment history.
  app.get('/api/customers/:id', perm('customers'), async (req, res) => {
    const c = await db.get(`SELECT c.*, ${STATS}, ${needsSql((await getLists(db)).places)} AS needs FROM customers c WHERE c.id = ?`, [idParam(req.params.id)]);
    if (!c) throw notFound('Customer');
    await assertOwnCustomer(req.user, c.id);
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
    const messages = await db.all(`SELECT m.id, m.kind, m.created_at, u.name AS user_name, l.name AS list_name, b.name AS book_name FROM customer_messages m
      JOIN users u ON u.id = m.user_id LEFT JOIN follow_up_lists l ON l.id = m.list_id LEFT JOIN books b ON b.id = m.book_id
      WHERE m.customer_id = ? ORDER BY m.id DESC LIMIT 100`, [c.id]);
    const feedback = (await db.all(`SELECT id, stars, liked_json, reasons_json, comment, submitted_at, requested_at FROM feedback
      WHERE customer_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC`, [c.id])).map(require('./followups').feedbackRow);
    const lists = await db.all(`SELECT l.id, l.name, l.closed_at, m.status FROM follow_up_members m JOIN follow_up_lists l ON l.id = m.list_id
      WHERE m.customer_id = ? ORDER BY l.id DESC`, [c.id]);
    const delivery_checks = await require('./delivery').checksFor(db, { customerId: c.id });
    res.json({ ...c, sales, payments, books, calls, visits, messages, feedback, lists, delivery_checks });
  });

  app.patch('/api/customers/:id', perm('customers'), async (req, res) => {
    const before = await db.get('SELECT id, name, phone, phone_norm, phone2, phone2_norm, address, location, state, pin, type, contact_person, name_ok FROM customers WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Customer');
    await assertOwnCustomer(req.user, before.id);
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
    if (b.phone2 !== undefined) {
      next.phone2 = str(b.phone2, { name: 'Second number', max: 30 });
      next.phone2_norm = next.phone2 ? validPhone(next.phone2, 'Second number') : null;
      if (next.phone2_norm && next.phone2_norm === next.phone_norm) { next.phone2 = null; next.phone2_norm = null; }
    }
    if (b.pin !== undefined) { next.pin = str(b.pin, { name: 'PIN', max: 10 }); if (next.pin) { next.pin = next.pin.replace(/\s/g, ''); if (!/^[1-9][0-9]{5}$/.test(next.pin)) throw bad('PIN must be 6 digits', { field: 'PIN' }); } }
    // "This name is correct": the name is no longer flagged for a check. Changing the name clears it again.
    if (b.name_ok !== undefined) next.name_ok = b.name_ok ? 1 : 0;
    if (b.name !== undefined && next.name !== before.name && b.name_ok === undefined) next.name_ok = 0;
    if (b.address !== undefined) next.address = str(b.address, { name: 'Address', max: 500 });
    if (b.location !== undefined) next.location = str(b.location, { name: 'District', max: 100 });
    if (b.state !== undefined) next.state = str(b.state, { name: 'State', max: 60 });
    for (const [key, field] of [[next.phone_norm, 'Contact number'], [next.phone2_norm, 'Second number']]) {
      if (key && await db.get('SELECT 1 AS x FROM customers WHERE (phone_norm = ? OR phone2_norm = ?) AND id <> ?', [key, key, before.id])) {
        throw conflict(`Another customer already has this number (${field.toLowerCase()}). If it is the same person, merge the two records from Update needed → Possible duplicates.`, { field });
      }
    }
    await db.tx(async t => {
      await t.run(`UPDATE customers SET name = ?, phone = ?, phone_norm = ?, phone2 = ?, phone2_norm = ?, address = ?, location = ?, state = ?, pin = ?, type = ?, contact_person = ?, name_ok = ?, updated_at = now_iso() WHERE id = ?`,
        [next.name, next.phone, next.phone_norm, next.phone2, next.phone2_norm, next.address, next.location, next.state, next.pin, next.type, next.contact_person, next.name_ok, before.id]);
      await audit(t, req.user, 'customer', before.id, 'updated', before, next);
    });
    res.json(await db.get(`SELECT c.*, ${STATS} FROM customers c WHERE c.id = ?`, [before.id]));
  });

  require('./followups')(app, { db, perm, customerQuery, queryArgs, ownId, assertOwnCustomer });
};
module.exports.findOrCreateCustomer = findOrCreateCustomer;
module.exports.SORTS = SORTS;
module.exports.NOT_SINCE = NOT_SINCE;
module.exports.mergeCustomers = mergeCustomers;
module.exports.needsSql = needsSql;
module.exports.SOURCES = SOURCES;
module.exports.REASONS = REASONS;
module.exports.phoneKey = phoneKey;
module.exports.CUSTOMER_TYPES = TYPES;
