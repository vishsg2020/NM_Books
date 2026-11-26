'use strict';
const { CHANNEL_OF } = require('../auth');
const { today, thisMonth } = require('../util');

// Figures come straight from the sales, payment and stock records. Cancelled orders never count.
module.exports = (app, { db, perm }) => {
  app.get('/api/dashboard', perm('dashboard'), async (req, res) => {
    const me = req.user; const day = today(); const month = thisMonth();
    const out = { role: me.role, today: day, month, metrics: {} };
    const m = out.metrics;

    if (['admin', 'manager', 'viewer', 'dispatch'].includes(me.role)) {
      const d = await db.get(`SELECT
          COUNT(*) FILTER (WHERE status = 'Confirmed') AS awaiting_packing,
          COUNT(*) FILTER (WHERE status = 'Packing') AS packing,
          COUNT(*) FILTER (WHERE status = 'Ready to Dispatch') AS ready,
          COUNT(*) FILTER (WHERE status = 'Dispatched') AS dispatched
        FROM sales`);
      Object.assign(m, d, { pending_dispatch: d.awaiting_packing + d.packing + d.ready });
      out.low_stock = await db.all(`SELECT id, sku, name, on_hand, reserved, (on_hand - reserved) AS available, min_stock
        FROM books WHERE active = 1 AND kind = 'Book' AND (on_hand - reserved) <= min_stock ORDER BY (on_hand - reserved) - min_stock, name LIMIT 20`);
      m.low_stock = (await db.get(`SELECT COUNT(*) n FROM books WHERE active = 1 AND kind = 'Book' AND (on_hand - reserved) <= min_stock`)).n;
    }
    if (me.role === 'dispatch') return res.json(out);

    // Channel roles see their own figures; Admin and Manager see the whole business.
    const mine = !!CHANNEL_OF[me.role];
    const w = mine ? 'AND s.salesperson_id = @me' : '';
    const p = { day, month: month + '%', me: me.id };
    Object.assign(m, await db.get(`SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE sale_date = @day),0) AS sales_today,
        COUNT(*) FILTER (WHERE sale_date = @day) AS orders_today,
        COALESCE(SUM(total_amount) FILTER (WHERE sale_date LIKE @month),0) AS sales_month,
        COUNT(*) FILTER (WHERE sale_date LIKE @month) AS orders_month,
        COALESCE(SUM(total_amount - amount_received),0) AS outstanding,
        COUNT(*) FILTER (WHERE amount_received < total_amount) AS outstanding_orders,
        COUNT(*) FILTER (WHERE amount_received < total_amount AND due_date < @day) AS overdue_orders
      FROM sales s WHERE s.status <> 'Cancelled' ${w}`, p));
    Object.assign(m, await db.get(`SELECT COALESCE(SUM(i.qty),0) AS books_month FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE s.status <> 'Cancelled' AND s.sale_date LIKE @month ${w}`, p));
    Object.assign(m, await db.get(`SELECT COALESCE(SUM(pm.amount),0) AS collected_month FROM payments pm JOIN sales s ON s.id = pm.sale_id
      WHERE s.status <> 'Cancelled' AND pm.paid_on LIKE @month ${w}`, p));
    if (!mine) {
      out.channels = await db.all(`SELECT c.channel, COUNT(s.id) AS orders, COALESCE(SUM(s.total_amount),0) AS amount
        FROM (VALUES ('Tele-sales'),('Online'),('Onsite')) c(channel)
        LEFT JOIN sales s ON s.channel = c.channel AND s.status <> 'Cancelled' AND s.sale_date LIKE ?
        GROUP BY c.channel ORDER BY c.channel DESC`, [month + '%']);
      m.customers = (await db.get(`SELECT COUNT(*) n FROM customers WHERE kind = 'Customer'`)).n;
    }
    out.recent = await db.all(`SELECT s.id, s.sale_no, s.sale_date, s.channel, s.customer_name, s.total_amount, s.payment_status, s.status, u.name AS salesperson_name
      FROM sales s JOIN users u ON u.id = s.salesperson_id WHERE s.status <> 'Cancelled' ${w} ORDER BY s.id DESC LIMIT 8`, mine ? { me: me.id } : {});
    res.json(out);
  });
};
