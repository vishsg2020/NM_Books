'use strict';
const bcrypt = require('bcryptjs');
const { requireRole, hashPassword, ROLES } = require('../auth');
const { audit } = require('../audit');
const { bad, notFound, conflict, str, oneOf, bool, idParam } = require('../util');

const PUBLIC = 'u.id, u.name, u.email, u.role, u.active, u.created_at';

module.exports = (app, { db }) => {
  app.get('/api/me', (req, res) => res.json({ user: req.user }));

  app.post('/api/me/password', async (req, res) => {
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.current_password || ''), u.password_hash))) throw bad('Current password is incorrect');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(req.body.new_password), u.id]);
    await audit(db, req.user, 'user', u.id, 'password_changed');
    res.json({ ok: true });
  });

  // People who can be the sales person on a sale (for dropdowns and filters).
  app.get('/api/users/salespeople', requireRole('admin', 'manager'), async (_req, res) => {
    res.json(await db.all(`SELECT id, name, role, active FROM users u
      WHERE role IN ('admin','manager','telesales','online','onsite') ORDER BY active DESC, name`));
  });

  app.get('/api/users', requireRole('admin'), async (_req, res) => {
    res.json(await db.all(`SELECT ${PUBLIC} FROM users u ORDER BY u.active DESC, u.role, u.name`));
  });

  app.post('/api/users', requireRole('admin'), async (req, res) => {
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

  app.patch('/api/users/:id', requireRole('admin'), async (req, res) => {
    const before = await db.get(`SELECT ${PUBLIC} FROM users u WHERE id = ?`, [idParam(req.params.id)]);
    if (!before) throw notFound('User');
    const b = req.body;
    const next = { ...before };
    if (b.name !== undefined) next.name = str(b.name, { required: true, name: 'Name', max: 100 });
    if (b.role !== undefined) next.role = oneOf(b.role, ROLES, { required: true, name: 'Role' });
    if (b.active !== undefined) next.active = bool(b.active) ? 1 : 0;
    if (!next.active && before.id === req.user.id) throw bad('You cannot deactivate your own account');
    if (next.role !== 'admin' && before.id === req.user.id) throw bad('You cannot change your own role');
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
