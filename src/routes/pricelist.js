'use strict';
// Prices & links (for the sales teams): the links to share and the offers and coupons running. Prices come from the
// book list and Settings → Discounts. The Admin keeps the links and the coupons; the website applies a coupon itself.
const { audit } = require('../audit');
const { read, write } = require('../settings');
const { bad, notFound, conflict, str, oneOf, idParam, today, isValidDate } = require('../util');

const LINKS = [
  ['website', 'Website', 'https://www.nallamalayalam.in'], ['books', 'Books on the website', 'https://www.nallamalayalam.in/books'],
  ['amazon', 'Amazon', ''], ['youtube', 'YouTube', ''], ['instagram', 'Instagram', 'https://www.instagram.com/nallamalayalam/'], ['facebook', 'Facebook', ''],
];
const WORKS_ON = ['Website', 'WhatsApp / phone', 'Amazon', 'Everywhere'];

async function getLinks(db) {
  const saved = (await read(db, 'links')) || {};
  return LINKS.map(([key, label, d]) => ({ key, label, url: typeof saved[key] === 'string' ? saved[key] : d }));
}
/** Running, upcoming or ended, from today's date. */
const stateOf = (c, day) => (!c.active ? 'Stopped' : c.valid_from && c.valid_from > day ? 'Upcoming' : c.valid_to && c.valid_to < day ? 'Ended' : 'Running');

module.exports = (app, { db, perm, requireAdmin }) => {
  app.get('/api/pricelist', perm('prices'), async (req, res) => {
    const day = today();
    const coupons = (await db.all('SELECT id, code, offer, conditions, works_on, valid_from, valid_to, active, updated_at FROM coupons ORDER BY active DESC, valid_to NULLS LAST, code'))
      .map(c => ({ ...c, state: stateOf(c, day) }));
    // The team sees what can be offered (running and upcoming); the Admin sees all, to manage them.
    const admin = req.user.role === 'admin';
    res.json({ links: await getLinks(db), coupons: admin ? coupons : coupons.filter(c => ['Running', 'Upcoming'].includes(c.state)), works_on: WORKS_ON, today: day });
  });

  app.put('/api/settings/links', requireAdmin, async (req, res) => {
    const before = await getLinks(db); const next = {};
    for (const [key, label] of LINKS) {
      const v = str((req.body || {})[key], { name: label, max: 500 }) || '';
      if (v && !/^https:\/\/\S+$/.test(v)) throw bad(`${label}: the link must start with https://`, { field: label });
      next[key] = v;
    }
    await db.tx(async t => { await write(t, 'links', next); await audit(t, req.user, 'settings', null, 'links_changed', Object.fromEntries(before.map(l => [l.key, l.url])), next); });
    res.json(await getLinks(db));
  });

  const couponFields = b => {
    const code = str(b.code, { required: true, name: 'Code', max: 40 }).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw bad('The code can have only letters, digits, dashes and underscores', { field: 'Code' });
    const f = { code, offer: str(b.offer, { required: true, name: 'What it gives', max: 200 }), conditions: str(b.conditions, { name: 'Conditions', max: 300 }) || null,
      works_on: oneOf(b.works_on, WORKS_ON, { name: 'Works on' }) || 'Website', valid_from: b.valid_from || null, valid_to: b.valid_to || null, active: b.active === undefined ? 1 : (b.active === true || b.active === 1 ? 1 : 0) };
    for (const [k, l] of [['valid_from', 'Valid from'], ['valid_to', 'Valid until']]) if (f[k] && !isValidDate(f[k])) throw bad(`${l} is not a valid date`, { field: l });
    if (f.valid_from && f.valid_to && f.valid_to < f.valid_from) throw bad('Valid until is before Valid from', { field: 'Valid until' });
    return f;
  };
  app.post('/api/coupons', requireAdmin, async (req, res) => {
    const f = couponFields(req.body || {});
    if (await db.get('SELECT 1 FROM coupons WHERE upper(code) = ?', [f.code])) throw conflict(`${f.code} is already in the list`, { field: 'Code' });
    const id = await db.tx(async t => {
      const r = await t.get('INSERT INTO coupons (code, offer, conditions, works_on, valid_from, valid_to, active, created_by) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
        [f.code, f.offer, f.conditions, f.works_on, f.valid_from, f.valid_to, f.active, req.user.id]);
      await audit(t, req.user, 'coupon', r.id, 'created', null, f);
      return r.id;
    });
    res.status(201).json({ id, ...f, state: stateOf(f, today()) });
  });
  app.patch('/api/coupons/:id', requireAdmin, async (req, res) => {
    const id = idParam(req.params.id);
    const before = await db.get('SELECT code, offer, conditions, works_on, valid_from, valid_to, active FROM coupons WHERE id = ?', [id]);
    if (!before) throw notFound('Coupon');
    const f = couponFields({ ...before, ...req.body });
    if (await db.get('SELECT 1 FROM coupons WHERE upper(code) = ? AND id <> ?', [f.code, id])) throw conflict(`${f.code} is already in the list`, { field: 'Code' });
    await db.tx(async t => {
      await t.run('UPDATE coupons SET code = ?, offer = ?, conditions = ?, works_on = ?, valid_from = ?, valid_to = ?, active = ?, updated_at = now_iso() WHERE id = ?',
        [f.code, f.offer, f.conditions, f.works_on, f.valid_from, f.valid_to, f.active, id]);
      await audit(t, req.user, 'coupon', id, 'updated', before, f);
    });
    res.json({ id, ...f, state: stateOf(f, today()) });
  });
};
