'use strict';
// Delivery check (Dispatch → Delivery check). A few days after an order's parcel goes out, the dispatch team calls the
// customer: did the books arrive, are they happy? Only our own shipments (Tele-sales, WhatsApp and Website orders sent
// by India Post or DTDC); Amazon and Flipkart look after their own deliveries. Orders brought in from the old sheets
// were never dispatched in the app, so they never appear.
//
// Each call is a row in delivery_checks. The latest call decides where an order sits:
//   none yet                         → To call, once it is `days` days since dispatch
//   happy / not happy / returned     → done (the order moves to Delivered on happy or not happy)
//   not delivered                    → To call again 2 days later
//   no answer                        → To call again the next day; after 3 in a row, Couldn't reach
//   wrong or switched-off number     → Couldn't reach
// Not happy, not delivered and returned calls also wait under "Needs action" until someone marks them sorted.
const { audit } = require('../audit');
const S = require('../settings');
const { bad, notFound, unprocessable, str, oneOf, idParam, today, TZ } = require('../util');

const RESULTS = [
  ['happy', 'Delivered, happy'],
  ['not_happy', 'Delivered, not happy'],
  ['not_delivered', 'Not delivered yet'],
  ['no_answer', 'No answer'],
  ['wrong_number', 'Wrong or switched-off number'],
  ['returned', 'Returned to us'],
];
const NEEDS_NOTE = ['not_happy', 'not_delivered', 'returned'];
const ACTION = ['not_happy', 'not_delivered', 'returned'];
const DONE = ['happy', 'not_happy', 'returned'];
const RETRY_DAYS = { not_delivered: 2, no_answer: 1 };
const MAX_NO_ANSWER = 3;
const DAY_CHOICES = [2, 3, 4, 5, 6, 7, 10, 14];
const DEFAULT_DAYS = 4;

const tz = TZ.replace(/[^A-Za-z_/+-]/g, '');
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const localDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

async function getConfig(db) {
  const saved = (await S.read(db, 'delivery_check')) || {};
  return { days: DAY_CHOICES.includes(saved.days) ? saved.days : DEFAULT_DAYS, day_choices: DAY_CHOICES };
}

// Our own shipments that have left stock, with the day their stock was first dispatched.
const SHIPPED = `
  SELECT s.id, s.sale_no, s.sale_date, s.channel, s.platform, s.status, s.customer_id, s.customer_name, s.customer_phone,
    s.courier, s.tracking_no, s.total_amount, c.location AS district, d.day AS sent_day,
    (SELECT string_agg(b.name || CASE WHEN i.qty > 1 THEN ' × ' || i.qty ELSE '' END, ', ' ORDER BY i.id)
       FROM sale_items i JOIN books b ON b.id = i.book_id WHERE i.sale_id = s.id) AS books
  FROM sales s
  JOIN (SELECT sale_id, MIN(to_char(at::timestamptz AT TIME ZONE '${tz}', 'YYYY-MM-DD')) AS day
          FROM stock_movements WHERE type = 'Stock dispatched' AND sale_id IS NOT NULL GROUP BY sale_id) d ON d.sale_id = s.id
  LEFT JOIN customers c ON c.id = s.customer_id
  WHERE s.status IN ('Dispatched', 'Delivered') AND s.channel <> 'Onsite' AND COALESCE(s.platform, '') NOT IN ('Amazon', 'Flipkart')`;

const CHECK_COLS = `k.id, k.sale_id, k.result, k.note, k.checked_at, k.sorted_at, k.sorted_note, u.name AS checked_by_name, su.name AS sorted_by_name`;
const CHECK_FROM = `FROM delivery_checks k JOIN users u ON u.id = k.checked_by LEFT JOIN users su ON su.id = k.sorted_by`;

/** Where an order sits now, from its calls (oldest first). */
function placeOf(order, checks, days, day) {
  const last = checks[checks.length - 1];
  let trailing = 0; for (let i = checks.length - 1; i >= 0 && checks[i].result === 'no_answer'; i--) trailing++;
  if (!last) return order.sent_day <= addDays(day, -days) ? { place: 'call', due: addDays(order.sent_day, days) } : { place: 'waiting', due: addDays(order.sent_day, days) };
  if (DONE.includes(last.result)) return { place: 'done' };
  if (last.result === 'wrong_number' || (last.result === 'no_answer' && trailing >= MAX_NO_ANSWER)) return { place: 'unreachable' };
  const due = addDays(localDay(last.checked_at), RETRY_DAYS[last.result]);
  return { place: due <= day ? 'call' : 'waiting', due };
}

module.exports = (app, { db, perm, requireAdmin }) => {
  app.get('/api/delivery-checks', perm('delivery'), async (req, res) => {
    const day = today(); const { days } = await getConfig(db);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : day.slice(0, 7);
    // Orders sent long ago drop off the call list (they would only be old news); open "Needs action" stays.
    const from = addDays(day, -120);
    const orders = await db.all(`${SHIPPED} AND (d.day >= @from OR EXISTS (SELECT 1 FROM delivery_checks k WHERE k.sale_id = s.id AND k.sorted_at IS NULL AND k.result IN ('not_happy','not_delivered','returned')))
      ORDER BY d.day, s.id`, { from });
    const checks = await db.all(`SELECT ${CHECK_COLS} ${CHECK_FROM} WHERE k.sale_id IN (SELECT x.id FROM (${SHIPPED}) x) ORDER BY k.id`);
    const bySale = new Map(); for (const k of checks) { if (!bySale.has(k.sale_id)) bySale.set(k.sale_id, []); bySale.get(k.sale_id).push(k); }
    const byId = new Map(orders.map(o => [o.id, o]));
    const call = [], unreachable = [];
    for (const o of orders) {
      const ks = bySale.get(o.id) || [];
      const p = placeOf(o, ks, days, day);
      const row = { ...o, days_since: daysBetween(o.sent_day, day), tries: ks.length, last: ks[ks.length - 1] || null, due: p.due || null };
      if (p.place === 'call') call.push(row);
      else if (p.place === 'unreachable') unreachable.push(row);
    }
    const action = checks.filter(k => ACTION.includes(k.result) && !k.sorted_at && byId.has(k.sale_id))
      .map(k => ({ ...k, order: byId.get(k.sale_id) })).reverse();
    // Checked: every call made in the month, newest first.
    const done = await db.all(`SELECT ${CHECK_COLS}, s.sale_no, s.customer_id, s.customer_name, s.customer_phone,
        (SELECT string_agg(b.name, ', ' ORDER BY i.id) FROM sale_items i JOIN books b ON b.id = i.book_id WHERE i.sale_id = s.id) AS books
      ${CHECK_FROM} JOIN sales s ON s.id = k.sale_id
      WHERE substr(to_char(k.checked_at::timestamptz AT TIME ZONE '${tz}', 'YYYY-MM-DD'), 1, 7) = @month ORDER BY k.id DESC LIMIT 500`, { month });
    const delivered = done.filter(k => k.result === 'happy' || k.result === 'not_happy');
    call.sort((a, b) => (a.tries ? 1 : 0) - (b.tries ? 1 : 0) || a.sent_day.localeCompare(b.sent_day) || a.id - b.id);
    res.json({
      today: day, days, month, results: RESULTS, needs_note: NEEDS_NOTE, max_no_answer: MAX_NO_ANSWER,
      call, action, unreachable, checked: done,
      counts: { call: call.length, second: call.filter(r => r.tries).length, action: action.length, unreachable: unreachable.length,
        checked: delivered.length, happy: delivered.filter(k => k.result === 'happy').length },
    });
  });

  // Record a call.
  app.post('/api/delivery-checks', perm('delivery'), async (req, res) => {
    const saleId = idParam(req.body.sale_id);
    const result = oneOf(req.body.result, RESULTS.map(r => r[0]), { required: true, name: 'Result' });
    const note = str(req.body.note, { name: 'Note', max: 500, required: NEEDS_NOTE.includes(result) });
    let id;
    await db.tx(async t => {
      const s = await t.get(`SELECT x.* FROM (${SHIPPED}) x WHERE x.id = ?`, [saleId]);
      if (!s) {
        if (!(await t.get('SELECT 1 FROM sales WHERE id = ?', [saleId]))) throw notFound('Order');
        throw unprocessable('Only our own parcels that have been dispatched are checked here');
      }
      id = (await t.get('INSERT INTO delivery_checks (sale_id, result, note, checked_by) VALUES (?,?,?,?) RETURNING id', [saleId, result, note, req.user.id])).id;
      await audit(t, req.user, 'sale', saleId, 'delivery_checked', null, { result, note });
      if (result === 'happy' || result === 'not_happy') {
        // The books arrived: the order is Delivered, and an earlier "not delivered yet" is sorted by itself.
        const moved = await t.run(`UPDATE sales SET status = 'Delivered', updated_at = now_iso() WHERE id = ? AND status = 'Dispatched'`, [saleId]);
        if (moved.rowCount) await audit(t, req.user, 'sale', saleId, 'status_changed', { status: 'Dispatched' }, { status: 'Delivered' });
        await t.run(`UPDATE delivery_checks SET sorted_at = now_iso(), sorted_by = ?, sorted_note = 'Delivered (found on a later call)'
          WHERE sale_id = ? AND result = 'not_delivered' AND sorted_at IS NULL`, [req.user.id, saleId]);
      }
    });
    res.status(201).json(await db.get(`SELECT ${CHECK_COLS} ${CHECK_FROM} WHERE k.id = ?`, [id]));
  });

  // Close a "Needs action" call with what was done.
  app.post('/api/delivery-checks/:id/sorted', perm('delivery'), async (req, res) => {
    const id = idParam(req.params.id);
    const note = str(req.body.note, { name: 'What was done', max: 500, required: true });
    await db.tx(async t => {
      const k = await t.get('SELECT * FROM delivery_checks WHERE id = ? FOR UPDATE', [id]);
      if (!k) throw notFound('Call');
      if (!ACTION.includes(k.result)) throw bad('Only not happy, not delivered and returned calls need sorting');
      if (k.sorted_at) return; // already sorted (repeat click)
      await t.run('UPDATE delivery_checks SET sorted_at = now_iso(), sorted_by = ?, sorted_note = ? WHERE id = ?', [req.user.id, note, id]);
      await audit(t, req.user, 'sale', k.sale_id, 'delivery_sorted', null, { result: k.result, note });
    });
    res.json(await db.get(`SELECT ${CHECK_COLS} ${CHECK_FROM} WHERE k.id = ?`, [id]));
  });

  app.put('/api/settings/delivery-check', requireAdmin, async (req, res) => {
    const days = Number(req.body && req.body.days);
    if (!DAY_CHOICES.includes(days)) throw bad(`Choose ${DAY_CHOICES.join(', ')} days`, { field: 'Days after dispatch' });
    const before = await getConfig(db);
    await db.tx(async t => { await S.write(t, 'delivery_check', { days }); await audit(t, req.user, 'settings', null, 'delivery_check_changed', { days: before.days }, { days }); });
    res.json(await getConfig(db));
  });
};

/** The calls for one order or one customer (shown on the order and the customer page). */
module.exports.checksFor = (db, { saleId, customerId }) => db.all(`SELECT ${CHECK_COLS}, s.sale_no ${CHECK_FROM} JOIN sales s ON s.id = k.sale_id
  WHERE ${saleId ? 'k.sale_id = ?' : 's.customer_id = ?'} ORDER BY k.id DESC LIMIT 100`, [saleId || customerId]);
module.exports.getConfig = getConfig;
module.exports.RESULTS = RESULTS;
