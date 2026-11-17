'use strict';
// Corrections by the Admin: change a saved sale, change or remove a payment, remove a call, change or remove a visit.
// Every correction needs a reason and is written to the history with the old and new values.
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { moveStock, saleStock } = require('../stock');
const { findOrCreateCustomer } = require('./customers');
const { getLists } = require('../settings');
const { bad, notFound, unprocessable, str, int, money, date, oneOf, idParam, today, inr } = require('../util');

const OPEN = ['Confirmed', 'Packing', 'Ready to Dispatch'];

module.exports = (app, { db }) => {
  const { paymentStatus } = require('./sales');

  // ── Change a saved sale ──────────────────────────────────────────────────
  app.patch('/api/sales/:id', requireRole('admin'), async (req, res) => {
    const b = req.body; const id = idParam(req.params.id);
    const reason = str(b.reason, { required: true, name: 'Reason', max: 300 });
    const sale = await db.get('SELECT * FROM sales WHERE id = ?', [id]);
    if (!sale) throw notFound('Sale');
    if (sale.status === 'Cancelled') throw unprocessable('A cancelled sale cannot be changed');
    const lists = await getLists(db);
    const oldItems = await db.all('SELECT book_id, qty, unit_price FROM sale_items WHERE sale_id = ? ORDER BY id', [id]);
    const next = { sale_date: sale.sale_date, salesperson_id: sale.salesperson_id, customer_name: sale.customer_name, customer_phone: sale.customer_phone, address: sale.address,
      payment_method: sale.payment_method, due_date: sale.due_date, remarks: sale.remarks, platform_order_id: sale.platform_order_id };
    if (b.sale_date !== undefined) { next.sale_date = date(b.sale_date, { required: true, name: 'Sales date' }); if (next.sale_date > today()) throw bad('The sales date cannot be in the future', { field: 'Sales date' }); }
    if (b.salesperson_id !== undefined) {
      const sp = await db.get(`SELECT id FROM users WHERE id = ? AND role <> 'dispatch'`, [idParam(b.salesperson_id)]);
      if (!sp) throw bad('Sales person not found', { field: 'Sales person' });
      next.salesperson_id = sp.id;
    }
    if (b.customer_name !== undefined) next.customer_name = str(b.customer_name, { required: true, name: 'Customer name', max: 150 });
    if (b.customer_phone !== undefined) next.customer_phone = str(b.customer_phone, { name: 'Customer contact number', max: 30, required: sale.channel === 'Tele-sales' });
    if (b.address !== undefined) next.address = str(b.address, { name: 'Address', max: 500 });
    if (b.payment_method !== undefined) next.payment_method = oneOf(b.payment_method, lists.payment_methods, { name: 'Payment method' });
    if (b.due_date !== undefined) next.due_date = date(b.due_date, { name: 'Due date' });
    if (b.remarks !== undefined) next.remarks = str(b.remarks, { name: 'Remarks', max: 1000 });
    if (b.platform_order_id !== undefined && sale.channel === 'Online') next.platform_order_id = str(b.platform_order_id, { required: true, name: 'Order ID', max: 80 });

    // Books: the same rules as a new sale. A book that is now inactive may stay if it was already on the sale.
    let items = null;
    if (b.items !== undefined) {
      if (!Array.isArray(b.items) || !b.items.length) throw bad('A sale needs at least one book', { field: 'Books' });
      items = b.items.map((it, n) => ({ book_id: int(it && it.book_id, { required: true, min: 1, name: `Book on line ${n + 1}` }), qty: int(it && it.qty, { required: true, min: 1, max: 100000, name: `Quantity on line ${n + 1}` }),
        unit_price: money(it && it.unit_price, { required: true, name: `Unit price on line ${n + 1}`, max: 1000000 }) }));
      if (new Set(items.map(i => i.book_id)).size !== items.length) throw bad('The same book is on two lines. Put it on one line with the full quantity.', { field: 'Books' });
      const books = await db.all('SELECT id, name, active FROM books WHERE id = ANY(?::int[])', [items.map(i => i.book_id)]);
      for (const it of items) {
        const bk = books.find(x => x.id === it.book_id);
        if (!bk) throw bad('A selected book is not in the Book Master', { field: 'Books' });
        if (!bk.active && !oldItems.some(o => o.book_id === bk.id)) throw bad(`"${bk.name}" is inactive and cannot be added`, { field: 'Books' });
      }
      if (JSON.stringify(items) === JSON.stringify(oldItems)) items = null; // nothing changed
    }
    const total = items ? items.reduce((s, i) => s + i.qty * i.unit_price, 0) : sale.total_amount;
    if (total < sale.amount_received) throw bad(`${inr(sale.amount_received)} has already been received on this sale, more than the new total of ${inr(total)}. Change or remove a payment first.`, { field: 'Books' });

    await db.tx(async t => {
      const cur = await t.get('SELECT status, amount_received FROM sales WHERE id = ? FOR UPDATE', [id]);
      if (cur.status !== sale.status || cur.amount_received !== sale.amount_received) throw unprocessable('This sale was changed by someone else just now. Open it again and repeat the change.');
      if (items) {
        // Take the old books out of the stock figures and put the new ones in, the way this sale's stage treats stock.
        // An order imported from the old sheet never touched stock, so it still does not.
        const moves = sale.import_ref ? null : OPEN.includes(sale.status) ? ['Reservation released', 'Stock reserved'] : sale.status === 'Completed' ? ['Stock returned', 'Onsite sale'] : ['Stock returned', 'Stock issued'];
        if (moves) for (const o of await saleStock(t, id)) await moveStock(t, { bookId: o.book_id, type: moves[0], qty: o.qty, saleId: id, user: req.user, note: 'Sale changed: old books taken off' });
        await t.run('DELETE FROM sale_items WHERE sale_id = ?', [id]);
        for (const it of items) await t.run('INSERT INTO sale_items (sale_id, book_id, qty, unit_price, line_total) VALUES (?,?,?,?,?)', [id, it.book_id, it.qty, it.unit_price, it.qty * it.unit_price]);
        if (moves) for (const n of await saleStock(t, id)) await moveStock(t, { bookId: n.book_id, type: moves[1], qty: n.qty, saleId: id, user: req.user, note: 'Sale changed: new books put on' });
      }
      // A changed contact number moves the sale to that customer (not for onsite sales, which belong to the place).
      let customerId = sale.customer_id;
      if (sale.channel !== 'Onsite' && next.customer_phone !== sale.customer_phone) {
        customerId = next.customer_phone ? (await findOrCreateCustomer(t, { name: next.customer_name, phone: next.customer_phone, address: next.address })).id : null;
      }
      await t.run(`UPDATE sales SET sale_date = ?, salesperson_id = ?, customer_id = ?, customer_name = ?, customer_phone = ?, address = ?, payment_method = ?, due_date = ?, remarks = ?, platform_order_id = ?,
          total_amount = ?, payment_status = ?, updated_at = now_iso() WHERE id = ?`,
      [next.sale_date, next.salesperson_id, customerId, next.customer_name, next.customer_phone, next.address, next.payment_method, next.due_date, next.remarks, next.platform_order_id,
        total, paymentStatus(total, sale.amount_received, next.payment_method), id]);
      const was = { ...Object.fromEntries(Object.keys(next).map(k => [k, sale[k]])), total_amount: sale.total_amount };
      const now = { ...next, total_amount: total };
      if (items) {
        const names = Object.fromEntries((await t.all('SELECT id, name FROM books WHERE id = ANY(?::int[])', [[...oldItems, ...items].map(i => i.book_id)])).map(r => [r.id, r.name]));
        const show = list => list.map(i => `${names[i.book_id]} × ${i.qty} at ₹${i.unit_price}`).join('; ');
        was.books = show(oldItems); now.books = show(items);
      }
      await audit(t, req.user, 'sale', id, 'changed', was, now, reason);
    });
    res.json({ ok: true, id });
  });

  // ── Change or remove a payment ───────────────────────────────────────────
  async function resum(t, saleId) {
    const s = await t.get('SELECT total_amount, payment_method FROM sales WHERE id = ? FOR UPDATE', [saleId]);
    const { got } = await t.get('SELECT COALESCE(SUM(amount),0) AS got FROM payments WHERE sale_id = ?', [saleId]);
    if (got > s.total_amount) throw bad(`That would make the payments ${inr(got)}, more than the sale total of ${inr(s.total_amount)}`, { field: 'Amount' });
    await t.run('UPDATE sales SET amount_received = ?, payment_status = ?, updated_at = now_iso() WHERE id = ?', [got, paymentStatus(s.total_amount, got, s.payment_method), saleId]);
  }
  app.patch('/api/payments/:id', requireRole('admin'), async (req, res) => {
    const b = req.body; const before = await db.get('SELECT id, sale_id, amount, method, paid_on, note FROM payments WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Payment');
    const reason = str(b.reason, { required: true, name: 'Reason', max: 300 });
    const next = { ...before };
    if (b.amount !== undefined) { next.amount = money(b.amount, { required: true, name: 'Amount' }); if (next.amount < 1) throw bad('Amount must be at least ₹1', { field: 'Amount' }); }
    if (b.method !== undefined) next.method = oneOf(b.method, (await getLists(db)).payment_methods.filter(m => m !== 'COD'), { required: true, name: 'Payment method' });
    if (b.paid_on !== undefined) { next.paid_on = date(b.paid_on, { required: true, name: 'Payment date' }); if (next.paid_on > today()) throw bad('The payment date cannot be in the future', { field: 'Payment date' }); }
    if (b.note !== undefined) next.note = str(b.note, { name: 'Note', max: 300 });
    await db.tx(async t => {
      await t.run('UPDATE payments SET amount = ?, method = ?, paid_on = ?, note = ? WHERE id = ?', [next.amount, next.method, next.paid_on, next.note, before.id]);
      await resum(t, before.sale_id);
      await audit(t, req.user, 'sale', before.sale_id, 'payment_changed', before, next, reason);
    });
    res.json({ ok: true, sale_id: before.sale_id });
  });
  app.delete('/api/payments/:id', requireRole('admin'), async (req, res) => {
    const before = await db.get('SELECT id, sale_id, amount, method, paid_on, note FROM payments WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Payment');
    const reason = str(req.body.reason, { required: true, name: 'Reason', max: 300 });
    await db.tx(async t => {
      await t.run('DELETE FROM payments WHERE id = ?', [before.id]);
      await resum(t, before.sale_id);
      await audit(t, req.user, 'sale', before.sale_id, 'payment_removed', before, null, reason);
    });
    res.json({ ok: true, sale_id: before.sale_id });
  });

  // ── Remove a call logged by mistake (changing one is PATCH /api/calls/:id) ─
  app.delete('/api/calls/:id', requireRole('admin'), async (req, res) => {
    const before = await db.get('SELECT * FROM calls WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Call');
    const reason = str(req.body.reason, { required: true, name: 'Reason', max: 300 });
    await db.tx(async t => {
      await t.run('UPDATE calls SET followup_done_by = NULL WHERE followup_done_by = ?', [before.id]); // follow-ups it had completed are waiting again
      await t.run('DELETE FROM calls WHERE id = ?', [before.id]);
      await audit(t, req.user, 'call', before.id, 'removed', { call_no: before.call_no, called_at: before.called_at, customer_id: before.customer_id, status: before.status, outcome: before.outcome, remarks: before.remarks }, null, reason);
    });
    res.json({ ok: true });
  });

  // ── Change or remove a visit ─────────────────────────────────────────────
  app.patch('/api/visits/:id', requireRole('admin'), async (req, res) => {
    const b = req.body; const before = await db.get('SELECT id, visit_date, outcome, remarks, next_visit_date, contact_person, sale_id, next_visit_done_by FROM visits WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Visit');
    const reason = str(b.reason, { required: true, name: 'Reason', max: 300 });
    const next = { ...before };
    if (b.visit_date !== undefined) { next.visit_date = date(b.visit_date, { required: true, name: 'Visit date' }); if (next.visit_date > today()) throw bad('The visit date cannot be in the future', { field: 'Visit date' }); }
    if (b.outcome !== undefined && !before.sale_id) next.outcome = oneOf(b.outcome, ['No sale', 'Payment collected'], { required: true, name: 'Result' });
    if (b.remarks !== undefined) next.remarks = str(b.remarks, { name: 'Remarks', max: 1000 });
    if (b.contact_person !== undefined) next.contact_person = str(b.contact_person, { name: 'Contact person', max: 100 });
    if (b.next_visit_date !== undefined) { next.next_visit_date = date(b.next_visit_date, { name: 'Next visit date' }); if (next.next_visit_date !== before.next_visit_date) next.next_visit_done_by = null; }
    await db.tx(async t => {
      await t.run('UPDATE visits SET visit_date = ?, outcome = ?, remarks = ?, contact_person = ?, next_visit_date = ?, next_visit_done_by = ? WHERE id = ?',
        [next.visit_date, next.outcome, next.remarks, next.contact_person, next.next_visit_date, next.next_visit_done_by, before.id]);
      await audit(t, req.user, 'visit', before.id, 'changed', before, next, reason);
    });
    res.json({ ok: true });
  });
  app.delete('/api/visits/:id', requireRole('admin'), async (req, res) => {
    const before = await db.get('SELECT * FROM visits WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Visit');
    const reason = str(req.body.reason, { required: true, name: 'Reason', max: 300 });
    if (before.sale_id) throw unprocessable('This visit has a sale. Cancel or change the sale instead; the visit stays as its record.');
    await db.tx(async t => {
      await t.run('UPDATE visits SET next_visit_done_by = NULL WHERE next_visit_done_by = ?', [before.id]);
      await t.run('DELETE FROM visits WHERE id = ?', [before.id]);
      await audit(t, req.user, 'visit', before.id, 'removed', { visit_no: before.visit_no, visit_date: before.visit_date, location_name: before.location_name, outcome: before.outcome, remarks: before.remarks }, null, reason);
    });
    res.json({ ok: true });
  });
};
