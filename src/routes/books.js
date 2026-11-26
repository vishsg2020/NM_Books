'use strict';
const { audit, history } = require('../audit');
const { moveStock } = require('../stock');
const { bad, notFound, conflict, str, int, money, bool, oneOf, idParam } = require('../util');
const P = require('../prices');

// A pack has no stock of its own: its available figure is how many whole packs the books inside allow.
const COLS = `b.id, b.sku, b.name, b.category, b.kind, b.mrp, b.price, b.description, b.min_stock, b.on_hand, b.reserved,
  CASE WHEN b.kind = 'Pack' THEN COALESCE((SELECT MIN((c.on_hand - c.reserved) / pi.qty) FROM pack_items pi JOIN books c ON c.id = pi.book_id WHERE pi.pack_id = b.id), 0)
       ELSE b.on_hand - b.reserved END AS available,
  (SELECT string_agg(c.name || CASE WHEN pi.qty > 1 THEN ' × ' || pi.qty ELSE '' END, ', ' ORDER BY c.name) FROM pack_items pi JOIN books c ON c.id = pi.book_id WHERE pi.pack_id = b.id) AS contents,
  b.discount_group, b.name_ml, b.author, b.website_url, b.amazon_url,
  b.active, b.created_at, b.updated_at`;

function fields(b, base = {}) {
  const out = { ...base };
  if (b.sku !== undefined || !('sku' in base)) out.sku = str(b.sku, { required: true, name: 'Book ID / SKU', max: 40 });
  if (b.name !== undefined || !('name' in base)) out.name = str(b.name, { required: true, name: 'Book name', max: 200 });
  if (b.category !== undefined || !('category' in base)) out.category = str(b.category, { name: 'Category / Series', max: 100 });
  if (b.price !== undefined || !('price' in base)) out.price = money(b.price, { required: true, name: 'Selling price', max: 1000000 });
  if (b.mrp !== undefined || !('mrp' in base)) out.mrp = money(b.mrp, { name: 'MRP', max: 1000000 });
  if (b.description !== undefined || !('description' in base)) out.description = str(b.description, { name: 'Description', max: 2000 });
  if (b.min_stock !== undefined || !('min_stock' in base)) out.min_stock = int(b.min_stock, { min: 0, max: 1000000, name: 'Minimum stock level' }) ?? 0;
  if (b.active !== undefined) out.active = bool(b.active) ? 1 : 0;
  if (b.name_ml !== undefined || !('name_ml' in base)) out.name_ml = str(b.name_ml, { name: 'Malayalam title', max: 200 }) || null;
  if (b.author !== undefined || !('author' in base)) out.author = str(b.author, { name: 'Author', max: 200 }) || null;
  for (const [k, label] of [['website_url', 'Website link'], ['amazon_url', 'Amazon link']]) {
    if (b[k] === undefined && k in base) continue;
    const v = str(b[k], { name: label, max: 500 }) || null;
    if (v && !/^https:\/\/\S+$/.test(v)) throw bad(`${label} must start with https://`, { field: label });
    out[k] = v;
  }
  if (b.discount_group !== undefined) out.discount_group = b.discount_group ? oneOf(b.discount_group, P.GROUPS.map(g => g[0]), { name: 'Discount group' }) : null;
  return out;
}

module.exports = (app, { db, perm }) => {
  // Every book row leaves with its channel prices worked out from the discounts (null for books sold at MRP).
  const withPrices = async rows => { const d = await P.getDiscounts(db); for (const b of [].concat(rows)) if (b) b.prices = P.pricesOf(b, d); return rows; };
  async function assertUnique(f, exceptId = -1) {
    if (await db.get('SELECT 1 AS x FROM books WHERE lower(sku) = lower(?) AND id <> ?', [f.sku, exceptId])) throw conflict('Another book already uses this Book ID / SKU', { field: 'Book ID / SKU' });
    if (await db.get('SELECT 1 AS x FROM books WHERE lower(name) = lower(?) AND id <> ?', [f.name, exceptId])) throw conflict('Another book already has this name', { field: 'Book name' });
  }

  // Everyone signed in can read the Book Master: sales entry and dispatch both select from it.
  app.get('/api/books', async (req, res) => {
    const where = []; const p = {};
    if (req.query.active === '1') where.push('b.active = 1');
    if (req.query.active === '0') where.push('b.active = 0');
    if (req.query.low === '1') where.push("b.active = 1 AND b.kind = 'Book' AND (b.on_hand - b.reserved) <= b.min_stock");
    if (req.query.kind === 'Book' || req.query.kind === 'Pack') { where.push('b.kind = @kind'); p.kind = req.query.kind; }
    if (req.query.category) { where.push('b.category = @category'); p.category = String(req.query.category); }
    if (req.query.q) { where.push("(b.name ILIKE @q OR b.sku ILIKE @q OR b.category ILIKE @q OR b.name_ml ILIKE @q OR b.author ILIKE @q)"); p.q = '%' + String(req.query.q).replace(/[%_\\]/g, '\\$&') + '%'; }
    res.json(await withPrices(await db.all(`SELECT ${COLS} FROM books b ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.active DESC, b.kind DESC, b.category NULLS LAST, b.name`, p)));
  });

  app.get('/api/books/:id', async (req, res) => {
    const book = await db.get(`SELECT ${COLS} FROM books b WHERE b.id = ?`, [idParam(req.params.id)]);
    if (!book) throw notFound('Book');
    await withPrices(book);
    const canSeeHistory = ['admin', 'manager'].includes(req.user.role);
    const items = await db.all('SELECT pi.book_id, pi.qty, c.name FROM pack_items pi JOIN books c ON c.id = pi.book_id WHERE pi.pack_id = ? ORDER BY c.name', [book.id]);
    res.json({ ...book, items, history: canSeeHistory ? await history(db, 'book', book.id) : [] });
  });

  /** Reads the books inside a pack from the request: [{ book_id, qty }]. Only single books can go in a pack. */
  async function packItems(list) {
    if (!Array.isArray(list) || !list.length) throw bad('Choose the books in this set or combo', { field: 'Books in the set' });
    const items = list.map(i => ({ book_id: int(i && i.book_id, { required: true, min: 1, name: 'Book in the set' }), qty: int(i && i.qty, { min: 1, max: 100, name: 'Copies in the set' }) ?? 1 }));
    if (new Set(items.map(i => i.book_id)).size !== items.length) throw bad('A book is listed twice in the set', { field: 'Books in the set' });
    const found = await db.all(`SELECT id FROM books WHERE kind = 'Book' AND id = ANY(?::int[])`, [items.map(i => i.book_id)]);
    if (found.length !== items.length) throw bad('A set can only contain single books from the Book Master', { field: 'Books in the set' });
    return items;
  }

  app.post('/api/books', perm('books'), async (req, res) => {
    const f = fields(req.body);
    const kind = oneOf(req.body.kind, ['Book', 'Pack'], { name: 'Type' }) || 'Book';
    const items = kind === 'Pack' ? await packItems(req.body.items) : [];
    const opening = kind === 'Pack' ? 0 : int(req.body.opening_stock, { min: 0, max: 1000000, name: 'Opening stock' }) ?? 0;
    await assertUnique(f);
    const id = await db.tx(async t => {
      const r = await t.get(`INSERT INTO books (sku, name, category, kind, mrp, price, description, min_stock, active, discount_group, name_ml, author, website_url, amazon_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        [f.sku, f.name, f.category, kind, f.mrp, f.price, f.description, kind === 'Pack' ? 0 : f.min_stock, f.active ?? 1, f.discount_group || null, f.name_ml, f.author, f.website_url, f.amazon_url]);
      for (const it of items) await t.run('INSERT INTO pack_items (pack_id, book_id, qty) VALUES (?,?,?)', [r.id, it.book_id, it.qty]);
      if (opening > 0) await moveStock(t, { bookId: r.id, type: 'Opening stock', qty: opening, user: req.user });
      await audit(t, req.user, 'book', r.id, 'created', null, { ...f, kind, opening_stock: opening, items: items.length ? items : undefined });
      return r.id;
    });
    res.status(201).json(await withPrices(await db.get(`SELECT ${COLS} FROM books b WHERE b.id = ?`, [id])));
  });

  // Stock figures are never edited here; they change only through stock movements.
  app.patch('/api/books/:id', perm('books'), async (req, res) => {
    const before = await db.get('SELECT id, sku, name, category, kind, mrp, price, description, min_stock, active, discount_group, name_ml, author, website_url, amazon_url FROM books WHERE id = ?', [idParam(req.params.id)]);
    if (!before) throw notFound('Book');
    const next = fields(req.body, before);
    await assertUnique(next, before.id);
    // Read outside the transaction: the local database has a single connection.
    const newItems = before.kind === 'Pack' && req.body.items !== undefined ? await packItems(req.body.items) : null;
    await db.tx(async t => {
      await t.run(`UPDATE books SET sku = ?, name = ?, category = ?, mrp = ?, price = ?, description = ?, min_stock = ?, active = ?, discount_group = ?,
          name_ml = ?, author = ?, website_url = ?, amazon_url = ?, updated_at = now_iso() WHERE id = ?`,
        [next.sku, next.name, next.category, next.mrp, next.price, next.description, next.kind === 'Pack' ? 0 : next.min_stock, next.active, next.discount_group || null,
          next.name_ml, next.author, next.website_url, next.amazon_url, before.id]);
      // The books inside a set can be changed only while no sale uses it, so open orders always release the right stock.
      if (newItems) {
        const items = newItems;
        const cur = await t.all('SELECT book_id, qty FROM pack_items WHERE pack_id = ? ORDER BY book_id', [before.id]);
        const same = JSON.stringify(cur) === JSON.stringify([...items].sort((a, b) => a.book_id - b.book_id));
        if (!same) {
          if (await t.get('SELECT 1 AS x FROM sale_items WHERE book_id = ? LIMIT 1', [before.id])) throw conflict('This set has already been sold, so its books cannot be changed. Make it inactive and add a new set instead.', { field: 'Books in the set' });
          await t.run('DELETE FROM pack_items WHERE pack_id = ?', [before.id]);
          for (const it of items) await t.run('INSERT INTO pack_items (pack_id, book_id, qty) VALUES (?,?,?)', [before.id, it.book_id, it.qty]);
          await audit(t, req.user, 'book', before.id, 'set_contents_changed', { items: cur }, { items });
        }
      }
      await audit(t, req.user, 'book', before.id, 'updated', before, next);
    });
    res.json(await withPrices(await db.get(`SELECT ${COLS} FROM books b WHERE b.id = ?`, [before.id])));
  });
};
