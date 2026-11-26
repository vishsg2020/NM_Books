'use strict';
// Tidies the customer records that came from the order sheet and the WhatsApp group.
//   npm run customers:tidy              shows what would change, saves nothing
//   npm run customers:tidy -- --apply   saves the changes (each one is kept in the customer's history)
// Stop the app first when you use the built-in local database: it allows one program at a time.
//
// What it does:
//   1. corrects the WhatsApp note on each customer (the first import said the order was not in the app);
//   2. cleans names that start with a label or punctuation (":saleena", "Name:-Rubeena");
//   3. takes phone numbers out of addresses (the number is already on the record);
//   4. districts: a whole address typed into the district goes to the address; misspellings become the district
//      ("Kozhikod", "Tvpm", "Trichur"); a town or an empty district is filled from the PIN, using the district that
//      the other customers with that PIN have;
//   5. State from the PIN: Kerala for 67xxxx to 69xxxx, the right state for the rest;
//   6. merges records of the same person: the same name and the same PIN on two numbers. The record with more
//      orders is kept, the other number becomes its second number, and every order, call and visit moves to it.
// It never changes sales, amounts or stock. Names that need a person to look at them stay in "Update needed".
require('./load-env');
const { withDb } = require('./import-db');
const { mergeCustomers } = require('../src/routes/customers');

const KD = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod'];
const ALIAS = { trivandrum: 'Thiruvananthapuram', tvm: 'Thiruvananthapuram', tvpm: 'Thiruvananthapuram', tpm: 'Thiruvananthapuram', calicut: 'Kozhikode', calicit: 'Kozhikode', clt: 'Kozhikode', kochi: 'Ernakulam', cochin: 'Ernakulam', ekm: 'Ernakulam',
  trichur: 'Thrissur', tcr: 'Thrissur', alleppey: 'Alappuzha', alappey: 'Alappuzha', alpy: 'Alappuzha', quilon: 'Kollam', klm: 'Kollam', palghat: 'Palakkad', pkd: 'Palakkad', mlp: 'Malappuram', cannanore: 'Kannur', knr: 'Kannur', ksd: 'Kasaragod', pta: 'Pathanamthitta', ktm: 'Kottayam', idk: 'Idukki', wnd: 'Wayanad' };
const BENGALURU = /^(bangalore|banglore|bengaluru|bengaluruurban|bangaloreurban|blr)$/;
const key = s => String(s || '').toLowerCase().replace(/district|dist\b|\(dt\)|\bdt\b/g, '').replace(/[^a-z]/g, '');

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** A Kerala district from a spelling, or null. */
function districtOf(text) {
  const k = key(text); if (!k) return null;
  const exact = KD.find(d => key(d) === k) || ALIAS[k]; if (exact) return exact;
  if (k.length < 5) return null;
  const hits = KD.map(d => [d, lev(k, key(d))]).filter(([, n]) => n <= (k.length >= 10 ? 3 : 2)).sort((x, y) => x[1] - y[1]);
  return hits.length && (hits.length === 1 || hits[0][1] < hits[1][1]) ? hits[0][0] : null;
}
/** The State a PIN belongs to (by its first digits). */
function pinState(pin) {
  if (!/^[1-9][0-9]{5}$/.test(pin || '')) return null;
  const p2 = +pin.slice(0, 2), p3 = +pin.slice(0, 3);
  if (/^6825[5-9]/.test(pin)) return 'Lakshadweep';
  if (p2 >= 67 && p2 <= 69) return 'Kerala';
  if (p3 === 403) return 'Goa'; if (p3 === 605 || p3 === 609) return 'Puducherry'; if (p3 === 737) return 'Sikkim'; if (p3 === 744) return 'Andaman and Nicobar Islands'; if (p3 === 160) return 'Chandigarh'; if (p3 === 194) return 'Ladakh';
  if (p3 >= 790 && p3 <= 792) return 'Arunachal Pradesh'; if (p3 >= 793 && p3 <= 794) return 'Meghalaya'; if (p3 === 795) return 'Manipur'; if (p3 === 796) return 'Mizoram'; if (p3 >= 797 && p3 <= 798) return 'Nagaland'; if (p3 === 799) return 'Tripura';
  if ([244, 246, 247, 248, 249, 262, 263].includes(p3)) return 'Uttarakhand';
  if ((p3 >= 814 && p3 <= 816) || (p3 >= 825 && p3 <= 835)) return 'Jharkhand';
  const by2 = { 11: 'Delhi', 12: 'Haryana', 13: 'Haryana', 14: 'Punjab', 15: 'Punjab', 17: 'Himachal Pradesh', 18: 'Jammu and Kashmir', 19: 'Jammu and Kashmir', 30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan', 34: 'Rajasthan',
    36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat', 40: 'Maharashtra', 41: 'Maharashtra', 42: 'Maharashtra', 43: 'Maharashtra', 44: 'Maharashtra', 45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh', 48: 'Madhya Pradesh', 49: 'Chhattisgarh',
    50: 'Telangana', 51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh', 56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka', 60: 'Tamil Nadu', 61: 'Tamil Nadu', 62: 'Tamil Nadu', 63: 'Tamil Nadu', 64: 'Tamil Nadu',
    70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal', 73: 'West Bengal', 74: 'West Bengal', 75: 'Odisha', 76: 'Odisha', 77: 'Odisha', 78: 'Assam', 80: 'Bihar', 81: 'Bihar', 82: 'Bihar', 83: 'Bihar', 84: 'Bihar', 85: 'Bihar' };
  return by2[p2] || (p2 >= 20 && p2 <= 28 ? 'Uttar Pradesh' : null);
}
const PHONE = /(?:\b(?:ph|phone|mob|mobile|mob\s*no|contact|whatsapp|wa)\b\.?\s*(?:no\.?|number)?\s*[:.\-–]*\s*)?(?:\+?91[\s-]?)?0?[6-9]\d{4}[\s-]?\d{5}(?!\d)/gi;
const tidyText = s => s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/(,\s*){2,}/g, ', ').replace(/^[\s,.:;\-–]+|[\s,;:\-–]+$/g, '').trim();
const fmtNote = d => d; // dates in the notes are already written as "7 Jul 2025"

async function main() {
  const apply = process.argv.includes('--apply');
  const out = { notes: 0, names: [], addresses: 0, districtMoved: 0, districtSpelling: 0, districtFromPin: 0, townToDistrict: 0, stateSet: 0, stateFixed: 0, merged: [], left: 0 };
  await withDb(async (db, admin) => {
    const rows = await db.all(`SELECT c.id, c.code, c.name, c.address, c.location, c.state, c.pin, c.notes, c.source,
      EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS has_order FROM customers c ORDER BY c.id`);
    const next = new Map(rows.map(r => [r.id, { ...r }]));
    // 1. WhatsApp notes.
    for (const c of next.values()) {
      if (!c.notes || !/order itself is not in the app/.test(c.notes)) continue;
      const m = c.notes.match(/order posted on (\d{1,2} \w{3} \d{4})/) || c.notes.match(/order posts, (\d{1,2} \w{3} \d{4}) to/);
      const first = m ? fmtNote(m[1]) : null;
      c.notes = c.has_order
        ? `From the WhatsApp sales group${first ? `: first order posted on ${first}` : ''}.`
        : `From the WhatsApp sales group${first ? `: posted on ${first}` : ''}. The post named no book, so no order was recorded.`;
      out.notes++;
    }
    // 2. Names that start with a label or punctuation.
    for (const c of next.values()) {
      // Not a person's name at all (a bank detail or the address template pasted in): left as it is for Update needed.
      if (/account\s*(number|no)|ifsc|address\s*format/i.test(c.name)) continue;
      let n = c.name.normalize('NFKC').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(my\s+)?(name|address)\s*[:\-–.]+\s*/i, '');
      // "Fida Fathima K Address: Karanathil (h) ..." — the address part goes to the address.
      const at = n.search(/\baddress\s*[:\-–]/i);
      if (at > 1) { const rest = tidyText(n.slice(at).replace(/^address\s*[:\-–]+\s*/i, '')); n = n.slice(0, at); if (rest && !(c.address || '').toLowerCase().includes(rest.toLowerCase().slice(0, 15))) c.address = [rest, c.address].filter(Boolean).join(', ').slice(0, 500); }
      if (!n.includes('(')) n = n.replace(/\)+/g, ''); // "(Farsana P)" lost its "(" above
      n = n.replace(/["“”'‘’*]+$/u, '').replace(/[\s,;:\-–]+$/, '').replace(/\.{2,}$/, '.').replace(/\s+/g, ' ').trim();
      if (n !== c.name && n.length >= 2) { out.names.push(`${c.code}: "${c.name.slice(0, 40)}" → "${n.slice(0, 40)}"`); c.name = n; }
    }
    // 3. Phone numbers inside addresses.
    for (const c of next.values()) {
      if (!c.address || !/[6-9]\d{4}[\s-]?\d{5}/.test(c.address)) continue;
      const a = tidyText(c.address.replace(PHONE, ' '));
      if (a !== c.address) { c.address = a || null; out.addresses++; }
    }
    // 4. Districts. First the clear cases, then build PIN → district from the records that have both.
    for (const c of next.values()) {
      if (!c.location) continue;
      if (c.location.length > 40 || /\d/.test(c.location)) { // a whole address typed into the district
        const text = tidyText(c.location.replace(PHONE, ' '));
        if (text && !(c.address || '').toLowerCase().includes(text.toLowerCase().slice(0, 20))) c.address = [c.address, text].filter(Boolean).join(', ').slice(0, 500);
        c.location = null; out.districtMoved++; continue;
      }
      const d = districtOf(c.location);
      if (d && d !== c.location) { c.location = d; out.districtSpelling++; }
      else if (!d && BENGALURU.test(key(c.location)) && c.location !== 'Bengaluru') { c.location = 'Bengaluru'; out.districtSpelling++; }
    }
    const votes6 = new Map(), votes3 = new Map();
    const vote = (m, k, d) => { if (!m.has(k)) m.set(k, {}); m.get(k)[d] = (m.get(k)[d] || 0) + 1; };
    for (const c of next.values()) if (KD.includes(c.location) && /^6[7-9]\d{4}$/.test(c.pin || '')) { vote(votes6, c.pin, c.location); vote(votes3, c.pin.slice(0, 3), c.location); }
    const best = (m, k, min, share) => { const v = m.get(k); if (!v) return null; const t = Object.values(v).reduce((a, b) => a + b, 0); const [d, n] = Object.entries(v).sort((x, y) => y[1] - x[1])[0]; return n >= min && n / t >= share ? d : null; };
    const fromPin = pin => (/^6[7-9]\d{4}$/.test(pin || '') && !/^6825[5-9]/.test(pin) ? best(votes6, pin, 1, 0.75) || best(votes3, pin.slice(0, 3), 10, 0.9) : null);
    for (const c of next.values()) {
      if (KD.includes(c.location)) continue;
      const d = fromPin(c.pin); if (!d) continue;
      if (c.location) { // a town: it becomes part of the address, the district is set from the PIN
        if (!(c.address || '').toLowerCase().includes(c.location.toLowerCase())) c.address = [c.address, c.location].filter(Boolean).join(', ').slice(0, 500);
        out.townToDistrict++;
      } else out.districtFromPin++;
      c.location = d;
    }
    // 5. State from the PIN.
    for (const c of next.values()) {
      const s = pinState(c.pin) || (KD.includes(c.location) ? 'Kerala' : null);
      if (!s || s === c.state) continue;
      if (!c.state) { c.state = s; out.stateSet++; } else if (pinState(c.pin)) { c.state = s; out.stateFixed++; }
    }
    if (process.argv.includes('--samples')) {
      const show = f => rows.filter(r => (r[f] || null) !== (next.get(r.id)[f] || null)).sort(() => Math.random() - 0.5).slice(0, 8)
        .forEach(r => console.log(`  ${f} ${r.code}: ${JSON.stringify((r[f] || '').slice(0, 70))} → ${JSON.stringify((next.get(r.id)[f] || '').slice(0, 70))}`));
      ['address', 'location', 'state', 'notes'].forEach(show);
    }
    // Save the field changes.
    const FIELDS = ['name', 'address', 'location', 'state', 'notes'];
    const changed = rows.filter(r => FIELDS.some(f => (r[f] || null) !== (next.get(r.id)[f] || null)));
    out.changed = changed.length;
    if (apply && changed.length) {
      // In batches of 100, each saved on its own: if the connection drops, the batches already done stay saved and
      // running the tidy again carries on with the rest.
      for (let i = 0; i < changed.length; i += 100) {
        const part = changed.slice(i, i + 100);
        process.stdout.write(`\rSaving changes ${Math.min(i + 100, changed.length)} / ${changed.length} `);
        await db.tx(async t => {
          await t.run(`UPDATE customers c SET name = v.name, address = v.address, location = v.location, state = v.state, notes = v.notes, updated_at = now_iso()
            FROM (VALUES ${part.map(() => '(?::int, ?, ?, ?, ?, ?)').join(', ')}) AS v(id, name, address, location, state, notes) WHERE c.id = v.id`,
          part.flatMap(r => { const n = next.get(r.id); return [r.id, n.name, n.address, n.location, n.state, n.notes]; }));
          await t.run(`INSERT INTO audit_events (user_id, entity, entity_id, action, before_json, after_json, reason) VALUES ${part.map(() => `(?, 'customer', ?, 'tidied', ?, ?, 'Customer list tidy')`).join(', ')}`,
            part.flatMap(r => {
              const n = next.get(r.id); const before = {}, after = {};
              for (const f of FIELDS) if ((r[f] || null) !== (n[f] || null)) { before[f] = r[f]; after[f] = n[f]; }
              return [admin.id, r.id, JSON.stringify(before), JSON.stringify(after)];
            }));
        });
      }
      process.stdout.write('\n');
    }
    // 6. Same person, two records: the same name (letters only) and the same PIN.
    const groups = await db.all(`SELECT array_agg(id ORDER BY id) AS ids FROM (
        SELECT c.id, lower(regexp_replace(c.name, '[^A-Za-z]', '', 'g')) AS nk, c.pin FROM customers c WHERE c.kind = 'Customer' AND c.pin ~ '^[1-9][0-9]{5}$') k
      WHERE length(nk) >= 5 GROUP BY nk, pin HAVING COUNT(*) > 1`);
    const dismissed = new Set(JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'duplicates_dismissed'`))?.value || '[]'));
    for (const { ids } of groups) {
      if (dismissed.has(ids.join('-'))) continue;
      const info = await db.all(`SELECT c.id, c.code, c.name, c.phone, (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status <> 'Cancelled') AS orders FROM customers c WHERE c.id = ANY(?::int[])`, [ids]);
      info.sort((x, y) => y.orders - x.orders || x.id - y.id);
      out.merged.push(`${info[0].code} ${info[0].name} (${info.map(i => i.phone).join(' + ')})`);
      if (apply) process.stdout.write(`\rMerging ${out.merged.length} `);
      if (apply) await db.tx(async t => { for (const o of info.slice(1)) await mergeCustomers(t, info[0].id, o.id, { id: admin.id }, 'Customer list tidy: same name and PIN'); });
    }
    if (apply) await db.run(`INSERT INTO audit_events (user_id, entity, action, after_json) VALUES (?, 'import', 'customers_tidied', ?)`, [admin.id, JSON.stringify({ ...out, names: out.names.length, merged: out.merged.length })]);
  });
  console.log(apply ? '\nTidy finished.\n' : '\nCHECK ONLY — nothing was saved. Add --apply to save.\n');
  console.log(`WhatsApp notes corrected                ${out.notes}`);
  console.log(`Names cleaned (label or punctuation)    ${out.names.length}`);
  console.log(`Phone numbers taken out of addresses    ${out.addresses}`);
  console.log(`District: whole address moved out       ${out.districtMoved}`);
  console.log(`District: spelling corrected            ${out.districtSpelling}`);
  console.log(`District: town replaced, from the PIN   ${out.townToDistrict}`);
  console.log(`District: empty, filled from the PIN    ${out.districtFromPin}`);
  console.log(`State filled in from the PIN            ${out.stateSet}`);
  console.log(`State corrected from the PIN            ${out.stateFixed}`);
  console.log(`Customers changed in all                ${out.changed}`);
  console.log(`Same person on two records, ${apply ? 'merged' : 'to merge'}   ${out.merged.length}`);
  if (out.names.length) console.log(`\nNames:\n  ${out.names.join('\n  ')}`);
  if (out.merged.length) console.log(`\n${apply ? 'Merged' : 'Would merge'}:\n  ${out.merged.join('\n  ')}`);
  console.log('\nEverything else that needs a person (odd names, missing PIN or address) is on Customers → Update needed.');
}
if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { districtOf, pinState };
