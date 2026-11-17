'use strict';
const { hashPassword } = require('../src/auth');
const { isUniqueViolation } = require('../src/db');

/**
 * Creates the first Admin from environment variables when the users table is empty.
 * Safe to call on every cold start; does nothing once any user exists.
 */
async function ensureInitialAdmin(db, log = console) {
  const { n } = await db.get('SELECT COUNT(*) n FROM users');
  if (n) return false;
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const name = process.env.INITIAL_ADMIN_NAME || 'Admin';
  if (!email || !password) {
    log.warn('No users exist yet. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD (min 8 characters) to create the first Admin.');
    return false;
  }
  try {
    await db.run(`INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'admin')`, [name, email, hashPassword(password)]);
    log.log(`Created the first Admin account for ${email}. Remove INITIAL_ADMIN_PASSWORD from the environment now.`);
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false; // another instance created it first
    throw e;
  }
}
module.exports = { ensureInitialAdmin };
