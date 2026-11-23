'use strict';
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const S = require('../settings');

module.exports = (app, { db }) => {
  // Everyone signed in needs the lists to fill the forms.
  app.get('/api/settings/lists', async (_req, res) => {
    res.json({ lists: await S.getLists(db), locked: S.LOCKED, names: S.LIST_NAMES, charges: await S.getCharges(db) });
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
