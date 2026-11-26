'use strict';
// Insights (Tele-sales → Insights): where customers are, when they buy and answer the phone, and how they buy.
// Everything is counted from the sales, customers and calls already in the app.
const { oneOf, idParam, today } = require('../util');

const KD = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod'];
const PLACE = `CASE WHEN c.location IN (${KD.map(d => `'${d}'`).join(', ')}) THEN c.location
  WHEN lower(COALESCE(c.state, '')) = 'kerala' THEN 'Kerala, district not known'
  WHEN c.state IS NOT NULL AND c.state <> '' THEN 'Outside Kerala' ELSE 'Not known' END`;
const RANGES = { '3m': 3, '6m': 6, '12m': 12, all: null };
const SLOTS = [['9–12', 9, 12], ['12–3', 12, 15], ['3–6', 15, 18], ['6–9 pm', 18, 21]];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Days between a customer's first and second order.
const GAPS = [['0–2 wk', 0, 14], ['2–4 wk', 15, 28], ['4–6 wk', 29, 42], ['6–8 wk', 43, 56], ['2–3 mo', 57, 91], ['3–6 mo', 92, 182], ['6+ mo', 183, 100000]];
const MIN_CALLS = 200; // the call grid shows once this many calls are logged in the period
const MIN_CELL = 10;   // a day/time cell needs this many calls to count as "best"

const minusMonths = (d, m) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() - m); return x.toISOString().slice(0, 10); };
const minusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

module.exports = (app, { db, perm }) => {
  app.get('/api/insights', perm('insights'), async (req, res) => {
    const q = req.query; const to = today();
    const range = q.range ? oneOf(String(q.range), Object.keys(RANGES), { name: 'Period' }) : '12m';
    const from = RANGES[range] ? minusDays(minusMonths(to, RANGES[range]), -1) : '1900-01-01';
    const p = { from, to }; const cond = [`s.status <> 'Cancelled'`, 's.sale_date BETWEEN @from AND @to'];
    if (q.channel) { p.channel = oneOf(String(q.channel), ['Tele-sales', 'Online', 'Onsite'], { name: 'Channel' }); cond.push('s.channel = @channel'); }
    if (q.book_id) { p.book = idParam(q.book_id); cond.push('EXISTS (SELECT 1 FROM sale_items i LEFT JOIN pack_items pk ON pk.pack_id = i.book_id WHERE i.sale_id = s.id AND (i.book_id = @book OR pk.book_id = @book))'); }
    const B = `b AS (SELECT s.id, s.customer_id, s.sale_date, s.total_amount, s.payment_method FROM sales s WHERE ${cond.join(' AND ')})`;

    // ── Where ──────────────────────────────────────────────────────────────
    const places = await db.all(`WITH ${B}, per AS (SELECT customer_id, COUNT(*) AS orders, SUM(total_amount) AS amount,
          COUNT(*) FILTER (WHERE payment_method = 'COD') AS cod FROM b WHERE customer_id IS NOT NULL GROUP BY customer_id)
      SELECT ${PLACE} AS place, COUNT(*) AS customers, SUM(per.orders) AS orders, SUM(per.amount) AS amount,
        COUNT(*) FILTER (WHERE per.orders >= 2) AS repeaters, SUM(per.cod) AS cod
      FROM per JOIN customers c ON c.id = per.customer_id GROUP BY 1`, p);
    const sixAgo = minusMonths(to, 6); p.six = sixAgo;
    const dormant = await db.all(`SELECT ${PLACE} AS place, COUNT(*) AS n FROM customers c
      WHERE c.kind = 'Customer' AND (SELECT MAX(s.sale_date) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') < @six GROUP BY 1`, p);
    const tops = await db.all(`WITH ${B} SELECT place, name FROM (SELECT ${PLACE} AS place, bk.name, ROW_NUMBER() OVER (PARTITION BY ${PLACE} ORDER BY SUM(i.qty) DESC) AS rn
        FROM b JOIN customers c ON c.id = b.customer_id JOIN sale_items i ON i.sale_id = b.id JOIN books bk ON bk.id = i.book_id
        WHERE lower(bk.sku) <> 'other' GROUP BY ${PLACE}, bk.name) x WHERE rn = 1`, p);
    const where = places.map(r => ({
      place: r.place, customers: r.customers, orders: Number(r.orders), amount: Number(r.amount), avg_order: r.orders ? Math.round(Number(r.amount) / Number(r.orders)) : 0,
      repeat_pct: pct(r.repeaters, r.customers), cod_pct: pct(Number(r.cod), Number(r.orders)),
      top_book: (tops.find(t => t.place === r.place) || {}).name || null, dormant: (dormant.find(d => d.place === r.place) || {}).n || 0,
      district: KD.includes(r.place),
    })).sort((a, b) => b.customers - a.customers);
    for (const d of dormant) if (!where.some(w => w.place === d.place)) where.push({ place: d.place, customers: 0, orders: 0, amount: 0, avg_order: 0, repeat_pct: 0, cod_pct: 0, top_book: null, dormant: d.n, district: KD.includes(d.place) });

    // ── When: calls answered by day and time ──────────────────────────────
    const calls = await db.all(`SELECT extract(isodow FROM call_date::date)::int AS dow, substr(called_at, 12, 2)::int AS hr, COUNT(*) AS n,
        COUNT(*) FILTER (WHERE status = 'Answered') AS answered, COUNT(*) FILTER (WHERE outcome = 'Sale') AS sales
      FROM calls WHERE call_date BETWEEN @from AND @to GROUP BY 1, 2`, p);
    const totalCalls = calls.reduce((a, r) => a + r.n, 0); const totalAnswered = calls.reduce((a, r) => a + r.answered, 0);
    const grid = SLOTS.map(([label, a, z]) => ({ slot: label, days: DAYS.map((d, i) => {
      const rows = calls.filter(r => r.dow === i + 1 && r.hr >= a && r.hr < z);
      const n = rows.reduce((x, r) => x + r.n, 0); const ans = rows.reduce((x, r) => x + r.answered, 0);
      return { day: d, calls: n, answered_pct: n ? pct(ans, n) : null };
    }) }));
    let bestCall = null;
    if (totalCalls >= MIN_CALLS) {
      const slotRates = grid.map(g => { const n = g.days.reduce((x, d) => x + d.calls, 0); const a = g.days.reduce((x, d) => x + (d.answered_pct || 0) * d.calls / 100, 0); return { slot: g.slot, n, rate: n ? pct(a, n) : 0 }; });
      const slot = slotRates.filter(s => s.n >= MIN_CELL).sort((a, b) => b.rate - a.rate)[0];
      if (slot) {
        const days = grid.find(g => g.slot === slot.slot).days.filter(d => d.calls >= MIN_CELL).sort((a, b) => b.answered_pct - a.answered_pct).slice(0, 3).map(d => d.day);
        bestCall = { slot: slot.slot, days, rate: slot.rate, overall: pct(totalAnswered, totalCalls) };
      }
    }

    // ── When: orders by month and by weekday ──────────────────────────────
    const byMonth = await db.all(`WITH ${B} SELECT extract(month FROM sale_date::date)::int AS m, COUNT(*) AS n FROM b GROUP BY 1`, p);
    const byDay = await db.all(`WITH ${B} SELECT extract(isodow FROM sale_date::date)::int AS d, COUNT(*) AS n FROM b GROUP BY 1`, p);
    const months = MONTHS.map((m, i) => ({ month: m, orders: (byMonth.find(r => r.m === i + 1) || {}).n || 0 }));
    const weekdays = DAYS.map((d, i) => ({ day: d, orders: (byDay.find(r => r.d === i + 1) || {}).n || 0 }));
    const allOrders = months.reduce((a, m) => a + m.orders, 0);
    let season = null;
    if (allOrders) {
      let best = null;
      for (let i = 0; i < 12; i++) { const n = [0, 1, 2, 3].reduce((a, k) => a + months[(i + k) % 12].orders, 0); if (!best || n > best.n) best = { i, n }; }
      season = { from: MONTHS[best.i], to: MONTHS[(best.i + 3) % 12], share: pct(best.n, allOrders), start_calling: MONTHS[(best.i + 11) % 12] };
    }

    // ── When they come back: first to second order (all time) ────────────
    const firsts = await db.all(`SELECT customer_id, MIN(sale_date) AS first, (array_agg(sale_date ORDER BY sale_date, id))[2] AS second,
        MAX(sale_date) AS last, COUNT(*) AS n FROM sales WHERE status <> 'Cancelled' AND customer_id IS NOT NULL GROUP BY customer_id`);
    const day = d => Date.parse(d + 'T00:00:00Z') / 864e5;
    const gaps = firsts.filter(r => r.second).map(r => day(r.second) - day(r.first)).sort((a, b) => a - b);
    const gapBuckets = GAPS.map(([label, a, z]) => ({ label, customers: gaps.filter(g => g >= a && g <= z).length }));
    let comeBack = null;
    if (gaps.length) {
      let best = null; // the two neighbouring buckets (up to 3 months) holding most second orders
      for (let i = 0; i < 4; i++) { const n = gapBuckets[i].customers + gapBuckets[i + 1].customers; if (!best || n > best.n) best = { i, n }; }
      const lo = GAPS[best.i][1], hi = GAPS[best.i + 1][2];
      const now = firsts.filter(r => { const ago = day(to) - day(r.last); return ago >= lo && ago <= hi; }).length;
      comeBack = { from_days: lo, to_days: hi, label: `${GAPS[best.i][0].split('–')[0]}–${GAPS[best.i + 1][0].split('–')[1] || GAPS[best.i + 1][0]}`, share: pct(best.n, gaps.length),
        customers_now: now, median_days: gaps[Math.floor(gaps.length / 2)], repeat_pct: pct(gaps.length, firsts.length) };
    }

    // ── How they buy ─────────────────────────────────────────────────────
    const firstItems = await db.all(`WITH f AS (SELECT DISTINCT ON (customer_id) id, customer_id FROM sales WHERE status <> 'Cancelled' AND customer_id IS NOT NULL ORDER BY customer_id, sale_date, id),
        s2 AS (SELECT DISTINCT ON (customer_id) id, customer_id FROM (SELECT s.id, s.customer_id, s.sale_date, ROW_NUMBER() OVER (PARTITION BY s.customer_id ORDER BY s.sale_date, s.id) AS rn
          FROM sales s WHERE s.status <> 'Cancelled' AND s.customer_id IS NOT NULL) x WHERE rn = 2 ORDER BY customer_id)
      SELECT 'first' AS which, bk.id, bk.name, COUNT(DISTINCT f.customer_id) AS n FROM f JOIN sale_items i ON i.sale_id = f.id JOIN books bk ON bk.id = i.book_id WHERE lower(bk.sku) <> 'other' GROUP BY bk.id, bk.name
      UNION ALL
      SELECT 'pair:' || fi.book_id, bk.id, bk.name, COUNT(DISTINCT s2.customer_id) FROM s2 JOIN f ON f.customer_id = s2.customer_id JOIN sale_items fi ON fi.sale_id = f.id
        JOIN sale_items i ON i.sale_id = s2.id JOIN books bk ON bk.id = i.book_id WHERE lower(bk.sku) <> 'other' GROUP BY fi.book_id, bk.id, bk.name`);
    const firstTop = firstItems.filter(r => r.which === 'first').sort((a, b) => b.n - a.n)[0] || null;
    const nextTop = firstTop ? firstItems.filter(r => r.which === `pair:${firstTop.id}` && r.id !== firstTop.id).sort((a, b) => b.n - a.n)[0] || null : null;
    // Customers whose first order had that book and who ordered again.
    const cameBack = firstTop ? (await db.get(`WITH f AS (SELECT DISTINCT ON (customer_id) id, customer_id FROM sales WHERE status <> 'Cancelled' AND customer_id IS NOT NULL ORDER BY customer_id, sale_date, id)
      SELECT COUNT(*) AS n FROM f WHERE EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = f.id AND i.book_id = @book)
        AND (SELECT COUNT(*) FROM sales s WHERE s.customer_id = f.customer_id AND s.status <> 'Cancelled') >= 2`, { book: firstTop.id })).n : 0;
    const pay = await db.all(`WITH ${B} SELECT COALESCE(payment_method, 'Not recorded') AS method, COUNT(*) AS n FROM b GROUP BY 1 ORDER BY 2 DESC`, p);
    const multi = await db.get(`WITH ${B} SELECT COUNT(*) FILTER (WHERE (SELECT MAX(qty) FROM sale_items i WHERE i.sale_id = b.id) >= 2) AS multi, COUNT(*) AS n FROM b`, p);
    const sales2 = await db.get(`SELECT COUNT(*) FILTER (WHERE outcome = 'Sale') AS sale, COUNT(*) FILTER (WHERE status = 'Answered') AS answered FROM calls WHERE call_date BETWEEN @from AND @to`, p);
    const how = [];
    if (firstTop) how.push({ label: `First order includes ${firstTop.name}`, pct: pct(firstTop.n, firsts.length) });
    if (nextTop && cameBack) how.push({ label: `…of those who came back, the second order includes ${nextTop.name}`, pct: pct(nextTop.n, cameBack) });
    const orders = pay.reduce((a, r) => a + r.n, 0);
    for (const r of pay.slice(0, 4)) how.push({ label: r.method === 'Other' ? 'Payment recorded as Other (mostly the old order sheet)' : `Paid by ${r.method}`, pct: pct(r.n, orders) });
    how.push({ label: 'Orders with 2 or more copies of one book or set (a school, a group or gifts)', pct: pct(multi.multi, multi.n) });
    if (sales2.answered) how.push({ label: 'Answered calls that ended in a sale', pct: pct(sales2.sale, sales2.answered) });

    const callFirst = where.filter(w => w.district && w.dormant).sort((a, b) => b.dormant - a.dormant).slice(0, 2);
    res.json({
      range, from, to, orders, customers: where.reduce((a, w) => a + w.customers, 0),
      where, districts: KD,
      calls: { total: totalCalls, needed: MIN_CALLS, enough: totalCalls >= MIN_CALLS, grid: totalCalls >= MIN_CALLS ? grid : null, best: bestCall },
      months, weekdays, season, come_back: { buckets: gapBuckets, ...(comeBack || {}) }, how,
      call_first: callFirst.map(w => ({ place: w.place, dormant: w.dormant, cod_pct: w.cod_pct })),
    });
  });
};
module.exports.KD = KD;
