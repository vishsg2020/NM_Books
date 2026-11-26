'use strict';
const { isWide } = require('../access');
// Tele-sales call management: individual call records, follow-ups and the day/week/month report.
const { audit, history } = require('../audit');
const { getLists } = require('../settings');
const { findOrCreateCustomer, phoneKey } = require('./customers');
const { bad, notFound, forbidden, str, date, oneOf, idParam, isValidDate, isValidDateTime, isValidTime, nowParts, today } = require('../util');

const STATUSES = ['Answered', 'Not Answered', 'Busy', 'Switched Off', 'Wrong Number'];
const OUTCOMES = ['Interested', 'Not Interested', 'Follow-up', 'Sale'];
const PERIOD = { day: 'call_date', week: `to_char(date_trunc('week', call_date::date), 'YYYY-MM-DD')`, month: 'substr(call_date, 1, 7)' };
const SALE_PERIOD = { day: 's.sale_date', week: `to_char(date_trunc('week', s.sale_date::date), 'YYYY-MM-DD')`, month: 'substr(s.sale_date, 1, 7)' };
const PAY_PERIOD = { day: 'p.paid_on', week: `to_char(date_trunc('week', p.paid_on::date), 'YYYY-MM-DD')`, month: 'substr(p.paid_on, 1, 7)' };

const LIST = `c.id, c.call_no, c.called_at, c.call_date, c.salesperson_id, u.name AS salesperson_name, c.customer_id, cu.name AS customer_name, cu.phone, cu.kind AS customer_kind,
  c.status, c.outcome, c.remarks, c.followup_at, c.followup_date, c.followup_done_by, c.sale_id, s.sale_no, s.total_amount AS sale_amount`;
const FROM = `FROM calls c JOIN users u ON u.id = c.salesperson_id JOIN customers cu ON cu.id = c.customer_id LEFT JOIN sales s ON s.id = c.sale_id`;

module.exports = (app, { db, perm }) => {
  const isManager = u => isWide(u.role); // Admin, Manager, Report Viewer: every record

  function followup(b, outcome) {
    const d = date(b.followup_date, { name: 'Next follow-up date', required: outcome === 'Follow-up' });
    if (!d) return [null, null];
    const t = b.followup_time === undefined || b.followup_time === null || b.followup_time === '' ? '00:00' : b.followup_time;
    if (!isValidTime(t)) throw bad('Next follow-up time is not valid', { field: 'Next follow-up time' });
    return [`${d}T${t}`, d];
  }

  // ── Calls list ───────────────────────────────────────────────────────────
  app.get('/api/calls', perm('calls'), async (req, res) => {
    const q = req.query; const where = []; const p = {};
    // A sales person sees their own calls; a customer's full call history is on the customer profile.
    if (!isManager(req.user)) { where.push('c.salesperson_id = @me'); p.me = req.user.id; }
    else if (q.salesperson) { where.push('c.salesperson_id = @sp'); p.sp = idParam(q.salesperson); }
    if (q.customer_id) { where.push('c.customer_id = @cust'); p.cust = idParam(q.customer_id); }
    if (q.status === 'unanswered') where.push(`c.status <> 'Answered'`);
    else if (q.status) { where.push('c.status = @status'); p.status = String(q.status); }
    if (q.outcome) { where.push('c.outcome = @outcome'); p.outcome = String(q.outcome); }
    if (q.followup === 'pending') where.push('c.followup_date IS NOT NULL AND c.followup_done_by IS NULL');
    if (q.date_from) { if (!isValidDate(q.date_from)) throw bad('From date is not valid'); where.push('c.call_date >= @from'); p.from = q.date_from; }
    if (q.date_to) { if (!isValidDate(q.date_to)) throw bad('To date is not valid'); where.push('c.call_date <= @to'); p.to = q.date_to; }
    if (q.q) {
      const digits = phoneKey(q.q);
      p.q = '%' + String(q.q).replace(/[%_\\]/g, '\\$&') + '%'; p.digits = digits.length >= 3 ? '%' + digits + '%' : null;
      where.push('(cu.name ILIKE @q OR c.call_no ILIKE @q OR c.remarks ILIKE @q OR (@digits::text IS NOT NULL AND (cu.phone_norm LIKE @digits OR cu.phone2_norm LIKE @digits)))');
    }
    const rows = await db.all(`SELECT ${LIST} ${FROM} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.called_at DESC, c.id DESC LIMIT 501`, p);
    res.json({ rows: rows.slice(0, 500), truncated: rows.length > 500 });
  });

  // ── Follow-ups still to be made: overdue, due today, upcoming ────────────
  app.get('/api/calls/followups', perm('calls'), async (req, res) => {
    const p = { today: today() }; let who = '';
    if (!isManager(req.user)) { who = 'AND c.salesperson_id = @sp'; p.sp = req.user.id; }
    else if (req.query.salesperson) { who = 'AND c.salesperson_id = @sp'; p.sp = idParam(req.query.salesperson); }
    const rows = await db.all(`SELECT ${LIST}, CASE WHEN c.followup_date < @today THEN 'Overdue' WHEN c.followup_date = @today THEN 'Today' ELSE 'Upcoming' END AS due
      ${FROM} WHERE c.followup_date IS NOT NULL AND c.followup_done_by IS NULL ${who} ORDER BY c.followup_at, c.id LIMIT 300`, p);
    res.json({ today: p.today, rows });
  });

  // ── Day / week / month report, built from the call and sale records ──────
  app.get('/api/calls/report', perm(['calls', 'reports']), async (req, res) => {
    const q = req.query;
    const from = date(q.date_from, { name: 'From date', required: true }), to = date(q.date_to, { name: 'To date', required: true });
    if (from > to) throw bad('The From date is after the To date');
    const by = oneOf(q.by, ['day', 'week', 'month', 'person'], { name: 'Show by' }) || 'day';
    const p = { from, to }; let who = '', whoS = '';
    if (!isManager(req.user)) { p.sp = req.user.id; who = 'AND salesperson_id = @sp'; whoS = 'AND s.salesperson_id = @sp'; }
    else if (q.salesperson) { p.sp = idParam(q.salesperson); who = 'AND salesperson_id = @sp'; whoS = 'AND s.salesperson_id = @sp'; }
    const person = by === 'person';
    const key = person ? 'salesperson_id' : PERIOD[by];
    const rows = new Map();
    const row = k => { if (!rows.has(k)) rows.set(k, { key: k, calls: 0, answered: 0, unanswered: 0, interested: 0, converted: 0, followups_required: 0, followups_completed: 0, orders: 0, books: 0, sales: 0, collected: 0, outstanding: 0 }); return rows.get(k); };
    for (const r of await db.all(`SELECT ${key} AS k, COUNT(*) AS calls, COUNT(*) FILTER (WHERE status = 'Answered') AS answered,
        COUNT(*) FILTER (WHERE status <> 'Answered') AS unanswered, COUNT(*) FILTER (WHERE outcome = 'Interested') AS interested, COUNT(*) FILTER (WHERE outcome = 'Sale') AS converted
      FROM calls WHERE call_date BETWEEN @from AND @to ${who} GROUP BY 1`, p)) Object.assign(row(r.k), { calls: r.calls, answered: r.answered, unanswered: r.unanswered, interested: r.interested, converted: r.converted });
    // Follow-ups counted on the day they fall due.
    const fkey = person ? 'salesperson_id' : PERIOD[by].replace(/call_date/g, 'followup_date');
    for (const r of await db.all(`SELECT ${fkey} AS k, COUNT(*) AS required, COUNT(*) FILTER (WHERE followup_done_by IS NOT NULL) AS completed
      FROM calls WHERE followup_date BETWEEN @from AND @to ${who} GROUP BY 1`, p)) Object.assign(row(r.k), { followups_required: r.required, followups_completed: r.completed });
    // Tele-sales orders by this person; cancelled orders are left out.
    const skey = person ? 's.salesperson_id' : SALE_PERIOD[by];
    for (const r of await db.all(`SELECT ${skey} AS k, COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS sales, COALESCE(SUM(s.total_amount - s.amount_received),0) AS outstanding,
        COALESCE(SUM((SELECT SUM(i.qty) FROM sale_items i WHERE i.sale_id = s.id)),0) AS books
      FROM sales s WHERE s.channel = 'Tele-sales' AND s.status <> 'Cancelled' AND s.sale_date BETWEEN @from AND @to ${whoS} GROUP BY 1`, p)) Object.assign(row(r.k), { orders: r.orders, sales: r.sales, outstanding: r.outstanding, books: r.books });
    const pkey = person ? 's.salesperson_id' : PAY_PERIOD[by];
    for (const r of await db.all(`SELECT ${pkey} AS k, COALESCE(SUM(p.amount),0) AS collected FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.channel = 'Tele-sales' AND s.status <> 'Cancelled' AND p.paid_on BETWEEN @from AND @to ${whoS} GROUP BY 1`, p)) row(r.k).collected = r.collected;
    let out = [...rows.values()];
    if (person) {
      const names = Object.fromEntries((await db.all('SELECT id, name FROM users')).map(u => [u.id, u.name]));
      out = out.map(r => ({ ...r, label: names[r.key] || 'Unknown' })).sort((a, b) => b.sales - a.sales || b.calls - a.calls);
    } else out.sort((a, b) => (a.key < b.key ? -1 : 1));
    const total = out.reduce((t, r) => { for (const k of Object.keys(t)) t[k] += r[k]; return t; },
      { calls: 0, answered: 0, unanswered: 0, interested: 0, converted: 0, followups_required: 0, followups_completed: 0, orders: 0, books: 0, sales: 0, collected: 0, outstanding: 0 });
    res.json({ by, from, to, rows: out, total });
  });

  // ── Log a call ───────────────────────────────────────────────────────────
  app.post('/api/calls', perm('calls'), async (req, res) => {
    const b = req.body; const me = req.user;
    const requestKey = str(b.request_key, { name: 'Request key', max: 80 });
    if (requestKey) {
      const dup = await db.get(`SELECT ${LIST} ${FROM} WHERE c.request_key = ?`, [requestKey]);
      if (dup) return res.json(dup);
    }
    const phone = str(b.phone, { required: true, name: 'Contact number', max: 30 });
    const lists = await getLists(db);
    const status = oneOf(b.status, lists.call_statuses, { required: true, name: 'Call status' });
    const outcome = status === 'Answered' ? oneOf(b.outcome, lists.call_outcomes, { required: true, name: 'Call outcome' }) : null;
    const name = str(b.customer_name, { name: 'Customer name', max: 150 });
    const remarks = str(b.remarks, { name: 'Discussion remarks', max: 2000 });
    const now = nowParts(); let calledAt = process.env.TODAY_OVERRIDE ? `${today()}T12:00` : `${now.date}T${now.time}`; // tests pin the date
    if (b.called_at) {
      if (!isValidDateTime(b.called_at)) throw bad('Call date and time is not valid', { field: 'Call date and time' });
      if (b.called_at > calledAt) throw bad('The call time cannot be in the future', { field: 'Call date and time' });
      calledAt = b.called_at;
    }
    const [fAt, fDate] = followup(b, outcome);
    if (fDate && fDate < calledAt.slice(0, 10)) throw bad('The follow-up date is before the call', { field: 'Next follow-up date' });
    const id = await db.tx(async t => {
      // The person called is a customer if they have bought, otherwise a lead (created here when new).
      const cust = await findOrCreateCustomer(t, { name: name || 'Name not known', phone, kind: 'Lead', source: 'Calls' });
      if (name && cust.created === false) await t.run(`UPDATE customers SET name = ? WHERE id = ? AND name = 'Name not known'`, [name, cust.id]);
      const { n } = await t.get(`SELECT nextval('call_number_seq') AS n`);
      const c = await t.get(`INSERT INTO calls (call_no, called_at, call_date, salesperson_id, customer_id, status, outcome, remarks, followup_at, followup_date, request_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, ['CL-' + String(n).padStart(6, '0'), calledAt, calledAt.slice(0, 10), me.id, cust.id, status, outcome, remarks, fAt, fDate, requestKey]);
      // Calling the person again completes any follow-up that was waiting for them.
      await t.run('UPDATE calls SET followup_done_by = ?, updated_at = now_iso() WHERE customer_id = ? AND id <> ? AND followup_date IS NOT NULL AND followup_done_by IS NULL', [c.id, cust.id, c.id]);
      return c.id;
    });
    res.status(201).json(await db.get(`SELECT ${LIST} ${FROM} WHERE c.id = ?`, [id]));
  });

  // ── Correct a call: your own on the same day; Manager and Admin any time ─
  app.patch('/api/calls/:id', perm('calls'), async (req, res) => {
    const before = await db.get('SELECT id, salesperson_id, call_date, status, outcome, remarks, followup_at, followup_date, followup_done_by FROM calls WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Call');
    if (!isManager(req.user)) {
      if (before.salesperson_id !== req.user.id) throw forbidden();
      if (before.call_date !== today()) throw bad('A call can be corrected on the day it was made. After that, ask the Manager.');
    }
    const b = req.body; const next = { ...before }; const lists = await getLists(db);
    if (b.status !== undefined) next.status = oneOf(b.status, lists.call_statuses, { required: true, name: 'Call status' });
    if (next.status !== 'Answered') next.outcome = null;
    else if (b.outcome !== undefined || !next.outcome) next.outcome = oneOf(b.outcome, lists.call_outcomes, { required: true, name: 'Call outcome' });
    if (b.remarks !== undefined) next.remarks = str(b.remarks, { name: 'Discussion remarks', max: 2000 });
    if (b.followup_date !== undefined || next.outcome === 'Follow-up') {
      const src = b.followup_date !== undefined ? b : { followup_date: before.followup_date, followup_time: before.followup_at ? before.followup_at.slice(11) : '' };
      [next.followup_at, next.followup_date] = followup(src, next.outcome);
      if (!next.followup_date) next.followup_done_by = null;
    }
    await db.tx(async t => {
      await t.run('UPDATE calls SET status = ?, outcome = ?, remarks = ?, followup_at = ?, followup_date = ?, followup_done_by = ?, updated_at = now_iso() WHERE id = ?',
        [next.status, next.outcome, next.remarks, next.followup_at, next.followup_date, next.followup_done_by, before.id]);
      await audit(t, req.user, 'call', before.id, 'updated', before, next);
    });
    res.json({ ...(await db.get(`SELECT ${LIST} ${FROM} WHERE c.id = ?`, [before.id])), history: await history(db, 'call', before.id) });
  });
};
module.exports.CALL_LIST = LIST; module.exports.CALL_FROM = FROM;
