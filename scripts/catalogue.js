'use strict';
// The real Nalla Malayalam product list. ensureCatalogue creates any product that is missing; it changes an existing
// one only when called with { update: true } (npm run catalogue:update), which resets names, MRP and prices to this list.
const BOOKS = [
  // key, sku, name, category, mrp, price   (names and single-book prices from nallamalayalam.in/books, 18 Nov 2026)
  ['NM1', 'NM-P1', 'Nalla Malayalam - Part 1', 'Nalla Malayalam', 320, 320],
  ['NM2', 'NM-P2', 'Nalla Malayalam - Part 2', 'Nalla Malayalam', 280, 280],
  ['MAMB', 'KVS1-1', 'Mambazhakkallan', 'Kuttivayana Series 1', 95, 95],
  ['CHAN', 'KVS1-2', 'Changattham', 'Kuttivayana Series 1', 100, 100],
  ['MITT', 'KVS1-3', 'Mittuvum Makkalum', 'Kuttivayana Series 1', 95, 95],
  ['AKSH', 'KVS1-4', 'Aksharappattukal', 'Kuttivayana Series 1', 100, 100],
  ['DOLP', 'KVS2-1', 'Dolphinte Aagraham', 'Kuttivayana Series 2', 95, 95],
  ['PACH', 'KVS2-2', 'Pachakkarippattukal', 'Kuttivayana Series 2', 95, 95],
  ['KOOT', 'KVS2-3', 'Koottinte Kathakal', 'Kuttivayana Series 2', 95, 95],
  ['NAKS', 'KVS2-4', 'Kunjunakshathrathinte Katha', 'Kuttivayana Series 2', 95, 95],
  // Series 3 titles: the four remaining ₹95 story books on the website (their prices add up to the ₹380 set).
  ['K3A', 'KVS3-1', 'Appooppan Maram', 'Kuttivayana Series 3', 95, 95],
  ['K3B', 'KVS3-2', 'Kunjananayum Kunjikiliyum', 'Kuttivayana Series 3', 95, 95],
  ['K3C', 'KVS3-3', 'Mazhayude Santhosham', 'Kuttivayana Series 3', 95, 95],
  ['K3D', 'KVS3-4', 'Spider Kuttappan', 'Kuttivayana Series 3', 95, 95],
  ['OTHER', 'OTHER', 'Other titles', 'Other', null, 0],
];
// Set prices are the tele-sales (WhatsApp) prices: MRP less 15% for NM 1+2 and KVS 1+2+3, less 10% for KVS 1+2.
const PACKS = [
  ['NMCOMBO', 'NM-COMBO', 'Nalla Malayalam - Bundle (Part 1 + Part 2)', 'Nalla Malayalam', 600, 510, ['NM1', 'NM2']],
  ['KVS1', 'KVS1', 'Kuttivayana Series 1 (set of 4)', 'Kuttivayana Series 1', 390, 390, ['MAMB', 'CHAN', 'MITT', 'AKSH']],
  ['KVS2', 'KVS2', 'Kuttivayana Series 2 (set of 4)', 'Kuttivayana Series 2', 380, 380, ['DOLP', 'PACH', 'KOOT', 'NAKS']],
  ['KVS3', 'KVS3', 'Kuttivayana Series 3 (set of 4)', 'Kuttivayana Series 3', 380, 380, ['K3A', 'K3B', 'K3C', 'K3D']],
  ['KVSCOMBO', 'KVS-COMBO', 'Kuttivayana Bundle 1 (Series 1 + 2, set of 8)', 'Kuttivayana', 770, 690, ['MAMB', 'CHAN', 'MITT', 'AKSH', 'DOLP', 'PACH', 'KOOT', 'NAKS']],
  ['KVSALL', 'KVS-BUNDLE2', 'Kuttivayana Bundle 2 (Series 1 + 2 + 3, set of 12)', 'Kuttivayana', 1150, 978, ['MAMB', 'CHAN', 'MITT', 'AKSH', 'DOLP', 'PACH', 'KOOT', 'NAKS', 'K3A', 'K3B', 'K3C', 'K3D']],
];

// Website and Amazon prices, from the discount plan (% off MRP), in whole rupees.
// Website: NM 1+2 18%, KVS 1+2 15% (₹654.50 on the site, held here as ₹655), KVS 1+2+3 20%. Amazon / Flipkart: 10%.
const CHANNEL_PRICES = {
  NMCOMBO: { Website: 492, Amazon: 540 },
  KVSCOMBO: { Website: 655, Amazon: 693 },
  KVSALL: { Website: 920, Amazon: 1035 },
};

// Cost per copy, from the costing sheet (18 Nov 2026): [printing, packing, postal, misc, ad cost, Amazon fee, royalty %, commission %].
// KVS3 and the 12-book bundle follow the sheet's pattern (packing 15, misc 30, ad 75, royalty 15%, commission 7%); the bundle's
// printing is the three series added up. Single story books have no costs here: enter them on the Costs & profit page.
const COSTS = {
  NM1: [45, 15, 0, 30, 75, 0, 15, 7], NM2: [35, 15, 0, 30, 75, 0, 15, 7], NMCOMBO: [80, 15, 42, 30, 75, 0, 15, 7],
  KVS1: [116, 15, 0, 30, 75, 0, 15, 7], KVS2: [92, 15, 0, 30, 75, 40, 15, 7], KVS3: [76, 15, 0, 30, 75, 0, 15, 7],
  KVSCOMBO: [208, 15, 42, 30, 75, 0, 15, 7], KVSALL: [284, 15, 42, 30, 75, 0, 15, 7],
};

/** Returns { key: { id, price } }. `t` is a db or transaction handle. */
async function ensureCatalogue(t, { update = false } = {}) {
  const out = {}; let created = 0, updated = 0;
  const upsert = async (key, sku, name, category, mrp, price, kind) => {
    let b = await t.get('SELECT id, price FROM books WHERE lower(sku) = lower(?)', [sku]);
    if (!b) { b = await t.get('INSERT INTO books (sku, name, category, kind, mrp, price) VALUES (?,?,?,?,?,?) RETURNING id, price', [sku, name, category, kind, mrp, price]); created++; b.isNew = true; }
    else if (update) { await t.run('UPDATE books SET name = ?, category = ?, mrp = ?, price = ?, updated_at = now_iso() WHERE id = ?', [name, category, mrp, price, b.id]); b.price = price; updated++; }
    out[key] = b; return b;
  };
  for (const [key, sku, name, cat, mrp, price] of BOOKS) await upsert(key, sku, name, cat, mrp, price, 'Book');
  for (const [key, sku, name, cat, mrp, price, parts] of PACKS) {
    const p = await upsert(key, sku, name, cat, mrp, price, 'Pack');
    if (p.isNew || update) for (const [ch, amount] of Object.entries(CHANNEL_PRICES[key] || {})) {
      await t.run('INSERT INTO book_prices (book_id, channel_key, price) VALUES (?,?,?) ON CONFLICT (book_id, channel_key) DO UPDATE SET price = EXCLUDED.price', [p.id, ch, amount]);
    }
    if (p.isNew) for (const k of parts) await t.run('INSERT INTO pack_items (pack_id, book_id, qty) VALUES (?,?,1)', [p.id, out[k].id]);
  }
  // Costs are filled in only where a product has none yet, so figures edited in the app are never overwritten.
  for (const [key, v] of Object.entries(COSTS)) {
    await t.run(`INSERT INTO book_costs (book_id, printing, packing, postal, misc, ad_cost, amazon_fee, royalty_pct, commission_pct) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (book_id) DO NOTHING`, [out[key].id, ...v]);
  }
  return { products: out, created, updated };
}
module.exports = { ensureCatalogue };
