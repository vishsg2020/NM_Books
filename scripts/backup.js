'use strict';
// Off-site safety copy: exports every table to one JSON file.
// Supabase's Free plan has no automatic backups, so run this regularly (a weekly GitHub Action is included).
//
// Usage: DATABASE_URL="postgresql://..." npm run backup     (the same Supabase connection string the app uses)
// Writes ./backups/nm-books-<timestamp>.json and keeps the newest BACKUP_KEEP files.
require('./load-env');
const fs = require('fs');
const path = require('path');
const { databasePool } = require('../src/db');

const TABLES = ['users', 'books', 'pack_items', 'book_prices', 'book_costs', 'settings', 'customers', 'sales', 'sale_items', 'payments', 'stock_movements', 'audit_events', 'calls', 'visits'];

(async () => {
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.error('Set DATABASE_URL to the database connection string.'); process.exit(1); }
  const dir = process.env.BACKUP_DIR || './backups';
  const keep = Number(process.env.BACKUP_KEEP || 30);
  fs.mkdirSync(dir, { recursive: true });
  const pool = databasePool({ max: 1 });
  const client = await pool.connect();
  const out = { exported_at: new Date().toISOString(), tables: {} };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); // one consistent view
    for (const t of TABLES) out.tables[t] = (await client.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
    await client.query('COMMIT');
  } finally { client.release(); await pool.end(); }
  const file = path.join(dir, `nm-books-${out.exported_at.replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  const files = fs.readdirSync(dir).filter(f => /^nm-books-.*\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
  console.log(`Backup written: ${file} (${TABLES.map(t => `${t} ${out.tables[t].length}`).join(', ')})`);
})().catch(e => { console.error(e.message); process.exit(1); });
