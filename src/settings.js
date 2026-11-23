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

module.exports = { getCharges, cleanCharges, DEFAULT_CHARGES, getLists, cleanList, getCostRules, cleanCostRules, write, read, DEFAULT_LISTS, LOCKED, LIST_NAMES, COST_PARTS, COST_MODES, DEFAULT_COST_RULES };
