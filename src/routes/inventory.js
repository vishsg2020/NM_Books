'use strict';
const { requireRole } = require('../auth');
const { moveStock } = require('../stock');
const { bad, notFound, str, int, oneOf, isValidDate, idParam } = require('../util');

// Movements a person records by hand. Reservations, dispatches and onsite sales come from orders.
const MANUAL = ['Stock received', 'Stock issued', 'Stock returned', 'Damaged stock', 'Stock adjustment'];
const NEEDS_NOTE = ['Stock issued', 'Damaged stock', 'Stock adjustment'];
const ALL_TYPES = ['Opening stock', 'Stock received', 'Stock issued', 'Stock reserved', 'Reservation released', 'Stock dispatched',
  'Onsite sale', 'Stock returned', 'Damaged stock', 'Stock adjustment'];

module.exports = (app, { db }) => {
  // Stock movement history, newest first.
  app.get('/api/inventory/movements', requireRole('admin', 'manager'), async (req, res) => {
    const q = req.query; const where = []; const p = {};
    if (q.book_id) { where.push('m.book_id = @book'); p.book = idParam(q.book_id); }
    if (q.type) { where.push('m.type = @type'); p.type = oneOf(q.type, ALL_TYPES, { name: 'Type' }); }
    if (q.date_from) { if (!isValidDate(q.date_from)) throw bad('From date is not valid'); where.push(`(m.at::timestamptz AT TIME ZONE 'Asia/Kolkata')::date >= @from::date`); p.from = q.date_from; }
    if (q.date_to) { if (!isValidDate(q.date_to)) throw bad('To date is not valid'); where.push(`(m.at::timestamptz AT TIME ZONE 'Asia/Kolkata')::date <= @to::date`); p.to = q.date_to; }
    const rows = await db.all(`SELECT m.*, b.name AS book_name, b.sku, u.name AS user_name, s.sale_no
      FROM stock_movements m JOIN books b ON b.id = m.book_id
      LEFT JOIN users u ON u.id = m.user_id LEFT JOIN sales s ON s.id = m.sale_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 501`, p);
    res.json({ rows: rows.slice(0, 500), truncated: rows.length > 500 });
  });

  app.post('/api/inventory/movements', requireRole('admin'), async (req, res) => {
    const b = req.body;
    const bookId = int(b.book_id, { required: true, min: 1, name: 'Book' });
    const type = oneOf(b.type, MANUAL, { required: true, name: 'Movement type' });
    const qty = int(b.qty, { required: true, min: 1, max: 1000000, name: 'Quantity' });
    const note = str(b.note, { name: 'Note', max: 500, required: NEEDS_NOTE.includes(type) });
    let direction = 1;
    if (type === 'Stock adjustment') direction = oneOf(b.direction, ['add', 'remove'], { required: true, name: 'Adjustment direction' }) === 'remove' ? -1 : 1;
    // A return may point at the order it came from.
    let saleId = null;
    const saleNo = str(b.sale_no, { name: 'Order number', max: 20 });
    if (saleNo) {
      if (type !== 'Stock returned') throw bad('An order number can only be given for returned stock');
      const sale = await db.get(`SELECT s.id, (SELECT qty FROM sale_items i WHERE i.sale_id = s.id AND i.book_id = ?) AS qty FROM sales s WHERE lower(s.sale_no) = lower(?)`, [bookId, saleNo]);
      if (!sale) throw notFound('Order ' + saleNo);
      if (!sale.qty) throw bad(`Order ${saleNo} does not include this book`, { field: 'Order number' });
      saleId = sale.id;
    }
    const after = await db.tx(t => moveStock(t, { bookId, type, qty, note, saleId, user: req.user, direction }));
    res.status(201).json(after);
  });
};
