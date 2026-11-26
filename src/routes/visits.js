'use strict';
const { isWide } = require('../access');
// Onsite visits: every visit to a school, bookstore or exhibition, with or without a sale; saved locations; next visits.
const { findOrCreateCustomer, phoneKey } = require('./customers');
const { bad, notFound, str, date, oneOf, idParam, isValidDate, today } = require('../util');
const { getLists } = require('../settings');

const TYPES = ['School', 'Bookstore', 'Exhibition'];
const LIST = `v.id, v.visit_no, v.visit_date, v.salesperson_id, u.name AS salesperson_name, v.customer_id, v.location_type, v.location_name, v.address, v.contact_person, v.contact_phone,
  v.outcome, v.remarks, v.next_visit_date, v.next_visit_done_by, v.sale_id, s.sale_no, s.total_amount AS sale_amount, (s.total_amount - s.amount_received) AS sale_balance, s.status AS sale_status`;
const FROM = `FROM visits v JOIN users u ON u.id = v.salesperson_id LEFT JOIN sales s ON s.id = v.sale_id`;

/**
 * The saved school or bookstore for a visit: the one picked from the list, the one with this phone number,
 * the one with this name and type, or a new record. Returns its customer id. `t` is a transaction handle.
 */
async function resolveLocation(t, { id, type, name, phone, address, contact_person }) {
  if (id) {
    await t.run('UPDATE customers SET address = COALESCE(address, ?), contact_person = COALESCE(?, contact_person), updated_at = now_iso() WHERE id = ?', [address || null, contact_person || null, id]);
    return id;
  }
  let cid;
  if (phone) cid = (await findOrCreateCustomer(t, { name, phone, address, type, source: 'Visits' })).id;
  else {
    await t.get('SELECT pg_advisory_xact_lock(hashtext(?)) AS locked', ['location:' + type + ':' + name.toLowerCase()]);
    const found = await t.get(`SELECT id FROM customers WHERE type = ? AND lower(name) = lower(?) ORDER BY id LIMIT 1`, [type, name]);
    if (found) cid = found.id;
    else {
      const { n } = await t.get(`SELECT nextval('customer_number_seq') AS n`);
      cid = (await t.get(`INSERT INTO customers (code, name, address, type, source) VALUES (?,?,?,?,'Visits') RETURNING id`, ['C-' + String(n).padStart(5, '0'), name, address || null, type])).id;
    }
  }
  await t.run('UPDATE customers SET address = COALESCE(address, ?), contact_person = COALESCE(?, contact_person) WHERE id = ?', [address || null, contact_person || null, cid]);
  return cid;
}

/** Saves the visit row and marks any earlier "next visit" for this location as done. `t` is a transaction handle. */
async function recordVisit(t, v) {
  const { n } = await t.get(`SELECT nextval('visit_number_seq') AS n`);
  const row = await t.get(`INSERT INTO visits (visit_no, visit_date, salesperson_id, customer_id, location_type, location_name, address, contact_person, contact_phone, outcome, remarks, next_visit_date, sale_id, request_key, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, ['V-' + String(n).padStart(6, '0'), v.visit_date, v.salesperson_id, v.customer_id, v.location_type, v.location_name, v.address, v.contact_person, v.contact_phone,
    v.outcome, v.remarks, v.next_visit_date, v.sale_id || null, v.request_key || null, v.created_by]);
  if (v.customer_id) await t.run('UPDATE visits SET next_visit_done_by = ? WHERE customer_id = ? AND id <> ? AND next_visit_date IS NOT NULL AND next_visit_done_by IS NULL', [row.id, v.customer_id, row.id]);
  return row.id;
}

/** Reads the location part of an onsite entry (shared by visits and onsite sales). Uses the pool, so call it before the transaction. */
async function readLocation(db, b) {
  let loc = null; const lists = await getLists(db);
  if (b.location_id) {
    loc = await db.get(`SELECT id, name, type, phone, address, contact_person FROM customers WHERE id = ? AND type = ANY(?::text[])`, [idParam(b.location_id), lists.places]);
    if (!loc) throw bad('The chosen location was not found', { field: 'Location' });
  }
  const type = loc ? loc.type : oneOf(b.location_type, lists.location_types, { required: true, name: 'Location type' });
  const name = loc ? loc.name : str(b.location_name, { required: true, name: 'Location name', max: 150 });
  const phone = str(b.customer_phone, { name: 'Contact number', max: 30 }) || (loc && loc.phone) || null;
  if (phone && (phoneKey(phone).length < 7 || phoneKey(phone).length > 15)) throw bad('Contact number must have 7 to 15 digits', { field: 'Contact number' });
  return {
    id: loc ? loc.id : null, type, name, phone,
    address: str(b.address, { name: 'Address', max: 500 }) || (loc && loc.address) || null,
    contact_person: str(b.contact_person, { name: 'Contact person', max: 100 }) || (loc && loc.contact_person) || null,
  };
}

module.exports = (app, { db, perm }) => {
  const isManager = u => isWide(u.role); // Admin, Manager, Report Viewer: every record

  // Saved schools and bookstores, for the picker on the visit form.
  app.get('/api/locations', perm('visits'), async (_req, res) => {
    res.json(await db.all(`SELECT c.id, c.name, c.type, c.phone, c.address, c.contact_person,
        (SELECT COALESCE(SUM(s.total_amount - s.amount_received),0) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS outstanding,
        (SELECT MAX(v.visit_date) FROM visits v WHERE v.customer_id = c.id) AS last_visit,
        (SELECT COUNT(*) FROM visits v WHERE v.customer_id = c.id) AS visits
      FROM customers c WHERE c.type = ANY(?::text[]) ORDER BY lower(c.name) LIMIT 2000`, [(await getLists(db)).places]));
  });

  app.get('/api/visits', perm('visits'), async (req, res) => {
    const q = req.query; const where = []; const p = {};
    if (q.salesperson) { where.push('v.salesperson_id = @sp'); p.sp = idParam(q.salesperson); }
    if (q.customer_id) { where.push('v.customer_id = @cust'); p.cust = idParam(q.customer_id); }
    if (q.outcome) { where.push('v.outcome = @outcome'); p.outcome = oneOf(q.outcome, ['Sale', 'Order taken', 'No sale', 'Payment collected'], { name: 'Outcome' }); }
    if (q.location_type) { where.push('v.location_type = @lt'); p.lt = String(q.location_type); }
    if (q.date_from) { if (!isValidDate(q.date_from)) throw bad('From date is not valid'); where.push('v.visit_date >= @from'); p.from = q.date_from; }
    if (q.date_to) { if (!isValidDate(q.date_to)) throw bad('To date is not valid'); where.push('v.visit_date <= @to'); p.to = q.date_to; }
    if (q.q) { p.q = '%' + String(q.q).replace(/[%_\\]/g, '\\$&') + '%'; where.push('(v.location_name ILIKE @q OR v.contact_person ILIKE @q OR v.remarks ILIKE @q OR v.visit_no ILIKE @q)'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await db.all(`SELECT ${LIST} ${FROM} ${w} ORDER BY v.visit_date DESC, v.id DESC LIMIT 501`, p);
    const totals = await db.get(`SELECT COUNT(*) AS visits, COUNT(*) FILTER (WHERE v.sale_id IS NOT NULL) AS with_sale, COUNT(DISTINCT COALESCE(v.customer_id::text, v.location_name)) AS locations,
        COALESCE(SUM(s.total_amount) FILTER (WHERE s.status <> 'Cancelled'),0) AS sales FROM visits v LEFT JOIN sales s ON s.id = v.sale_id ${w}`, p);
    res.json({ rows: rows.slice(0, 500), truncated: rows.length > 500, totals });
  });

  // Next visits still to be made: overdue, due today, upcoming. The onsite team sees its own.
  app.get('/api/visits/due', perm('visits'), async (req, res) => {
    const p = { today: today() }; let who = '';
    if (!isManager(req.user)) { who = 'AND v.salesperson_id = @sp'; p.sp = req.user.id; }
    else if (req.query.salesperson) { who = 'AND v.salesperson_id = @sp'; p.sp = idParam(req.query.salesperson); }
    const rows = await db.all(`SELECT ${LIST}, CASE WHEN v.next_visit_date < @today THEN 'Overdue' WHEN v.next_visit_date = @today THEN 'Today' ELSE 'Upcoming' END AS due,
        (SELECT COALESCE(SUM(x.total_amount - x.amount_received),0) FROM sales x WHERE x.customer_id = v.customer_id AND x.status <> 'Cancelled') AS outstanding
      ${FROM} WHERE v.next_visit_date IS NOT NULL AND v.next_visit_done_by IS NULL ${who} ORDER BY v.next_visit_date, v.id LIMIT 300`, p);
    res.json({ today: p.today, rows });
  });

  // A visit with no sale. (A visit with books goes through POST /api/sales, which records the visit too.)
  app.post('/api/visits', perm('visits'), async (req, res) => {
    const b = req.body; const me = req.user;
    const requestKey = str(b.request_key, { name: 'Request key', max: 80 });
    if (requestKey) {
      const dup = await db.get(`SELECT ${LIST} ${FROM} WHERE v.request_key = ?`, [requestKey]);
      if (dup) return res.json(dup);
    }
    const visitDate = date(b.sale_date || b.visit_date, { name: 'Visit date' }) || today();
    if (visitDate > today()) throw bad('The visit date cannot be in the future', { field: 'Visit date' });
    const loc = await readLocation(db, b);
    if (loc.type === 'Exhibition') throw bad('A visit is to a school or bookstore. Record an exhibition from Record a sale.', { field: 'Location type' });
    const outcome = oneOf(b.outcome, ['No sale', 'Payment collected'], { name: 'Outcome' }) || 'No sale';
    const remarks = str(b.remarks, { name: 'Remarks', max: 1000 });
    const next = date(b.next_visit_date, { name: 'Next visit date' });
    if (next && next < visitDate) throw bad('The next visit date is before this visit', { field: 'Next visit date' });
    let salespersonId = me.id;
    if (isManager(me) && b.salesperson_id && Number(b.salesperson_id) !== me.id) {
      const sp = await db.get(`SELECT id FROM users WHERE id = ? AND active = 1 AND role IN ('admin','manager','onsite')`, [idParam(b.salesperson_id)]);
      if (!sp) throw bad('Choose someone from the onsite team, a Manager or an Admin', { field: 'Sales person' });
      salespersonId = sp.id;
    }
    const id = await db.tx(async t => {
      const customerId = loc.type === 'Exhibition' ? null : await resolveLocation(t, { id: loc.id, type: loc.type, name: loc.name, phone: loc.phone, address: loc.address, contact_person: loc.contact_person });
      return recordVisit(t, { visit_date: visitDate, salesperson_id: salespersonId, customer_id: customerId, location_type: loc.type, location_name: loc.name, address: loc.address,
        contact_person: loc.contact_person, contact_phone: loc.phone, outcome, remarks, next_visit_date: next, request_key: requestKey, created_by: me.id });
    });
    const row = await db.get(`SELECT ${LIST} ${FROM} WHERE v.id = ?`, [id]);
    if (!row) throw notFound('Visit');
    res.status(201).json(row);
  });
};
module.exports.resolveLocation = resolveLocation; module.exports.recordVisit = recordVisit; module.exports.readLocation = readLocation;
module.exports.VISIT_LIST = LIST; module.exports.VISIT_FROM = FROM;
