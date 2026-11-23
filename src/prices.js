'use strict';
// Price list: what a book or set sells for on each channel.
// A set in a discount group sells at its MRP less that group's discount for the channel (Settings → Discounts).
// Everything else sells at its MRP (the Book Master's selling price) on every channel.
const { read } = require('./settings');
const { bad } = require('./util');

const GROUPS = [['NM12', 'Nalla Malayalam Part 1 + Part 2'], ['KVS2', 'Kuttivayana: two series (1+2, 2+3 or 1+3)'], ['KVS3', 'Kuttivayana: all three series (1+2+3)']];
const CHANNELS = [['Website', 'Website'], ['Tele-sales', 'WhatsApp (tele-sales)'], ['Amazon', 'Amazon and Flipkart']];
const DEFAULT_DISCOUNTS = {
  NM12: { Website: 18, 'Tele-sales': 15, Amazon: 10 },
  KVS2: { Website: 15, 'Tele-sales': 10, Amazon: 10 },
  KVS3: { Website: 20, 'Tele-sales': 15, Amazon: 10 },
};

async function getDiscounts(db) {
  const saved = (await read(db, 'discounts')) || {}; const out = {};
  for (const [g] of GROUPS) {
    out[g] = {};
    for (const [c] of CHANNELS) { const v = saved[g] && saved[g][c]; out[g][c] = typeof v === 'number' && v >= 0 && v <= 90 ? v : DEFAULT_DISCOUNTS[g][c]; }
  }
  return out;
}
function cleanDiscounts(body) {
  const out = {};
  for (const [g, gl] of GROUPS) {
    out[g] = {};
    for (const [c, cl] of CHANNELS) {
      const raw = body && body[g] ? body[g][c] : undefined; const n = Number(raw);
      if (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0 || n > 90) throw bad(`Discount for ${gl}, ${cl}: give a number from 0 to 90`, { field: 'Discounts' });
      out[g][c] = Math.round(n * 100) / 100;
    }
  }
  return out;
}

/** The channel key for a sale: Website, Tele-sales or Amazon (Flipkart uses the Amazon rate); null = MRP. */
function channelKey(channel, platform) {
  if (channel === 'Tele-sales') return 'Tele-sales';
  if (channel === 'Online') return platform === 'Website' ? 'Website' : platform ? 'Amazon' : null;
  return null;
}
/** Price of one book row ({ price, mrp, discount_group }) on a channel key, with the given discounts. Whole rupees. */
function priceOf(b, key, discounts) {
  const pct = key && b.discount_group && discounts[b.discount_group] ? discounts[b.discount_group][key] : null;
  if (pct === null || pct === undefined) return b.price;
  return Math.round((b.mrp || b.price) * (1 - pct / 100));
}
/** All channel prices of a book: { Website, 'Tele-sales', Amazon } for a set in a group, else null. */
function pricesOf(b, discounts) {
  if (!b.discount_group || !discounts[b.discount_group]) return null;
  return Object.fromEntries(CHANNELS.map(([c]) => [c, priceOf(b, c, discounts)]));
}

module.exports = { GROUPS, CHANNELS, DEFAULT_DISCOUNTS, getDiscounts, cleanDiscounts, channelKey, priceOf, pricesOf };
