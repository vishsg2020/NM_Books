'use strict';
// Shared start-up for the import scripts: opens the database (Supabase or the built-in local one), applies
// migrations, makes sure an Admin exists, runs `work(db, admin)` and closes everything again.
const path = require('path');
const pg = require('pg');
const { createDb, databasePool } = require('../src/db');
const { applyMigrations } = require('../src/migrate');
const { ensureInitialAdmin } = require('./bootstrap');

async function withDb(work) {
  let devDb = null; let pool;
  if (process.env.DATABASE_URL) pool = databasePool({ max: 1 });
  else {
    const { NetlifyDB } = await import('@netlify/database-dev');
    devDb = new NetlifyDB({ directory: process.env.LOCAL_DB_DIR || path.join(__dirname, '..', 'data', 'pg'), logger: () => {} });
    pool = new pg.Pool({ connectionString: await devDb.start(), max: 1 });
  }
  try {
    await applyMigrations(pool);
    const db = createDb(pool);
    await ensureInitialAdmin(db, { log() {}, warn() {} });
    const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1`);
    if (!admin) throw new Error('No Admin exists yet. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in .env (or start the app once), then run this again.');
    return await work(db, admin);
  } finally { await pool.end(); if (devDb) await devDb.stop(); }
}

/** Cell value as trimmed text (handles numbers, rich text, links and formula results). */
function txt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('').trim();
    if (v.text !== undefined) return txt(v.text);
    if (v.result !== undefined) return txt(v.result);
    return '';
  }
  return String(v).trim();
}
/** Insert many rows with one statement per 250 rows. Returns the RETURNING rows. */
async function insertMany(t, table, cols, rows, returning = '') {
  const out = [];
  for (let i = 0; i < rows.length; i += 250) {
    const part = rows.slice(i, i + 250);
    const r = await t.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${part.map(() => `(${cols.map(() => '?').join(',')})`).join(', ')} ${returning}`, part.flat());
    out.push(...r.rows);
  }
  return out;
}
/** n consecutive numbers from a sequence; returns the first. */
async function reserve(t, seq, n) {
  const { v } = await t.get(`SELECT nextval('${seq}') AS v`);
  if (n > 1) await t.get(`SELECT setval('${seq}', ?) AS v`, [Number(v) + n - 1]);
  return Number(v);
}
const inr = n => '₹' + Number(n).toLocaleString('en-IN');
module.exports = { withDb, txt, insertMany, reserve, inr };
