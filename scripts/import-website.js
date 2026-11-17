'use strict';
// Brings the orders exported from the OLD website (WooCommerce "Orders" export) into the app as HISTORY.
//   npm run import:website -- "/path/to/old_website_orders.xlsx"          (add --dry-run to only see the summary)
// Stop the app first when you use the built-in local database: it allows one program at a time.
// Import the Google order sheet first (npm run import:orders): website orders that the team had also typed into
// the order sheet are then left out. The same import is on the app's "Website orders" page (upload the file there).
//
// What it does:
//   - one sale per Order Number: channel Online, platform Website, the website's order number as the Order ID;
//   - real order lines and prices. The books listed at ₹0 under a set are the set's contents and are not repeated;
//   - a delivery charge is kept inside the order amount (added to the first line), as in the order-sheet import;
//   - customers are matched or created by phone number;
//   - every order is saved as Delivered and paid by card. It NEVER changes stock.
// Safe to run again: orders already imported are left alone.
require('./load-env');
const path = require('path');
const fs = require('fs');
const { ensureCatalogue } = require('./catalogue');
const { withDb } = require('./import-db');
const W = require('../src/website-import');

async function main() {
  const args = process.argv.slice(2); const dry = args.includes('--dry-run');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Give the path of the website export:  npm run import:website -- "/path/to/old_website_orders.xlsx"'); process.exit(1); }
  const full = path.resolve(file);
  const rows = /\.csv$/i.test(full) ? W.parseCsv(fs.readFileSync(full, 'utf8')) : await W.parseXlsx(fs.readFileSync(full));
  const { orders, unreadable } = W.readOrders(rows);
  let sum, sheetOrders;
  await withDb(async (db, admin) => {
    await db.tx(t => ensureCatalogue(t));
    sheetOrders = (await db.get(`SELECT COUNT(*) AS n FROM sales WHERE import_ref IS NOT NULL AND import_ref NOT LIKE 'WEB-%'`)).n;
    sum = await W.importWebsiteOrders(db, { id: admin.id, name: 'Import command' }, orders, { dry, file: path.basename(full) });
  });
  const inr = W.inr;
  console.log(dry ? '\nDRY RUN — no orders were saved.\n' : '\nImport finished.\n');
  console.log(`Orders in the website file            ${sum.in_file}`);
  console.log(`  already imported earlier            ${sum.already_imported}`);
  console.log(`  already in the app, left out        ${sum.already_in_app}   (same amount ${sum.already_in_app - sum.other_amount.length}, different amount ${sum.other_amount.length})`);
  console.log(`  not paid on the website, left out   ${sum.not_paid}${sum.not_paid ? '   (' + Object.entries(sum.not_paid_by_status).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : ''}`);
  console.log(`  fully refunded, left out            ${sum.refunded}`);
  console.log(`Orders ${dry ? 'that would be imported' : 'imported'}               ${sum.imported}   (${inr(sum.amount)}, of which delivery charges ${inr(sum.shipping)})`);
  console.log(`  new customers                       ${sum.new_customers}`);
  console.log(`  orders without a usable phone       ${sum.no_phone}  (kept, with no customer record)`);
  console.log(`  items not recognised → Other titles ${sum.other_titles}`);
  if (sum.simple) console.log(`  book worked out from the amount     ${sum.guessed}   (this file has no phone, address or items)`);
  if (!Number(sheetOrders)) console.log('\nNote: the Google order sheet is not in this database yet. Import it first (npm run import:orders),\nor website orders that were also typed into the sheet will be counted twice.');
  if (unreadable.length) console.log(`\nCould not be read, left out:\n  ${unreadable.join('\n  ')}`);
  if (sum.numbers.length) console.log(`\nWebsite order numbers ${dry ? 'that would be imported' : 'imported'}: ${sum.numbers.join(', ')}`);
  if (sum.other_amount.length) console.log(`\nLeft out as already in the app, but the amounts differ (please check):\n  ${sum.other_amount.map(o => `website order ${o.order} (${o.date}, ${inr(o.amount)}) ↔ ${o.matches.map(m => `${m.sale_no} (${m.date}, ${inr(m.amount)})`).join(', ')}`).join('\n  ')}`);
  console.log('\nCopies by product:');
  for (const [k, v] of Object.entries(sum.by_product).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
