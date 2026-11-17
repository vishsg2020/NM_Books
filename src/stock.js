'use strict';
// The single place where stock figures change. Every change updates books.on_hand / books.reserved
// (only if the result stays valid) and writes one stock_movements row — always inside the caller's
// transaction, so the figures and the history can never disagree.
const { unprocessable, notFound } = require('./util');

/** What each movement type does to (on_hand, reserved) per copy. */
const EFFECT = {
  'Opening stock':        [+1, 0],
  'Stock received':       [+1, 0],
  'Stock issued':         [-1, 0],
  'Stock reserved':       [0, +1],
  'Reservation released': [0, -1],
  'Stock dispatched':     [-1, -1],
  'Onsite sale':          [-1, 0],
  'Stock returned':       [+1, 0],
  'Damaged stock':        [-1, 0],
  // 'Stock adjustment' is signed and handled by the caller through `direction`.
};

/**
 * Applies one movement. `t` must be a transaction handle.
 * For 'Stock adjustment' pass direction +1 (found extra copies) or -1 (copies missing).
 */
async function moveStock(t, { bookId, type, qty, saleId = null, note = null, user = null, direction = 1 }) {
  const [oh, rs] = type === 'Stock adjustment' ? [direction < 0 ? -1 : 1, 0] : EFFECT[type];
  const dOn = oh * qty, dRes = rs * qty;
  // One atomic statement: the change is applied only if the figures stay valid, so two requests
  // racing for the last copies can never both succeed. (The table's CHECK constraints back this up.)
  const after = await t.get(`UPDATE books SET on_hand = on_hand + @dOn, reserved = reserved + @dRes, updated_at = now_iso()
    WHERE id = @id AND kind = 'Book' AND on_hand + @dOn >= 0 AND reserved + @dRes >= 0 AND reserved + @dRes <= on_hand + @dOn
    RETURNING on_hand, reserved`, { id: bookId, dOn, dRes });
  if (!after) {
    const book = await t.get('SELECT name, kind, on_hand, reserved FROM books WHERE id = ?', [bookId]);
    if (!book) throw notFound('Book');
    if (book.kind === 'Pack') throw unprocessable(`"${book.name}" is a set. Stock is kept for the books inside it, not for the set.`);
    // Dispatch draws on copies already reserved for the order; everything else needs unreserved copies.
    const free = Math.max(type === 'Stock dispatched' ? book.on_hand : book.on_hand - book.reserved, 0);
    throw unprocessable(`Not enough stock of "${book.name}": ${free} available, ${qty} needed.`, { code: 'INSUFFICIENT_STOCK', book_id: bookId, available: free });
  }
  await t.run(`INSERT INTO stock_movements (book_id, type, qty, on_hand_delta, reserved_delta, on_hand_after, reserved_after, sale_id, note, user_id)
               VALUES (?,?,?,?,?,?,?,?,?,?)`, [bookId, type, qty, dOn, dRes, after.on_hand, after.reserved, saleId, note, user ? user.id : null]);
  return { on_hand: after.on_hand, reserved: after.reserved, available: after.on_hand - after.reserved };
}

/**
 * The single books (and copies of each) that a sale's lines stand for: a set or combo line counts as
 * the books inside it. Ordered by book id so concurrent sales lock rows in the same order.
 */
const SALE_STOCK_SQL = `SELECT COALESCE(pi.book_id, i.book_id) AS book_id, SUM(i.qty * COALESCE(pi.qty, 1)) AS qty
  FROM sale_items i LEFT JOIN pack_items pi ON pi.pack_id = i.book_id WHERE i.sale_id = ? GROUP BY 1 ORDER BY 1`;
const saleStock = (t, saleId) => t.all(SALE_STOCK_SQL, [saleId]);

module.exports = { moveStock, saleStock, EFFECT };
