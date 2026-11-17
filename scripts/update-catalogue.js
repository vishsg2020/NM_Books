'use strict';
// Sets the names, MRP and selling prices of the standard products to the list in scripts/catalogue.js, and adds any that are missing.
//   npm run catalogue:update          (stop the app first when you use the built-in local database)
// It does not touch stock, sales, or any book you added yourself.
require('./load-env');
const path = require('path');
const pg = require('pg');
const { createDb, databasePool } = require('../src/db');
const { applyMigrations } = require('../src/migrate');
const { ensureCatalogue } = require('./catalogue');

(async () => {
  let devDb = null; let pool;
  if (process.env.DATABASE_URL) pool = databasePool({ max: 1 });
  else {
    const { NetlifyDB } = await import('@netlify/database-dev');
    devDb = new NetlifyDB({ directory: process.env.LOCAL_DB_DIR || path.join(__dirname, '..', 'data', 'pg'), logger: () => {} });
    pool = new pg.Pool({ connectionString: await devDb.start(), max: 1 });
  }
  try {
    await applyMigrations(pool);
    const r = await createDb(pool).tx(t => ensureCatalogue(t, { update: true }));
    console.log(`Product list is up to date: ${r.created} added, ${r.updated} set to the standard names and prices.`);
  } finally { await pool.end(); if (devDb) await devDb.stop(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
