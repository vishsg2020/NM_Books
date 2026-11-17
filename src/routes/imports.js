'use strict';
// Monthly upload of the website's order export, and the reminder that it is due.
const { requireRole } = require('../auth');
const { bad, today, bool, str } = require('../util');
const { read } = require('../settings');
const W = require('../website-import');

const ROLES = ['admin', 'manager', 'online'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Due when nothing has been uploaded since the 1st of this month. The month to upload is the one just finished. */
async function uploadStatus(db) {
  const last = await read(db, 'website_upload'); const now = today(); const first = now.slice(0, 8) + '01';
  let [y, m] = now.split('-').map(Number); m -= 1; if (m < 1) { m = 12; y--; }
  return { due: !last || !last.on || last.on < first, month: `${MONTHS[m - 1]} ${y}`, month_from: `${y}-${String(m).padStart(2, '0')}-01`, last: last || null };
}

module.exports = (app, { db }) => {
  app.get('/api/imports/website', requireRole(...ROLES), async (_req, res) => {
    const history = (await db.all(`SELECT e.at, e.after_json, u.name AS user_name FROM audit_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.entity = 'import' AND e.action = 'website_orders_imported' ORDER BY e.id DESC LIMIT 12`))
      .map(r => { let a = {}; try { a = JSON.parse(r.after_json) || {}; } catch { /* keep empty */ } return { at: r.at, by: r.user_name || a.by || null, file: a.file || '', in_file: a.in_file ?? a.inFile ?? null, imported: a.imported ?? 0, amount: a.amount ?? 0 }; });
    res.json({ ...(await uploadStatus(db)), history });
  });

  // body: { filename, csv } for a CSV file, or { filename, xlsx } (base64) for an Excel file; dry_run: true only checks.
  app.post('/api/imports/website', requireRole(...ROLES), async (req, res) => {
    const b = req.body; const file = str(b.filename, { max: 200, name: 'File name' }) || 'website orders';
    let rows;
    if (typeof b.csv === 'string' && b.csv.trim()) rows = W.parseCsv(b.csv);
    else if (typeof b.xlsx === 'string' && b.xlsx) {
      try { rows = await W.parseXlsx(Buffer.from(b.xlsx, 'base64')); } catch { throw bad('This Excel file could not be read. Download the export again, or save it as CSV.'); }
    } else throw bad('Choose the CSV or Excel file downloaded from the website');
    const { orders, unreadable } = W.readOrders(rows);
    if (!orders.length) throw bad('No orders were found in this file');
    if (orders.length > 5000) throw bad('This file has more than 5,000 orders. Export a shorter period.');
    const sum = await W.importWebsiteOrders(db, req.user, orders, { dry: bool(b.dry_run), file });
    res.json({ ...sum, unreadable, status: await uploadStatus(db) });
  });
};
module.exports.uploadStatus = uploadStatus;
