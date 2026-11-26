// WhatsApp messages to customers, one chat at a time: pick the kind of message, check the text, then open each chat
// with it typed in. The app sends nothing itself; the person presses Send in WhatsApp. Opening a chat is noted on the
// customer (and moves them along in their open follow-up lists). The wording is in Settings → Customer messages.
import { api, esc, html, raw, table, drawer, options, toast, state, waLink, canEdit } from '../core.js';

const firstName = c => {
  const n = String(c.name || '').trim();
  if (!n || /^name not/i.test(n)) return 'there';
  return state.lists.places.includes(c.type) ? n : n.split(/\s+/)[0];
};
const whatsappPrice = b => (b.prices && b.prices['Tele-sales'] != null ? b.prices['Tele-sales'] : b.price);

/**
 * customers: [{ id, name, phone, type }]. opts: { listId, kind, after } — after() runs when the drawer closes,
 * if any chat was opened.
 */
export function whatsappDrawer(customers, opts = {}) {
  customers = customers.filter(c => waLink(c.phone));
  if (!customers.length) { toast('No customer here has a number WhatsApp can use', 'error'); return; }
  const m = state.messages; const kinds = state.messageKinds;
  const books = state.books.filter(b => b.active && b.sku !== 'OTHER');
  const record = canEdit('customers');
  let kind = opts.kind || 'feedback'; let links = {}; let sent = 0;
  drawer({
    wide: true,
    title: customers.length === 1 ? `WhatsApp ${customers[0].name}` : `WhatsApp ${customers.length} customers, one by one`,
    body: html`<div class="msg-types" role="radiogroup" aria-label="Message">${raw(kinds.map(([k, l, h]) => `<label class="msg-type"><input type="radio" name="wa-kind" value="${k}" ${k === kind ? 'checked' : ''}><span><b>${esc(l)}</b><small>${esc(h)}</small></span></label>`).join(''))}</div>
      <div class="field hidden" id="wa-book-f"><label for="wa-book">Book or set</label><select id="wa-book">${raw(options(books.map(b => [b.id, `${b.name} · ₹${whatsappPrice(b)}`]), books[0]?.id))}</select></div>
      <div id="wa-warn"></div>
      <div class="field"><label for="wa-text">Message</label><textarea id="wa-text" rows="6" maxlength="1000"></textarea>
        <div class="hint" id="wa-hint"></div></div>
      <div id="wa-list"></div>
      <p class="muted small">${raw(record ? 'Opening a chat is noted on the customer, and in their follow-up lists. You press Send in WhatsApp.' : 'You press Send in WhatsApp.')}</p>`,
    foot: '<button class="btn" type="button" data-close>Close</button>',
    onClose: () => { if (sent && opts.after) opts.after(); },
    onMount: d => {
      const ta = d.querySelector('#wa-text'); const list = d.querySelector('#wa-list'); const opened = new Set();
      const book = () => books.find(b => String(b.id) === d.querySelector('#wa-book').value);
      const fill = c => {
        const b = book();
        const vals = { name: firstName(c), link: links[c.id] ? `${location.origin}/f/${links[c.id]}` : '(link)', review_link: m.review_url || m.website_url, website: m.website_url,
          coupon: m.coupon || '(coupon)', academy_text: m.academy_text, academy_link: m.academy_url, product: b ? b.name : '', price: b ? whatsappPrice(b) : '' };
        return ta.value.replace(/\{(\w+)\}/g, (all, k) => (k in vals ? String(vals[k] ?? '') : all)).replace(/\n{3,}/g, '\n\n').trim();
      };
      const draw = () => {
        const waiting = kind === 'feedback' && !Object.keys(links).length;
        list.innerHTML = table([
          { label: 'Customer', cell: c => `${esc(c.name)}<span class="sub">${esc(c.phone)}</span>` },
          { label: 'Open', cls: 'cell-actions', cell: c => (waiting ? '<span class="muted small">Making links…</span>'
            : `${opened.has(c.id) ? '<span class="pill green">Opened</span> ' : ''}<a class="btn small ${opened.has(c.id) ? '' : 'primary'}" target="_blank" rel="noopener noreferrer" data-id="${c.id}" href="${esc(waLink(c.phone, fill(c)))}">Open WhatsApp</a>`) },
        ], customers);
      };
      const setKind = async k => {
        kind = k;
        ta.value = m.templates[k] || '';
        d.querySelector('#wa-book-f').classList.toggle('hidden', k !== 'new_product');
        const warn = { coupon: !m.coupon && 'No coupon is set yet. The Admin adds it in Settings → General → Customer messages.',
          review: !m.review_url && 'No website review page is set yet, so the link goes to the website.', academy: !m.academy_url && 'No Academy link is set yet. The Admin adds it in Settings.' }[k];
        d.querySelector('#wa-warn').innerHTML = warn ? `<div class="notice warn">${esc(warn)}</div>` : '';
        d.querySelector('#wa-hint').textContent = k === 'feedback' ? 'Each customer gets their own feedback link in place of {link}. {name} becomes their first name.' : '{name} becomes each customer\'s first name. Change the text here for this message only; the Admin sets the usual wording in Settings.';
        if (k === 'feedback' && !Object.keys(links).length) {
          draw();
          if (!record) { toast('Feedback links need Edit access to Customers', 'error'); return; }
          try { links = (await api('POST', '/api/feedback/links', { customer_ids: customers.slice(0, 500).map(c => c.id) })).links; } catch (err) { toast(err.message, 'error'); }
        }
        draw();
      };
      d.querySelector('.msg-types').addEventListener('change', e => { if (e.target.name === 'wa-kind') setKind(e.target.value); });
      d.querySelector('#wa-book').addEventListener('change', draw);
      ta.addEventListener('input', draw);
      list.addEventListener('click', e => {
        const a = e.target.closest('a[data-id]'); if (!a) return;
        const id = Number(a.dataset.id); opened.add(id);
        if (record) {
          api('POST', `/api/customers/${id}/messages`, { kind, list_id: opts.listId || null, book_id: kind === 'new_product' ? book()?.id : null })
            .then(() => { sent++; }).catch(err => toast(err.message, 'error'));
        }
        setTimeout(draw, 50);
      });
      setKind(kind);
    },
  });
}
