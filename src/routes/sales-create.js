'use strict';
// POST /api/sales — the common sales entry for Tele-sales, Online and Onsite.
const { CHANNEL_OF } = require('../auth');
const { isWide } = require('../access');
const { audit } = require('../audit');
const { moveStock, saleStock } = require('../stock');
const { findOrCreateCustomer, CUSTOMER_TYPES } = require('./customers');
const { resolveLocation, recordVisit, readLocation } = require('./visits');
const { getLists } = require('../settings');
const P = require('../prices');

const MAX_CHARGE = 10000;
const { bad, forbidden, conflict, str, int, money, date, oneOf, bool, idParam, today, inr } = require('../util');

module.exports = (app, { db, load, perm }) => {
  const { paymentStatus, CHANNELS, METHODS } = require('./sales');

  app.post('/api/sales', perm('sales'), async (req, res) => {
    const b = req.body; const me = req.user; const lists = await getLists(db);
    const requestKey = str(b.request_key, { name: 'Request key', max: 80 });
    if (requestKey) {
      const dup = await db.get('SELECT id FROM sales WHERE request_key = ?', [requestKey]);
      if (dup) return res.json(await load(dup.id)); // the form was submitted twice
    }

    const channel = CHANNEL_OF[me.role] || oneOf(b.channel, CHANNELS, { required: true, name: 'Sales channel' });
    if (b.channel && b.channel !== channel) throw forbidden();
    const dateName = channel === 'Onsite' ? 'Visit date' : 'Sales date';
    const saleDate = date(b.sale_date, { name: dateName }) || today();
    if (saleDate > today()) throw bad(`The ${dateName.toLowerCase()} cannot be in the future`, { field: dateName });

    // The sales person is the signed-in user; Admin and Manager may enter a sale for someone else.
    let salespersonId = me.id;
    if (isWide(me.role) && b.salesperson_id && Number(b.salesperson_id) !== me.id) {
      const sp = await db.get(`SELECT id FROM users WHERE id = ? AND active = 1 AND role <> 'dispatch'`, [idParam(b.salesperson_id)]);
      if (!sp) throw bad('Sales person not found', { field: 'Sales person' });
      salespersonId = sp.id;
    }

    const f = { platform: null, platform_order_id: null, location_type: null, location_name: null, contact_person: null, next_visit_date: null };
    let handedOver = false, defaultType = 'Individual', loc = null;
    if (channel === 'Online') {
      f.platform = oneOf(b.platform, ['Website', 'Amazon', 'Flipkart'], { required: true, name: 'Platform' });
      f.platform_order_id = str(b.platform_order_id, { required: true, name: 'Order ID', max: 80 });
    } else if (channel === 'Onsite') {
      // The school or bookstore: picked from the saved list, or typed in for a new one.
      loc = await readLocation(db, b);
      f.location_type = loc.type; f.location_name = loc.name; f.contact_person = loc.contact_person;
      // An exhibition sale is handed over on the spot and has no next visit.
      f.next_visit_date = loc.type === 'Exhibition' ? null : date(b.next_visit_date, { name: 'Next visit date' });
      handedOver = loc.type === 'Exhibition' || b.handed_over === undefined ? true : bool(b.handed_over);
      if (f.location_type !== 'Exhibition') defaultType = f.location_type;
    }
    const tele = channel === 'Tele-sales';
    const phone = loc ? loc.phone : str(b.customer_phone, { name: 'Customer contact number', max: 30, required: tele });
    const address = loc ? loc.address : str(b.address, { name: 'Customer address', max: 500, required: tele });
    // At an exhibition the buyer is a walk-in: their own name if given, otherwise the sale carries the exhibition's name.
    const buyerName = str(b.customer_name, { name: 'Customer name', max: 150 });
    const customerName = (loc && loc.type !== 'Exhibition' ? null : buyerName) || f.location_name;
    if (!customerName) throw bad('Customer name is required', { field: 'Customer name' });
    const location = str(b.location, { name: 'District', max: 100 });
    const state = str(b.state, { name: 'State', max: 60 });
    const pin = (str(b.pin, { name: 'PIN', max: 10 }) || '').replace(/\s/g, '') || null;
    if (pin && !/^[1-9][0-9]{5}$/.test(pin)) throw bad('PIN must be 6 digits', { field: 'PIN' });
    const customerType = oneOf(b.customer_type, lists.customer_types, { name: 'Customer type' }) || defaultType;

    // Items: every book comes from the Book Master, once per sale.
    if (!Array.isArray(b.items) || !b.items.length) throw bad('Add at least one book', { field: 'Books' });
    if (b.items.length > 100) throw bad('Too many lines on one sale');
    const items = b.items.map((it, n) => ({
      book_id: int(it && it.book_id, { required: true, min: 1, name: `Book on line ${n + 1}` }),
      qty: int(it && it.qty, { required: true, min: 1, max: 100000, name: `Quantity on line ${n + 1}` }),
      unit_price: it && it.unit_price !== undefined && it.unit_price !== '' && it.unit_price !== null
        ? money(it.unit_price, { name: `Unit price on line ${n + 1}`, max: 1000000 }) : null,
    }));
    if (new Set(items.map(i => i.book_id)).size !== items.length) throw bad('The same book is on two lines. Put it on one line with the full quantity.', { field: 'Books' });
    // The price list for this sale: a set in a discount group gets its channel's discount on the MRP; the rest sells at MRP.
    const books = await db.all('SELECT b.id, b.name, b.price, b.mrp, b.discount_group, b.active FROM books b WHERE b.id = ANY(?::int[])', [items.map(i => i.book_id)]);
    const discounts = await P.getDiscounts(db); const key = P.channelKey(channel, f.platform);
    for (const bk of books) bk.price = P.priceOf(bk, key, discounts);
    for (const it of items) {
      const bk = books.find(x => x.id === it.book_id);
      if (!bk) throw bad('A selected book is not in the Book Master', { field: 'Books' });
      if (!bk.active) throw bad(`"${bk.name}" is inactive and cannot be sold`, { field: 'Books' });
      if (it.unit_price === null) it.unit_price = bk.price;
      it.line_total = it.qty * it.unit_price;
    }
    const booksTotal = items.reduce((s, i) => s + i.line_total, 0);
    // Delivery and COD charges are added to an order that is sent out (not to an onsite or exhibition sale).
    const delivery = channel === 'Onsite' ? 0 : money(b.delivery_charge, { name: 'Delivery charge', max: MAX_CHARGE }) ?? 0;
    const cod = channel === 'Onsite' ? 0 : money(b.cod_charge, { name: 'COD charge', max: MAX_CHARGE }) ?? 0;
    const total = booksTotal + delivery + cod;

    const recvName = channel === 'Onsite' ? 'Advance payment' : 'Amount received';
    const method = oneOf(b.payment_method, lists.payment_methods, { name: 'Payment method' });
    const received = money(b.amount_received, { name: recvName }) ?? 0;
    if (received > total) throw bad(`${recvName} ${inr(received)} is more than the total ${inr(total)}`, { field: recvName });
    if (received > 0 && !method) throw bad(`Choose the payment method for the ${recvName.toLowerCase()}`, { field: 'Payment method' });
    if (received > 0 && method === 'COD') throw bad(`A COD order is paid on delivery. Leave ${recvName} at 0 and record the payment when the money arrives.`, { field: recvName });
    if (cod > 0 && method !== 'COD') throw bad('A COD charge applies only when the payment method is COD', { field: 'COD charge' });
    const exhibition = !!loc && loc.type === 'Exhibition';
    const dueDate = date(b.due_date, { name: 'Due date' });
    // A school or shop that still owes money must have a date to pay by.
    if (channel === 'Onsite' && !exhibition && total - received > 0 && !dueDate) throw bad(`Give the due date for the ${inr(total - received)} still to be paid`, { field: 'Due date' });
    const remarks = str(b.remarks, { name: 'Remarks', max: 1000 });
    const status = handedOver ? 'Completed' : 'Confirmed';

    if (f.platform_order_id) {
      const dupe = await db.get(`SELECT sale_no FROM sales WHERE platform = ? AND lower(platform_order_id) = lower(?) AND status <> 'Cancelled'`, [f.platform, f.platform_order_id]);
      if (dupe) throw conflict(`${f.platform} order ${f.platform_order_id} is already recorded as ${dupe.sale_no}`, { field: 'Order ID', sale_no: dupe.sale_no });
    }

    let id;
    try {
      id = await db.tx(async t => {
        // Rule: link the sale to a customer wherever a contact number is available.
        let cust = null;
        if (loc && loc.type !== 'Exhibition') cust = { id: await resolveLocation(t, { id: loc.id, type: loc.type, name: loc.name, phone, address, contact_person: loc.contact_person }) };
        else if (loc) cust = phone && buyerName ? await findOrCreateCustomer(t, { name: buyerName, phone, type: 'Individual' }) : null; // exhibition walk-in
        else if (phone) cust = await findOrCreateCustomer(t, { name: customerName, phone, address, location, state, pin, type: customerType });
        const { n } = await t.get(`SELECT nextval('sale_number_seq') AS n`);
        const s = await t.get(`INSERT INTO sales (sale_no, sale_date, channel, salesperson_id, customer_id, customer_name, customer_phone, address,
            platform, platform_order_id, location_type, location_name, contact_person, next_visit_date, status,
            total_amount, amount_received, payment_method, payment_status, due_date, remarks, request_key, created_by, delivery_charge, cod_charge, gift_pack)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id, sale_no`,
        ['S-' + String(n).padStart(6, '0'), saleDate, channel, salespersonId, cust ? cust.id : null, customerName, phone, address,
          f.platform, f.platform_order_id, f.location_type, f.location_name, f.contact_person, f.next_visit_date, status,
          total, received, method, paymentStatus(total, received, method), dueDate, remarks, requestKey, me.id, delivery, cod, b.gift_pack === true || b.gift_pack === 1 || b.gift_pack === '1' || b.gift_pack === 'on' ? 1 : 0]);
        // Lock books in a fixed order so two sales of the same books cannot deadlock.
        for (const it of items) {
          await t.run('INSERT INTO sale_items (sale_id, book_id, qty, unit_price, line_total) VALUES (?,?,?,?,?)', [s.id, it.book_id, it.qty, it.unit_price, it.line_total]);
        }
        // Rules: an order reserves stock; a completed onsite sale deducts it immediately.
        // A set or combo line moves the stock of each book inside it.
        for (const it of await saleStock(t, s.id)) {
          await moveStock(t, { bookId: it.book_id, type: handedOver ? 'Onsite sale' : 'Stock reserved', qty: it.qty, saleId: s.id, user: me });
        }
        // A sale made on a call is linked to that call (same person, and a call links to one sale only).
        if (b.call_id && cust) await t.run('UPDATE calls SET sale_id = ?, outcome = \'Sale\', updated_at = now_iso() WHERE id = ? AND customer_id = ? AND sale_id IS NULL AND status = \'Answered\'', [s.id, idParam(b.call_id), cust.id]);
        if (received > 0) {
          await t.run('INSERT INTO payments (sale_id, amount, method, paid_on, note, user_id) VALUES (?,?,?,?,?,?)',
            [s.id, received, method, saleDate, channel === 'Onsite' ? 'Advance payment' : 'Received with the order', me.id]);
        }
        // An onsite sale is also a visit: it appears in the visit list and completes any visit that was due.
        // (An exhibition is a sale only: it is not a visit to a school or bookstore.)
        if (loc && !exhibition) await recordVisit(t, { visit_date: saleDate, salesperson_id: salespersonId, customer_id: loc.type === 'Exhibition' ? null : cust.id, location_type: loc.type, location_name: loc.name,
          address, contact_person: loc.contact_person, contact_phone: phone, outcome: handedOver ? 'Sale' : 'Order taken', remarks, next_visit_date: f.next_visit_date, sale_id: s.id, created_by: me.id });
        await audit(t, me, 'sale', s.id, 'created', null, { sale_no: s.sale_no, channel, total_amount: total, amount_received: received, status, new_customer: !!(cust && cust.created) });
        return s.id;
      });
    } catch (e) {
      // A double click that raced past the check above: return the sale the first click saved.
      if (e.code === '23505' && requestKey) {
        const dup = await db.get('SELECT id FROM sales WHERE request_key = ?', [requestKey]);
        if (dup) return res.json(await load(dup.id));
      }
      throw e;
    }
    res.status(201).json(await load(id));
  });
};
