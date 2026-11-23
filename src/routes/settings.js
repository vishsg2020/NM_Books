'use strict';
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const S = require('../settings');
const P = require('../prices');

// App colour themes (Admin, Settings). The names match the [data-theme] blocks in styles.css.
const THEMES = ['green', 'blue', 'teal', 'maroon', 'purple', 'orange', 'charcoal'];
const getTheme = async db => { const t = await S.read(db, 'theme'); return t && THEMES.includes(t.name) ? t.name : 'green'; };

module.exports = (app, { db }) => {
  // Everyone signed in needs the lists to fill the forms.
  app.get('/api/settings/lists', async (_req, res) => {
    res.json({ lists: await S.getLists(db), locked: S.LOCKED, names: S.LIST_NAMES, charges: await S.getCharges(db),
      discounts: await P.getDiscounts(db), discount_groups: P.GROUPS, discount_channels: P.CHANNELS, theme: await getTheme(db), themes: THEMES });
  });

  app.put('/api/settings/discounts', requireRole('admin'), async (req, res) => {
    const before = await P.getDiscounts(db); const next = P.cleanDiscounts(req.body);
    await db.tx(async t => { await S.write(t, 'discounts', next); await audit(t, req.user, 'settings', null, 'discounts_changed', before, next); });
    res.json(next);
  });
  app.put('/api/settings/theme', requireRole('admin'), async (req, res) => {
    const name = String(req.body.name || '');
    if (!THEMES.includes(name)) throw require('../util').bad('Choose one of the themes');
    const before = await getTheme(db);
    await db.tx(async t => { await S.write(t, 'theme', { name }); await audit(t, req.user, 'settings', null, 'theme_changed', { name: before }, { name }); });
    res.json({ name });
  });

  app.put('/api/settings/charges', requireRole('admin'), async (req, res) => {
    const before = await S.getCharges(db); const next = S.cleanCharges(req.body, before);
    await db.tx(async t => { await S.write(t, 'charges', next); await audit(t, req.user, 'settings', null, 'charges_changed', before, next); });
    res.json(next);
  });

  app.put('/api/settings/lists', requireRole('admin'), async (req, res) => {
    const before = (await S.read(db, 'lists')) || {};
    const next = { ...before };
    for (const key of Object.keys(S.DEFAULT_LISTS)) if (req.body[key] !== undefined) next[key] = S.cleanList(key, req.body[key]);
    await db.tx(async t => { await S.write(t, 'lists', next); await audit(t, req.user, 'settings', null, 'lists_changed', before, next); });
    res.json({ lists: await S.getLists(db), locked: S.LOCKED, names: S.LIST_NAMES });
  });

  app.get('/api/settings/cost-rules', requireRole('admin', 'manager'), async (_req, res) => res.json(await S.getCostRules(db)));
  app.put('/api/settings/cost-rules', requireRole('admin'), async (req, res) => {
    const before = await S.getCostRules(db); const next = S.cleanCostRules(req.body);
    await db.tx(async t => { await S.write(t, 'cost_rules', next); await audit(t, req.user, 'settings', null, 'cost_rules_changed', before, next); });
    res.json(next);
  });
};
module.exports.getTheme = getTheme;
module.exports.THEMES = THEMES;
