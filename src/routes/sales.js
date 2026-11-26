'use strict';
const { CHANNEL_OF } = require('../auth');
const { audit, history } = require('../audit');
const { moveStock, saleStock } = require('../stock');
const { getLists } = require('../settings');
const { phoneKey } = require('./customers');
const { bad, notFound, forbidden, unprocessable, str, money, date, oneOf, idParam, isValidDate, today, inr } = require('../util');

const CHANNELS = ['Tele-sales', 'Online', 'Onsite'];
const METHODS = ['UPI', 'Bank Transfer', 'COD', 'Cash', 'Card', 'Other'];
// Order workflow. An onsite sale handed over on the spot is 'Completed' and never enters it.
const FLOW = ['Confirmed', 'Packing', 'Ready to Dispatch', 'Dispatched', 'Delivered'];
const STATUSES = [...FLOW, 'Completed', 'Cancelled'];
const PAY_STATUSES = ['Paid', 'Partially Paid', 'Unpaid', 'COD'];

function paymentStatus(total, received, method) {
  if (received >= total) return 'Paid';
  if (received > 0) return 'Partially Paid';
  return method === 'COD' ? 'COD' : 'Unpaid';
}

const LIST = `s.id, s.sale_no, s.sale_date, s.channel, s.status, s.customer_id, s.customer_name, s.customer_phone, s.address,
  s.platform, s.platform_order_id, s.location_type, s.location_name, s.total_amount, s.amount_received,
  (s.total_amount - s.amount_received) AS balance, s.payment_method, s.payment_status, s.due_date, s.salesperson_id,
  u.name AS salesperson_name, s.created_at,
  (SELECT COALESCE(SUM(i.qty),0) FROM sale_items i WHERE i.sale_id = s.id) AS total_qty,
  (SELECT string_agg(b.name || ' × ' || i.qty, ', ' ORDER BY i.id) FROM sale_items i JOIN books b ON b.id = i.book_id WHERE i.sale_id = s.id) AS books`;

module.exports = (app, { db, perm }) => {
  /** Which sales a role may see: channel roles their own channel, Dispatch the orders that are shipped. */
  function scope(user, where, p) {
    if (CHANNEL_OF[user.role]) { where.push('s.channel = @scope_channel'); p.scope_channel = CHANNEL_OF[user.role]; }
    if (user.role === 'dispatch') where.push(`s.status <> 'Completed'`);
  }
  function assertCanSee(user, sale) {
    if (CHANNEL_OF[user.role] && sale.channel !== CHANNEL_OF[user.role]) throw forbidden();
    if (user.role === 'dispatch' && sale.status === 'Completed') throw forbidden();
  }

  async function load(id) {
    const sale = await db.get(`SELECT s.*, (s.total_amount - s.amount_received) AS balance, u.name AS salesperson_name, cb.name AS created_by_name, c.code AS customer_code
      FROM sales s JOIN users u ON u.id = s.salesperson_id JOIN users cb ON cb.id = s.created_by
      LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`, [id]);
    if (!sale) return null;
    delete sale.request_key;
    sale.items = await db.all(`SELECT i.id, i.book_id, i.qty, i.unit_price, i.line_total, b.name AS book_name, b.sku
      FROM sale_items i JOIN books b ON b.id = i.book_id WHERE i.sale_id = ? ORDER BY i.id`, [id]);
    sale.imported = !!sale.import_ref;
    sale.payments = await db.all(`SELECT p.id, p.amount, p.method, p.paid_on, p.note, p.created_at, u.name AS user_name
      FROM payments p JOIN users u ON u.id = p.user_id WHERE p.sale_id = ? ORDER BY p.paid_on, p.id`, [id]);
    return sale;
  }

  app.get('/api/sales', perm('sales'), async (req, res) => {
    const q = req.query; const where = []; const p = {};
    scope(req.user, where, p);
    if (q.channel) { where.push('s.channel = @channel'); p.channel = oneOf(q.channel, CHANNELS, { name: 'Channel' }); }
    if (q.status === 'open') where.push(`s.status IN ('Confirmed','Packing','Ready to Dispatch')`);
    else if (q.status) { where.push('s.status = @status'); p.status = oneOf(q.status, STATUSES, { name: 'Status' }); }
    else where.push(`s.status <> 'Cancelled'`);
    if (q.payment_status === 'outstanding') where.push(`s.amount_received < s.total_amount AND s.status <> 'Cancelled'`);
    else if (q.payment_status === 'overdue') { where.push(`s.amount_received < s.total_amount AND s.status <> 'Cancelled' AND s.due_date < @today`); p.today = today(); }
    else if (q.payment_status) { where.push('s.payment_status = @ps'); p.ps = oneOf(q.payment_status, PAY_STATUSES, { name: 'Payment status' }); }
    if (q.salesperson) { where.push('s.salesperson_id = @sp'); p.sp = idParam(q.salesperson); }
    if (q.customer_id) { where.push('s.customer_id = @cust'); p.cust = idParam(q.customer_id); }
    if (q.book_id) { where.push('EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.book_id = @book)'); p.book = idParam(q.book_id); }
    if (q.date_from) { if (!isValidDate(q.date_from)) throw bad('From date is not valid'); where.push('s.sale_date >= @from'); p.from = q.date_from; }
    if (q.date_to) { if (!isValidDate(q.date_to)) throw bad('To date is not valid'); where.push('s.sale_date <= @to'); p.to = q.date_to; }
    if (q.q) {
      const digits = phoneKey(q.q);
      p.q = '%' + String(q.q).replace(/[%_\\]/g, '\\$&') + '%';
      p.digits = digits.length >= 3 ? '%' + digits + '%' : null;
      where.push(`(s.customer_name ILIKE @q OR s.sale_no ILIKE @q OR s.platform_order_id ILIKE @q OR s.import_ref ILIKE @q OR s.location_name ILIKE @q
        OR (@digits::text IS NOT NULL AND regexp_replace(COALESCE(s.customer_phone,''), '[^0-9]', '', 'g') LIKE @digits))`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await db.all(`SELECT ${LIST} FROM sales s JOIN users u ON u.id = s.salesperson_id ${w} ORDER BY s.sale_date DESC, s.id DESC LIMIT 501`, p);
    const totals = await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS amount, COALESCE(SUM(s.amount_received),0) AS received,
        COALESCE(SUM(s.total_amount - s.amount_received),0) AS balance FROM sales s ${w}`, p);
    res.json({ rows: rows.slice(0, 500), truncated: rows.length > 500, totals });
  });

  app.get('/api/sales/:id', perm('sales'), async (req, res) => {
    const sale = await load(idParam(req.params.id));
    if (!sale) throw notFound('Sale');
    assertCanSee(req.user, sale);
    sale.stock = await db.all(`SELECT m.at, m.type, m.qty, b.name AS book_name, u.name AS user_name FROM stock_movements m
      JOIN books b ON b.id = m.book_id LEFT JOIN users u ON u.id = m.user_id WHERE m.sale_id = ? ORDER BY m.id`, [sale.id]);
    sale.history = await history(db, 'sale', sale.id);
    res.json(sale);
  });

  // ── Record a payment against an order ────────────────────────────────────
  app.post('/api/sales/:id/payments', perm('sales'), async (req, res) => {
    const b = req.body;
    const amount = money(b.amount, { required: true, name: 'Amount' });
    if (amount < 1) throw bad('Amount must be at least ₹1', { field: 'Amount' });
    const method = oneOf(b.method, (await getLists(db)).payment_methods.filter(m => m !== 'COD'), { required: true, name: 'Payment method' });
    const paidOn = date(b.paid_on, { name: 'Payment date' }) || today();
    if (paidOn > today()) throw bad('The payment date cannot be in the future', { field: 'Payment date' });
    const note = str(b.note, { name: 'Note', max: 300 });
    const id = idParam(req.params.id);
    await db.tx(async t => {
      const s = await t.get('SELECT * FROM sales WHERE id = ? FOR UPDATE', [id]);
      if (!s) throw notFound('Sale');
      assertCanSee(req.user, s);
      if (s.status === 'Cancelled') throw unprocessable('This order is cancelled, so no payment can be recorded');
      const balance = s.total_amount - s.amount_received;
      if (amount > balance) throw bad(balance ? `Only ${inr(balance)} is outstanding on this order` : 'This order is already fully paid', { field: 'Amount' });
      const received = s.amount_received + amount;
      const ps = paymentStatus(s.total_amount, received, s.payment_method);
      const upd = await t.run('UPDATE sales SET amount_received = ?, payment_status = ?, updated_at = now_iso() WHERE id = ? AND amount_received = ?', [received, ps, id, s.amount_received]);
      if (!upd.rowCount) throw unprocessable('Another payment was recorded on this order just now. Reload and check the balance.');
      await t.run('INSERT INTO payments (sale_id, amount, method, paid_on, note, user_id) VALUES (?,?,?,?,?,?)', [id, amount, method, paidOn, note, req.user.id]);
      await audit(t, req.user, 'sale', id, 'payment_recorded', { amount_received: s.amount_received, payment_status: s.payment_status }, { amount_received: received, payment_status: ps });
    });
    res.status(201).json(await load(id));
  });

  // ── Move an order through packing and dispatch ───────────────────────────
  app.post('/api/sales/:id/status', perm('dispatch'), async (req, res) => {
    const to = oneOf(req.body.status, FLOW, { required: true, name: 'Status' });
    const id = idParam(req.params.id);
    await db.tx(async t => {
      const s = await t.get('SELECT * FROM sales WHERE id = ? FOR UPDATE', [id]);
      if (!s) throw notFound('Sale');
      const from = FLOW.indexOf(s.status), target = FLOW.indexOf(to);
      if (from === -1) throw unprocessable(`This sale is ${s.status}, so its status cannot be changed`);
      if (s.import_ref) throw unprocessable('This order was brought in from the old order sheet and is kept as history');
      if (target === from) return; // already there (repeat click)
      const DISPATCHED = FLOW.indexOf('Dispatched');
      if (target < from && from >= DISPATCHED) throw unprocessable('A dispatched order cannot go back. Record returned books under Inventory instead.');
      // Claim the change first: if someone else moved the order in the meantime, nothing below runs twice.
      const claimed = await t.run('UPDATE sales SET status = ?, updated_at = now_iso() WHERE id = ? AND status = ?', [to, id, s.status]);
      if (!claimed.rowCount) return;
      await audit(t, req.user, 'sale', id, 'status_changed', { status: s.status }, { status: to });
      if (target >= DISPATCHED && from < DISPATCHED) {
        // Rule: physical stock is deducted on dispatch (and the reservation is used up).
        const items = await saleStock(t, id);
        for (const it of items) await moveStock(t, { bookId: it.book_id, type: 'Stock dispatched', qty: it.qty, saleId: id, user: req.user });
      }

    });
    res.json(await load(id));
  });

  // ── Cancel an order that has not been dispatched: its reserved stock is released ──
  app.post('/api/sales/:id/cancel', perm('sales'), async (req, res) => {
    const reason = str(req.body.reason, { required: true, name: 'Reason', max: 300 });
    const id = idParam(req.params.id);
    await db.tx(async t => {
      const s = await t.get('SELECT * FROM sales WHERE id = ? FOR UPDATE', [id]);
      if (!s) throw notFound('Sale');
      assertCanSee(req.user, s);
      if (s.status === 'Cancelled') return;
      if (s.import_ref) throw unprocessable('This order was brought in from the old order sheet and is kept as history');
      if (!['Confirmed', 'Packing', 'Ready to Dispatch'].includes(s.status)) {
        throw unprocessable(`This sale is ${s.status}: the books have already left stock. Record returned books under Inventory instead.`);
      }
      const claimed = await t.run(`UPDATE sales SET status = 'Cancelled', cancel_reason = ?, updated_at = now_iso() WHERE id = ? AND status = ?`, [reason, id, s.status]);
      if (!claimed.rowCount) return;
      const items = await saleStock(t, id);
      for (const it of items) await moveStock(t, { bookId: it.book_id, type: 'Reservation released', qty: it.qty, saleId: id, user: req.user, note: 'Order cancelled' });
      await audit(t, req.user, 'sale', id, 'cancelled', { status: s.status }, { status: 'Cancelled' }, reason);
    });
    res.json(await load(id));
  });

  require('./sales-create')(app, { db, load, perm });
};
module.exports.paymentStatus = paymentStatus;
module.exports.CHANNELS = CHANNELS;
module.exports.METHODS = METHODS;
