'use strict';
const { audit } = require('../audit');
const S = require('../settings');
const P = require('../prices');

// App colour themes (Admin, Settings). The names match the [data-theme] blocks in styles.css.
const THEMES = ['green', 'blue', 'teal', 'maroon', 'purple', 'orange', 'charcoal'];
const getTheme = async db => { const t = await S.read(db, 'theme'); return t && THEMES.includes(t.name) ? t.name : 'green'; };

module.exports = (app, { db, perm, requireAdmin }) => {
  // Everyone signed in needs the lists to fill the forms.
  app.get('/api/settings/lists', async (_req, res) => {
    res.json({ lists: await S.getLists(db), locked: S.LOCKED, names: S.LIST_NAMES, charges: await S.getCharges(db),
      discounts: await P.getDiscounts(db), discount_groups: P.GROUPS, discount_channels: P.CHANNELS, theme: await getTheme(db), themes: THEMES,
      messages: await S.getMessages(db), message_kinds: S.MESSAGE_KINDS, message_fields: S.MESSAGE_FIELDS, order_kinds: S.ORDER_KINDS,
      shipping: await S.getShipping(db), shipping_fields: S.SHIPPING_FIELDS, next_book: await S.getNextBook(db),
      delivery_check: await require('./delivery').getConfig(db), feedback_page: await S.getFeedbackPage(db), feedback_styles: S.FEEDBACK_STYLES });
  });

  app.put('/api/settings/shipping', requireAdmin, async (req, res) => {
    const before = await S.getShipping(db); const next = S.cleanShipping(req.body);
    await db.tx(async t => { await S.write(t, 'shipping', next); await audit(t, req.user, 'settings', null, 'shipping_changed', before, next); });
    res.json(await S.getShipping(db));
  });
  app.put('/api/settings/next-book', requireAdmin, async (req, res) => {
    const skus = new Set((await db.all('SELECT lower(sku) AS s FROM books WHERE active = 1')).map(r => r.s));
    const before = await S.getNextBook(db); const next = S.cleanNextBook(req.body, skus);
    await db.tx(async t => { await S.write(t, 'next_book', next); await audit(t, req.user, 'settings', null, 'next_book_changed', before, next); });
    res.json(await S.getNextBook(db));
  });
  app.put('/api/settings/messages', requireAdmin, async (req, res) => {
    const before = await S.getMessages(db); const next = S.cleanMessages(req.body);
    await db.tx(async t => { await S.write(t, 'messages', next); await audit(t, req.user, 'settings', null, 'messages_changed', before, next); });
    res.json(await S.getMessages(db));
  });
  app.put('/api/settings/feedback-page', requireAdmin, async (req, res) => {
    const before = await S.getFeedbackPage(db); const next = S.cleanFeedbackPage(req.body);
    await db.tx(async t => { await S.write(t, 'feedback_page', next); await audit(t, req.user, 'settings', null, 'feedback_page_changed', before, next); });
    res.json(await S.getFeedbackPage(db));
  });
  app.put('/api/settings/discounts', requireAdmin, async (req, res) => {
    const before = await P.getDiscounts(db); const next = P.cleanDiscounts(req.body);
    await db.tx(async t => { await S.write(t, 'discounts', next); await audit(t, req.user, 'settings', null, 'discounts_changed', before, next); });
    res.json(next);
  });
  app.put('/api/settings/theme', requireAdmin, async (req, res) => {
    const name = String(req.body.name || '');
    if (!THEMES.includes(name)) throw require('../util').bad('Choose one of the themes');
    const before = await getTheme(db);
    await db.tx(async t => { await S.write(t, 'theme', { name }); await audit(t, req.user, 'settings', null, 'theme_changed', { name: before }, { name }); });
    res.json({ name });
  });

  app.put('/api/settings/charges', requireAdmin, async (req, res) => {
    const before = await S.getCharges(db); const next = S.cleanCharges(req.body, before);
    await db.tx(async t => { await S.write(t, 'charges', next); await audit(t, req.user, 'settings', null, 'charges_changed', before, next); });
    res.json(next);
  });

  app.put('/api/settings/lists', requireAdmin, async (req, res) => {
    const before = (await S.read(db, 'lists')) || {};
    const next = { ...before };
    for (const key of Object.keys(S.DEFAULT_LISTS)) if (req.body[key] !== undefined) next[key] = S.cleanList(key, req.body[key]);
    await db.tx(async t => { await S.write(t, 'lists', next); await audit(t, req.user, 'settings', null, 'lists_changed', before, next); });
    res.json({ lists: await S.getLists(db), locked: S.LOCKED, names: S.LIST_NAMES });
  });

  app.get('/api/settings/cost-rules', perm('profit'), async (_req, res) => res.json(await S.getCostRules(db)));
  app.put('/api/settings/cost-rules', perm('profit'), async (req, res) => {
    const before = await S.getCostRules(db); const next = S.cleanCostRules(req.body);
    await db.tx(async t => { await S.write(t, 'cost_rules', next); await audit(t, req.user, 'settings', null, 'cost_rules_changed', before, next); });
    res.json(next);
  });
};
module.exports.getTheme = getTheme;
module.exports.THEMES = THEMES;
