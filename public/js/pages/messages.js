// WhatsApp messages to customers, one chat at a time: pick the kind of message, check the text, then open each chat
// with it typed in. The app sends nothing itself; the person presses Send in WhatsApp. Opening a chat is noted on the
// customer (and moves them along in their open follow-up lists). The wording is in Settings → Customer messages.
import { api, esc, html, raw, table, drawer, options, toast, state, waLink, canEdit, fmtDate, inr, todayLocal } from '../core.js';

const firstName = c => {
  const n = String(c.name || '').trim();
  if (!n || /^name not/i.test(n)) return 'there';
  return state.lists.places.includes(c.type) ? n : n.split(/\s+/)[0];
};
const whatsappPrice = b => (b.prices && b.prices['Tele-sales'] != null ? b.prices['Tele-sales'] : b.price);

const GROUPS = [['Ask', ['feedback', 'review']], ['Offer', ['coupon', 'new_product', 'academy']], ['Other', ['share', 'custom']]];
const SHORT = { feedback: 'Feedback', review: 'Website review', coupon: 'Coupon', new_product: 'New book or set', academy: 'Language Academy', share: 'Share with friends', custom: 'Own message' };
const daysAgo = iso => { const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

/**
 * customers: [{ id, name, phone, type }]. opts: { listId, kind, after, title } — after() runs when the drawer closes,
 * if any chat was opened. Several customers are sent one by one: open WhatsApp, press Send there, come back, and the
 * next customer is ready. Anyone sent the same kind of message in the last 30 days is flagged.
 */
export function whatsappDrawer(customers, opts = {}) {
  customers = customers.filter(c => waLink(c.phone));
  if (!customers.length) { toast('No customer here has a number WhatsApp can use', 'error'); return; }
  const m = state.messages; const kinds = Object.fromEntries((state.messageKinds || []).map(([k, l, h]) => [k, [l, h]]));
  const books = state.books.filter(b => b.active && b.sku !== 'OTHER');
  const record = canEdit('customers');
  const many = customers.length > 1;
  let kind = opts.kind || 'feedback'; let links = {}; let sent = 0; let recent = {};
  const done = new Map(); // customer id → 'opened' | 'skipped'
  let at = 0;             // the customer whose turn it is
  drawer({
    wide: true,
    title: opts.title || (many ? `WhatsApp ${customers.length} customers, one by one` : `WhatsApp ${customers[0].name}`),
    body: html`<fieldset class="wa-kinds"><legend class="sr-only">Message</legend>${raw(GROUPS.map(([g, ks]) => `<div class="wa-group"><span class="wa-g">${g}</span>${ks.filter(k => kinds[k]).map(k => `<label class="wa-chip" title="${esc(kinds[k][1])}"><input type="radio" name="wa-kind" value="${k}" ${k === kind ? 'checked' : ''}><span>${esc(SHORT[k] || kinds[k][0])}</span></label>`).join('')}</div>`).join(''))}</fieldset>
      <div class="field hidden" id="wa-book-f"><label for="wa-book">Book or set</label><select id="wa-book">${raw(options(books.map(b => [b.id, `${b.name} · ₹${whatsappPrice(b)}`]), books[0]?.id))}</select></div>
      <div id="wa-warn"></div>
      <div class="wa-cols"><div class="field"><label for="wa-text">Message <span class="muted small">— change it for this time only</span></label><textarea id="wa-text" rows="7" maxlength="1000"></textarea>
        <div class="hint" id="wa-hint"></div></div>
        <div><span class="label" id="wa-pv-l">How it will look</span><div class="wa-preview" aria-labelledby="wa-pv-l"><div class="wa-to" id="wa-to"></div><div class="wa-bubble" id="wa-bubble"></div></div></div></div>
      <div id="wa-queue"></div>
      <p class="muted small">${raw(record ? 'Opening a chat is noted on the customer, and in their follow-up lists. You press Send in WhatsApp.' : 'You press Send in WhatsApp.')}</p>`,
    foot: '<button class="btn" type="button" data-close>Close</button>',
    onClose: () => { if (sent && opts.after) opts.after(); },
    onMount: d => {
      const ta = d.querySelector('#wa-text'); const q = d.querySelector('#wa-queue');
      const book = () => books.find(b => String(b.id) === d.querySelector('#wa-book').value);
      const fill = c => {
        const b = book();
        const vals = { name: firstName(c), link: links[c.id] ? `${location.origin}/f/${links[c.id]}` : '(link)', review_link: m.review_url || m.website_url, website: m.website_url,
          coupon: m.coupon || '(coupon)', academy_text: m.academy_text, academy_link: m.academy_url, product: b ? b.name : '', price: b ? whatsappPrice(b) : '' };
        return ta.value.replace(/\{(\w+)\}/g, (all, k) => (k in vals ? String(vals[k] ?? '') : all)).replace(/\n{3,}/g, '\n\n').trim();
      };
      const lastSent = c => (recent[c.id] || {})[kind];
      const current = () => customers[at];
      const preview = () => {
        const c = current() || customers[0];
        d.querySelector('#wa-to').textContent = `To ${c.name} · ${c.phone}`;
        d.querySelector('#wa-bubble').textContent = fill(c);
      };
      const link = c => esc(waLink(c.phone, fill(c)));
      const draw = () => {
        preview();
        const waiting = kind === 'feedback' && !Object.keys(links).length;
        const c = current();
        const flag = x => (lastSent(x) ? `<span class="pill amber">${esc(SHORT[kind])} sent ${esc(daysAgo(lastSent(x)))}</span>` : '');
        const opened = [...done.values()].filter(v => v === 'opened').length; const skipped = [...done.values()].filter(v => v === 'skipped').length;
        let now;
        if (!c) now = `<div class="wa-now done"><div><b>All done.</b> <span class="muted">${opened} opened${skipped ? ` · ${skipped} skipped` : ''}</span></div><button class="btn" type="button" data-again>Start again</button></div>`;
        else if (waiting) now = '<div class="wa-now"><span class="muted">Making the feedback links…</span></div>';
        else now = `<div class="wa-now"><div><div class="wa-who">${many ? `${at + 1}. ` : ''}${esc(c.name)}</div><div class="muted small">${esc(c.phone)}</div>${flag(c)}</div>
          <div class="btn-row">${many ? '<button class="btn" type="button" data-skip>Skip</button>' : ''}<a class="btn primary" target="_blank" rel="noopener noreferrer" data-open="${c.id}" href="${link(c)}">${done.get(c.id) === 'opened' ? 'Open again' : 'Open WhatsApp'} ↗</a></div></div>`;
        const rows = many ? customers.map((x, i) => ({ x, i })) : [];
        const from = Math.max(0, Math.min(at - 3, rows.length - 8)); const show = rows.slice(from, from + 8); // a window around the current customer
        q.innerHTML = `<div class="wa-q">${many ? `<div class="wa-q-head"><b>One by one</b><span class="muted small">${opened} of ${customers.length} opened${skipped ? ` · ${skipped} skipped` : ''}</span></div>
            <div class="wa-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${customers.length}" aria-valuenow="${opened + skipped}"><i data-w="${Math.round(((opened + skipped) / customers.length) * 100)}"></i></div>` : ''}
          ${now}
          ${many ? `<ol class="wa-list">${show.map(({ x, i }) => `<li class="${i === at ? 'on' : ''}"><button type="button" data-go="${i}">${i + 1}. ${esc(x.name)}</button>${lastSent(x) && !done.has(x.id) ? ' <span class="muted small">· sent before</span>' : ''}
            <span>${done.get(x.id) === 'opened' ? '<span class="pill green">Opened</span>' : done.get(x.id) === 'skipped' ? '<span class="pill amber">Skipped</span>' : i === at ? '<span class="muted small">now</span>' : ''}</span></li>`).join('')}</ol>
            ${rows.length > show.length ? `<div class="muted small">Showing ${from + 1}–${from + show.length} of ${rows.length}</div>` : ''}` : ''}</div>`;
        q.querySelectorAll('i[data-w]').forEach(i => { i.style.width = i.dataset.w + '%'; });
      };
      const next = () => { const i = customers.findIndex((x, k) => k > at && !done.has(x.id)); at = i >= 0 ? i : customers.findIndex(x => !done.has(x.id)); if (at < 0) at = customers.length; };
      const setKind = async k => {
        kind = k;
        ta.value = m.templates[k] || '';
        d.querySelector('#wa-book-f').classList.toggle('hidden', k !== 'new_product');
        const warn = { coupon: !m.coupon && 'No coupon is set yet. The Admin adds it in Settings → General → Customer messages.',
          review: !m.review_url && 'No website review page is set yet, so the link goes to the website.', academy: !m.academy_url && 'No Academy link is set yet. The Admin adds it in Settings.' }[k];
        const again = customers.filter(lastSent).length;
        d.querySelector('#wa-warn').innerHTML = (warn ? `<div class="notice warn">${esc(warn)}</div>` : '') + (again ? `<div class="notice info small">${again === customers.length && !many ? 'This customer was' : `${again} of these customers were`} sent a ${esc(SHORT[k].toLowerCase())} message in the last 30 days.</div>` : '');
        d.querySelector('#wa-hint').textContent = k === 'feedback' ? 'Each customer gets their own feedback link in place of {link}. {name} becomes their first name.' : "{name} becomes each customer's first name. The Admin sets the usual wording in Settings.";
        if (k === 'feedback' && !Object.keys(links).length) {
          draw();
          if (!record) { toast('Feedback links need Edit access to Customers', 'error'); return; }
          try { links = (await api('POST', '/api/feedback/links', { customer_ids: customers.slice(0, 500).map(c => c.id) })).links; } catch (err) { toast(err.message, 'error'); }
        }
        draw();
      };
      d.querySelector('.wa-kinds').addEventListener('change', e => { if (e.target.name === 'wa-kind') setKind(e.target.value); });
      d.querySelector('#wa-book').addEventListener('change', draw);
      ta.addEventListener('input', draw);
      q.addEventListener('click', e => {
        const go = e.target.closest('[data-go]'); if (go) { at = Number(go.dataset.go); draw(); return; }
        if (e.target.closest('[data-skip]')) { done.set(current().id, 'skipped'); next(); draw(); return; }
        if (e.target.closest('[data-again]')) { done.clear(); at = 0; draw(); return; }
        const a = e.target.closest('a[data-open]'); if (!a) return;
        const id = Number(a.dataset.open); done.set(id, 'opened');
        if (record) {
          api('POST', `/api/customers/${id}/messages`, { kind, list_id: opts.listId || null, book_id: kind === 'new_product' ? book()?.id : null })
            .then(() => { sent++; (recent[id] = recent[id] || {})[kind] = new Date().toISOString(); }).catch(err => toast(err.message, 'error'));
        }
        // The link opens WhatsApp in a new tab; when they come back, the next customer is ready.
        setTimeout(() => { if (many) next(); draw(); }, 400);
      });
      if (record) api('POST', '/api/customers/recent-messages', { customer_ids: customers.map(c => c.id) }).then(r => { recent = r.recent || {}; setKind(kind); }).catch(() => {});
      setKind(kind);
    },
  });
}

// ---------- Messages about one order (order confirmation, dispatched) ----------

/** The text of an order message for this sale, from the wording in Settings → Customer messages. */
export function orderMessage(s, kind) {
  const m = state.messages; const ship = state.shipping || { couriers: [] };
  const name = firstName({ name: s.customer_name, type: 'Individual' });
  const books = s.total_amount - (s.delivery_charge || 0) - (s.cod_charge || 0);
  const items = s.items.map(i => `• ${i.book_name} × ${i.qty} — ${inr(i.line_total)}`).join('\n');
  const charges = (s.delivery_charge || s.cod_charge) ? `Books ${inr(books)}\n${s.delivery_charge ? `Delivery ${inr(s.delivery_charge)}\n` : ''}${s.cod_charge ? `COD charge ${inr(s.cod_charge)}\n` : ''}` : '';
  let payment;
  if (s.balance <= 0) payment = 'Paid in full. Thank you!';
  else if (s.payment_method === 'COD') payment = `Please pay ${inr(s.balance)} in cash when the books arrive.`;
  else if (m.upi_id) payment = `Please pay ${inr(s.balance)} by UPI to ${m.upi_id}${m.upi_name ? ` (${m.upi_name})` : ''} and send us the screenshot here.`;
  else payment = `Amount to pay: ${inr(s.balance)}.`;
  const courier = ship.couriers.find(c => c.name === s.courier);
  const vals = { name, order_no: s.sale_no, date: fmtDate(kind === 'dispatched' ? todayLocal() : s.sale_date), items, charges, total: String(s.total_amount),
    payment, courier: s.courier || 'courier', tracking: s.tracking_no || '(tracking number)', tracking_link: courier?.url || m.website_url, website: m.website_url };
  return (m.templates[kind] || '').replace(/\{(\w+)\}/g, (all, k) => (k in vals ? String(vals[k] ?? '') : all)).replace(/\n{3,}/g, '\n\n').trim();
}

/** Notes on the customer that an order message was opened. */
export function logOrderMessage(s, kind) {
  if (s.customer_id && canEdit('customers')) api('POST', `/api/customers/${s.customer_id}/messages`, { kind, sale_id: s.id }).catch(() => {});
}
/** Opens WhatsApp with an order message and notes it on the customer. Call it straight from a click. */
export function sendOrderMessage(s, kind) {
  const link = waLink(s.customer_phone, orderMessage(s, kind));
  if (!link) { toast('This order has no number WhatsApp can use', 'error'); return; }
  window.open(link, '_blank', 'noopener');
  logOrderMessage(s, kind);
}
