'use strict';
// Adds the customers found in an exported WhatsApp group chat ("Export chat" → without media → the .txt file).
//   npm run import:whatsapp -- "/path/to/WhatsApp Chat with Nalla Malayalam sales Group.txt"     (add --dry-run to only see the summary)
// Stop the app first when you use the built-in local database: it allows one program at a time.
//
// The sales group is where the team posted each order's name, address and phone number. This script reads those
// posts. A post counts when it has a phone number together with a PIN code or an address-sized text; bare lists
// of numbers (call lists) are not customers and are left out.
//   - one customer per phone number; a number already in the app is NOT changed, except that an empty address,
//     district, State or PIN is filled in;
//   - a new customer gets the name, address, PIN, district and State from the post, the date of the first post as
//     "customer since" and the source "WhatsApp group";
//   - each order post becomes a sale (Tele-sales, Delivered, paid) with the book named in the post and the price of
//     the time (see RATES below; a post that states its amount keeps that amount). A post whose phone number
//     already has an order in the app within ten days either side is taken to be that order and makes no sale.
//     A post that names no book after the story books came out (27 Jun 2025) makes no sale. Stock is never changed.
// Safe to run again: nobody is added twice.
require('./load-env');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('../src/auth');
const { ensureCatalogue } = require('./catalogue');
const { withDb, insertMany, reserve, inr } = require('./import-db');

const SOURCE = 'WhatsApp group';
const DISTRICTS = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod'];
const ALIAS = { trivandrum: 'Thiruvananthapuram', tvm: 'Thiruvananthapuram', thiruvanathapuram: 'Thiruvananthapuram', thiruvananthapuram: 'Thiruvananthapuram', calicut: 'Kozhikode', kozhikkode: 'Kozhikode', eranakulam: 'Ernakulam', ekm: 'Ernakulam', kochi: 'Ernakulam', cochin: 'Ernakulam',
  kasargod: 'Kasaragod', kasaragode: 'Kasaragod', kasargode: 'Kasaragod', trissur: 'Thrissur', thrissure: 'Thrissur', trichur: 'Thrissur', alleppey: 'Alappuzha', alapuzha: 'Alappuzha', wayanadu: 'Wayanad', malapuram: 'Malappuram', palakad: 'Palakkad', palghat: 'Palakkad', kottyam: 'Kottayam', idukky: 'Idukki', quilon: 'Kollam', cannanore: 'Kannur' };
const PH = /(?<!\d)(?:\+?91[\s-]?)?0?([6-9]\d{4})[\s-]?(\d{5})(?!\d)/g;
const PIN = /(?<!\d)([1-8]\d)\s?(\d)\s?(\d)\s?(\d{2})(?!\d)/;
// Lines that say what was ordered or how it is paid, not who the customer is.
const PRODUCT = /story\s*book|nml|nalla\s*malayalam|kvs|kutti\s*vayana|part\s*[12]|combo|\bset\b|\bcod\b|cash on delivery|\bpaid\b|g\s?pay|online payment|prepaid|copy book|reading card|നല്ല മലയാളം|സീരീസ്|കഥ/i;
const LABEL = /^(name|address|addr|ph|phone|mob|mobile|mob no|contact|whatsapp|pin|pincode|pin code|post|district|dist|dt|state|landmark)\s*(no\.?|number)?\s*[:\-–.]*\s*/i;

// Prices announced in the group itself, by date.
//   Nalla Malayalam Part 1 + Part 2: ₹450 from 21 Mar 2025, ₹490 from 16 Apr 2025. Part 1 alone ₹299, Part 2 alone ₹259.
//   Story books (Kuttivayana Series 1, set of 4): ₹320 from 27 Jun 2025, ₹360 from 16 Nov 2025. Series 2: ₹350. Series 1 + 2: ₹690. Series 3: ₹380.
//   Nalla Malayalam pack + story books: ₹800 (26 Jun 2025). Single story books: ₹95 or ₹100.
//   COD adds ₹30 (₹25 before July 2025).
const STORY_FROM = '2025-06-27';
const RATES = {
  NMCOMBO: d => (d < '2025-04-16' ? 450 : 490), NM1: () => 299, NM2: () => 259,
  KVS1: d => (d < '2025-11-16' ? 320 : 360), KVS2: () => 350, KVSCOMBO: () => 690, KVS3: () => 380,
  MAMB: () => 95, CHAN: () => 100, MITT: () => 95, AKSH: () => 100, DOLP: () => 95, PACH: () => 95, KOOT: () => 95, NAKS: () => 95,
};
const codCharge = d => (d < '2025-07-01' ? 25 : 30);
const SINGLES = [[/^mamb/, 'MAMB'], [/^changa(th|$)/, 'CHAN'], [/^mittu/, 'MITT'], [/^akshara/, 'AKSH'], [/^dol(ph|f)i/, 'DOLP'], [/^pacha[k]*ari/, 'PACH'], [/^koo?t+(inte|u|$)/, 'KOOT'], [/^nakshat/, 'NAKS']];
const FILLER = new Set(['only', 'cod', 'book', 'books', 'story', 'and', 'makkalum', 'kadha', 'katha', 'kadhakal', 'kathakal', 'aagraham', 'agraham', 'kunju', 'pattukal', 'paattukal', 'nml', 'no', 'nos', 'set']);

/** What a post orders: { keys, qty, cod, amount } — catalogue keys from the book words, and the amount when the post states one. */
function readOrder(text, date) {
  const rest = text.replace(PH, ' ').replace(PIN, ' '); const s = rest.toLowerCase();
  const nm = /\bnml\b|nalla\s*malayalam|നല്ല മലയാളം/.test(s); const p1 = /part\s*-?\s*(1|one)\b/.test(s), p2 = /part\s*-?\s*(2|two)\b/.test(s);
  const k12 = /kvs\s*-?\s*1\s*[&,+]\s*2|kvs\s*12\b|series\s*1\s*[&,+]\s*2/.test(s); const k1 = /kvs\s*-?\s*1\b|series\s*1\b/.test(s), k2 = /kvs\s*-?\s*2\b|series\s*2\b/.test(s), k3 = /kvs\s*-?\s*3\b|series\s*3\b/.test(s);
  const sb = /story\s*books?/.test(s);
  const keys = [];
  if ((nm && !(p1 || p2)) || (p1 && p2)) keys.push('NMCOMBO'); else if (p1) keys.push('NM1'); else if (p2) keys.push('NM2');
  if (k12 || (k1 && k2)) keys.push('KVSCOMBO'); else { if (k1) keys.push('KVS1'); if (k2) keys.push('KVS2'); }
  if (k3) keys.push('KVS3');
  if (sb && !keys.some(k => k.startsWith('KVS'))) keys.push('KVS1');
  // Single story books: only on a line made of book names and nothing else, so a place name such as Mambaram is not read as a book.
  if (!keys.some(k => k.startsWith('KVS'))) for (const l of s.split('\n')) {
    const words = l.match(/[a-z]+/g) || []; if (!words.length || words.length > 12) continue;
    const hits = words.map(w => SINGLES.find(([re]) => re.test(w)));
    if (hits.some(Boolean) && words.every((w, i) => hits[i] || FILLER.has(w))) for (const h of hits) if (h) keys.push(h[1]);
  }
  // Before the story books existed, every order was the Nalla Malayalam pack.
  if (!keys.length && date < STORY_FROM) keys.push('NMCOMBO');
  let amount = null;
  for (const l of rest.split('\n')) {
    if (!(/cod|paid|₹|rs\b|amount|\/-|nml|story|kvs|part/i.test(l) || /^[₹\s]*\d{3,4}(\.\d\d)?\s*(\/-)?$/.test(l.trim()))) continue;
    const m = l.match(/(?<![\d.])(\d{3,4})(?:\.\d\d)?(?!\d)/); if (m && +m[1] >= 90 && +m[1] <= 6000 && !(+m[1] >= 2024 && +m[1] <= 2027)) { amount = +m[1]; break; }
  }
  const q = s.match(/(\d)\s*(sets?|nos|copies|copy)\b/);
  return { keys: [...new Set(keys)], qty: q && +q[1] >= 2 ? +q[1] : 1, cod: /\bcod\b|cash on delivery/.test(s), amount };
}

/** Prices one order: the lines (key, qty, price), the COD charge and the total. A stated amount wins over the price list. */
function priceOrder(o, date) {
  const lines = o.keys.map(k => ({ key: k, qty: o.keys.length === 1 ? o.qty : 1, price: RATES[k](date) }));
  if (o.keys.includes('NMCOMBO') && o.keys.includes('KVS1') && o.keys.length === 2 && date < '2025-11-16') lines[1].price = 310; // the ₹800 offer
  let books = lines.reduce((a, l) => a + l.qty * l.price, 0); let cod = o.cod ? codCharge(date) : 0; let stated = false;
  if (o.amount !== null && lines.length) {
    // The written amount is what was charged. A difference of ₹25 or ₹30 on a COD order is the COD charge; the rest moves a single-copy line.
    const diff = o.amount - books; stated = true;
    if (o.cod && (diff === 25 || diff === 30)) cod = diff;
    else { cod = o.cod && o.amount - books >= 0 && o.amount - books <= 40 ? o.amount - books : 0; const host = lines.find(l => l.qty === 1 && l.price + (o.amount - cod - books) > 0); if (host) host.price += o.amount - cod - books; else stated = false; }
    books = lines.reduce((a, l) => a + l.qty * l.price, 0);
  }
  return { lines, cod, total: books + cod, stated };
}

/** Splits the export into messages: { date: 'YYYY-MM-DD', who, text }. Understands "3/19/25, 10:13 AM - Name: text" and "[19/03/25, 10:13:05] Name: text". */
function readChat(text) {
  const start = /^‎?\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? \d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?\]?(?: -)? (.*)$/;
  const lines = text.replace(/\r/g, '').split('\n'); const raw = []; let cur = null;
  for (const l of lines) {
    const m = l.match(start);
    if (m) { const i = m[4].indexOf(': '); cur = i > 0 && i <= 60 ? { a: +m[1], b: +m[2], y: +m[3], who: m[4].slice(0, i), text: m[4].slice(i + 2) } : null; if (cur) raw.push(cur); }
    else if (cur) cur.text += '\n' + l;
  }
  // Month first (3/19/25) unless a first number above 12 shows the export is day first.
  const dayFirst = raw.some(r => r.a > 12) && !raw.some(r => r.b > 12);
  return raw.map(r => { const y = r.y < 100 ? 2000 + r.y : r.y; const [mo, d] = dayFirst ? [r.b, r.a] : [r.a, r.b]; return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, who: r.who, text: r.text }; });
}

function district(text) {
  const t = ' ' + text.toLowerCase().replace(/[^a-z]+/g, ' ') + ' ';
  for (const d of DISTRICTS) if (t.includes(' ' + d.toLowerCase() + ' ')) return d;
  for (const [k, v] of Object.entries(ALIAS)) if (t.includes(' ' + k + ' ')) return v;
  return null;
}
const tidy = s => s.replace(/[*_~‍‎ ]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,.:;\-–]+|[\s,;:\-–]+$/g, '').trim();

/** One order post → { phone, name, address, pin, district, state, items } or null when it is not a customer's address. */
function readPost(text) {
  const phones = [...new Set([...text.matchAll(PH)].map(m => m[1] + m[2]))];
  if (!phones.length) return null;
  const rest = text.replace(PH, ' ');
  const pm = rest.match(PIN); const pin = pm ? pm.slice(1).join('') : null;
  const letters = (rest.match(/[A-Za-zഀ-ൿ]/g) || []).length;
  if (!pin && (letters < 25 || (phones.length >= 3 && letters / phones.length < 25))) return null; // a call list or a bare number
  const lines = rest.split('\n').map(tidy).filter(Boolean);
  const items = []; const who = [];
  for (let l of lines) {
    if (/^<media omitted>$|this message was deleted|^null$/i.test(l)) continue;
    l = tidy(l.replace(LABEL, ''));
    if (!l || !/[A-Za-zഀ-ൿ]/.test(l)) continue;                     // only digits or punctuation (the PIN line, a stray number)
    if ((PRODUCT.test(l) && l.length <= 60) || /^(new\s+)?order\b|^book\s*\d|\bonly$|^urgent\b/i.test(l)) { items.push(l); continue; }
    who.push(l);
  }
  if (!who.length) return null;
  // The name is the first line; when the whole address is on one line, it is the part before the first comma.
  let name = who[0]; let addr = who.slice(1);
  if (name.includes(',') && (name.length > 40 || !addr.length)) { const parts = name.split(',').map(tidy).filter(Boolean); name = parts[0]; addr = [...parts.slice(1), ...addr]; }
  name = tidy(name.replace(/\b(pin|ph|mob)\b.*$/i, ''));
  // A whole address typed on one line: the name is what comes before the first full stop or number, or the first three words.
  if (name.length > 40 || /\d/.test(name)) {
    const full = name; let cut = tidy(name.split(/[.(\d]/)[0]);
    if (cut.length > 40 || cut.length < 2) cut = name.split(' ').slice(0, 3).join(' ');
    name = tidy(cut); const restOfLine = tidy(full.slice(full.indexOf(cut) + cut.length)); if (restOfLine.length > 1) addr = [restOfLine, ...addr];
  }
  name = name.slice(0, 150);
  if (name.length < 2 || !/[A-Za-zഀ-ൿ]{2}/.test(name)) name = 'Name not known';
  const address = [...new Set(addr.map(a => tidy(a.replace(PIN, ' ').replace(/\b(pin|pincode|pin code)\b\s*[:\-.]*/ig, ' '))).filter(a => a.length > 1))].join(', ').slice(0, 500) || null;
  const dist = district(rest);
  return { phone: phones[0], name, address, pin, district: dist, state: dist || (pin && /^6[7-9]/.test(pin)) ? 'Kerala' : null, items: [...new Set(items)].join('; ').slice(0, 120) };
}

const fmt = d => { const [y, m, dd] = d.split('-').map(Number); return `${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`; };

async function main() {
  const args = process.argv.slice(2); const dry = args.includes('--dry-run');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Give the path of the exported chat:  npm run import:whatsapp -- "/path/to/WhatsApp Chat with ... .txt"'); process.exit(1); }
  const msgs = readChat(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!msgs.length) throw new Error('No messages were found. Export the chat from WhatsApp ("Export chat", without media) and give the .txt file.');
  const people = new Map(); let posts = 0;
  for (const m of msgs) {
    const p = readPost(m.text); if (!p) continue;
    posts++;
    const order = { date: m.date, who: m.who, ...readOrder(m.text, m.date), items: p.items };
    const cur = people.get(p.phone);
    if (!cur) people.set(p.phone, { ...p, first: m.date, last: m.date, orders: [order] });
    else { cur.orders.push(order); if (m.date > cur.last) cur.last = m.date; if (m.date < cur.first) cur.first = m.date;
      for (const k of ['address', 'pin', 'district', 'state']) if (!cur[k] && p[k]) cur[k] = p[k]; if (cur.name === 'Name not known') cur.name = p.name; }
  }
  // The same order posted again within three days (a correction, or the address sent twice) is one order.
  for (const p of people.values()) {
    p.orders.sort((x, y) => x.date.localeCompare(y.date)); const kept = [];
    for (const o of p.orders) {
      const prev = kept[kept.length - 1];
      if (prev && (Date.parse(o.date) - Date.parse(prev.date)) / 864e5 <= 3 && (o.keys.join() === prev.keys.join() || !o.keys.length || !prev.keys.length)) {
        if (!prev.keys.length) prev.keys = o.keys; if (prev.amount === null) prev.amount = o.amount; prev.cod = prev.cod || o.cod; prev.qty = Math.max(prev.qty, o.qty); continue;
      }
      kept.push(o);
    }
    p.orders = kept;
  }
  const sum = { messages: msgs.length, posts, people: people.size, already: 0, filled: 0, added: 0, noName: 0, orders: 0, inApp: 0, noBook: 0, sales: 0, amount: 0, stated: 0, cod: 0, repeatBuyers: 0, byProduct: {}, byMonth: {} };
  await withDb(async (db, admin) => {
    await db.tx(async t => {
      const { products } = await ensureCatalogue(t);
      const bookName = Object.fromEntries((await t.all('SELECT id, name FROM books')).map(b => [b.id, b.name]));
      const have = new Map((await t.all('SELECT id, phone_norm, phone2_norm, address, location, state, pin FROM customers WHERE phone_norm IS NOT NULL')).flatMap(c => [[c.phone_norm, c], ...(c.phone2_norm ? [[c.phone2_norm, c]] : [])]));
      const done = new Set((await t.all(`SELECT import_ref FROM sales WHERE import_ref LIKE 'WA-%'`)).map(r => r.import_ref));
      // Orders already in the app (from the order sheet, the website, or typed in), by phone number.
      const earlier = new Map();
      for (const r of await t.all(`SELECT unnest(array_remove(ARRAY[c.phone_norm, c.phone2_norm], NULL)) AS p, s.sale_date FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.status <> 'Cancelled' AND (s.import_ref IS NULL OR s.import_ref NOT LIKE 'WA-%')`)) { if (!earlier.has(r.p)) earlier.set(r.p, []); earlier.get(r.p).push(r.sale_date); }
      const fresh = []; const todo = [];
      for (const p of people.values()) {
        const c = have.get(p.phone);
        if (c) {
          sum.already++;
          if ((!c.address && p.address) || (!c.location && p.district) || (!c.state && p.state) || (!c.pin && p.pin)) {
            sum.filled++;
            if (!dry) await t.run('UPDATE customers SET address = COALESCE(address, ?), location = COALESCE(location, ?), state = COALESCE(state, ?), pin = COALESCE(pin, ?), updated_at = now_iso() WHERE id = ?', [p.address, p.district, p.state, p.pin, c.id]);
          }
        } else { sum.added++; if (p.name === 'Name not known') sum.noName++; fresh.push(p); }
        let mine = 0;
        p.orders.forEach((o, n) => {
          sum.orders++;
          const ref = `WA-${o.date}-${p.phone}-${n + 1}`; if (done.has(ref)) return;
          if ((earlier.get(p.phone) || []).some(d => Math.abs(Date.parse(d) - Date.parse(o.date)) / 864e5 <= 10)) { sum.inApp++; return; }
          if (!o.keys.length) { sum.noBook++; return; }
          const pr = priceOrder(o, o.date); mine++;
          sum.sales++; sum.amount += pr.total; if (pr.stated) sum.stated++; if (o.cod) sum.cod++;
          sum.byMonth[o.date.slice(0, 7)] = (sum.byMonth[o.date.slice(0, 7)] || 0) + 1;
          for (const l of pr.lines) { const nm = bookName[products[l.key].id]; sum.byProduct[nm] = (sum.byProduct[nm] || 0) + l.qty; }
          todo.push({ p, o, pr, ref });
        });
        if (mine > 1) sum.repeatBuyers++;
        p.note = `From the WhatsApp sales group: first order posted on ${fmt(p.first)}.`;
      }
      if (!dry) {
        const custId = new Map([...have].map(([k, c]) => [k, c.id]));
        if (fresh.length) {
          let n = await reserve(t, 'customer_number_seq', fresh.length);
          const made = await insertMany(t, 'customers', ['code', 'name', 'phone', 'phone_norm', 'address', 'location', 'state', 'pin', 'kind', 'source', 'notes', 'created_at'],
            fresh.map(p => ['C-' + String(n++).padStart(5, '0'), p.name, p.phone, p.phone, p.address, p.district, p.state, p.pin, 'Customer', SOURCE, p.note, p.first + 'T00:00:00.000Z']), 'RETURNING id, phone_norm');
          for (const c of made) custId.set(c.phone_norm, c.id);
        }
        if (todo.length) {
          // The chat does not say who made each sale: they are held by an inactive "Not recorded" account, as in the order-sheet import.
          let sp = await t.get(`SELECT id FROM users WHERE lower(name) = 'not recorded' ORDER BY id LIMIT 1`);
          if (!sp) sp = await t.get(`INSERT INTO users (name, email, password_hash, role, active) VALUES ('Not recorded', 'not.recorded@imported.invalid', ?, 'telesales', 0) RETURNING id`, [hashPassword(crypto.randomBytes(24).toString('base64url'))]);
          let n = await reserve(t, 'sale_number_seq', todo.length);
          const saved = await insertMany(t, 'sales', ['sale_no', 'sale_date', 'channel', 'salesperson_id', 'customer_id', 'customer_name', 'customer_phone', 'address', 'status',
            'total_amount', 'amount_received', 'payment_method', 'payment_status', 'cod_charge', 'remarks', 'import_ref', 'created_by', 'created_at'],
          todo.map(({ p, o, pr, ref }) => ['S-' + String(n++).padStart(6, '0'), o.date, 'Tele-sales', sp.id, custId.get(p.phone), p.name, p.phone, p.address, 'Delivered',
            pr.total, pr.total, o.cod ? 'COD' : 'Other', 'Paid', pr.cod,
            `From the WhatsApp sales group, posted by ${o.who} on ${fmt(o.date)}.${o.items ? ` Books as written: ${o.items}.` : ' No book was written: before the story books came out, so taken as the Nalla Malayalam pack.'} ${pr.stated ? 'Amount as written in the post.' : 'Amount from the price list of the time.'}`.slice(0, 1000),
            ref, admin.id, o.date + 'T06:00:00.000Z']), 'RETURNING id, import_ref');
          const saleId = new Map(saved.map(r => [r.import_ref, r.id]));
          await insertMany(t, 'sale_items', ['sale_id', 'book_id', 'qty', 'unit_price', 'line_total'], todo.flatMap(({ pr, ref }) => pr.lines.map(l => [saleId.get(ref), products[l.key].id, l.qty, l.price, l.qty * l.price])));
          await insertMany(t, 'payments', ['sale_id', 'amount', 'method', 'paid_on', 'note', 'user_id'],
            todo.filter(x => x.pr.total > 0).map(({ o, pr, ref }) => [saleId.get(ref), pr.total, o.cod ? 'Cash' : 'Other', o.date, o.cod ? 'COD collected (WhatsApp group import)' : 'Paid (WhatsApp group import)', admin.id]));
        }
        await t.run(`INSERT INTO audit_events (user_id, entity, action, after_json) VALUES (?,?,?,?)`, [admin.id, 'import', 'whatsapp_group_imported', JSON.stringify({ file: path.basename(file), ...sum, byMonth: undefined, byProduct: undefined })]);
      }
      if (dry) throw Object.assign(new Error('dry'), { dry: true });
    }).catch(e => { if (!e.dry) throw e; });
  });
  console.log(dry ? '\nDRY RUN — nothing was saved.\n' : '\nImport finished.\n');
  console.log(`Messages in the chat                    ${sum.messages}`);
  console.log(`Order posts (address and phone)         ${sum.posts}`);
  console.log(`Different phone numbers                 ${sum.people}`);
  console.log(`  already customers, not changed        ${sum.already}   (empty address, district or PIN filled in for ${sum.filled})`);
  console.log(`  new customers ${dry ? 'that would be added' : 'added'}          ${sum.added}   (${sum.noName} with a name that could not be read)`);
  console.log(`Orders in the chat (repeats merged)     ${sum.orders}`);
  console.log(`  already in the app (same phone, ±10 days)  ${sum.inApp}`);
  console.log(`  no book named, no sale made           ${sum.noBook}`);
  console.log(`Sales ${dry ? 'that would be added' : 'added'}                   ${sum.sales}   (${inr(sum.amount)})`);
  console.log(`  amount written in the post            ${sum.stated}`);
  console.log(`  amount from the price list            ${sum.sales - sum.stated}`);
  console.log(`  COD orders                            ${sum.cod}`);
  console.log(`  customers with two or more of these   ${sum.repeatBuyers}`);
  console.log('\nBooks and sets:');
  for (const [k, v] of Object.entries(sum.byProduct).sort((x, y) => y[1] - x[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
  console.log('\nSales by month:');
  for (const k of Object.keys(sum.byMonth).sort()) console.log(`  ${k}  ${String(sum.byMonth[k]).padStart(5)}`);
}
if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { readChat, readPost, readOrder, priceOrder };
