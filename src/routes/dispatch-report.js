'use strict';
// Daily dispatch report: how many of each book or set went out each day (or month).
// Two sources are added together: the history imported from the old Google Form (dispatch_history), and
// orders moved to "Dispatched" in the app (counted on the day of their first "Stock dispatched" movement).
const { requireRole } = require('../auth');
const { bad, oneOf, isValidDate, today, int, str } = require('../util');
const { audit } = require('../audit');

const TZ = process.env.APP_TZ || 'Asia/Kolkata';
const ROWS = `
  SELECT h.day, h.book_id, h.label, h.qty, h.source AS src FROM dispatch_history h
  UNION ALL
  SELECT d.day, i.book_id, '' AS label, i.qty, 'app' AS src
    FROM sale_items i
    JOIN sales s ON s.id = i.sale_id AND s.status <> 'Cancelled'
    JOIN (SELECT sale_id, MIN(to_char(at::timestamptz AT TIME ZONE '${TZ.replace(/[^A-Za-z_/+-]/g, '')}', 'YYYY-MM-DD')) AS day
            FROM stock_movements WHERE type = 'Stock dispatched' AND sale_id IS NOT NULL GROUP BY sale_id) d ON d.sale_id = i.sale_id`;

module.exports = (app, { db }) => {
  app.get('/api/dispatch-report', requireRole('admin', 'manager', 'dispatch'), async (req, res) => {
    const q = req.query; const where = []; const p = {};
    if (q.date_from) { if (!isValidDate(q.date_from)) throw bad('From date is not valid'); where.push('x.day >= @from'); p.from = q.date_from; }
    if (q.date_to) { if (!isValidDate(q.date_to)) throw bad('To date is not valid'); where.push('x.day <= @to'); p.to = q.date_to; }
    const group = oneOf(q.group, ['day', 'month'], { name: 'Group by' }) || 'day';
    const period = group === 'month' ? 'substr(x.day, 1, 7)' : 'x.day';
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const data = await db.all(`SELECT ${period} AS period, x.book_id, x.label, SUM(x.qty) AS qty FROM (${ROWS}) x ${w} GROUP BY 1, 2, 3 ORDER BY 1 DESC`, p);
    const src = await db.all(`SELECT x.src, COALESCE(SUM(x.qty),0) AS qty, MIN(x.day) AS first_day, MAX(x.day) AS last_day, COUNT(DISTINCT x.day) AS days FROM (${ROWS}) x ${w} GROUP BY 1`, p);
    const busiest = await db.get(`SELECT x.day, SUM(x.qty) AS qty FROM (${ROWS}) x ${w} GROUP BY 1 ORDER BY 2 DESC, 1 DESC LIMIT 1`, p);
    const days = await db.get(`SELECT COUNT(DISTINCT x.day) AS n FROM (${ROWS}) x ${w}`, p);
    const books = await db.all(`SELECT id, sku, name, kind, category FROM books ORDER BY id`);
    const byId = new Map(books.map(b => [b.id, b]));
    // Columns: every set and every Nalla Malayalam book on its own; single story books together; everything else under Other.
    const colOf = b => (b.sku === 'OTHER' ? 'other' : b.kind === 'Book' && /^kuttivayana/i.test(b.category || '') ? 'singles' : String(b.id));
    const colTotals = {}; const items = new Map(); const periods = new Map(); let total = 0;
    for (const r of data) {
      const b = byId.get(r.book_id); const qty = Number(r.qty); const col = colOf(b);
      if (!periods.has(r.period)) periods.set(r.period, { period: r.period, total: 0, cols: {}, detail: [] });
      const row = periods.get(r.period); row.total += qty; row.cols[col] = (row.cols[col] || 0) + qty;
      const name = r.label || b.name;
      if (col === 'singles' || col === 'other') row.detail.push({ col, name, qty });
      colTotals[col] = (colTotals[col] || 0) + qty; total += qty;
      const k = r.label ? 'L:' + r.label.toLowerCase() : 'B:' + b.id;
      const it = items.get(k) || { name, set: b.kind === 'Pack', qty: 0 }; it.qty += qty; items.set(k, it);
    }
    const columns = Object.keys(colTotals).filter(c => c !== 'singles' && c !== 'other').sort((a, b) => colTotals[b] - colTotals[a])
      .map(c => ({ key: c, label: byId.get(Number(c)).name }));
    if (colTotals.singles) columns.push({ key: 'singles', label: 'Single story books' });
    if (colTotals.other) columns.push({ key: 'other', label: 'Other' });
    res.json({
      group, total, days: Number(days.n), busiest: busiest ? { day: busiest.day, qty: Number(busiest.qty) } : null,
      columns, colTotals, rows: [...periods.values()], items: [...items.values()].sort((a, b) => b.qty - a.qty),
      sources: Object.fromEntries(src.map(s => [s.src, { qty: Number(s.qty), first_day: s.first_day, last_day: s.last_day, days: Number(s.days) }])),
    });
  });

  // ── Daily dispatch report typed in the app (takes the place of the Google Form) ──
  const dayRows = (h, day) => h.all(`SELECT d.book_id, d.label, d.qty, d.source, b.sku FROM dispatch_history d JOIN books b ON b.id = d.book_id WHERE d.day = ? ORDER BY d.id`, [day]);
  const readDay = q => { if (!isValidDate(q)) throw bad('Choose a valid date'); if (q > today()) throw bad('The date cannot be in the future'); return q; };

  app.get('/api/dispatch-report/day', requireRole('admin', 'manager', 'dispatch'), async (req, res) => {
    const day = readDay(req.query.date);
    const rows = await dayRows(db, day);
    const products = await db.all(`SELECT id, name, kind, category FROM books WHERE lower(sku) <> 'other' AND (active = 1 OR id IN (SELECT book_id FROM dispatch_history WHERE day = ?))
      ORDER BY CASE WHEN kind = 'Pack' THEN 0 ELSE 1 END, id`, [day]);
    const fromOrders = await db.get(`SELECT COALESCE(SUM(x.qty),0) AS n FROM (${ROWS}) x WHERE x.day = ? AND x.src = 'app'`, [day]);
    res.json({ date: day, products, exists: rows.length > 0, source: rows[0]?.source || null, from_orders: Number(fromOrders.n),
      items: rows.filter(r => r.sku.toLowerCase() !== 'other').map(r => ({ book_id: r.book_id, qty: r.qty })),
      other: rows.filter(r => r.sku.toLowerCase() === 'other').map(r => ({ label: r.label, qty: r.qty })) });
  });

  // Saves the whole day: what is sent replaces that day's report. Nothing sent removes it. Stock is never changed.
  app.put('/api/dispatch-report/day', requireRole('admin', 'manager', 'dispatch'), async (req, res) => {
    const b = req.body; const day = readDay(b.date);
    const other = await db.get(`SELECT id FROM books WHERE lower(sku) = 'other'`);
    const valid = new Set((await db.all(`SELECT id FROM books WHERE lower(sku) <> 'other'`)).map(r => r.id));
    const rows = new Map();
    for (const it of Array.isArray(b.items) ? b.items : []) {
      const qty = int(it.qty, { min: 0, max: 100000, name: 'Quantity' }) || 0; if (!qty) continue;
      if (!valid.has(Number(it.book_id))) throw bad('A book in this report is not in the Book Master');
      const k = it.book_id + '|'; rows.set(k, { book_id: Number(it.book_id), label: '', qty: (rows.get(k)?.qty || 0) + qty });
    }
    for (const it of Array.isArray(b.other) ? b.other : []) {
      const qty = int(it.qty, { min: 0, max: 100000, name: 'Quantity' }) || 0; const label = str(it.label, { max: 60, name: 'Other item' });
      if (!qty && !label) continue;
      if (!label) throw bad('Give a name for each other item'); if (!qty) throw bad(`Give a quantity for "${label}"`);
      if (!other) throw bad('Other items need the "Other titles" entry in the Book Master');
      const k = 'o|' + label.toLowerCase(); rows.set(k, { book_id: other.id, label, qty: (rows.get(k)?.qty || 0) + qty });
    }
    const before = await dayRows(db, day); const list = [...rows.values()];
    const total = list.reduce((a, r) => a + r.qty, 0); const was = before.reduce((a, r) => a + r.qty, 0);
    await db.tx(async t => {
      await t.run('DELETE FROM dispatch_history WHERE day = ?', [day]);
      for (const r of list) await t.run(`INSERT INTO dispatch_history (day, book_id, label, qty, source, user_id) VALUES (?,?,?,?,'manual',?)`, [day, r.book_id, r.label, r.qty, req.user.id]);
      await audit(t, req.user, 'dispatch_report', null, !list.length ? 'daily_report_removed' : before.length ? 'daily_report_changed' : 'daily_report_added',
        { day, total: was, lines: before.map(r => `${r.label || '#' + r.book_id} ${r.qty}`).join(', ') }, { day, total, lines: list.map(r => `${r.label || '#' + r.book_id} ${r.qty}`).join(', ') });
    });
    res.json({ date: day, total, removed: !list.length });
  });
};
