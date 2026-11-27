'use strict';
// Follow-up lists (customers saved from the Customers filters for the team to work through), the WhatsApp messages
// opened for customers, and customer feedback (a personal link to a public page with no sign-in).
const crypto = require('crypto');
const { audit } = require('../audit');
const { bad, notFound, conflict, str, oneOf, idParam, HttpError } = require('../util');
const { MESSAGE_KINDS, ORDER_KINDS, getMessages, getFeedbackPage } = require('../settings');
const reviews = require('./reviews');

const STATUSES = ['Not contacted yet', 'Contacted', 'No answer', 'Feedback requested', 'Feedback received', 'Review requested', 'Review posted', 'Ordered again', 'Not interested'];
// How far along a customer is. Something the app notes by itself never moves them back.
const RANK = { 'Not contacted yet': 0, 'No answer': 1, Contacted: 2, 'Feedback requested': 3, 'Review requested': 4, 'Feedback received': 5, 'Review posted': 6, 'Not interested': 7, 'Ordered again': 8 };
const KIND_STATUS = { feedback: 'Feedback requested', review: 'Review requested' }; // any other message: Contacted
const LIKED = ['Pictures', 'Easy to read', 'Stories', 'Paper and print', 'Price', 'Other'];
const REASONS = ['For my child to learn Malayalam', 'As a gift', 'For a school or class', 'For myself', 'Other'];
// Asked in the chat (C) and "your child's story" (F) page styles.
const CHANGES = ['Reads on their own', 'Knows the letters', 'Asks for more stories', 'Speaks more Malayalam', 'Not started yet'];
const AGES = ['3-5', '6-8', '9-12', '12+'];
const STYLES = ['A', 'C', 'E', 'F'];
const FILTER_KEYS = ['q', 'source', 'orders', 'bulk', 'type', 'state', 'location', 'bought', 'not_bought', 'kind', 'outstanding', 'not_since', 'sort', 'view', 'reason', 'ready_for'];
const MAX_MEMBERS = 5000;
const CHANGE_DAYS = 7; // a feedback answer can be changed for a week
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

const parse = v => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
const feedbackRow = r => ({ id: r.id, stars: r.stars, liked: parse(r.liked_json), reasons: parse(r.reasons_json), changes: parse(r.changes_json), child_age: r.child_age || null,
  comment: r.comment, style: r.style || null, website_answer: r.website_answer || null, review_status: r.review_status || null, called_back: !!r.called_back,
  submitted_at: r.submitted_at, requested_at: r.requested_at, customer_id: r.customer_id, customer_name: r.customer_name, customer_code: r.customer_code, customer_place: r.customer_place || null, customer_phone: r.customer_phone || null });
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

module.exports = (app, { db, perm, customerQuery, queryArgs, ownId = async () => null, assertOwnCustomer = async () => {}, OWN = 'TRUE' }) => {
  const { HttpError } = require('../util');
  const ASSIGNABLE = ['telesales', 'online', 'onsite', 'manager'];
  const canAssign = user => user.role === 'admin' || user.role === 'manager';
  const isAssigned = async (listId, userId) => !!(await db.get('SELECT 1 AS x FROM follow_up_assignees WHERE list_id = ? AND user_id = ?', [listId, userId]));
  // "Own only" (Tele-sales): a person sees and works the lists they made or were assigned.
  async function assertOwnList(user, list) {
    const me = await ownId(user);
    if (me && list.created_by !== me && !(await isAssigned(list.id || list.list_id, me))) throw new HttpError(403, 'This list belongs to another team member');
  }
  // Assigning, closing and reopening: Admin, Manager or whoever made the list.
  function assertCanManage(user, list, what) {
    if (!canAssign(user) && list.created_by !== user.id) throw new HttpError(403, `Only the Admin, a Manager or whoever made the list can ${what} it`);
  }
  const assigneesOf = ids => (ids.length ? db.all(`SELECT a.list_id, a.user_id AS id, u.name, u.role, u.active, a.assigned_at, ab.name AS assigned_by_name
      FROM follow_up_assignees a JOIN users u ON u.id = a.user_id JOIN users ab ON ab.id = a.assigned_by
      WHERE a.list_id = ANY(@ids::int[]) ORDER BY u.name`, { ids }) : []);
  // ── Follow-up lists ──────────────────────────────────────────────────────
  app.get('/api/followups', perm('customers'), async (req, res) => {
    await markOrders(db);
    const me = await ownId(req.user);
    const lists = await db.all(`SELECT l.id, l.name, l.note, l.created_at, l.closed_at, l.created_by, u.name AS created_by_name,
        (SELECT COUNT(*) FROM follow_up_members m WHERE m.list_id = l.id) AS total
      FROM follow_up_lists l JOIN users u ON u.id = l.created_by
      ${me ? 'WHERE l.created_by = @me OR EXISTS (SELECT 1 FROM follow_up_assignees a WHERE a.list_id = l.id AND a.user_id = @me)' : ''}
      ORDER BY (l.closed_at IS NULL) DESC, l.id DESC LIMIT 200`, { me });
    const counts = await db.all('SELECT list_id, status, COUNT(*) AS n FROM follow_up_members GROUP BY list_id, status');
    const assignees = await assigneesOf(lists.map(l => l.id));
    for (const l of lists) {
      l.counts = Object.fromEntries(counts.filter(c => c.list_id === l.id).map(c => [c.status, c.n]));
      l.assignees = assignees.filter(a => a.list_id === l.id).map(({ list_id, ...a }) => a);
      const mine = l.assignees.find(a => a.id === req.user.id);
      l.assigned_to_me = !!mine;
      if (mine) { l.assigned_by_name = mine.assigned_by_name; l.assigned_at = mine.assigned_at; }
      l.can_manage = canAssign(req.user) || l.created_by === req.user.id;
    }
    res.json({ lists, statuses: STATUSES, can_assign: canAssign(req.user) });
  });

  app.post('/api/followups', perm('customers'), async (req, res) => {
    const name = str(req.body.name, { required: true, name: 'List name', max: 120 });
    const note = str(req.body.note, { name: 'Note for the team', max: 500 }) || null;
    const raw = req.body.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const filters = Object.fromEntries(FILTER_KEYS.filter(k => raw[k] !== undefined && raw[k] !== '').map(k => [k, String(raw[k])]));
    const { sql, p } = customerQuery(filters, ...(await queryArgs()), await ownId(req.user));
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

  app.get('/api/followups/people', perm('customers'), async (req, res) => {
    if (!canAssign(req.user)) throw new HttpError(403, 'Only the Admin or a Manager can assign lists');
    res.json(await db.all(`SELECT id, name, role FROM users WHERE active = 1 AND role = ANY(@roles::text[]) ORDER BY role, name`, { roles: ASSIGNABLE }));
  });
  app.get('/api/followups/:id', perm('customers'), async (req, res) => {
    const id = idParam(req.params.id);
    const list = await db.get(`SELECT l.*, u.name AS created_by_name, cu.name AS closed_by_name FROM follow_up_lists l
      JOIN users u ON u.id = l.created_by LEFT JOIN users cu ON cu.id = l.closed_by WHERE l.id = ?`, [id]);
    if (!list) throw notFound('Follow-up list');
    await assertOwnList(req.user, list);
    if (!list.closed_at) await markOrders(db, id);
    // Own only: a customer of someone else in an assigned list can be worked here, but their page stays closed.
    const me = await ownId(req.user);
    const members = await db.all(`SELECT c.id, c.code, c.name, c.phone, c.location, c.type, m.status, m.status_at, su.name AS status_by_name,
        ${me ? OWN : 'TRUE'} AS yours,
        m.sale_id, s.sale_no, s.sale_date, s.total_amount AS sale_amount,
        lm.kind AS msg_kind, lm.created_at AS msg_at, lm.user_name AS msg_by, lc.called_at, lc.status AS call_status, lc.user_name AS call_by,
        fb.stars, fb.comment
      FROM follow_up_members m JOIN customers c ON c.id = m.customer_id LEFT JOIN users su ON su.id = m.status_by LEFT JOIN sales s ON s.id = m.sale_id
      LEFT JOIN LATERAL (SELECT x.kind, x.created_at, u.name AS user_name FROM customer_messages x JOIN users u ON u.id = x.user_id WHERE x.customer_id = c.id ORDER BY x.id DESC LIMIT 1) lm ON true
      LEFT JOIN LATERAL (SELECT k.called_at, k.status, u.name AS user_name FROM calls k JOIN users u ON u.id = k.salesperson_id WHERE k.customer_id = c.id ORDER BY k.called_at DESC, k.id DESC LIMIT 1) lc ON true
      LEFT JOIN LATERAL (SELECT f.stars, f.comment FROM feedback f WHERE f.customer_id = c.id AND f.submitted_at IS NOT NULL ORDER BY f.submitted_at DESC LIMIT 1) fb ON true
      WHERE m.list_id = @id ORDER BY c.name, c.id`, { id, own_me: me });
    const kindName = Object.fromEntries(MESSAGE_KINDS.map(([k, l]) => [k, l]));
    for (const m of members) {
      const msg = m.msg_at ? { at: ist(m.msg_at), how: `WhatsApp: ${kindName[m.msg_kind] || m.msg_kind}`, by: m.msg_by } : null;
      const call = m.called_at ? { at: m.called_at, how: `Call: ${m.call_status}`, by: m.call_by } : null;
      m.last_contact = msg && call ? (msg.at >= call.at ? msg : call) : msg || call;
      for (const k of ['msg_kind', 'msg_at', 'msg_by', 'called_at', 'call_status', 'call_by']) delete m[k];
    }
    const counts = {}; for (const m of members) counts[m.status] = (counts[m.status] || 0) + 1;
    const assignees = (await assigneesOf([id])).map(({ list_id, ...a }) => a);
    res.json({ ...list, filters: parse(list.filters_json), filters_json: undefined, members, counts, statuses: STATUSES,
      assignees, can_assign: canAssign(req.user), can_manage: canAssign(req.user) || list.created_by === req.user.id });
  });

  // ── Assigning a list (Admin, Manager) ────────────────────────────────────
  app.put('/api/followups/:id/assignees', perm('customers'), async (req, res) => {
    if (!canAssign(req.user)) throw new HttpError(403, 'Only the Admin or a Manager can assign lists');
    const id = idParam(req.params.id);
    const list = await db.get('SELECT id, name FROM follow_up_lists WHERE id = ?', [id]);
    if (!list) throw notFound('Follow-up list');
    const raw = req.body && req.body.user_ids;
    if (!Array.isArray(raw) || raw.length > 50) throw bad('Choose the people to assign');
    const ids = [...new Set(raw.map(x => idParam(x)))];
    const people = ids.length ? await db.all(`SELECT id, name FROM users WHERE id = ANY(@ids::int[]) AND active = 1 AND role = ANY(@roles::text[])`, { ids, roles: ASSIGNABLE }) : [];
    if (people.length !== ids.length) throw bad('Lists can be assigned to active Tele-sales, Online, Onsite and Manager logins only', { field: 'Assigned to' });
    const before = await assigneesOf([id]);
    await db.tx(async t => {
      await t.run('DELETE FROM follow_up_assignees WHERE list_id = @id AND NOT (user_id = ANY(@ids::int[]))', { id, ids });
      for (const p of people) await t.run('INSERT INTO follow_up_assignees (list_id, user_id, assigned_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', [id, p.id, req.user.id]);
      await audit(t, req.user, 'followup_list', id, 'assigned', { assigned_to: before.map(a => a.name) }, { assigned_to: people.map(p => p.name).sort() });
    });
    res.json({ ok: true, assignees: (await assigneesOf([id])).map(({ list_id, ...a }) => a) });
  });

  app.patch('/api/followups/:id/members/:cid', perm('customers'), async (req, res) => {
    const id = idParam(req.params.id); const cid = idParam(req.params.cid);
    const status = oneOf(req.body.status, STATUSES, { required: true, name: 'Status' });
    const m = await db.get(`SELECT m.status, m.list_id, l.closed_at, l.created_by FROM follow_up_members m JOIN follow_up_lists l ON l.id = m.list_id WHERE m.list_id = ? AND m.customer_id = ?`, [id, cid]);
    if (!m) throw notFound('Customer in this list');
    await assertOwnList(req.user, m);
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
      const l = await db.get('SELECT id, closed_at, created_by FROM follow_up_lists WHERE id = ?', [id]);
      if (!l) throw notFound('Follow-up list');
      await assertOwnList(req.user, l);
      assertCanManage(req.user, l, action);
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

  // Messages opened for these customers in the last 30 days, so nobody is sent the same thing twice by mistake.
  app.post('/api/customers/recent-messages', perm('customers'), async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body.customer_ids) ? req.body.customer_ids : []).map(idParam))].filter(i => i > 0).slice(0, 2000);
    const out = {};
    if (ids.length) {
      for (const r of await db.all(`SELECT customer_id, kind, MAX(created_at) AS at FROM customer_messages WHERE customer_id = ANY(?::int[])
          AND created_at > to_char((now() - interval '30 days') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS') GROUP BY customer_id, kind`, [ids])) (out[r.customer_id] = out[r.customer_id] || {})[r.kind] = r.at;
    }
    res.json({ recent: out });
  });

  // Notes that a WhatsApp message was opened for the customer, and moves them along in their open follow-up lists.
  app.post('/api/customers/:id/messages', perm('customers'), async (req, res) => {
    const cid = idParam(req.params.id);
    const kind = oneOf(req.body.kind, [...MESSAGE_KINDS, ...ORDER_KINDS].map(k => k[0]), { required: true, name: 'Message' });
    const listId = req.body.list_id ? idParam(req.body.list_id) : null;
    const bookId = req.body.book_id ? idParam(req.body.book_id) : null;
    const saleId = req.body.sale_id ? idParam(req.body.sale_id) : null;
    if (!(await db.get('SELECT 1 FROM customers WHERE id = ?', [cid]))) throw notFound('Customer');
    // From a list they were assigned: allowed for the customers in that list, theirs or not.
    const viaList = listId && await db.get(`SELECT 1 AS x FROM follow_up_members m JOIN follow_up_lists l ON l.id = m.list_id
      WHERE m.list_id = ? AND m.customer_id = ? AND (l.created_by = ? OR EXISTS (SELECT 1 FROM follow_up_assignees a WHERE a.list_id = l.id AND a.user_id = ?))`, [listId, cid, req.user.id, req.user.id]);
    if (!viaList) await assertOwnCustomer(req.user, cid);
    if (saleId && !(await db.get('SELECT 1 FROM sales WHERE id = ? AND customer_id = ?', [saleId, cid]))) throw bad('That order is not this customer\'s');
    await db.tx(async t => {
      await t.run('INSERT INTO customer_messages (customer_id, kind, list_id, book_id, sale_id, user_id) VALUES (?,?,?,?,?,?)', [cid, kind, listId, bookId, saleId, req.user.id]);
      // Order messages are about the order, not a follow-up: they do not move anyone in a list.
      if (!ORDER_KINDS.some(k => k[0] === kind)) await bumpLists(t, cid, KIND_STATUS[kind] || 'Contacted', req.user.id);
    });
    res.status(201).json({ ok: true });
  });

  // ── Feedback answers ─────────────────────────────────────────────────────
  // called_back: a call was logged to the customer after they answered (low ratings get a call back).
  app.get('/api/feedback', perm('customers'), async (_req, res) => {
    const rows = (await db.all(`SELECT f.*, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone, COALESCE(c.location, c.state) AS customer_place, w.status AS review_status,
        EXISTS (SELECT 1 FROM calls k WHERE k.customer_id = f.customer_id
          AND k.called_at >= to_char((f.submitted_at::timestamptz AT TIME ZONE 'UTC') + interval '330 minutes', 'YYYY-MM-DD"T"HH24:MI')) AS called_back
      FROM feedback f JOIN customers c ON c.id = f.customer_id LEFT JOIN website_reviews w ON w.feedback_id = f.id
      WHERE f.submitted_at IS NOT NULL ORDER BY f.submitted_at DESC LIMIT 500`)).map(feedbackRow);
    const t = await db.get(`SELECT COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS answered, COUNT(*) AS sent, AVG(stars) AS avg,
      AVG(stars) FILTER (WHERE submitted_at > to_char((now() - interval '90 days') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS')) AS avg90 FROM feedback`);
    const w = await db.get(`SELECT COUNT(*) FILTER (WHERE status = 'waiting') AS waiting FROM website_reviews`);
    const tally = (key, opts) => opts.map(o => [o, rows.filter(r => r[key].includes(o)).length]);
    const stars = [5, 4, 3, 2, 1].map(s => [s, rows.filter(r => r.stars === s).length]);
    const round = v => (v === null ? null : Math.round(Number(v) * 10) / 10);
    const low = rows.filter(r => r.stars <= 3);
    res.json({ answered: t.answered, sent: t.sent, average: round(t.avg), average_90: round(t.avg90), stars, liked: tally('liked', LIKED), reasons: tally('reasons', REASONS),
      changes: tally('changes', CHANGES), ages: AGES.map(a => [a, rows.filter(r => r.child_age === a).length]),
      website_yes: rows.filter(r => r.website_answer === 'yes').length, reviews_waiting: w.waiting, low: low.length, low_not_called: low.filter(r => !r.called_back).length, rows });
  });
};

/**
 * The public feedback page's API (no sign-in): GET and POST /api/public/feedback/:token.
 * It shows only the customer's first name and their own answer, never their number, address or orders.
 */
function publicRoutes(app, db) {
  const load = async token => {
    if (!TOKEN.test(String(token))) throw new HttpError(404, 'This feedback link is not valid');
    const f = await db.get(`SELECT f.*, c.name, c.location, c.state FROM feedback f JOIN customers c ON c.id = f.customer_id WHERE f.token = ?`, [token]);
    if (!f) throw new HttpError(404, 'This feedback link is not valid');
    return f;
  };
  const editable = f => !f.submitted_at || Date.now() - Date.parse(f.submitted_at) < CHANGE_DAYS * 864e5;
  const view = async f => {
    const m = await getMessages(db);
    const first = String(f.name || '').trim().split(/\s+/)[0];
    // A customer who already answered keeps the look they answered in; a new answer gets the style set in Settings.
    const style = f.submitted_at && STYLES.includes(f.style) ? f.style : (await getFeedbackPage(db)).style;
    const bookId = await reviews.bookFor(db, f.customer_id);
    const book = bookId ? await db.get('SELECT name, name_ml FROM books WHERE id = ?', [bookId]) : null;
    return {
      book_name: book ? book.name : null, book_name_ml: book ? book.name_ml || null : null,
      style, lang: f.lang || null,
      first_name: /^name\b/i.test(first) ? '' : first.slice(0, 40), name_shown: reviews.nameShown(f.name), place_shown: reviews.placeShown(f),
      stars: f.stars, liked: parse(f.liked_json), reasons: parse(f.reasons_json), changes: parse(f.changes_json), child_age: f.child_age || null, comment: f.comment || '',
      submitted: !!f.submitted_at, can_change: editable(f), options: { liked: LIKED, reasons: REASONS, changes: CHANGES, ages: AGES },
      // "May we show this on the website?": asked for 4 or 5 stars with a comment, unless they wrote a review on the website.
      website: { eligible: reviews.eligible(f), answer: f.website_answer || null, review_clicked: !!f.review_clicked_at },
      review_url: m.review_url || null, website_url: m.website_url || null,
      share_text: `Nalla Malayalam books help children learn to read Malayalam. Have a look: ${m.website_url || ''}`.trim(),
    };
  };
  const send = async (res, token) => { res.set('Cache-Control', 'no-store'); res.json(await view(await load(token))); };
  app.get('/api/public/feedback/:token', async (req, res) => send(res, req.params.token));
  app.post('/api/public/feedback/:token', async (req, res) => {
    const f = await load(req.params.token);
    if (!editable(f)) throw conflict('Thank you! This answer can no longer be changed.');
    const b = req.body || {};
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('Tap a star to rate the books');
    const pick = (v, opts) => [...new Set((Array.isArray(v) ? v : []).map(String))].filter(x => opts.includes(x));
    const comment = str(b.comment, { name: 'Comment', max: 1000 }) || null;
    const style = STYLES.includes(b.style) ? b.style : null;
    const lang = ['ml', 'en'].includes(b.lang) ? b.lang : null;
    const age = AGES.includes(b.child_age) ? b.child_age : null;
    await db.tx(async t => {
      await t.run(`UPDATE feedback SET stars = ?, liked_json = ?, reasons_json = ?, changes_json = ?, child_age = ?, comment = ?, style = COALESCE(?, style), lang = COALESCE(?, lang),
        submitted_at = COALESCE(submitted_at, now_iso()), updated_at = now_iso() WHERE id = ?`,
      [stars, JSON.stringify(pick(b.liked, LIKED)), JSON.stringify(pick(b.reasons, REASONS)), JSON.stringify(pick(b.changes, CHANGES)), age, comment, style, lang, f.id]);
      await bumpLists(t, f.customer_id, 'Feedback received', null);
      // Already said yes to the website: the review follows the changed answer (or is taken off if it no longer fits).
      if (f.website_answer) await reviews.syncFromFeedback(t, f.id);
    });
    await send(res, req.params.token);
  });
  // The customer's answer to "may we show this on our website?". They can change it at any time, even after the week.
  app.post('/api/public/feedback/:token/website', async (req, res) => {
    const f = await load(req.params.token);
    if (!f.submitted_at) throw bad('Please send your answer first');
    const answer = oneOf((req.body || {}).answer, ['yes', 'no'], { name: 'Answer', required: true });
    if (answer === 'yes' && !reviews.eligible(f)) throw bad('Only a 4 or 5 star answer with a few words can go on the website');
    await db.tx(async t => {
      await t.run('UPDATE feedback SET website_answer = ?, website_answer_at = now_iso(), updated_at = now_iso() WHERE id = ?', [answer, f.id]);
      await reviews.syncFromFeedback(t, f.id);
    });
    await send(res, req.params.token);
  });
  // Tapped "write a review on the website": they are not asked the website question after that.
  app.post('/api/public/feedback/:token/review-click', async (req, res) => {
    const f = await load(req.params.token);
    if (f.submitted_at && !f.review_clicked_at) await db.run('UPDATE feedback SET review_clicked_at = now_iso() WHERE id = ?', [f.id]);
    res.set('Cache-Control', 'no-store'); res.json({ ok: true });
  });
}

module.exports.publicRoutes = publicRoutes;
module.exports.bumpLists = bumpLists;
module.exports.feedbackRow = feedbackRow;
module.exports.STATUSES = STATUSES;
module.exports.LIKED = LIKED;
module.exports.REASONS = REASONS;
module.exports.CHANGES = CHANGES;
module.exports.AGES = AGES;
