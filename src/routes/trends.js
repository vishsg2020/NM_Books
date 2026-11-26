'use strict';
// Manager dashboard charts (BA section 11): sales over time and by channel, product, sales person,
// district and payment method. Everything is calculated from the sales records; cancelled orders never count.
const { bad, oneOf, idParam, isValidDate } = require('../util');

const PERIOD = {
  day: 's.sale_date',
  week: `to_char(date_trunc('week', s.sale_date::date), 'YYYY-MM-DD')`, // the Monday that starts the week
  month: 'substr(s.sale_date, 1, 7)',
};

module.exports = (app, { db, perm }) => {
  app.get('/api/dashboard/trends', perm('reports'), async (req, res) => {
    const q = req.query; const where = [`s.status <> 'Cancelled'`]; const p = {};
    if (q.date_from) { if (!isValidDate(q.date_from)) throw bad('From date is not valid'); where.push('s.sale_date >= @from'); p.from = q.date_from; }
    if (q.date_to) { if (!isValidDate(q.date_to)) throw bad('To date is not valid'); where.push('s.sale_date <= @to'); p.to = q.date_to; }
    if (q.channel) { where.push('s.channel = @channel'); p.channel = oneOf(q.channel, ['Tele-sales', 'Online', 'Onsite'], { name: 'Channel' }); }
    if (q.salesperson) { where.push('s.salesperson_id = @sp'); p.sp = idParam(q.salesperson); }
    if (q.book_id) { where.push('EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = s.id AND x.book_id = @book)'); p.book = idParam(q.book_id); }
    const w = 'WHERE ' + where.join(' AND ');

    const totals = await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS amount, COALESCE(SUM(s.amount_received),0) AS received,
        COALESCE(SUM(s.total_amount - s.amount_received),0) AS outstanding, COUNT(DISTINCT s.customer_id) AS customers,
        MIN(s.sale_date) AS first_date, MAX(s.sale_date) AS last_date,
        COALESCE((SELECT SUM(i.qty) FROM sale_items i JOIN sales s ON s.id = i.sale_id ${w}),0) AS lines
      FROM sales s ${w}`, p);
    // Group by day, week or month. "auto" picks the one that gives a readable number of bars.
    let group = oneOf(q.group, ['auto', 'day', 'week', 'month'], { name: 'Group by' }) || 'auto';
    if (group === 'auto') {
      const days = totals.first_date ? (Date.parse(q.date_to || totals.last_date) - Date.parse(q.date_from || totals.first_date)) / 864e5 + 1 : 0;
      group = days <= 45 ? 'day' : days <= 190 ? 'week' : 'month';
    }
    const series = await db.all(`SELECT ${PERIOD[group]} AS period, COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS amount
      FROM sales s ${w} GROUP BY 1 ORDER BY 1`, p);
    const byChannel = await db.all(`SELECT s.channel AS label, COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS amount FROM sales s ${w} GROUP BY 1 ORDER BY amount DESC`, p);
    const byProduct = await db.all(`SELECT b.id, b.name AS label, COUNT(DISTINCT s.id) AS orders, SUM(i.qty) AS qty, SUM(i.line_total) AS amount
      FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN books b ON b.id = i.book_id ${w} GROUP BY b.id, b.name ORDER BY amount DESC, orders DESC LIMIT 12`, p);
    const byPerson = await db.all(`SELECT u.id, u.name AS label, COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS amount
      FROM sales s JOIN users u ON u.id = s.salesperson_id ${w} GROUP BY u.id, u.name ORDER BY amount DESC LIMIT 12`, p);
    const byLocation = await db.all(`SELECT COALESCE(c.location, 'Not recorded') AS label, COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS amount
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${w} GROUP BY 1 ORDER BY amount DESC LIMIT 14`, p);
    const byPayment = await db.all(`SELECT CASE WHEN s.payment_method = 'COD' THEN 'COD' ELSE 'Paid online or at sale' END AS label, COUNT(*) AS orders, COALESCE(SUM(s.total_amount),0) AS amount
      FROM sales s ${w} GROUP BY 1 ORDER BY amount DESC`, p);
    // New customers: first ever order falls in the period. Repeat: ordered before as well.
    const cust = await db.get(`SELECT COUNT(*) FILTER (WHERE f.first_date >= COALESCE(@cfrom, '0000')) AS new_customers, COUNT(*) AS buying
      FROM (SELECT DISTINCT s.customer_id FROM sales s ${w} AND s.customer_id IS NOT NULL) x
      JOIN (SELECT customer_id, MIN(sale_date) AS first_date FROM sales WHERE status <> 'Cancelled' GROUP BY customer_id) f ON f.customer_id = x.customer_id`,
    { ...p, cfrom: q.date_from || null });
    res.json({ group, totals: { ...totals, new_customers: cust.new_customers, repeat_customers: cust.buying - cust.new_customers }, series, byChannel, byProduct, byPerson, byLocation, byPayment });
  });
};
