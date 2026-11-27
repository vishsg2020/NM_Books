'use strict';
// Settings the Admin can change. Read on each request (one small query), so a change applies at once everywhere.
const { bad } = require('./util');

const DEFAULT_LISTS = {
  payment_methods: ['UPI', 'Bank Transfer', 'COD', 'Cash', 'Card', 'Other'],
  call_statuses: ['Answered', 'Not Answered', 'Busy', 'Switched Off', 'Wrong Number'],
  call_outcomes: ['Interested', 'Not Interested', 'Follow-up', 'Sale'],
  location_types: ['School', 'Bookstore', 'Exhibition'],
  customer_types: ['Individual', 'School', 'Bookstore', 'Other'],
};
// Choices the app's own rules depend on. They cannot be removed (the Admin can add to the list around them).
const LOCKED = {
  payment_methods: ['COD'],                    // a COD order is paid on delivery
  call_statuses: ['Answered'],                 // only an answered call has an outcome
  call_outcomes: ['Follow-up', 'Sale'],        // these need a follow-up date / open the sale form
  location_types: ['School', 'Bookstore', 'Exhibition'], // an exhibition is an event, the others are saved places
  customer_types: ['Individual', 'School', 'Bookstore', 'Other'],
};
const LIST_NAMES = { payment_methods: 'Payment methods', call_statuses: 'Call statuses', call_outcomes: 'Call outcomes', location_types: 'Onsite location types', customer_types: 'Customer types' };

const COST_PARTS = ['printing', 'packing', 'postal', 'misc', 'ad_cost', 'amazon_fee', 'royalty', 'commission'];
const COST_MODES = ['tele', 'website', 'amazon', 'onsite'];
const DEFAULT_COST_RULES = {
  tele: ['printing', 'packing', 'postal', 'misc', 'ad_cost', 'royalty', 'commission'],
  website: ['printing', 'packing', 'postal', 'misc', 'ad_cost', 'royalty'],
  amazon: ['printing', 'packing', 'misc', 'royalty', 'amazon_fee'],
  onsite: ['printing', 'packing', 'misc', 'royalty'],
};

async function read(db, key) {
  const r = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  try { return r ? JSON.parse(r.value) : null; } catch { return null; }
}
const write = (db, key, value) => db.run(`INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now_iso()`, [key, JSON.stringify(value)]);

/** The dropdown lists. `places` = location types that are saved places (everything but Exhibition); they are customer types too. */
async function getLists(db) {
  const saved = (await read(db, 'lists')) || {};
  const out = {};
  for (const k of Object.keys(DEFAULT_LISTS)) out[k] = Array.isArray(saved[k]) && saved[k].length ? saved[k] : DEFAULT_LISTS[k];
  out.places = out.location_types.filter(t => t !== 'Exhibition');
  out.customer_types = [...new Set([...out.customer_types, ...out.places])];
  return out;
}
/** Checks and tidies one list sent by the Admin. */
function cleanList(key, values) {
  if (!DEFAULT_LISTS[key]) throw bad('Unknown list');
  if (!Array.isArray(values)) throw bad(`${LIST_NAMES[key]} must be a list`);
  const out = [];
  for (const v of values) {
    const t = String(v ?? '').trim().replace(/\s+/g, ' ');
    if (!t) continue;
    if (t.length > 40) throw bad(`"${t.slice(0, 20)}…" is too long (40 characters at most)`);
    if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  for (const need of LOCKED[key]) if (!out.includes(need)) throw bad(`"${need}" cannot be removed from ${LIST_NAMES[key]}: the app's rules depend on it`);
  if (out.length > 30) throw bad(`${LIST_NAMES[key]} can have 30 choices at most`);
  return out;
}

// Order charges and the size of a "bulk" order. The Admin changes these on the Settings page.
// Delivery is free when the books come to more than free_delivery_above; otherwise delivery_charge is added.
const DEFAULT_CHARGES = { cod_charge: 10, delivery_charge: 40, free_delivery_above: 492, bulk_min_copies: 10, bulk_min_amount: 3000 };
const CHARGE_NAMES = { cod_charge: 'COD charge', delivery_charge: 'Delivery charge', free_delivery_above: 'Free delivery above', bulk_min_copies: 'Bulk order: copies', bulk_min_amount: 'Bulk order: amount' };
async function getCharges(db) {
  const saved = (await read(db, 'charges')) || {}; const out = {};
  for (const k of Object.keys(DEFAULT_CHARGES)) out[k] = Number.isInteger(saved[k]) && saved[k] >= 0 ? saved[k] : DEFAULT_CHARGES[k];
  return out;
}
function cleanCharges(body, current) {
  const out = { ...current };
  for (const k of Object.keys(DEFAULT_CHARGES)) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (body[k] === '' || !Number.isInteger(n) || n < 0 || n > 1000000) throw bad(`${CHARGE_NAMES[k]} must be a whole number, 0 or more`, { field: CHARGE_NAMES[k] });
    out[k] = n;
  }
  if (out.bulk_min_copies < 2) throw bad('A bulk order needs at least 2 copies', { field: CHARGE_NAMES.bulk_min_copies });
  return out;
}

async function getCostRules(db) {
  const saved = (await read(db, 'cost_rules')) || {};
  const out = {};
  for (const m of COST_MODES) out[m] = Array.isArray(saved[m]) ? saved[m].filter(p => COST_PARTS.includes(p)) : DEFAULT_COST_RULES[m];
  return out;
}
function cleanCostRules(body) {
  const out = {};
  for (const m of COST_MODES) {
    if (!Array.isArray(body[m])) throw bad('Each channel needs its list of costs');
    out[m] = COST_PARTS.filter(p => body[m].includes(p));
  }
  return out;
}

// ---------- Customer messages (Settings → General → Customer messages) ----------
// The WhatsApp messages the team sends from Customers and Follow-up lists. In a template:
// {name} the customer's first name, {link} their feedback link, {review_link}, {website}, {coupon},
// {product} and {price} the book chosen, {academy_text}, {academy_link}.
const MESSAGE_KINDS = [
  ['feedback', 'Feedback request', 'Their own link: stars, a few taps and a comment'],
  ['review', 'Website review request', 'Ask for a review on the website; a coupon after they send a screenshot'],
  ['coupon', 'Coupon (after a review)', 'Send the coupon once they have shown their review'],
  ['new_product', 'New product', 'Tell them about a book or set'],
  ['academy', 'Language Academy', 'About Nalla Malayalam Language Academy'],
  ['share', 'Share with friends', 'Ask them to pass it on to family and friends'],
  ['custom', 'Own message', 'Type your own'],
];
const MESSAGE_FIELDS = [
  ['website_url', 'Website address', 'https://www.nallamalayalam.in'],
  ['review_url', 'Website review page', ''],
  ['coupon', 'Coupon to send after a review', ''],
  ['academy_text', 'About the Language Academy', 'Nalla Malayalam Language Academy teaches children to read and write Malayalam in small online classes, wherever they live. Ask us for the next batch.'],
  ['academy_url', 'Language Academy link', ''],
  ['upi_id', 'UPI ID for payments', ''],
  ['upi_name', 'Name on the UPI account', 'Nalla Malayalam'],
];
// Messages about one order: sent from the sale, not from the WhatsApp message list.
// Extra placeholders: {order_no}, {date}, {items}, {charges}, {total}, {payment}, {courier}, {tracking}, {tracking_link}.
const ORDER_KINDS = [
  ['order', 'Order confirmation', 'Sent after a sale: books, amount and how to pay'],
  ['dispatched', 'Dispatched', 'Sent when the order goes out, with the tracking number'],
];
const DEFAULT_MESSAGES = {
  website_url: 'https://www.nallamalayalam.in', review_url: '', coupon: '', academy_url: '', upi_id: '', upi_name: 'Nalla Malayalam',
  academy_text: MESSAGE_FIELDS[3][2],
  templates: {
    feedback: 'Hello {name}, thank you for buying from Nalla Malayalam! We would love to know what you think of the books. It takes 30 seconds:\n{link}\nThank you!',
    review: 'Hello {name}, thank you for choosing Nalla Malayalam! Could you write a short review on our website? It helps other parents find us:\n{review_link}\nSend us a screenshot of your review here and we will send you a coupon for your next order.',
    coupon: 'Hello {name}, thank you so much for your review! Here is your coupon for your next order: {coupon}\nOrder on our website: {website}',
    new_product: 'Hello {name}, greetings from Nalla Malayalam. {product} is now available at ₹{price}. Reply to this message to order, or order on our website: {website}',
    academy: 'Hello {name}, greetings from Nalla Malayalam. {academy_text}\n{academy_link}',
    share: 'Hello {name}, thank you for being a Nalla Malayalam reader! If your friends and family would like their children to learn Malayalam, please share our website with them: {website}',
    custom: 'Hello {name}, greetings from Nalla Malayalam.',
    order: 'Hello {name}, thank you for your order with Nalla Malayalam!\n\nOrder {order_no} · {date}\n{items}\n{charges}Total ₹{total}\n\n{payment}',
    dispatched: 'Hello {name}, your Nalla Malayalam order {order_no} is on its way!\nSent by {courier} on {date}.\nTracking number: {tracking}\nTrack it here: {tracking_link}\nHappy reading!',
  },
};
async function getMessages(db) {
  const saved = (await read(db, 'messages')) || {};
  const out = { templates: {} };
  for (const [k] of MESSAGE_FIELDS) out[k] = typeof saved[k] === 'string' ? saved[k] : DEFAULT_MESSAGES[k];
  for (const [k] of [...MESSAGE_KINDS, ...ORDER_KINDS]) out.templates[k] = saved.templates && typeof saved.templates[k] === 'string' && saved.templates[k].trim() ? saved.templates[k] : DEFAULT_MESSAGES.templates[k];
  return out;
}
function cleanMessages(body) {
  if (!body || typeof body !== 'object') throw bad('Send the customer messages');
  const out = { templates: {} };
  for (const [k, label] of MESSAGE_FIELDS) {
    const v = String(body[k] ?? '').trim();
    if (v.length > 600) throw bad(`${label} is too long`, { field: label });
    if (k.endsWith('_url') && v && !/^https:\/\/[^\s]+$/.test(v)) throw bad(`${label} must start with https://`, { field: label });
    out[k] = v;
  }
  for (const [k, label] of [...MESSAGE_KINDS, ...ORDER_KINDS]) {
    const v = String((body.templates || {})[k] ?? '').trim();
    if (!v) throw bad(`Write the "${label}" message`, { field: label });
    if (v.length > 1000) throw bad(`The "${label}" message is too long`, { field: label });
    if (k === 'feedback' && !v.includes('{link}')) throw bad('The feedback message needs {link}, where each customer\'s own link goes', { field: label });
    out.templates[k] = v;
  }
  return out;
}

// ---------- Shipping: labels and bills (Settings → General → Labels and bills) ----------
const SHIPPING_FIELDS = [
  ['from_name', 'Sender name (return address)', '3000BC SCRIPT MUSEUM'],
  ['from_address', 'Sender address', '1/812, Pappus, Kodakara, Opp. Govt. Hospital Kodakara, Thrissur Dt., Kerala - 680684'],
  ['from_phone', 'Sender phone', '(+91) 8590 4444 90'],
  ['booking_office', 'India Post booking office', 'Kodakara SO 680684'],
  ['biller_name', 'India Post biller name', '3000BC SCRIPT MUSEUM'],
  ['spcod_biller_id', 'SPCOD biller ID', '60983'],
  ['contract_id', 'India Post contract ID', '40119594'],
];
const DEFAULT_COURIERS = [{ name: 'India Post (Speed Post)', url: 'https://www.indiapost.gov.in' }, { name: 'DTDC', url: 'https://www.dtdc.in' }];
async function getShipping(db) {
  const saved = (await read(db, 'shipping')) || {}; const out = {};
  for (const [k, , d] of SHIPPING_FIELDS) out[k] = typeof saved[k] === 'string' ? saved[k] : d;
  out.couriers = Array.isArray(saved.couriers) && saved.couriers.length ? saved.couriers : DEFAULT_COURIERS;
  return out;
}
function cleanShipping(body) {
  if (!body || typeof body !== 'object') throw bad('Send the label details');
  const out = {};
  for (const [k, label] of SHIPPING_FIELDS) {
    const v = String(body[k] ?? '').trim();
    if (v.length > 300) throw bad(`${label} is too long`, { field: label });
    out[k] = v;
  }
  // Couriers, one per line: "Name | tracking page".
  const lines = (Array.isArray(body.couriers) ? body.couriers.map(c => `${c.name} | ${c.url || ''}`) : String(body.couriers || '').split('\n')).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw bad('Add at least one courier', { field: 'Couriers' });
  if (lines.length > 10) throw bad('Up to 10 couriers', { field: 'Couriers' });
  out.couriers = lines.map(l => {
    const [name, url = ''] = l.split('|').map(x => x.trim());
    if (!name || name.length > 60) throw bad(`Courier "${l}": give a name of up to 60 characters`, { field: 'Couriers' });
    if (url && !/^https:\/\/\S+$/.test(url)) throw bad(`Courier ${name}: the tracking page must start with https://`, { field: 'Couriers' });
    return { name, url };
  });
  return out;
}

// ---------- Next book: which book comes after which (Customers → Next book) ----------
const DEFAULT_NEXT_BOOK = { months: 1, steps: [['NMP1OCT2026', 'NMP2OCT2026'], ['NMCOMBOOCT2026', 'KVS1BUNDLEOCT2026'], ['KVS1BUNDLEOCT2026', 'KVS2BUNDLEOCT2026'], ['KVS2BUNDLEOCT2026', 'KVS3BUNDLENOV2026'], ['KVS12BUNDLEOCT2026', 'KVS3BUNDLENOV2026']] };
async function getNextBook(db) {
  const saved = (await read(db, 'next_book')) || {};
  return {
    months: [1, 2, 3, 6].includes(saved.months) ? saved.months : DEFAULT_NEXT_BOOK.months,
    steps: Array.isArray(saved.steps) ? saved.steps : DEFAULT_NEXT_BOOK.steps,
  };
}
function cleanNextBook(body, skus) {
  const months = Number(body && body.months);
  if (![1, 2, 3, 6].includes(months)) throw bad('Choose 1, 2, 3 or 6 months', { field: 'Waiting time' });
  const steps = (Array.isArray(body.steps) ? body.steps : []).map(x => [String(x[0] || '').trim(), String(x[1] || '').trim()]).filter(([a, b]) => a || b);
  if (steps.length > 12) throw bad('Up to 12 steps', { field: 'Steps' });
  for (const [a, b] of steps) {
    if (!skus.has(a.toLowerCase()) || !skus.has(b.toLowerCase())) throw bad('Choose a book or set for both sides of each step', { field: 'Steps' });
    if (a.toLowerCase() === b.toLowerCase()) throw bad('A step needs two different books', { field: 'Steps' });
  }
  return { months, steps };
}

// ---------- Customer feedback page (Settings → General → Feedback page) ----------
// The look of the page a customer opens from their feedback link. C and F also ask about the child.
const FEEDBACK_STYLES = [
  ['F', "Your child's story", 'One step at a time about what changed for the child; their review card fills in as they answer'],
  ['A', 'Simple page', 'Everything on one screen'],
  ['C', 'WhatsApp-style chat', 'Questions as chat messages with tap-to-answer replies'],
  ['E', 'Postcard', 'They write a postcard to Nalla Malayalam; "pin it on the readers\' wall" for the website'],
];
async function getFeedbackPage(db) {
  const saved = (await read(db, 'feedback_page')) || {};
  return { style: FEEDBACK_STYLES.some(s => s[0] === saved.style) ? saved.style : 'F' };
}
function cleanFeedbackPage(body) {
  const style = String((body && body.style) || '');
  if (!FEEDBACK_STYLES.some(s => s[0] === style)) throw bad('Choose a page style', { field: 'Page style' });
  return { style };
}

module.exports = { FEEDBACK_STYLES, getFeedbackPage, cleanFeedbackPage, ORDER_KINDS, SHIPPING_FIELDS, getShipping, cleanShipping, getNextBook, cleanNextBook, DEFAULT_NEXT_BOOK, MESSAGE_KINDS, MESSAGE_FIELDS, DEFAULT_MESSAGES, getMessages, cleanMessages, getCharges, cleanCharges, DEFAULT_CHARGES, getLists, cleanList, getCostRules, cleanCostRules, write, read, DEFAULT_LISTS, LOCKED, LIST_NAMES, COST_PARTS, COST_MODES, DEFAULT_COST_RULES };
