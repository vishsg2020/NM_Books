'use strict';
// Website reviews (Customers → Website reviews): reviews customers agreed to show on nallamalayalam.in.
// They come from the feedback link (the customer says yes when asked) or are added by the team for praise that came
// on WhatsApp, a call, Google or Instagram, with a note of how the customer agreed. The Admin or a Manager approves
// each one; the approved ones are downloaded as an Excel file for the website.
const { audit } = require('../audit');
const { bad, notFound, str, oneOf, idParam, HttpError } = require('../util');

const SOURCES = [['feedback', 'Feedback link'], ['whatsapp', 'WhatsApp'], ['call', 'Call'], ['google', 'Google'], ['instagram', 'Instagram'], ['other', 'Other']];
const AGES = ['3-5', '6-8', '9-12', '12+'];
const MIN_STARS = 4;          // the website question is asked only for 4 or 5 stars with a comment
const canApprove = u => !!u && (u.role === 'admin' || u.role === 'manager');
const seesCustomers = u => !!u && ['admin', 'manager', 'viewer'].includes(u.role);

/** 'ml', 'en' or 'mixed', from the letters used. */
function language(text) {
  const ml = (String(text).match(/[ഀ-ൿ]/g) || []).length;
  const en = (String(text).match(/[A-Za-z]/g) || []).length;
  if (!ml) return 'en';
  if (!en) return 'ml';
  const share = ml / (ml + en);
  return share >= 0.8 ? 'ml' : share <= 0.2 ? 'en' : 'mixed';
}
/** The name shown on the website: the first word of the customer's name, tidied ("ANITHA" → "Anitha"). */
function nameShown(name) {
  let n = String(name || '').trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}.'-]/gu, '').slice(0, 40);
  if (/^name\b/i.test(n)) return '';
  if (/^[A-Za-z.'-]+$/.test(n) && (n === n.toUpperCase() || n === n.toLowerCase())) n = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  return n;
}
const placeShown = c => String((c && (c.location || c.state)) || '').trim().slice(0, 40) || null;
const eligible = f => Number(f.stars) >= MIN_STARS && String(f.comment || '').trim().length >= 3;

/** The book a review is about: from the customer's latest order (a set or bundle first). */
async function bookFor(t, customerId) {
  const r = await t.get(`SELECT si.book_id FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN books b ON b.id = si.book_id
    WHERE s.customer_id = ? AND s.status <> 'Cancelled' ORDER BY s.sale_date DESC, s.id DESC, (b.kind = 'Pack') DESC, si.id LIMIT 1`, [customerId]);
  return r ? r.book_id : null;
}

/**
 * Keeps the website review that belongs to a feedback answer in step with it. Called after the customer sends or
 * changes their answer, and after they answer the website question. Yes (and still 4–5 stars with a comment): the
 * review is there, waiting for approval, with their latest words. No, or no longer eligible: it is withdrawn.
 */
async function syncFromFeedback(t, feedbackId) {
  const f = await t.get(`SELECT f.*, c.name, c.location, c.state FROM feedback f JOIN customers c ON c.id = f.customer_id WHERE f.id = ?`, [feedbackId]);
  if (!f) return;
  const r = await t.get('SELECT * FROM website_reviews WHERE feedback_id = ? FOR UPDATE', [f.id]);
  const comment = String(f.comment || '').trim();
  if (f.website_answer === 'yes' && eligible(f)) {
    if (!r) {
      const ins = await t.get(`INSERT INTO website_reviews (feedback_id, customer_id, name_shown, place_shown, child_age, stars, text, original_text, language, book_id, source, consent_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'feedback',?) RETURNING id`,
      [f.id, f.customer_id, nameShown(f.name) || 'A parent', placeShown(f), f.child_age, f.stars, comment, comment, language(comment), await bookFor(t, f.customer_id), f.website_answer_at]);
      await audit(t, null, 'website_review', ins.id, 'review_given', null, { feedback_id: f.id, stars: f.stars });
      return;
    }
    const changed = r.original_text !== comment || r.stars !== f.stars || (r.child_age || null) !== (f.child_age || null);
    if (!changed && r.status !== 'withdrawn') return;
    // New words go back for approval (a hidden review stays hidden).
    const status = r.status === 'hidden' ? 'hidden' : 'waiting';
    await t.run(`UPDATE website_reviews SET stars = ?, text = ?, original_text = ?, language = ?, child_age = ?, status = ?, consent_at = ?,
      reviewed_by = NULL, reviewed_at = NULL, updated_at = now_iso() WHERE id = ?`, [f.stars, comment, comment, language(comment), f.child_age, status, f.website_answer_at, r.id]);
    await audit(t, null, 'website_review', r.id, 'review_changed_by_customer', { status: r.status, stars: r.stars, text: r.original_text }, { status, stars: f.stars, text: comment });
  } else if (r && r.status !== 'withdrawn') {
    await t.run(`UPDATE website_reviews SET status = 'withdrawn', updated_at = now_iso() WHERE id = ?`, [r.id]);
    await audit(t, null, 'website_review', r.id, 'review_withdrawn', { status: r.status }, { status: 'withdrawn' }, f.website_answer === 'no' ? 'The customer said no' : 'The answer changed below 4 stars or lost its comment');
  }
}

const COLS = `r.*, b.name AS book_name, c.name AS customer_name, c.code AS customer_code, cu.name AS created_by_name, ru.name AS reviewed_by_name, ku.name AS consent_by_name`;
const FROM = `FROM website_reviews r LEFT JOIN books b ON b.id = r.book_id LEFT JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users ru ON ru.id = r.reviewed_by LEFT JOIN users ku ON ku.id = r.consent_by`;
const rowOut = (r, user) => ({
  id: r.id, feedback_id: r.feedback_id, name_shown: r.name_shown, place_shown: r.place_shown, child_age: r.child_age, stars: r.stars,
  text: r.text, original_text: r.original_text, edited: r.text !== r.original_text, language: r.language, book_id: r.book_id, book_name: r.book_name,
  source: r.source, consent_at: r.consent_at, consent_note: r.consent_note, consent_by_name: r.consent_by_name, status: r.status,
  reviewed_by_name: r.reviewed_by_name, reviewed_at: r.reviewed_at, created_by_name: r.created_by_name, created_at: r.created_at,
  mine: !!user && r.created_by === user.id,
  // Which customer it is: only for the roles that see every customer.
  customer_id: seesCustomers(user) ? r.customer_id : null, customer_name: seesCustomers(user) ? r.customer_name : null, customer_code: seesCustomers(user) ? r.customer_code : null,
});

function cleanReview(b, { manual }) {
  const out = {
    name_shown: str(b.name_shown, { name: 'Name shown', max: 40, required: true }),
    place_shown: str(b.place_shown, { name: 'Place shown', max: 40 }) || null,
    child_age: b.child_age ? oneOf(b.child_age, AGES, { name: "Child's age" }) : null,
    text: str(b.text, { name: 'Review', max: 1000, required: true }),
    book_id: b.book_id ? idParam(b.book_id) : null,
  };
  if (out.text.trim().length < 3) throw bad('Write the review', { field: 'Review' });
  if (manual) {
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('Choose the stars', { field: 'Stars' });
    out.stars = stars;
  }
  return out;
}

module.exports = (app, { db, perm }) => {
  app.get('/api/website-reviews', perm('customers'), async (req, res) => {
    const u = req.user;
    const status = oneOf(req.query.status || 'waiting', ['waiting', 'approved', 'hidden'], { name: 'Status' });
    const where = ['r.status = ?']; const p = [status];
    // Others than Admin and Manager see the approved ones and those they added themselves.
    if (!canApprove(u) && status !== 'approved') { where.push('r.created_by = ?'); p.push(u.id); }
    if (req.query.source) { where.push('r.source = ?'); p.push(oneOf(req.query.source, SOURCES.map(s => s[0]), { name: 'Source' })); }
    if (req.query.book) { where.push('r.book_id = ?'); p.push(idParam(req.query.book)); }
    const q = str(req.query.q, { max: 80 });
    if (q) { where.push('(r.text ILIKE ? OR r.name_shown ILIKE ? OR r.place_shown ILIKE ?)'); const like = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`; p.push(like, like, like); }
    const rows = await db.all(`SELECT ${COLS} ${FROM} WHERE ${where.join(' AND ')} ORDER BY ${status === 'waiting' ? 'r.id' : 'COALESCE(r.reviewed_at, r.created_at) DESC, r.id DESC'} LIMIT 500`, p);
    const counts = await db.get(`SELECT COUNT(*) FILTER (WHERE status = 'waiting') AS waiting, COUNT(*) FILTER (WHERE status = 'approved') AS approved,
      COUNT(*) FILTER (WHERE status = 'hidden') AS hidden, AVG(stars) FILTER (WHERE status = 'approved') AS avg FROM website_reviews`);
    res.json({ rows: rows.map(r => rowOut(r, u)), counts: { waiting: counts.waiting, approved: counts.approved, hidden: counts.hidden },
      average: counts.avg === null ? null : Math.round(Number(counts.avg) * 10) / 10, can_approve: canApprove(u), sources: SOURCES, ages: AGES });
  });

  // Praise that came another way (WhatsApp, a call, Google, Instagram): the person adding it notes how the customer agreed.
  app.post('/api/website-reviews', perm('customers'), async (req, res) => {
    const b = req.body || {};
    const v = cleanReview(b, { manual: true });
    const source = oneOf(b.source, SOURCES.map(s => s[0]).filter(s => s !== 'feedback'), { name: 'Where it came from', required: true });
    if (b.consent !== true) throw bad('Tick that the customer agreed to show this on the website', { field: 'Customer agreed' });
    const note = str(b.consent_note, { name: 'How they agreed', max: 300, required: true });
    const customerId = b.customer_id ? idParam(b.customer_id) : null;
    if (customerId && !(await db.get('SELECT 1 FROM customers WHERE id = ?', [customerId]))) throw notFound('Customer');
    if (v.book_id && !(await db.get('SELECT 1 FROM books WHERE id = ?', [v.book_id]))) throw notFound('Book');
    const id = await db.tx(async t => {
      const r = await t.get(`INSERT INTO website_reviews (customer_id, name_shown, place_shown, child_age, stars, text, original_text, language, book_id, source,
          consent_at, consent_by, consent_note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?, now_iso(), ?,?,?) RETURNING id`,
      [customerId, v.name_shown, v.place_shown, v.child_age, v.stars, v.text, v.text, language(v.text), v.book_id, source, req.user.id, note, req.user.id]);
      await audit(t, req.user, 'website_review', r.id, 'review_added', null, { source, stars: v.stars, name_shown: v.name_shown, consent_note: note });
      return r.id;
    });
    res.status(201).json(rowOut(await db.get(`SELECT ${COLS} ${FROM} WHERE r.id = ?`, [id]), req.user));
  });

  // Fix spelling or shorten: the customer's own words stay in original_text.
  app.put('/api/website-reviews/:id', perm('customers'), async (req, res) => {
    const id = idParam(req.params.id);
    const out = await db.tx(async t => {
      const r = await t.get('SELECT * FROM website_reviews WHERE id = ? FOR UPDATE', [id]);
      if (!r) throw notFound('Review');
      if (!canApprove(req.user) && !(r.created_by === req.user.id && r.status === 'waiting')) throw new HttpError(403, 'Only the Admin or a Manager can change this review');
      if (r.status === 'withdrawn') throw bad('The customer took this review back');
      const v = cleanReview(req.body || {}, { manual: r.source !== 'feedback' });
      if (v.book_id && !(await t.get('SELECT 1 FROM books WHERE id = ?', [v.book_id]))) throw notFound('Book');
      const next = { name_shown: v.name_shown, place_shown: v.place_shown, child_age: v.child_age, text: v.text, book_id: v.book_id, stars: v.stars || r.stars };
      // A team-added review's own words are what was typed; changing them changes the original too while it waits.
      const original = r.source !== 'feedback' && r.status === 'waiting' ? v.text : r.original_text;
      await t.run(`UPDATE website_reviews SET name_shown = ?, place_shown = ?, child_age = ?, text = ?, original_text = ?, language = ?, book_id = ?, stars = ?, updated_at = now_iso() WHERE id = ?`,
        [next.name_shown, next.place_shown, next.child_age, next.text, original, language(next.text), next.book_id, next.stars, id]);
      await audit(t, req.user, 'website_review', id, 'review_edited',
        { name_shown: r.name_shown, place_shown: r.place_shown, child_age: r.child_age, text: r.text, book_id: r.book_id, stars: r.stars }, next);
      return id;
    });
    res.json(rowOut(await db.get(`SELECT ${COLS} ${FROM} WHERE r.id = ?`, [out]), req.user));
  });

  // Approve, hide, or put back to waiting: one or several at once (Admin and Manager).
  app.post('/api/website-reviews/status', perm('customers'), async (req, res) => {
    if (!canApprove(req.user)) throw new HttpError(403, 'Only the Admin or a Manager can approve or hide reviews');
    const status = oneOf(req.body.status, ['approved', 'hidden', 'waiting'], { name: 'Status', required: true });
    const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(idParam))].filter(i => i > 0);
    if (!ids.length) throw bad('Choose the reviews');
    if (ids.length > 200) throw bad('Up to 200 reviews at a time');
    let changed = 0;
    await db.tx(async t => {
      for (const r of await t.all('SELECT id, status FROM website_reviews WHERE id = ANY(?::int[]) FOR UPDATE', [ids])) {
        if (r.status === 'withdrawn' || r.status === status) continue;
        await t.run('UPDATE website_reviews SET status = ?, reviewed_by = ?, reviewed_at = now_iso(), updated_at = now_iso() WHERE id = ?', [status, req.user.id, r.id]);
        await audit(t, req.user, 'website_review', r.id, `review_${status}`, { status: r.status }, { status });
        changed++;
      }
    });
    res.json({ changed });
  });

  // The approved reviews as an Excel file, to add to the website by hand.
  app.get('/api/website-reviews/download.xlsx', perm('customers'), async (req, res) => {
    if (!canApprove(req.user)) throw new HttpError(403, 'Only the Admin or a Manager can download the reviews');
    const rows = await db.all(`SELECT ${COLS} ${FROM} WHERE r.status = 'approved' ORDER BY r.reviewed_at DESC, r.id DESC`);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook(); wb.creator = 'Nalla Malayalam';
    const ws = wb.addWorksheet('Website reviews');
    ws.columns = [
      { header: 'Name', key: 'name', width: 16 }, { header: 'Place', key: 'place', width: 16 }, { header: 'About', key: 'about', width: 30 },
      { header: 'Stars', key: 'stars', width: 7 }, { header: 'Review', key: 'text', width: 70 }, { header: 'Book', key: 'book', width: 30 },
      { header: 'Language', key: 'lang', width: 11 }, { header: 'Date', key: 'date', width: 12 }, { header: 'From', key: 'source', width: 14 },
    ];
    const LANG = { ml: 'Malayalam', en: 'English', mixed: 'Both' };
    for (const r of rows) {
      ws.addRow({ name: r.name_shown, place: r.place_shown || '', about: r.child_age ? `Parent of a ${r.child_age.replace('-', '–')} year old` : '', stars: r.stars, text: r.text,
        book: r.book_name || '', lang: LANG[r.language], date: String(r.consent_at || r.created_at).slice(0, 10), source: (SOURCES.find(s => s[0] === r.source) || [])[1] });
    }
    ws.getRow(1).font = { bold: true }; ws.getColumn('text').alignment = { wrapText: true, vertical: 'top' }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    await audit(db, req.user, 'website_review', null, 'reviews_exported', null, { count: rows.length });
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="nalla-malayalam-website-reviews.xlsx"', 'Cache-Control': 'no-store', 'X-Review-Count': String(rows.length) });
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
};

module.exports.syncFromFeedback = syncFromFeedback;
module.exports.bookFor = bookFor;
module.exports.eligible = eligible;
module.exports.nameShown = nameShown;
module.exports.placeShown = placeShown;
module.exports.language = language;
module.exports.AGES = AGES;
module.exports.SOURCES = SOURCES;
