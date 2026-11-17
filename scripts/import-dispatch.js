'use strict';
// Brings the old "Daily Dispatch - Report" Google Form answers into the app as dispatch HISTORY.
//   npm run import:dispatch -- "/path/to/Daily Dispatch - Report Responses.xlsx"      (add --dry-run to only see the summary)
// Stop the app first when you use the built-in local database: it allows one program at a time.
//
// What it does:
//   - one row per day and product: the form's columns, plus the single books typed in its "Other" box;
//   - a date that cannot be right (typed year 2023 or 0202) is replaced by the day the form was filled in;
//   - two form entries for the same day are added together; an entry that is plainly a test is left out;
//   - it REPLACES the imported history each time, so running it again with a newer export is safe;
//     a day whose report was typed in the app is left as typed.
// It never changes stock, sales or orders.
require('./load-env');
const path = require('path');
const ExcelJS = require('exceljs');
const { ensureCatalogue } = require('./catalogue');
const { withDb, txt, insertMany } = require('./import-db');

// Form column → catalogue key, or a label kept under "Other titles".
const COLUMNS = [
  [/^nm combo/, 'NMCOMBO'], [/^nm part 1/, 'NM1'], [/^nm part 2/, 'NM2'], [/^kvs 1 & 2/, 'KVSCOMBO'], [/^kvs 1$/, 'KVS1'], [/^kvs 2$/, 'KVS2'], [/^kvs 3$/, 'KVS3'],
  [/^kg combo/, 'OTHER', 'KG Combo'], [/^lkg/, 'OTHER', 'LKG'], [/^ukg/, 'OTHER', 'UKG'], [/^onam/, 'OTHER', 'Onam Special combo'],
];
// Words typed in the "Other" box, in the team's many spellings.
const WORDS = [
  [/^kvs ?3|^kv ?3/, 'KVS3'], [/^mamb/, 'MAMB'], [/^ch/, 'CHAN'], [/^mit/, 'MITT'], [/^aks/, 'AKSH'], [/^do[lp]/, 'DOLP'], [/^pac/, 'PACH'], [/^koo/, 'KOOT'], [/^na\w*k/, 'NAKS'],
  [/^cop/, 'OTHER', 'Copy book'], [/^read/, 'OTHER', 'Reading card'], [/^nml old/, 'OTHER', 'NML old pack combo'],
];

/** "MAMBA3/akshara 1/KVS3 6" → [{ key, label, qty }]. Text that is not recognised comes back under OTHER with its own words. */
function parseOther(text) {
  const out = []; const unknown = [];
  for (let tok of String(text).split(/[\/,+]/)) {
    tok = tok.trim().toLowerCase(); if (!tok || /^0+$/.test(tok)) continue;
    const kv3 = /^kvs? ?3/.test(tok); const rest = kv3 ? tok.replace(/^kvs? ?3/, '') : tok;
    const pair = /\d\s*&\s*\d\s*$/.test(rest);                       // "copy book 1&2" is two books
    const m = rest.match(/(\d+)\s*$/); const qty = pair ? 2 : m ? Number(m[1]) : 1;
    const hit = WORDS.find(w => w[0].test(tok));
    if (hit) out.push({ key: hit[1], label: hit[2] || '', qty });
    else { const label = tok.replace(/[\d&\s]+$/, '').trim().slice(0, 60) || tok.slice(0, 60); out.push({ key: 'OTHER', label: label.charAt(0).toUpperCase() + label.slice(1), qty }); unknown.push(tok); }
  }
  return { items: out, unknown };
}

async function readForm(file) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0]; let head = null; const days = new Map();
  const stats = { entries: 0, test: 0, dateFixed: [], sameDay: 0, unknown: [], unreadable: [] };
  ws.eachRow({ includeEmpty: false }, row => {
    const v = row.values.slice(1);
    if (!head) { head = v.map(h => txt(h).toLowerCase().replace(/\s+/g, ' ').trim()); return; }
    const stamp = v[0] instanceof Date ? v[0].toISOString().slice(0, 10) : null; if (!stamp && !v.some(x => txt(x))) return;
    stats.entries++;
    let day = v[1] instanceof Date ? v[1].toISOString().slice(0, 10) : null;
    // The day must be close to when the form was filled in; otherwise the year was mistyped.
    if (stamp && (!day || Math.abs(Date.parse(day) - Date.parse(stamp)) > 45 * 864e5)) { stats.dateFixed.push(`${txt(v[1]).slice(0, 10) || 'blank'} → ${stamp}`); day = stamp; }
    if (!day) { stats.unreadable.push(`row ${row.number}: no date`); return; }
    const items = []; const odd = [];
    head.forEach((h, i) => {
      if (i < 2 || !h) return; const raw = txt(v[i]); if (!raw) return;
      if (h === 'other') { const p = parseOther(raw); items.push(...p.items); odd.push(...p.unknown.map(u => `${day}: ${u}`)); return; }
      const col = COLUMNS.find(c => c[0].test(h));
      const n = Number(raw.match(/^\d+(\.\d+)?/)?.[0]);
      if (!Number.isFinite(n)) { stats.unreadable.push(`${day}, ${h}: "${raw.slice(0, 30)}"`); return; }
      if (n > 0) items.push(col ? { key: col[1], label: col[2] || '', qty: Math.round(n) } : { key: 'OTHER', label: h, qty: Math.round(n) });
    });
    // A try-out of the form: the same count in every product column.
    const counts = head.map((h, i) => (i >= 2 && h !== 'other' && COLUMNS.slice(0, 9).some(c => c[0].test(h)) ? Number(txt(v[i])) : null)).filter(x => x !== null);
    if (counts.length >= 8 && counts.every(x => x === counts[0] && x > 0)) { stats.test++; return; }
    stats.unknown.push(...odd);
    if (days.has(day)) stats.sameDay++;
    const d = days.get(day) || new Map();
    for (const it of items) { const k = it.key + '|' + it.label; d.set(k, { ...it, qty: (d.get(k)?.qty || 0) + it.qty }); }
    days.set(day, d);
  });
  if (!head || !head.includes('date')) throw new Error('This does not look like the Daily Dispatch form export: the "Date" column is missing.');
  return { days, stats };
}

async function main() {
  const args = process.argv.slice(2); const dry = args.includes('--dry-run');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Give the path of the form export:  npm run import:dispatch -- "/path/to/Daily Dispatch - Report Responses.xlsx"'); process.exit(1); }
  const { days, stats } = await readForm(path.resolve(file));
  const byProduct = {}; let pieces = 0, rows = 0, replaced = 0; const kept = new Set();
  await withDb(async (db, admin) => {
    await db.tx(async t => {
      const { products } = await ensureCatalogue(t);
      const bookName = Object.fromEntries((await t.all('SELECT id, name FROM books')).map(b => [b.id, b.name]));
      const data = [];
      // Days whose report was typed in the app stay as they are.
      const typed = new Set((await t.all(`SELECT DISTINCT day FROM dispatch_history WHERE source = 'manual'`)).map(r => r.day));
      for (const [day, d] of days) for (const it of d.values()) {
        if (typed.has(day)) { kept.add(day); continue; }
        const id = products[it.key].id; data.push([day, id, it.label, it.qty]); rows++; pieces += it.qty;
        const n = it.label || bookName[id]; byProduct[n] = (byProduct[n] || 0) + it.qty;
      }
      replaced = (await t.get(`SELECT COUNT(*) AS n FROM dispatch_history WHERE source = 'form'`)).n;
      if (!dry) {
        await t.run(`DELETE FROM dispatch_history WHERE source = 'form'`);
        await insertMany(t, 'dispatch_history', ['day', 'book_id', 'label', 'qty'], data);
        await t.run(`INSERT INTO audit_events (user_id, entity, action, after_json) VALUES (?,?,?,?)`, [admin.id, 'import', 'dispatch_history_imported', JSON.stringify({ file: path.basename(file), days: days.size, rows, pieces })]);
      }
      if (dry) throw Object.assign(new Error('dry'), { dry: true });
    }).catch(e => { if (!e.dry) throw e; });
  });
  const all = [...days.keys()].sort();
  console.log(dry ? '\nDRY RUN — nothing was saved.\n' : '\nImport finished.\n');
  console.log(`Form entries                          ${stats.entries}`);
  console.log(`  test entry, left out                ${stats.test}`);
  console.log(`  second entry for a day, added in    ${stats.sameDay}`);
  console.log(`Days ${dry ? 'that would be saved' : 'saved'}                   ${days.size}   (${all[0]} to ${all[all.length - 1]})`);
  console.log(`Books and sets dispatched             ${pieces}`);
  if (kept.size) console.log(`Days already entered in the app, kept   ${kept.size}`);
  if (Number(replaced)) console.log(`Earlier dispatch history replaced     ${replaced} rows`);
  if (stats.dateFixed.length) console.log(`\nDates corrected to the day the form was filled in:\n  ${stats.dateFixed.join('\n  ')}`);
  if (stats.unreadable.length) console.log(`\nCould not be read, left out:\n  ${stats.unreadable.join('\n  ')}`);
  if (stats.unknown.length) console.log(`\n"Other" words not recognised (kept under Other titles):\n  ${stats.unknown.join('\n  ')}`);
  console.log('\nBy product:');
  for (const [k, v] of Object.entries(byProduct).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
}
if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { parseOther };
