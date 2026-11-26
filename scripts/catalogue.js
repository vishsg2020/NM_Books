'use strict';
// The real Nalla Malayalam product list. ensureCatalogue creates any product that is missing; it changes an existing
// one only when called with { update: true } (npm run catalogue:update), which resets names, MRP and prices to this list.
const W = slug => (slug ? `https://www.nallamalayalam.in/books/${slug}` : null);
// key, sku, name, category, mrp, price, Malayalam title, author, website page
// (from the website admin's Products and Bundles lists, 27 Nov 2026; SKUs are the website's)
const BOOKS = [
  ['NM1', 'NMP1OCT2026', 'Nalla Malayalam - Part 1', 'Nalla Malayalam', 320, 320, 'നല്ലമലയാളം ഭാഗം ഒന്ന് – മാമ്പഴം', 'Ajay Venu Peringassery', W('nalla-malayalam-part-1')],
  ['NM2', 'NMP2OCT2026', 'Nalla Malayalam - Part 2', 'Nalla Malayalam', 280, 280, 'നല്ലമലയാളം ഭാഗം രണ്ട് - കൊളുന്ത്', null, W('nalla-malayalam-part-2')],
  ['MAMB', 'KVS1MAMOCT2026', 'Mambazhakkallan', 'Kuttivayana Series 1', 95, 95, 'മാമ്പഴക്കള്ളൻ', 'Muthumani', W('mambazhakkallan')],
  ['CHAN', 'KVS1CHANGOCT2026', 'Changattham', 'Kuttivayana Series 1', 100, 100, 'ചങ്ങാത്തം', 'Ajay Venu Peringassery', W('changattham')],
  ['MITT', 'KVS1MIMAOCT2026', 'Mittuvum Makkalum', 'Kuttivayana Series 1', 95, 95, 'മിട്ടുവും മക്കളും', null, W('mittuvum-makkalum')],
  ['AKSH', 'KVS1AKSHOCT2026', 'Aksharappattukal', 'Kuttivayana Series 1', 100, 100, 'അക്ഷരപ്പാട്ടുകൾ', 'Ajay Venu Peringassery', W('aksharappattukal')],
  ['DOLP', 'KVS2DOLOCT2026', 'Dolphinte Aagraham', 'Kuttivayana Series 2', 95, 95, 'ഡോൾഫിന്റെ ആഗ്രഹം', 'Ajay Venu Peringassery', W('dolphinte-aagraham')],
  ['PACH', 'KVS2PPOCT2026', 'Pachakkarippattukal', 'Kuttivayana Series 2', 95, 95, 'പച്ചക്കറിപ്പാട്ടുകൾ', 'Jeeshma Krishnan', W('pachakkarippattukal')],
  ['KOOT', 'KVS2KKOCT2026', 'Koottinte Kathakal', 'Kuttivayana Series 2', 95, 95, 'കൂട്ടിന്റെ കഥകൾ', 'Ajay Venu Peringassery', W('koottinte-kathakal')],
  ['NAKS', 'KVS2KNKOCT2026', 'Kunjunakshathrathinte Katha', 'Kuttivayana Series 2', 95, 95, 'കുഞ്ഞുനക്ഷത്രത്തിന്റെ കഥ', 'Jeeshma Krishnan', W('kunjunakshathrathinte-katha')],
  ['K3A', 'KVS3APMNOV2026', 'Appooppan Maram', 'Kuttivayana Series 3', 95, 95, 'അപ്പൂപ്പൻ മരം', null, W('appooppan-maram')],
  ['K3B', 'KVS3KJKLNOV2026', 'Kunjananayum Kunjikiliyum', 'Kuttivayana Series 3', 95, 95, 'കുഞ്ഞനാനയും കുഞ്ഞിക്കിളിയും', null, W('kunjananayum-kunjikiliyum')],
  ['K3C', 'KVS3MZSNOV2026', 'Mazhayude Santhosham', 'Kuttivayana Series 3', 95, 95, 'മഴയുടെ സന്തോഷം', 'Muthumani', W('mazhayude-santhosham')],
  ['K3D', 'KVS3SPKNOV2026', 'Spider Kuttappan', 'Kuttivayana Series 3', 95, 95, 'സ്പൈഡർ കുട്ടപ്പൻ', 'Ajay Venu Peringassery', W('spider-kuttappan')],
  ['OTHER', 'OTHER', 'Other titles', 'Other', null, 0, null, null, null],
];
// Sets sell at their MRP; the channel prices come from Settings → Discounts by the set's discount group
// (NM12: Part 1 + 2; KVS2: two Kuttivayana series; KVS3: all three). The Series 1 + 3 set is sold by phone only.
// key, sku, name, category, mrp, group, parts, Malayalam title, author, website page
const PACKS = [
  ['NMCOMBO', 'NMCOMBOOCT2026', 'Nalla Malayalam - Bundle', 'Nalla Malayalam', 600, 'NM12', ['NM1', 'NM2'], 'നല്ലമലയാളം മാമ്പഴം & കൊളുന്ത്', 'Ajay Venu Peringassery', W('nalla-malayalam-bundle')],
  ['KVS1', 'KVS1BUNDLEOCT2026', 'Nalla Malayalam Kuttivayana Series 1', 'Kuttivayana Series 1', 390, null, ['MAMB', 'CHAN', 'MITT', 'AKSH'], 'നല്ല മലയാളം കുട്ടിവായന സീരീസ് 1', null, W('nalla-malayalam-kuttivayana-series-1')],
  ['KVS2', 'KVS2BUNDLEOCT2026', 'Nalla Malayalam Kuttivayana Series 2', 'Kuttivayana Series 2', 380, null, ['DOLP', 'PACH', 'KOOT', 'NAKS'], 'നല്ല മലയാളം കുട്ടിവായന സീരീസ് 2', null, W('nalla-malayalam-kuttivayana-series-2')],
  ['KVS3', 'KVS3BUNDLENOV2026', 'Nalla Malayalam Kuttivayana Series 3', 'Kuttivayana Series 3', 380, null, ['K3A', 'K3B', 'K3C', 'K3D'], 'നല്ല മലയാളം കുട്ടിവായന സീരീസ് 3', null, W('nalla-malayalam-kuttivayana-series-3')],
  ['KVSCOMBO', 'KVS12BUNDLEOCT2026', 'Nalla Malayalam Kuttivayana Series 1 & 2', 'Kuttivayana', 770, 'KVS2', ['MAMB', 'CHAN', 'MITT', 'AKSH', 'DOLP', 'PACH', 'KOOT', 'NAKS'], 'കുട്ടിവായന സീരീസ് 1 & 2', null, W('nalla-malayalam-kuttivayana-series-bundle-1')],
  ['KVS23', 'KVS23BUNDLENOV2026', 'Nalla Malayalam Kuttivayana Series 2 & 3', 'Kuttivayana', 760, 'KVS2', ['DOLP', 'PACH', 'KOOT', 'NAKS', 'K3A', 'K3B', 'K3C', 'K3D'], 'കുട്ടിവായന സീരീസ് 2 & 3', null, null],
  ['KVS13', 'KVS-13', 'Nalla Malayalam Kuttivayana Series 1 & 3', 'Kuttivayana', 770, 'KVS2', ['MAMB', 'CHAN', 'MITT', 'AKSH', 'K3A', 'K3B', 'K3C', 'K3D'], 'കുട്ടിവായന സീരീസ് 1 & 3', null, null],
  ['KVSALL', 'KVS123BUNDLENOV2026', 'Nalla Malayalam Kuttivayana Series 1, 2 & 3', 'Kuttivayana', 1150, 'KVS3', ['MAMB', 'CHAN', 'MITT', 'AKSH', 'DOLP', 'PACH', 'KOOT', 'NAKS', 'K3A', 'K3B', 'K3C', 'K3D'], 'കുട്ടിവായന സീരീസ് 1, 2 & 3', null, W('nalla-malayalam-kuttivayana-series-bundle-2')],
];

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
  const upsert = async (key, sku, name, category, mrp, price, kind, group, ml, author, url) => {
    let b = await t.get('SELECT id, price FROM books WHERE lower(sku) = lower(?)', [sku]);
    if (!b) { b = await t.get('INSERT INTO books (sku, name, category, kind, mrp, price, discount_group, name_ml, author, website_url) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id, price', [sku, name, category, kind, mrp, price, group, ml, author, url]); created++; b.isNew = true; }
    else if (update) { await t.run('UPDATE books SET name = ?, category = ?, mrp = ?, price = ?, discount_group = ?, name_ml = ?, author = ?, website_url = ?, updated_at = now_iso() WHERE id = ?', [name, category, mrp, price, group, ml, author, url, b.id]); b.price = price; updated++; }
    out[key] = b; return b;
  };
  for (const [key, sku, name, cat, mrp, price, ml, author, url] of BOOKS) await upsert(key, sku, name, cat, mrp, price, 'Book', null, ml, author, url);
  for (const [key, sku, name, cat, mrp, group, parts, ml, author, url] of PACKS) {
    const p = await upsert(key, sku, name, cat, mrp, mrp, 'Pack', group, ml, author, url);
    if (p.isNew) for (const k of parts) await t.run('INSERT INTO pack_items (pack_id, book_id, qty) VALUES (?,?,1)', [p.id, out[k].id]);
  }
  // Costs are filled in only where a product has none yet, so figures edited in the app are never overwritten.
  for (const [key, v] of Object.entries(COSTS)) {
    if (out[key]) await t.run(`INSERT INTO book_costs (book_id, printing, packing, postal, misc, ad_cost, amazon_fee, royalty_pct, commission_pct) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (book_id) DO NOTHING`, [out[key].id, ...v]);
  }
  return { products: out, created, updated };
}
module.exports = { ensureCatalogue };
