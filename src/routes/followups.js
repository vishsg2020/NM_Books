'use strict';
// Follow-up lists (customers saved from the Customers filters for the team to work through), the WhatsApp messages
// opened for customers, and customer feedback (a personal link to a public page with no sign-in).
const crypto = require('crypto');
const { audit } = require('../audit');
const { bad, notFound, conflict, str, oneOf, idParam, HttpError } = require('../util');
const { MESSAGE_KINDS, ORDER_KINDS, getMessages } = require('../settings');

const STATUSES = ['Not contacted yet', 'Contacted', 'No answer', 'Feedback requested', 'Feedback received', 'Review requested', 'Review posted', 'Ordered again', 'Not interested'];
// How far along a customer is. Something the app notes by itself never moves them back.
const RANK = { 'Not contacted yet': 0, 'No answer': 1, Contacted: 2, 'Feedback requested': 3, 'Review requested': 4, 'Feedback received': 5, 'Review posted': 6, 'Not interested': 7, 'Ordered again': 8 };
const KIND_STATUS = { feedback: 'Feedback requested', review: 'Review requested' }; // any other message: Contacted
const LIKED = ['Pictures', 'Easy to read', 'Stories', 'Paper and print', 'Price', 'Other'];
const REASONS = ['For my child to learn Malayalam', 'As a gift', 'For a school or class', 'For myself', 'Other'];
const FILTER_KEYS = ['q', 'source', 'orders', 'bulk', 'type', 'state', 'location', 'bought', 'not_bought', 'kind', 'outstanding', 'not_since', 'sort', 'view', 'reason', 'ready_for'];
const MAX_MEMBERS = 5000;
const CHANGE_DAYS = 7; // a feedback answer can be changed for a week
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

const parse = v => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
const feedbackRow = r => ({ id: r.id, stars: r.stars, liked: parse(r.liked_json), reasons: parse(r.reasons_json), comment: r.comment, submitted_at: r.submitted_at, requested_at: r.requested_at, customer_id: r.customer_id, customer_name: r.customer_name, customer_code: r.customer_code });
/** UTC ISO time → "YYYY-MM-DDTHH:MM" in India, to compare with call times. */
const ist = iso => new Date(Date.parse(iso) + 5.5 * 3600e3).toISOString().slice(0, 16);

/** Moves the customer forward in every open follow-up list they are in (never back). by: user id, or null for the app. */
async function bumpLists(t, customerId, status, by) {
  const lower = Object.keys(RANK).filter(s => RANK[s] < RANK[status]);
  await t.run(`UPDATE follow_up_members m SET status = ?, status_at = now_iso(), status_by = ?
    FROM follow_up_lists l WHERE l.id = m.list_id AND l.closed_at IS NULL AND m.customer_id = ? AND m.status = ANY(?::text[])`, [status, by, customerId, lower]);
}
/** Marks "Ordered again" for members of open lists who have ordered since the list was made (an order entered after it). */
async function markOrders(db, listId) {
  await db.run(`UPDATE follow_up_members m SET status = 'Ordered again', status_at = now_iso(), status_by = NULL, sale_id = x.sale_id
    FROM (SELECT m2.list_id, m2.customer_id, (SELECT s.id FROM sales s WHERE s.customer_id = m2.customer_id AND s.status <> 'Cancelled'
            AND s.created_at > l.created_at AND s.sale_date >= substr(l.created_at, 1, 10) ORDER BY s.id LIMIT 1) AS sale_id
          FROM follow_up_members m2 JOIN follow_up_lists l ON l.id = m2.list_id
          WHERE l.closed_at IS NULL AND m2.status <> 'Ordered again' ${listId ? 'AND l.id = @list' : ''}) x
    WHERE m.list_id = x.list_id AND m.customer_id = x.customer_id AND x.sale_id IS NOT NULL`, listId ? { list: listId } : {});
}
const newToken = () => crypto.randomBytes(18).toString('base64url'); // 24 characters, not guessable

module.exports = (app, { db, perm, customerQuery, queryArgs }) => {
  // ── Follow-up lists ──────────────────────────────────────────────────────
  app.get('/api/followups', perm('customers'), async (_req, res) => {
    await markOrders(db);
    const lists = await db.all(`SELECT l.id, l.name, l.note, l.created_at, l.closed_at, u.name AS created_by_name,
        (SELECT COUNT(*) FROM follow_up_members m WHERE m.list_id = l.id) AS total
      FROM follow_up_lists l JOIN users u ON u.id = l.created_by ORDER BY (l.closed_at IS NULL) DESC, l.id DESC LIMIT 200`);
    const counts = await db.all('SELECT list_id, status, COUNT(*) AS n FROM follow_up_members GROUP BY list_id, status');
    for (const l of lists) l.counts = Object.fromEntries(counts.filter(c => c.list_id === l.id).map(c => [c.status, c.n]));
    res.json({ lists, statuses: STATUSES });
  });

  app.post('/api/followups', perm('customers'), async (req, res) => {
    const name = str(req.body.name, { required: true, name: 'List name', max: 120 });
    const note = str(req.body.note, { name: 'Note for the team', max: 500 }) || null;
    const raw = req.body.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const filters = Object.fromEntries(FILTER_KEYS.filter(k => raw[k] !== undefined && raw[k] !== '').map(k => [k, String(raw[k])]));
    const { sql, p } = customerQuery(filters, ...(await queryArgs()));
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM (${sql}) y`, p);
    if (!n) throw bad('No customers match these filters');
    if (n > MAX_MEMBERS) throw bad(`${n.toLocaleString('en-IN')} customers match. A list can hold up to ${MAX_MEMBERS.toLocaleString('en-IN')}: add a filter to narrow it down.`);
    const id = await db.tx(async t => {
      const l = await t.get('INSERT INTO follow_up_lists (name, note, filters_json, created_by) VALUES (?,?,?,?) RETURNING id', [name, note, JSON.stringify(filters), req.user.id]);
      await t.run(`INSERT INTO follow_up_members (list_id, customer_id) SELECT @list_id, id FROM (${sql}) y`, { ...p, list_id: l.id });
      await audit(t, req.user, 'followup_list', l.id, 'created', null, { name, note, filters, customers: n });
      return l.id;
    });
    res.status(201).json({ id, total: n });
  });

  app.get('/api/followups/:id', perm('customers'), async (req, res) => {
    const id = idParam(req.params.id);
    const list = await db.get(`SELECT l.*, u.name AS created_by_name, cu.name AS closed_by_name FROM follow_up_lists l
      JOIN users u ON u.id = l.created_by LEFT JOIN users cu ON cu.id = l.closed_by WHERE l.id = ?`, [id]);
    if (!list) throw notFound('Follow-up list');
    if (!list.closed_at) await markOrders(db, id);
    const members = await db.all(`SELECT c.id, c.code, c.name, c.phone, c.location, c.type, m.status, m.status_at, su.name AS status_by_name,
        m.sale_id, s.sale_no, s.sale_date, s.total_amount AS sale_amount,
        lm.kind AS msg_kind, lm.created_at AS msg_at, lm.user_name AS msg_by, lc.called_at, lc.status AS call_status, lc.user_name AS call_by,
        fb.stars, fb.comment
      FROM follow_up_members m JOIN customers c ON c.id = m.customer_id LEFT JOIN users su ON su.id = m.status_by LEFT JOIN sales s ON s.id = m.sale_id
      LEFT JOIN LATERAL (SELECT x.kind, x.created_at, u.name AS user_name FROM customer_messages x JOIN users u ON u.id = x.user_id WHERE x.customer_id = c.id ORDER BY x.id DESC LIMIT 1) lm ON true
      LEFT JOIN LATERAL (SELECT k.called_at, k.status, u.name AS user_name FROM calls k JOIN users u ON u.id = k.salesperson_id WHERE k.customer_id = c.id ORDER BY k.called_at DESC, k.id DESC LIMIT 1) lc ON true
      LEFT JOIN LATERAL (SELECT f.stars, f.comment FROM feedback f WHERE f.customer_id = c.id AND f.submitted_at IS NOT NULL ORDER BY f.submitted_at DESC LIMIT 1) fb ON true
      WHERE m.list_id = ? ORDER BY c.name, c.id`, [id]);
    const kindName = Object.fromEntries(MESSAGE_KINDS.map(([k, l]) => [k, l]));
    for (const m of members) {
      const msg = m.msg_at ? { at: ist(m.msg_at), how: `WhatsApp: ${kindName[m.msg_kind] || m.msg_kind}`, by: m.msg_by } : null;
      const call = m.called_at ? { at: m.called_at, how: `Call: ${m.call_status}`, by: m.call_by } : null;
      m.last_contact = msg && call ? (msg.at >= call.at ? msg : call) : msg || call;
      for (const k of ['msg_kind', 'msg_at', 'msg_by', 'called_at', 'call_status', 'call_by']) delete m[k];
    }
    const counts = {}; for (const m of members) counts[m.status] = (counts[m.status] || 0) + 1;
    res.json({ ...list, filters: parse(list.filters_json), filters_json: undefined, members, counts, statuses: STATUSES });
  });

  app.patch('/api/followups/:id/members/:cid', perm('customers'), async (req, res) => {
    const id = idParam(req.params.id); const cid = idParam(req.params.cid);
    const status = oneOf(req.body.status, STATUSES, { required: true, name: 'Status' });
    const m = await db.get(`SELECT m.status, l.closed_at FROM follow_up_members m JOIN follow_up_lists l ON l.id = m.list_id WHERE m.list_id = ? AND m.customer_id = ?`, [id, cid]);
    if (!m) throw notFound('Customer in this list');
    if (m.closed_at) throw conflict('This list is closed. Reopen it to change a status.');
    await db.tx(async t => {
      await t.run('UPDATE follow_up_members SET status = ?, status_at = now_iso(), status_by = ? WHERE list_id = ? AND customer_id = ?', [status, req.user.id, id, cid]);
      await audit(t, req.user, 'followup_list', id, 'status_changed', { customer_id: cid, status: m.status }, { customer_id: cid, status });
    });
    res.json({ ok: true, status });
  });

  for (const [action, closed] of [['close', true], ['reopen', false]]) {
    app.post(`/api/followups/:id/${action}`, perm('customers'), async (req, res) => {
      const id = idParam(req.params.id);
      const l = await db.get('SELECT id, closed_at FROM follow_up_lists WHERE id = ?', [id]);
      if (!l) throw notFound('Follow-up list');
      await db.tx(async t => {
        await t.run(`UPDATE follow_up_lists SET closed_at = ${closed ? 'now_iso()' : 'NULL'}, closed_by = ? WHERE id = ?`, [closed ? req.user.id : null, id]);
        await audit(t, req.user, 'followup_list', id, closed ? 'closed' : 'reopened');
      });
      res.json({ ok: true });
    });
  }

  // ── WhatsApp messages ────────────────────────────────────────────────────
  // Personal feedback links for these customers: an unanswered link from the last 30 days is reused.
  app.post('/api/feedback/links', perm('customers'), async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body.customer_ids) ? req.body.customer_ids : []).map(idParam))];
    if (!ids.length) throw bad('Choose the customers');
    if (ids.length > 500) throw bad('Up to 500 customers at a time');
    const out = {};
    await db.tx(async t => {
      const known = new Set((await t.all('SELECT id FROM customers WHERE id = ANY(?::int[])', [ids])).map(r => r.id));
      for (const r of await t.all(`SELECT DISTINCT ON (customer_id) customer_id, token FROM feedback WHERE customer_id = ANY(?::int[]) AND submitted_at IS NULL
          AND requested_at > to_char((now() - interval '30 days') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS') ORDER BY customer_id, id DESC`, [ids])) out[r.customer_id] = r.token;
      for (const id of ids) {
        if (out[id] || !known.has(id)) continue;
        out[id] = newToken();
        await t.run('INSERT INTO feedback (token, customer_id, requested_by) VALUES (?,?,?)', [out[id], id, req.user.id]);
      }
    });
    res.json({ links: out });
  });

  // Notes that a WhatsApp message was opened for the customer, and moves them along in their open follow-up lists.
  app.post('/api/customers/:id/messages', perm('customers'), async (req, res) => {
    const cid = idParam(req.params.id);
    const kind = oneOf(req.body.kind, [...MESSAGE_KINDS, ...ORDER_KINDS].map(k => k[0]), { required: true, name: 'Message' });
    const listId = req.body.list_id ? idParam(req.body.list_id) : null;
    const bookId = req.body.book_id ? idParam(req.body.book_id) : null;
    const saleId = req.body.sale_id ? idParam(req.body.sale_id) : null;
    if (!(await db.get('SELECT 1 FROM customers WHERE id = ?', [cid]))) throw notFound('Customer');
    if (saleId && !(await db.get('SELECT 1 FROM sales WHERE id = ? AND customer_id = ?', [saleId, cid]))) throw bad('That order is not this customer\'s');
    await db.tx(async t => {
      await t.run('INSERT INTO customer_messages (customer_id, kind, list_id, book_id, sale_id, user_id) VALUES (?,?,?,?,?,?)', [cid, kind, listId, bookId, saleId, req.user.id]);
      // Order messages are about the order, not a follow-up: they do not move anyone in a list.
      if (!ORDER_KINDS.some(k => k[0] === kind)) await bumpLists(t, cid, KIND_STATUS[kind] || 'Contacted', req.user.id);
    });
    res.status(201).json({ ok: true });
  });

  // ── Feedback answers ─────────────────────────────────────────────────────
  app.get('/api/feedback', perm('customers'), async (_req, res) => {
    const rows = (await db.all(`SELECT f.*, c.name AS customer_name, c.code AS customer_code FROM feedback f JOIN customers c ON c.id = f.customer_id
      WHERE f.submitted_at IS NOT NULL ORDER BY f.submitted_at DESC LIMIT 500`)).map(feedbackRow);
    const t = await db.get(`SELECT COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS answered, COUNT(*) AS sent, AVG(stars) AS avg FROM feedback`);
    const tally = (key, opts) => opts.map(o => [o, rows.filter(r => r[key].includes(o)).length]);
    const stars = [5, 4, 3, 2, 1].map(s => [s, rows.filter(r => r.stars === s).length]);
    res.json({ answered: t.answered, sent: t.sent, average: t.avg === null ? null : Math.round(Number(t.avg) * 10) / 10, stars, liked: tally('liked', LIKED), reasons: tally('reasons', REASONS), rows });
  });
};

/**
 * The public feedback page's API (no sign-in): GET and POST /api/public/feedback/:token.
 * It shows only the customer's first name and their own answer, never their number, address or orders.
 */
function publicRoutes(app, db) {
  const load = async token => {
    if (!TOKEN.test(String(token))) throw new HttpError(404, 'This feedback link is not valid');
    const f = await db.get(`SELECT f.*, c.name FROM feedback f JOIN customers c ON c.id = f.customer_id WHERE f.token = ?`, [token]);
    if (!f) throw new HttpError(404, 'This feedback link is not valid');
    return f;
  };
  const editable = f => !f.submitted_at || Date.now() - Date.parse(f.submitted_at) < CHANGE_DAYS * 864e5;
  const view = async f => {
    const m = await getMessages(db);
    const first = String(f.name || '').trim().split(/\s+/)[0];
    return {
      first_name: /^name\b/i.test(first) ? '' : first.slice(0, 40), stars: f.stars, liked: parse(f.liked_json), reasons: parse(f.reasons_json), comment: f.comment || '',
      submitted: !!f.submitted_at, can_change: editable(f), options: { liked: LIKED, reasons: REASONS },
      review_url: m.review_url || null, website_url: m.website_url || null,
      share_text: `Nalla Malayalam books help children learn to read Malayalam. Have a look: ${m.website_url || ''}`.trim(),
    };
  };
  app.get('/api/public/feedback/:token', async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await view(await load(req.params.token))); });
  app.post('/api/public/feedback/:token', async (req, res) => {
    const f = await load(req.params.token);
    if (!editable(f)) throw conflict('Thank you! This answer can no longer be changed.');
    const b = req.body || {};
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('Tap a star to rate the books');
    const pick = (v, opts) => [...new Set((Array.isArray(v) ? v : []).map(String))].filter(x => opts.includes(x));
    const comment = str(b.comment, { name: 'Comment', max: 1000 }) || null;
    await db.tx(async t => {
      await t.run(`UPDATE feedback SET stars = ?, liked_json = ?, reasons_json = ?, comment = ?, submitted_at = COALESCE(submitted_at, now_iso()), updated_at = now_iso() WHERE id = ?`,
        [stars, JSON.stringify(pick(b.liked, LIKED)), JSON.stringify(pick(b.reasons, REASONS)), comment, f.id]);
      await bumpLists(t, f.customer_id, 'Feedback received', null);
    });
    res.set('Cache-Control', 'no-store');
    res.json(await view(await load(req.params.token)));
  });
}

module.exports.publicRoutes = publicRoutes;
module.exports.bumpLists = bumpLists;
module.exports.feedbackRow = feedbackRow;
module.exports.STATUSES = STATUSES;
module.exports.LIKED = LIKED;
module.exports.REASONS = REASONS;
