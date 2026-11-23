'use strict';
// Costs & profit: what each book or set costs, what is left at each price, and an estimate of profit on what was sold.
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { getCostRules } = require('../settings');
const { bad, notFound, idParam, isValidDate } = require('../util');

const AMOUNTS = [['printing', 'Printing'], ['packing', 'Packing'], ['postal', 'Postal'], ['misc', 'Misc'], ['ad_cost', 'Ad cost'], ['amazon_fee', 'Amazon fee']];
const PCTS = [['royalty_pct', 'Royalty %'], ['commission_pct', 'Commission %']];
const r2 = n => Math.round(n * 100) / 100;

/**
 * Which costs apply to a sale, by how it was sold:
 *   tele     printing, packing, misc, royalty + postal, ad cost, sales commission
 *   website  as tele-sales, without the sales commission (nobody takes the order by phone)
 *   amazon   printing, packing, misc, royalty + the Amazon fee (no postal, ad cost or commission)
 *   onsite   printing, packing, misc, royalty only (handed over in person)
 */
function unitCost(c, price, mode, rules) {
  const on = new Set(rules[mode] || []);
  let cost = 0;
  for (const k of ['printing', 'packing', 'postal', 'misc', 'ad_cost', 'amazon_fee']) if (on.has(k)) cost += c[k];
  if (on.has('royalty')) cost += (c.royalty_pct / 100) * price;
  if (on.has('commission')) cost += (c.commission_pct / 100) * price;
  return cost;
}
const modeOf = (channel, platform) => (channel === 'Onsite' ? 'onsite' : channel === 'Online' ? (platform === 'Website' ? 'website' : 'amazon') : 'tele');
const P = require('../prices');

module.exports = (app, { db }) => {
  app.get('/api/profit', requireRole('admin', 'manager'), async (req, res) => {
    const q = req.query; const where = [`s.status <> 'Cancelled'`]; const p = {}; const rules = await getCostRules(db);
    if (q.date_from) { if (!isValidDate(q.date_from)) throw bad('From date is not valid'); where.push('s.sale_date >= @from'); p.from = q.date_from; }
    if (q.date_to) { if (!isValidDate(q.date_to)) throw bad('To date is not valid'); where.push('s.sale_date <= @to'); p.to = q.date_to; }
    const books = await db.all(`SELECT b.id, b.sku, b.name, b.kind, b.category, b.mrp, b.price, b.active,
        b.discount_group,
        c.printing, c.packing, c.postal, c.misc, c.ad_cost, c.amazon_fee, c.royalty_pct, c.commission_pct, (c.book_id IS NOT NULL) AS has_costs
      FROM books b LEFT JOIN book_costs c ON c.book_id = b.id WHERE b.sku <> 'OTHER' ORDER BY b.kind DESC, b.category NULLS LAST, b.name`);
    const discounts = await P.getDiscounts(db);
    const sold = await db.all(`SELECT i.book_id, s.channel, s.platform, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue
      FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${where.join(' AND ')} GROUP BY i.book_id, s.channel, s.platform`, p);
    const rows = books.map(b => {
      const c = {}; for (const [k] of [...AMOUNTS, ...PCTS]) c[k] = Number(b[k] || 0);
      const at = (price, mode) => { const cost = unitCost(c, price, mode, rules); return { price, cost: r2(cost), profit: r2(price - cost), margin: price ? r2(((price - cost) / price) * 100) : null }; };
      const tele = at(P.priceOf(b, 'Tele-sales', discounts), 'tele');
      // The lowest tele-sales price that covers every cost (royalty and commission shrink with the price).
      const tOn = new Set(rules.tele);
      const fixed = ['printing', 'packing', 'misc', 'postal', 'ad_cost', 'amazon_fee'].reduce((t, k) => t + (tOn.has(k) ? c[k] : 0), 0);
      const share = 1 - ((tOn.has('royalty') ? c.royalty_pct : 0) + (tOn.has('commission') ? c.commission_pct : 0)) / 100;
      const out = {
        id: b.id, sku: b.sku, name: b.name, kind: b.kind, mrp: b.mrp, price: b.price, active: b.active, has_costs: b.has_costs, costs: c,
        royalty: r2((c.royalty_pct / 100) * b.price), commission: r2((c.commission_pct / 100) * b.price),
        tele, no_ads: r2(tele.profit + (tOn.has('ad_cost') ? c.ad_cost : 0)), no_commission: r2(tele.profit + (tOn.has('commission') ? (c.commission_pct / 100) * b.price : 0)), no_postal: r2(tele.profit + (tOn.has('postal') ? c.postal : 0)),
        website: at(P.priceOf(b, 'Website', discounts), 'website'),
        amazon: at(P.priceOf(b, 'Amazon', discounts), 'amazon'),
        onsite: at(b.price, 'onsite'),
        break_even: share > 0 ? Math.ceil(fixed / share) : null,
        sold: { qty: 0, revenue: 0, cost: 0, profit: 0 },
      };
      for (const s of sold.filter(x => x.book_id === b.id)) {
        // Estimate: each copy carries today's costs; percentage costs follow the price it was actually sold at.
        const cost = s.qty ? unitCost(c, s.revenue / s.qty, modeOf(s.channel, s.platform), rules) * s.qty : 0;
        out.sold.qty += s.qty; out.sold.revenue += s.revenue; out.sold.cost += cost;
      }
      out.sold.cost = r2(out.sold.cost); out.sold.profit = r2(out.sold.revenue - out.sold.cost);
      return out;
    });
    const withCosts = rows.filter(r => r.has_costs);
    const total = withCosts.reduce((t, r) => ({ qty: t.qty + r.sold.qty, revenue: t.revenue + r.sold.revenue, cost: r2(t.cost + r.sold.cost), profit: r2(t.profit + r.sold.profit) }), { qty: 0, revenue: 0, cost: 0, profit: 0 });
    const uncosted = rows.filter(r => !r.has_costs).reduce((t, r) => t + r.sold.revenue, 0);
    res.json({ rows, total, uncosted_revenue: uncosted, rules });
  });

  app.put('/api/books/:id/costs', requireRole('admin'), async (req, res) => {
    const book = await db.get('SELECT id FROM books WHERE id = ?', [idParam(req.params.id)]);
    if (!book) throw notFound('Book');
    const next = {};
    for (const [k, label] of AMOUNTS) { const n = Number(req.body[k] === '' || req.body[k] == null ? 0 : req.body[k]); if (!(n >= 0 && n <= 100000)) throw bad(`${label} must be an amount from 0 upwards`, { field: label }); next[k] = r2(n); }
    for (const [k, label] of PCTS) { const n = Number(req.body[k] === '' || req.body[k] == null ? 0 : req.body[k]); if (!(n >= 0 && n <= 100)) throw bad(`${label} must be between 0 and 100`, { field: label }); next[k] = r2(n); }
    const before = await db.get('SELECT printing, packing, postal, misc, ad_cost, amazon_fee, royalty_pct, commission_pct FROM book_costs WHERE book_id = ?', [book.id]);
    await db.tx(async t => {
      await t.run(`INSERT INTO book_costs (book_id, printing, packing, postal, misc, ad_cost, amazon_fee, royalty_pct, commission_pct) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT (book_id) DO UPDATE SET printing = EXCLUDED.printing, packing = EXCLUDED.packing, postal = EXCLUDED.postal, misc = EXCLUDED.misc, ad_cost = EXCLUDED.ad_cost,
          amazon_fee = EXCLUDED.amazon_fee, royalty_pct = EXCLUDED.royalty_pct, commission_pct = EXCLUDED.commission_pct, updated_at = now_iso()`,
      [book.id, next.printing, next.packing, next.postal, next.misc, next.ad_cost, next.amazon_fee, next.royalty_pct, next.commission_pct]);
      await audit(t, req.user, 'book', book.id, 'costs_updated', before || {}, next);
    });
    res.json({ ok: true });
  });
};
