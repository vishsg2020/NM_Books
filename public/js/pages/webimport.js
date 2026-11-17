// Website orders: once a month, upload the order export downloaded from the website. Duplicates are ignored.
import { api, get, esc, html, raw, inr, fmtDate, fmtStamp, table, toast, parseHash } from '../core.js';

const n = v => Number(v || 0).toLocaleString('en-IN');
async function fileBody(file) {
  if (file.size > 4 * 1024 * 1024) throw new Error('This file is larger than 4 MB. Export a shorter period from the website.');
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return { filename: file.name, csv: await file.text() };
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose a .csv or .xlsx file');
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { filename: file.name, xlsx: btoa(bin) };
}

function summary(s) {
  const dup = s.already_imported + s.already_in_app;
  const row = (l, v, note = '') => `<dt>${esc(l)}</dt><dd>${esc(v)}${note ? ` <span class="muted small">${esc(note)}</span>` : ''}</dd>`;
  return `<dl class="totals">
    ${row('Orders in the file', n(s.in_file))}
    ${row('Duplicates, ignored', n(dup), dup ? `${n(s.already_imported)} uploaded before, ${n(s.already_in_app)} already entered in the app for the same phone number` : '')}
    ${row('Not paid on the website, left out', n(s.not_paid), Object.entries(s.not_paid_by_status).map(([k, v]) => `${k} ${v}`).join(', '))}
    ${s.refunded ? row('Fully refunded, left out', n(s.refunded)) : ''}
    ${row(s.saved ? 'Orders added' : 'New orders to add', n(s.imported), s.imported ? `${inr(s.amount)}${s.first_date ? `, ${fmtDate(s.first_date)} to ${fmtDate(s.last_date)}` : ''}` : '')}
    ${s.simple ? row('Book worked out from the amount', n(s.guessed), s.other_titles ? `${n(s.other_titles)} more could not be matched and go under "Other titles"` : '') : row('New customers', n(s.new_customers))}
  </dl>
  ${s.simple ? '<p class="muted small">This file has no phone number, address or item list. The orders are saved with the customer name and email only: they are not added to the Customers list, and the book is taken from the amount where exactly one book or set has that website price.</p>' : ''}
  ${s.other_titles && !s.simple ? `<p class="muted small">${n(s.other_titles)} item${s.other_titles === 1 ? ' was' : 's were'} not recognised and will sit under "Other titles".</p>` : ''}
  ${s.unreadable.length ? `<div class="notice warn">Could not be read and left out: ${esc(s.unreadable.join('; '))}</div>` : ''}
  ${s.other_amount.length ? `<details><summary>${n(s.other_amount.length)} ignored as duplicates although the amount differs</summary><ul>${s.other_amount.map(o => `<li>Website order ${esc(o.order)} (${esc(fmtDate(o.date))}, ${inr(o.amount)}) matches ${o.matches.map(m => `${esc(m.sale_no)} (${esc(fmtDate(m.date))}, ${inr(m.amount)})`).join(', ')}</li>`).join('')}</ul></details>` : ''}
  ${Object.keys(s.by_product).length ? `<p class="muted small">Copies: ${esc(Object.entries(s.by_product).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))}.</p>` : ''}`;
}

export async function render(page) {
  const d = await get('/api/imports/website');
  page.innerHTML = html`<div class="page-head"><div><h1>Website orders</h1><div class="sub">Once a month, upload the order file from the website. Orders already in the app are ignored.</div></div></div>
    ${raw(d.due ? `<div class="notice warn"><strong>Upload due.</strong> The website orders for ${esc(d.month)} have not been uploaded yet.</div>`
      : `<div class="notice info">Done for this month: uploaded on ${esc(fmtDate(d.last.on))}${d.last.by ? ` by ${esc(d.last.by)}` : ''}. The next reminder appears on the 1st.</div>`)}
    <section class="panel"><h2>Upload</h2>
      <ol>
        <li>On the website, open the order export and download the orders from ${esc(fmtDate(d.month_from))} to today as CSV (Excel also works). A longer period is fine: repeats are ignored.</li>
        <li>Choose the file here and press Check file. Nothing is saved yet.</li>
        <li>Read the summary, then press Add the orders.</li>
      </ol>
      <form id="wi-form" novalidate>
        <div class="field"><label for="wi-file">Order file (.csv or .xlsx)</label><input id="wi-file" name="file" type="file" accept=".csv,.xlsx,text/csv"></div>
        <div class="btn-row"><button class="btn primary" type="submit">Check file</button></div>
      </form>
      <div id="wi-out" aria-live="polite"></div>
    </section>
    <section class="panel"><h2>Earlier uploads</h2>
      ${raw(table([
        { label: 'When', cell: r => esc(fmtStamp(r.at)) },
        { label: 'By', cell: r => esc(r.by || '—') },
        { label: 'File', cell: r => esc(r.file || '—') },
        { label: 'Orders in file', cls: 'num', cell: r => (r.in_file === null ? '—' : n(r.in_file)) },
        { label: 'Added', cls: 'num', cell: r => n(r.imported) },
        { label: 'Amount', cls: 'num', cell: r => inr(r.amount) },
      ], d.history, { empty: 'No uploads yet' }))}</section>
    <p class="muted small">Uploaded orders are saved as Online / Website sales, paid by card and delivered. They do not reserve or reduce stock; record the stock that left under Stock movements, or enter a website order by hand with Record a sale when it should go through packing and dispatch.</p>`;
  const form = page.querySelector('#wi-form'); const out = page.querySelector('#wi-out'); let body = null;
  const fail = err => { out.innerHTML = `<div class="notice error">${esc(err.message || 'Something went wrong')}</div>`; };
  form.addEventListener('submit', async e => {
    e.preventDefault(); const file = form.elements.file.files[0]; body = null;
    if (!file) return fail(new Error('Choose the file downloaded from the website'));
    out.innerHTML = '<p class="muted">Checking the file…</p>';
    try {
      body = await fileBody(file);
      const s = await api('POST', '/api/imports/website', { ...body, dry_run: true });
      out.innerHTML = `<h3>${esc(file.name)}</h3>${summary(s)}<div class="btn-row"><button class="btn primary" type="button" id="wi-go">${s.imported ? `Add the ${n(s.imported)} order${s.imported === 1 ? '' : 's'}` : 'Mark this month as done'}</button></div>`;
    } catch (err) { fail(err); }
  });
  form.elements.file.addEventListener('change', () => { out.innerHTML = ''; body = null; });
  out.addEventListener('click', async e => {
    const b = e.target.closest('#wi-go'); if (!b || !body) return;
    b.disabled = true;
    try {
      const s = await api('POST', '/api/imports/website', body);
      toast(s.imported ? `${n(s.imported)} website order${s.imported === 1 ? '' : 's'} added` : 'No new orders; this month is marked as done');
      await render(page, { query: parseHash().query });
      page.querySelector('#wi-out').innerHTML = `<div class="notice info">Saved.</div>${summary(s)}${s.imported ? `<p><a href="#/sales?channel=Online">See the Online sales</a></p>` : ''}`;
    } catch (err) { b.disabled = false; fail(err); }
  });
}
