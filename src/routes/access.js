'use strict';
// Settings → Roles & access (Admin only): read and save the grid of what each role can see and change.
const { audit } = require('../audit');
const { str } = require('../util');
const { AREAS, ROLE_NAMES, EDITABLE, defaults } = require('../access');

module.exports = (app, { db, access, requireAdmin }) => {
  const payload = async () => {
    const row = await db.get(`SELECT updated_at FROM settings WHERE key = 'role_access'`);
    return {
      areas: AREAS,
      roles: Object.entries(ROLE_NAMES).map(([key, name]) => ({ key, name, editable: EDITABLE.includes(key) })),
      grid: await access.grid(), defaults: defaults(), customised: !!row, updated_at: row ? row.updated_at : null,
    };
  };
  app.get('/api/access', requireAdmin, async (_req, res) => res.json(await payload()));

  app.put('/api/access', requireAdmin, async (req, res) => {
    const next = access.parseGrid(req.body.grid);
    const reason = str(req.body.reason, { name: 'Reason', max: 300 }) || null;
    const before = await access.grid();
    await db.tx(async t => {
      await access.save(t, next);
      // Only the cells that changed, as "Role · Area": "View → Edit".
      const was = {}; const now = {};
      for (const r of EDITABLE) for (const a of AREAS) {
        if (before[r][a.key] !== next[r][a.key]) { const k = `${ROLE_NAMES[r]} · ${a.name}`; was[k] = before[r][a.key]; now[k] = next[r][a.key]; }
      }
      await audit(t, req.user, 'settings', null, 'role_access', was, now, reason);
    });
    res.json(await payload());
  });
};
