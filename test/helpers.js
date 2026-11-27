'use strict';
// Shared set-up for the API tests. Each test file gets its own fresh local database and its own app on a free port,
// so the files run side by side (`npm test`) or one at a time (`npm run test:core`, `npm run test:features`).
process.env.TODAY_OVERRIDE = process.env.TODAY_OVERRIDE || '2026-11-16';
const assert = require('node:assert/strict');
const pg = require('pg');
const { createDb } = require('../src/db');
const { applyMigrations } = require('../src/migrate');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const pw = 'correct-horse-1';
let base = '';

/** A signed-in browser, more or less: keeps its own session cookie. */
function client() {
  let cookie = '';
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nm-app', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return {
    send: (m, u, b) => call(m, u, b), cookie: () => cookie, get: u => call('GET', u), post: (u, b) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b),
    login: async email => { const r = await call('POST', '/api/login', { email, password: pw }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r; },
  };
}

const ok = (r, status = 201) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

/** A fresh database with every migration and one Admin (a@x.in), and the app listening on a free port. */
async function startApp() {
  const { NetlifyDB } = await import('@netlify/database-dev');
  const devDb = new NetlifyDB({ logger: () => {} });
  const pool = new pg.Pool({ connectionString: await devDb.start(), max: 1 }); // the local test database is one shared session
  await applyMigrations(pool);
  const db = createDb(pool);
  await db.run(`INSERT INTO users (name,email,password_hash,role) VALUES ('Asha Admin','a@x.in',?,'admin')`, [hashPassword(pw)]);
  const server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, stop: async () => { server.close(); await pool.end(); await devDb.stop(); } };
}

module.exports = { pw, client, ok, startApp };
