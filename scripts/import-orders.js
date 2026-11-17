'use strict';
// Brings the old Google Sheets order book into the app as HISTORY.
//   npm run import:orders -- "/path/to/Nalla Malayalam Orders-2.xlsx"          (add --dry-run to only see the summary)
// Stop the app first when you use the built-in local database: it allows one program at a time.
//
// What it does:
//   - reads every monthly sheet (their column layouts differ, and some rows have shifted columns);
//   - skips rows already imported and rows repeated in the sheet (same Order ID);
//   - matches the book text to the Book Master (scripts/catalogue.js creates the real product list if missing);
//   - creates customers by phone number, and an inactive user for each "Verified By" name (the sales person);
//   - saves each order as a Tele-sales sale, Delivered and fully paid. It NEVER changes stock.
// Safe to run again: orders already imported are left alone.
require('./load-env');
const path = require('path');
const crypto = require('crypto');
const pg = require('pg');
const ExcelJS = require('exceljs');
const { createDb, databasePool } = require('../src/db');
const { applyMigrations } = require('../src/migrate');
const { hashPassword } = require('../src/auth');
const { ensureInitialAdmin } = require('./bootstrap');
const { ensureCatalogue } = require('./catalogue');
const { phoneKey } = require('../src/routes/customers');

const OID = /^\d{8}-\d{3,4}$/; const TRK = /^[A-Z]{2}\d{9}IN$/;
const STAFF = { megha: 'Megha', 'ajay mash': 'Ajay mash', anasooya: 'Anasooya', ajil: 'Ajil', sanjana: 'Sanjana', sreejith: 'Sreejith', 'jeeshma k': 'Jeeshma', jeeshma: 'Jeeshma', vish: 'Vish' };
const STATES = ['kerala', 'karnataka', 'karanataka', 'tamilnadu', 'lakshadweep', 'maharashtra', 'telangana', 'delhi', 'goa', 'gujarat', 'andhrapradesh', 'puducherry', 'pondicherry'];
const DISTRICTS = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod'];
const DISTRICT_ALIAS = { trivandrum: 'Thiruvananthapuram', tvm: 'Thiruvananthapuram', thiruvanathapuram: 'Thiruvananthapuram', calicut: 'Kozhikode', kozhikkode: 'Kozhikode', eranakulam: 'Ernakulam', ekm: 'Ernakulam', kochi: 'Ernakulam', cochin: 'Ernakulam', ernakukam: 'Ernakulam',
  kasargod: 'Kasaragod', kasaragode: 'Kasaragod', kasargode: 'Kasaragod', trissur: 'Thrissur', thrissure: 'Thrissur', alleppey: 'Alappuzha', alapuzha: 'Alappuzha', wayanadu: 'Wayanad', malapuram: 'Malappuram', palakad: 'Palakkad', palghat: 'Palakkad', kottyam: 'Kottayam', idukky: 'Idukki', bengaluru: 'Bangalore' };

/** Cell value as trimmed text (handles numbers, rich text, links and formula results). */
function txt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('').trim();
    if (v.text !== undefined) return txt(v.text);
    if (v.result !== undefined) return txt(v.result);
    return '';
  }
  return String(v).trim();
}
function district(raw) {
  const d = raw.toLowerCase().replace(/district|dist\b|\(dt\)/g, '').replace(/[^a-z ]/g, '').trim();
  if (!d) return null;
  const hit = DISTRICTS.find(x => x.toLowerCase() === d) || DISTRICT_ALIAS[d.replace(/ /g, '')];
  return hit || raw.trim().slice(0, 100);
}

/** Which products a book text stands for. Returns catalogue keys; [] means nothing recognised. */
function matchProducts(book) {
  const t = book.toLowerCase().replace(/\s+/g, '');
  const has = (...ks) => ks.some(k => t.includes(k));
  const nm1 = /part1|മാമ്പഴം|nml1|nm1/.test(t), nm2 = /part2|കൊളുന്ത്|nml2|nm2/.test(t);
  const nmPack = /nmlpack|part1&2|രണ്ട്ഭാഗങ്ങളും|nmlpart1&2|nml1&2/.test(t) || (nm1 && nm2);
  const kvBoth = /1&2kv|kvs1&2|kvseries1&2|kv1&2|ksv1&2|kvspack|kvs1,2/.test(t) || (t.includes('സീരീസ്1') && t.includes('സീരീസ്2'));
  const kv1 = /kvseries1|kvs1|സീരീസ്1|storybooks1,2,3,&4/.test(t), kv2 = /kvseries2|kvs2|സീരീസ്2/.test(t), kv3 = /kvseries3|kvs3|series3|സീരീസ്3/.test(t);
  const s1 = { MAMB: has('mamb', 'mbk', 'മാമ്പഴക്കള്ള'), CHAN: has('chan', 'ചങ്ങ'), MITT: has('mitt', 'മിട്ടു'), AKSH: has('aks', 'അക്ഷര') };
  const s2 = { DOLP: has('dol', 'ഡോൾഫ'), PACH: has('pach', 'പച്ചക്കറി'), KOOT: has('koot', 'കൂട്ടി'), NAKS: has('nak', 'nkt', 'നക്ഷത്ര') };
  const n1 = Object.values(s1).filter(Boolean).length, n2 = Object.values(s2).filter(Boolean).length;
  const out = new Set();
  if (nmPack) out.add('NMCOMBO'); else if (nm1) out.add('NM1'); else if (nm2) out.add('NM2');
  const set1 = kv1 || n1 === 4, set2 = kv2 || n2 === 4;
  if (kvBoth || (set1 && set2)) out.add('KVSCOMBO');
  else {
    if (set1) out.add('KVS1'); else for (const k of Object.keys(s1)) if (s1[k]) out.add(k);
    if (set2) out.add('KVS2'); else for (const k of Object.keys(s2)) if (s2[k]) out.add(k);
  }
  if (kv3 && out.has('KVSCOMBO')) { out.delete('KVSCOMBO'); out.add('KVSALL'); } else if (kv3) out.add('KVS3');
  return [...out];
}

async function readOrders(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const orders = []; const stats = { rows: 0, blank: 0, noPayment: 0 };
  wb.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = row.values.slice(1); // 1-based
      const c = Array.from({ length: vals.length }, (_, i) => txt(vals[i]));
      if (!c.some(Boolean)) return;
      stats.rows++;
      const ts = vals[0];
      if (!(ts instanceof Date) || isNaN(ts)) { stats.blank++; return; } // header or note row
      // Find the cells by what they contain, not by column: some rows are shifted.
      const pi = c.findIndex(x => ['online payment', 'cod'].includes(x.toLowerCase()));
      if (pi === -1) { stats.noPayment++; return; }
      const m = (c[pi + 1] || '').match(/\d{1,6}/);
      const si = (() => { for (let i = pi - 1; i > 0; i--) if (STATES.includes(c[i].toLowerCase().replace(/ /g, ''))) return i; return -1; })();
      const phones = c.slice(1, pi).filter(x => !x.includes('@')).map(phoneKey).filter(k => k.length === 10);
      const before = c.slice(1, si > 0 ? Math.max(si - 2, 2) : pi).filter(x => x && !x.includes('@'));
      orders.push({
        sheet: ws.name, date: ts.toISOString().slice(0, 10), at: ts.toISOString(),
        name: c[1].replace(/\s+/g, ' ').slice(0, 150) || 'Name not recorded',
        address: [...new Set(before.slice(1).map(x => x.replace(/\s*\n\s*/g, ', ')))].join(', ').slice(0, 500) || null,
        pin: si >= 2 ? (c[si - 2].replace(/\D/g, '').slice(0, 6) || null) : null,
        district: si >= 1 ? district(c[si - 1]) : null,
        phone: phones.length ? phones[phones.length - 1] : null,
        cod: c[pi].toLowerCase() === 'cod',
        amount: m ? Number(m[0]) : 0,
        book: (c[pi + 2] || '').replace(/\s+/g, ' ').slice(0, 400),
        ref: c.find(x => OID.test(x)) || null,
        staff: (c.slice(pi + 2).map(x => STAFF[x.toLowerCase()]).find(Boolean)) || null,
        tracking: c.find(x => TRK.test(x)) || null,
      });
    });
  });
  return { orders, stats };
}

async function main() {
  const args = process.argv.slice(2); const dry = args.includes('--dry-run');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Give the path of the order sheet:  npm run import:orders -- "/path/to/Nalla Malayalam Orders-2.xlsx"'); process.exit(1); }
  const { orders, stats } = await readOrders(path.resolve(file));

  let devDb = null; let pool;
  if (process.env.DATABASE_URL) pool = databasePool({ max: 1 });
  else {
    const { NetlifyDB } = await import('@netlify/database-dev');
    devDb = new NetlifyDB({ directory: process.env.LOCAL_DB_DIR || path.join(__dirname, '..', 'data', 'pg'), logger: () => {} });
    pool = new pg.Pool({ connectionString: await devDb.start(), max: 1 });
  }
  const sum = { rowsInSheet: stats.rows, notOrders: stats.blank + stats.noPayment, repeatedInSheet: 0, alreadyImported: 0, imported: 0, amount: 0, newCustomers: 0, noPhone: 0, toOtherTitles: 0, byProduct: {} };
  try {
    await applyMigrations(pool);
    const db = createDb(pool);
    await ensureInitialAdmin(db, { log() {}, warn() {} });
    const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1`);
    if (!admin) throw new Error('No Admin exists yet. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in .env (or start the app once), then run this again.');

    await db.tx(async t => {
      const { products } = await ensureCatalogue(t);
      const name = Object.fromEntries((await t.all('SELECT id, name FROM books')).map(b => [b.id, b.name]));
      const done = new Set((await t.all('SELECT import_ref FROM sales WHERE import_ref IS NOT NULL')).map(r => r.import_ref));
      const custs = new Map((await t.all('SELECT id, phone_norm FROM customers')).map(c => [c.phone_norm, c.id]));
      const people = new Map((await t.all('SELECT id, lower(name) AS n FROM users')).map(u => [u.n, u.id]));
      const person = async label => {
        const key = label.toLowerCase();
        if (!people.has(key)) {
          // An inactive account: it holds the sales history. The Admin can add a real login for the person later.
          const slug = key.replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
          const u = await t.get(`INSERT INTO users (name, email, password_hash, role, active) VALUES (?,?,?,'telesales',0) RETURNING id`,
            [label, `${slug}@imported.invalid`, hashPassword(crypto.randomBytes(24).toString('base64url'))]);
          people.set(key, u.id);
        }
        return people.get(key);
      };
      // Rows are written in batches: one statement per few hundred rows keeps a 5,000-order import to seconds.
      const insertMany = async (table, cols, rows, returning = '') => {
        const out = [];
        for (let i = 0; i < rows.length; i += 250) {
          const part = rows.slice(i, i + 250);
          const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${part.map(() => `(${cols.map(() => '?').join(',')})`).join(', ')} ${returning}`;
          const r = await t.run(sql, part.flat());
          out.push(...r.rows);
        }
        return out;
      };
      const reserve = async (seq, n) => { // n consecutive numbers from a sequence
        const { v } = await t.get(`SELECT nextval('${seq}') AS v`);
        if (n > 1) await t.get(`SELECT setval('${seq}', ?) AS v`, [v + n - 1]);
        return v;
      };

      const seen = new Set(); const todo = [];
      for (const o of orders) {
        const ref = o.ref || `NOID-${o.at}-${o.phone || o.name}`;
        if (seen.has(ref)) { sum.repeatedInSheet++; continue; }
        seen.add(ref);
        if (done.has(ref)) { sum.alreadyImported++; continue; }
        let keys = matchProducts(o.book);
        if (!keys.length) { keys = ['OTHER']; sum.toOtherTitles++; }
        // Share the order amount across its lines in proportion to today's prices; the lines always add up to the amount.
        const weights = keys.map(k => products[k].price || 1); const wsum = weights.reduce((a, b) => a + b, 0);
        const lines = keys.map((k, i) => ({ id: products[k].id, price: Math.floor(o.amount * weights[i] / wsum) }));
        lines[0].price += o.amount - lines.reduce((a, l) => a + l.price, 0);
        for (const l of lines) sum.byProduct[name[l.id]] = (sum.byProduct[name[l.id]] || 0) + 1;
        sum.imported++; sum.amount += o.amount;
        if (!o.phone) sum.noPhone++;
        todo.push({ ...o, ref, lines });
      }

      // Customers: one per phone number; the first order with that number gives the name and address.
      const fresh = new Map();
      for (const o of todo) if (o.phone && !custs.has(o.phone) && !fresh.has(o.phone)) fresh.set(o.phone, o);
      sum.newCustomers = fresh.size;
      if (!dry && fresh.size) {
        let n = await reserve('customer_number_seq', fresh.size);
        const made = await insertMany('customers', ['code', 'name', 'phone', 'phone_norm', 'address', 'location', 'pin'],
          [...fresh.values()].map(o => ['C-' + String(n++).padStart(5, '0'), o.name, o.phone, o.phone, o.address, o.district, o.pin]), 'RETURNING id, phone_norm');
        for (const c of made) custs.set(c.phone_norm, c.id);
      }
      if (!dry && todo.length) {
        const staffId = {};
        for (const label of new Set(todo.map(o => o.staff || 'Not recorded'))) staffId[label] = await person(label);
        let n = await reserve('sale_number_seq', todo.length);
        const saved = await insertMany('sales', ['sale_no', 'sale_date', 'channel', 'salesperson_id', 'customer_id', 'customer_name', 'customer_phone', 'address', 'status',
          'total_amount', 'amount_received', 'payment_method', 'payment_status', 'remarks', 'import_ref', 'created_by', 'created_at'],
        todo.map(o => ['S-' + String(n++).padStart(6, '0'), o.date, 'Tele-sales', staffId[o.staff || 'Not recorded'], o.phone ? custs.get(o.phone) : null, o.name, o.phone, o.address, 'Delivered',
          o.amount, o.amount, o.cod ? 'COD' : 'Other', 'Paid',
          `Imported from the order sheet (${o.sheet}). Books as written: ${o.book || '—'}${o.tracking ? `. Tracking ID: ${o.tracking}` : ''}`.slice(0, 1000), o.ref, admin.id, o.at]),
        'RETURNING id, import_ref');
        const saleId = new Map(saved.map(r => [r.import_ref, r.id]));
        await insertMany('sale_items', ['sale_id', 'book_id', 'qty', 'unit_price', 'line_total'], todo.flatMap(o => o.lines.map(l => [saleId.get(o.ref), l.id, 1, l.price, l.price])));
        await insertMany('payments', ['sale_id', 'amount', 'method', 'paid_on', 'note', 'user_id'],
          todo.filter(o => o.amount > 0).map(o => [saleId.get(o.ref), o.amount, o.cod ? 'Cash' : 'Other', o.date, o.cod ? 'COD collected (imported)' : 'Online payment (imported)', admin.id]));
      }
      if (!dry) await t.run(`UPDATE customers SET kind = 'Customer' WHERE kind = 'Lead' AND id IN (SELECT customer_id FROM sales WHERE customer_id IS NOT NULL)`);
      if (!dry) await t.run(`INSERT INTO audit_events (user_id, entity, action, after_json) VALUES (?,?,?,?)`, [admin.id, 'import', 'orders_imported', JSON.stringify({ file: path.basename(file), ...sum, byProduct: undefined })]);
      if (dry) throw Object.assign(new Error('dry'), { dry: true }); // roll back the catalogue too
    }).catch(e => { if (!e.dry) throw e; });
  } finally { await pool.end(); if (devDb) await devDb.stop(); }

  const inr = n => '₹' + n.toLocaleString('en-IN');
  console.log(dry ? '\nDRY RUN — nothing was saved.\n' : '\nImport finished.\n');
  console.log(`Rows in the sheet with content      ${sum.rowsInSheet}`);
  console.log(`  not orders (headers, notes)       ${sum.notOrders}`);
  console.log(`  repeated in the sheet, skipped    ${sum.repeatedInSheet}`);
  console.log(`  already imported earlier          ${sum.alreadyImported}`);
  console.log(`Orders ${dry ? 'that would be imported' : 'imported'}             ${sum.imported}   (${inr(sum.amount)})`);
  console.log(`  new customers                     ${sum.newCustomers}`);
  console.log(`  orders without a usable phone     ${sum.noPhone}  (kept, with no customer record)`);
  console.log(`  book not recognised → Other titles ${sum.toOtherTitles}`);
  console.log('\nOrder lines by product:');
  for (const [k, v] of Object.entries(sum.byProduct).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
