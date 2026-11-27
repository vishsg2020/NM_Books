'use strict';
const bcrypt = require('bcryptjs');
const { hashPassword, ROLES } = require('../auth');
const { audit } = require('../audit');
const { bad, notFound, conflict, str, oneOf, bool, idParam } = require('../util');

const PUBLIC = 'u.id, u.name, u.email, u.role, u.active, u.created_at';

module.exports = (app, { db, access, requireAdmin, requireWide }) => {
  // The signed-in user, with what their role may see (View) and change (Edit) in each area.
  app.get('/api/me', async (req, res) => res.json({ user: { ...req.user, perms: await access.permsFor(req.user.role), own: await access.ownFor(req.user.role) } }));

  app.post('/api/me/password', async (req, res) => {
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.current_password || ''), u.password_hash))) throw bad('Current password is incorrect');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(req.body.new_password), u.id]);
    await audit(db, req.user, 'user', u.id, 'password_changed');
    res.json({ ok: true });
  });

  // People who can be the sales person on a sale (for dropdowns and filters).
  app.get('/api/users/salespeople', requireWide, async (_req, res) => {
    res.json(await db.all(`SELECT id, name, role, active FROM users u
      WHERE role IN ('admin','manager','telesales','online','onsite') ORDER BY active DESC, name`));
  });

  app.get('/api/users', requireAdmin, async (_req, res) => {
    res.json(await db.all(`SELECT ${PUBLIC}, (SELECT COUNT(*) FROM sales s WHERE s.salesperson_id = u.id) AS orders,
        (SELECT string_agg(a.after_json::json->>'old_name', ', ' ORDER BY a.id) FROM audit_events a WHERE a.entity = 'user' AND a.entity_id = u.id AND a.action = 'old_name_linked') AS old_names
      FROM users u ORDER BY u.active DESC, u.role, u.name`));
  });

  // Old order-sheet names: the inactive placeholders the imports made for each name in the sheets ("Megha", "Ajil"…).
  // Linking one to a login moves its orders and calls to that login, so they count as theirs ("Own only").
  // "Not recorded" is never offered.
  const LEGACY = `u.active = 0 AND u.email LIKE '%@imported.invalid' AND u.name <> 'Not recorded'`;
  app.get('/api/users/old-names', requireAdmin, async (_req, res) => {
    res.json(await db.all(`SELECT u.id, u.name, u.role,
        (SELECT COUNT(*) FROM sales s WHERE s.salesperson_id = u.id) AS orders, (SELECT COUNT(*) FROM calls k WHERE k.salesperson_id = u.id) AS calls
      FROM users u WHERE ${LEGACY} AND (EXISTS (SELECT 1 FROM sales s WHERE s.salesperson_id = u.id) OR EXISTS (SELECT 1 FROM calls k WHERE k.salesperson_id = u.id))
      ORDER BY u.name`));
  });
  app.post('/api/users/:id/link-old-name', requireAdmin, async (req, res) => {
    const to = await db.get(`SELECT ${PUBLIC} FROM users u WHERE id = ?`, [idParam(req.params.id)]);
    if (!to) throw notFound('User');
    if (/@imported\.invalid$/i.test(to.email)) throw bad('Choose a real login to link the old name to');
    const from = await db.get(`SELECT u.id, u.name FROM users u WHERE u.id = ? AND ${LEGACY}`, [idParam(req.body.old_id)]);
    if (!from) throw bad('Choose one of the old order-sheet names', { field: 'Old order-sheet name' });
    const moved = await db.tx(async t => {
      const s = await t.run('UPDATE sales SET salesperson_id = ? WHERE salesperson_id = ?', [to.id, from.id]);
      const k = await t.run('UPDATE calls SET salesperson_id = ? WHERE salesperson_id = ?', [to.id, from.id]);
      const out = { orders: s.rowCount, calls: k.rowCount };
      await audit(t, req.user, 'user', to.id, 'old_name_linked', null, { old_name: from.name, ...out });
      await audit(t, req.user, 'user', from.id, 'linked_to_login', null, { login: to.name, email: to.email, ...out });
      return out;
    });
    res.json({ ok: true, old_name: from.name, ...moved });
  });

  app.post('/api/users', requireAdmin, async (req, res) => {
    const b = req.body;
    const name = str(b.name, { required: true, name: 'Name', max: 100 });
    const email = str(b.email, { required: true, name: 'Email', max: 200 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address', { field: 'Email' });
    const role = oneOf(b.role, ROLES, { required: true, name: 'Role' });
    if (await db.get('SELECT 1 AS x FROM users WHERE lower(email) = lower(?)', [email])) throw conflict('A user with this email already exists');
    const r = await db.get('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?) RETURNING id',
      [name, email, hashPassword(b.password), role]);
    await audit(db, req.user, 'user', r.id, 'created', null, { name, email, role });
    res.status(201).json(await db.get(`SELECT ${PUBLIC} FROM users u WHERE id = ?`, [r.id]));
  });

  app.patch('/api/users/:id', requireAdmin, async (req, res) => {
    const before = await db.get(`SELECT ${PUBLIC} FROM users u WHERE id = ?`, [idParam(req.params.id)]);
    if (!before) throw notFound('User');
    const b = req.body;
    const next = { ...before };
    if (b.name !== undefined) next.name = str(b.name, { required: true, name: 'Name', max: 100 });
    if (b.role !== undefined) next.role = oneOf(b.role, ROLES, { required: true, name: 'Role' });
    if (b.active !== undefined) next.active = bool(b.active) ? 1 : 0;
    if (!next.active && before.id === req.user.id) throw bad('You cannot deactivate your own account');
    if (next.role !== before.role && before.id === req.user.id) throw bad('You cannot change your own role');
    if (before.role === 'admin' && before.active && (!next.active || next.role !== 'admin')) {
      const others = (await db.get(`SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id <> ?`, [before.id])).n;
      if (!others) throw bad('At least one active Admin is required');
    }
    await db.tx(async t => {
      await t.run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', [next.name, next.role, next.active, before.id]);
      if (b.password) {
        await t.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(b.password), before.id]);
        await audit(t, req.user, 'user', before.id, 'password_reset');
      }
      // A deactivated user, or one whose role changed, must sign in again.
      if (!next.active || next.role !== before.role) await t.run('DELETE FROM sessions WHERE user_id = ?', [before.id]);
      await audit(t, req.user, 'user', before.id, 'updated', before, next);
    });
    res.json(await db.get(`SELECT ${PUBLIC} FROM users u WHERE id = ?`, [before.id]));
  });
};
