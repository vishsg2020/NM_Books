// Customers → Feedback (the answers to the feedback links) and Customers → Website reviews (what customers agreed to
// show on nallamalayalam.in). Waiting reviews open as a queue, one at a time; approved and hidden ones as a table.
// Approving, hiding and the download: Admin and Manager. Adding a review: anyone who can edit Customers.
import { api, get, esc, raw, table, drawer, onSubmit, options, toast, fmtDate, fmtStamp, parseHash, state, canEdit, qs } from '../core.js';
import { callForm } from './calls.js';

const n = v => Number(v || 0).toLocaleString('en-IN');
const starsRo = s => `<span class="stars-ro" aria-label="${s} out of 5 stars">${'★'.repeat(s)}<span class="off">${'★'.repeat(5 - s)}</span></span>`;
const ageLine = a => (a ? `parent of a ${a.replace('-', '–')} year old` : '');
const SOURCE = { feedback: 'Feedback link', whatsapp: 'WhatsApp', call: 'Call', google: 'Google', instagram: 'Instagram', other: 'Other' };
const STYLE = { A: 'Simple page', C: 'Chat', E: 'Postcard', F: "Child's story" };
const REVIEW_STATUS = { waiting: 'Waiting for approval', approved: 'On the website list', hidden: 'Hidden', withdrawn: 'Taken back by the customer' };
const AGES = ['3-5', '6-8', '9-12', '12+'];

/** The tab bar shared by every Customers view. */
export function customerTabs(current, sum) {
  const tab = (view, label, count, cls = '') => `<a href="#/customers${view ? '?view=' + view : ''}" ${current === view ? 'aria-current="page"' : ''}>${label}${count === undefined ? '' : ` <span class="count ${cls}">${n(count)}</span>`}</a>`;
  return `<nav class="tabs" aria-label="Customer lists">${tab('', 'Customers', sum.complete)}${tab('update', 'Update needed', sum.needing + sum.sales_without_customer)}${tab('next', 'Next book')}
    ${tab('feedback', 'Feedback', sum.feedback)}${tab('reviews', 'Website reviews', sum.reviews_waiting, sum.reviews_waiting ? 'amber' : '')}</nav>`;
}

// ---------- Customers → Feedback ----------
const FILTERS = [['all', 'All'], ['comment', 'With a comment'], ['5', '5 ★'], ['4', '4 ★'], ['low', '3 ★ or less'], ['callback', 'Call back'], ['website', 'OK for website']];
const TEST = {
  all: () => true, comment: r => !!(r.comment || '').trim(), 5: r => r.stars === 5, 4: r => r.stars === 4, low: r => r.stars <= 3,
  callback: r => r.stars <= 3 && !r.called_back, website: r => r.website_answer === 'yes',
};
function feedbackSide(r) {
  if (r.stars <= 3) {
    if (r.called_back) return '<span class="pill">Called back</span>';
    return `<span class="pill red">Call back</span>${canEdit('calls') && r.customer_phone ? `<button class="btn small" type="button" data-call="${r.customer_id}">Log a call</button>` : ''}`;
  }
  if (r.website_answer === 'yes') return `<span class="pill green">OK for website</span><span class="muted small">${esc(REVIEW_STATUS[r.review_status] || '')}</span>`;
  if (r.website_answer === 'no') return '<span class="muted small">Said no to the website</span>';
  if ((r.comment || '').trim()) return '<span class="muted small">Not asked about the website yet</span>';
  return '';
}
const tagsOf = r => [...r.liked.map(x => `<span class="pill">${esc(x)}</span>`), ...r.reasons.map(x => `<span class="pill">${esc(x)}</span>`),
  ...(r.changes || []).map(x => `<span class="pill green">${esc(x)}</span>`), r.child_age ? `<span class="pill blue">Child ${esc(r.child_age.replace('-', '–'))}</span>` : ''].join('');
const feedbackCardRow = r => `<article class="fbx ${r.stars <= 3 ? 'low' : ''}"><div class="fbx-main">
  <div class="fbx-head">${starsRo(r.stars)} <span class="fbx-who"><a href="#/customer/${r.customer_id}"><b>${esc(r.customer_name)}</b></a>${r.customer_place ? `<span class="muted">, ${esc(r.customer_place)}</span>` : ''}</span>
    <span class="muted small">· ${esc(fmtStamp(r.submitted_at))}${r.style ? ' · ' + esc(STYLE[r.style] || r.style) : ''}</span></div>
  ${(r.comment || '').trim() ? `<blockquote>${esc(r.comment)}</blockquote>` : '<div class="muted small">No comment</div>'}
  <div class="fbx-tags">${tagsOf(r)}</div></div><div class="fbx-side">${feedbackSide(r)}</div></article>`;

export async function renderFeedback(page) {
  const q = parseHash().query; const f = TEST[q.f] ? q.f : 'all';
  const [d, sum] = await Promise.all([get('/api/feedback'), get('/api/customers/update-summary')]);
  const rows = d.rows.filter(TEST[f]);
  const bars = list => { const max = Math.max(1, ...list.map(r => r[1])); return `<div class="hbars">${list.map(([l, v]) => `<div class="hbar"><span class="l">${esc(String(l))}</span><span class="b"><i data-w="${Math.round((v / max) * 100)}"></i></span><span class="v">${n(v)}</span></div>`).join('')}</div>`; };
  const share = d.sent ? Math.round((d.answered / d.sent) * 100) : 0;
  page.innerHTML = `<div class="page-head"><div><h1>Customers</h1><div class="sub">What customers said through their feedback links. The look of their page is set in Settings → General → Feedback page.</div></div></div>
    ${customerTabs('feedback', sum)}
    <div class="kpis"><div class="kpi"><span class="l">Answers</span><span class="v">${n(d.answered)}</span><span class="s">of ${n(d.sent)} links sent · ${share}% answered</span></div>
      <div class="kpi"><span class="l">Average rating</span><span class="v">${d.average_90 === null ? '—' : esc(d.average_90.toFixed(1)) + ' ★'}</span><span class="s">last 90 days${d.average === null ? '' : ` · all time ${esc(d.average.toFixed(1))}`}</span></div>
      <a class="kpi" href="#/customers?view=reviews"><span class="l">OK to show on the website</span><span class="v">${n(d.website_yes)}</span><span class="s">${n(d.reviews_waiting)} waiting for approval</span></a>
      <a class="kpi ${d.low_not_called ? 'bad' : ''}" href="#/customers?view=feedback&f=callback"><span class="l">3 stars or less</span><span class="v">${n(d.low)}</span><span class="s">${n(d.low_not_called)} not called back yet</span></a></div>
    <div class="chips fbx-filters">${FILTERS.map(([k, l]) => `<a class="chip${k === f ? ' on' : ''}" href="#/customers?view=feedback${k === 'all' ? '' : '&f=' + k}">${esc(l)} <b>${n(d.rows.filter(TEST[k]).length)}</b></a>`).join('')}</div>
    <details class="panel fbx-charts"><summary>What they like, why they bought, and what changed for the child</summary>
      <div class="grid-3 top-gap"><section><h3>Stars</h3>${bars(d.stars.map(([s, v]) => [s + ' ★', v]))}</section><section><h3>What they like most</h3>${bars(d.liked)}</section>
        <section><h3>Why they bought</h3>${bars(d.reasons)}</section><section><h3>What changed for the child</h3>${bars(d.changes)}</section><section><h3>Child's age</h3>${bars(d.ages.map(([a, v]) => [a.replace('-', '–'), v]))}</section></div></details>
    <div class="fbx-list">${rows.length ? rows.map(feedbackCardRow).join('') : `<div class="state"><strong>${d.rows.length ? 'No answers match this filter' : 'No feedback yet'}</strong>${d.rows.length ? '' : "Send a feedback request from a customer's WhatsApp button, or from a follow-up list."}</div>`}</div>`;
  // Bar widths are set here, not in the markup (the page's security policy blocks inline styles).
  page.querySelectorAll('i[data-w]').forEach(i => { i.style.width = i.dataset.w + '%'; });
  page.onclick = e => {
    const b = e.target.closest('[data-call]'); if (!b) return;
    const r = d.rows.find(x => String(x.customer_id) === b.dataset.call);
    callForm({ phone: r.customer_phone, name: r.customer_name, after: () => renderFeedback(page) });
  };
}

// ---------- Customers → Website reviews ----------
const whoLine = r => `${esc(r.name_shown)}${r.place_shown ? ', ' + esc(r.place_shown) : ''}${r.child_age ? ` <span class="muted">· ${esc(ageLine(r.child_age))}</span>` : ''}`;
const fromLine = r => [SOURCE[r.source], r.source === 'feedback' ? 'said yes on their link' : `added by ${esc(r.created_by_name || '—')}${r.consent_note ? ` · “${esc(r.consent_note)}”` : ''}`,
  esc(fmtDate(String(r.consent_at || r.created_at).slice(0, 10))), r.book_name ? esc(r.book_name) : ''].filter(Boolean).join(' · ');
const webCard = r => `<div class="rv-web"><div class="rv-site">🌐 <b>nallamalayalam.in</b> · what parents say</div>${starsRo(r.stars)}<p>“${esc(r.text)}”</p><div class="rv-who">${whoLine(r)}</div></div>`;

export async function renderReviews(page) {
  const q = parseHash().query;
  const status = ['waiting', 'approved', 'hidden'].includes(q.status) ? q.status : 'waiting';
  const [d, sum] = await Promise.all([get('/api/website-reviews' + qs({ status, source: q.source, book: q.book, q: q.q })), get('/api/customers/update-summary')]);
  const canAdd = canEdit('customers');
  const stat = (k, label) => `<a class="stat${k === status ? ' on' : ''}" href="#/customers?view=reviews${k === 'waiting' ? '' : '&status=' + k}"><b>${n(d.counts[k])}</b><span>${label}</span></a>`;
  page.innerHTML = `<div class="page-head"><div><h1>Customers</h1><div class="sub">Reviews customers agreed to show on nallamalayalam.in. Only reviews with the customer's yes come here.</div></div>
      <div class="actions">${d.can_approve ? '<button class="btn" type="button" id="rv-dl">Download approved (Excel)</button>' : ''}${canAdd ? '<button class="btn primary" type="button" id="rv-add">+ Add a review</button>' : ''}</div></div>
    ${customerTabs('reviews', sum)}
    <div class="stat-row">${stat('waiting', 'Waiting for approval')}${stat('approved', 'Approved')}${stat('hidden', 'Hidden')}<div class="stat"><b>${d.average === null ? '—' : esc(d.average.toFixed(1)) + ' ★'}</b><span>Average of approved</span></div></div>
    <div id="rv-body"></div>`;
  const body = page.querySelector('#rv-body');
  if (status === 'waiting' && d.can_approve) queue(body, d.rows, page); else reviewTable(body, d, status, q, page);
  page.querySelector('#rv-add')?.addEventListener('click', () => reviewForm(null, () => renderReviews(page)));
  page.querySelector('#rv-dl')?.addEventListener('click', download);
}

/** Waiting reviews, one at a time: Approve and next, Hide, Skip (keys A, H, →). */
function queue(box, rows, page) {
  let i = 0;
  const draw = () => {
    if (!rows.length) { box.innerHTML = '<div class="state"><strong>Nothing waiting</strong>New reviews come here when a customer says yes on their feedback link, or when someone adds one.</div>'; return; }
    i = Math.min(i, rows.length - 1); const r = rows[i];
    box.innerHTML = `<div class="rq"><section class="panel rq-main" aria-live="polite"><div class="muted small">Waiting for approval · ${i + 1} of ${rows.length}</div>
        <div class="rq-stars">${starsRo(r.stars)}</div><blockquote class="rq-text">“${esc(r.text)}”</blockquote>
        <div class="rq-who">${whoLine(r)}</div><div class="muted small">${fromLine(r)}${r.customer_id ? ` · <a href="#/customer/${r.customer_id}">Customer page</a>` : ''}</div>
        ${r.edited ? `<div class="notice info small">Changed by the team. Their own words: “${esc(r.original_text)}”</div>` : ''}
        <div class="btn-row rq-acts"><button class="btn primary" type="button" data-q="approved">✓ Approve and next</button><button class="btn" type="button" data-q="hidden">Hide</button>
          <button class="btn" type="button" data-q="skip">Skip</button><button class="btn" type="button" data-q="edit">Edit text</button></div>
        <div class="muted small">Keys: A approve · H hide · → skip</div></section>
      <aside class="panel rq-side"><h3>Up next</h3><ol class="rq-list">${rows.map((x, k) => `<li class="${k === i ? 'on' : ''}"><button type="button" data-pick="${k}"><b>${esc(x.name_shown)}</b>${x.place_shown ? ', ' + esc(x.place_shown) : ''} <span class="muted">★${x.stars} · ${esc(SOURCE[x.source])}</span></button></li>`).join('')}</ol>
        <h3 class="top-gap">On the website it looks like</h3>${webCard(r)}</aside></div>`;
  };
  const act = async what => {
    const r = rows[i]; if (!r) return;
    if (what === 'skip') { i = (i + 1) % rows.length; draw(); return; }
    if (what === 'edit') { reviewForm(r, saved => { rows[i] = saved; draw(); }); return; }
    try {
      await api('POST', '/api/website-reviews/status', { ids: [r.id], status: what });
      toast(what === 'approved' ? `Approved: ${r.name_shown}` : `Hidden: ${r.name_shown}`);
      rows.splice(i, 1); draw();
      const st = page.querySelector('.stat.on b'); if (st) st.textContent = n(rows.length);
    } catch (err) { toast(err.message, 'error'); }
  };
  box.addEventListener('click', e => {
    const q = e.target.closest('[data-q]'); if (q) { act(q.dataset.q); return; }
    const p = e.target.closest('[data-pick]'); if (p) { i = Number(p.dataset.pick); draw(); }
  });
  const onKey = e => {
    if (!box.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (document.querySelector('.drawer') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'a' || e.key === 'A') act('approved'); else if (e.key === 'h' || e.key === 'H') act('hidden'); else if (e.key === 'ArrowRight') act('skip');
  };
  document.addEventListener('keydown', onKey);
  draw();
}

/** Approved, hidden (and, for others than Admin and Manager, their own waiting ones) as a table; tick several to change at once. */
function reviewTable(box, d, status, q, page) {
  const books = state.books.filter(b => b.sku !== 'OTHER').map(b => [b.id, b.name]);
  const bulk = d.can_approve;
  const moves = { approved: [['hidden', 'Hide'], ['waiting', 'Back to waiting']], hidden: [['approved', 'Approve'], ['waiting', 'Back to waiting']], waiting: [['approved', 'Approve'], ['hidden', 'Hide']] }[status];
  const editable = r => d.can_approve || (r.mine && r.status === 'waiting');
  box.innerHTML = `${status === 'waiting' ? '<div class="notice info">The Admin or a Manager approves each review. You see the ones you added.</div>' : ''}
    <form class="filters" id="rv-f"><input type="hidden" name="view" value="reviews">${status === 'waiting' ? '' : `<input type="hidden" name="status" value="${status}">`}
      <div class="field"><label for="rv-src">From</label><select id="rv-src" name="source">${options(d.sources, q.source || '', 'Everywhere')}</select></div>
      <div class="field"><label for="rv-book">Book</label><select id="rv-book" name="book">${options(books, q.book || '', 'All books')}</select></div>
      <div class="field grow"><label for="rv-q">Search</label><input id="rv-q" name="q" type="search" value="${esc(q.q || '')}" placeholder="Words, name or place"></div>
      <div class="field"><button class="btn" type="submit">Show</button></div></form>
    ${bulk && d.rows.length ? `<div class="bulkbar" id="rv-bulk" hidden><span id="rv-n">0 selected</span>${moves.map(([k, l]) => `<button class="btn small ${k === 'approved' ? 'primary' : ''}" type="button" data-move="${k}">${l}</button>`).join('')}</div>` : ''}
    ${table([
      ...(bulk ? [{ label: 'Select', cls: 'cell-check', cell: r => `<label class="sr-only" for="rv-c${r.id}">Select ${esc(r.name_shown)}</label><input type="checkbox" id="rv-c${r.id}" data-sel="${r.id}">` }] : []),
      { label: 'Stars', cell: r => starsRo(r.stars) },
      { label: 'Review', cell: r => `<div class="rv-text">${esc(r.text)}</div>${r.edited ? '<span class="muted small">Changed by the team</span>' : ''}` },
      { label: 'Shown as', cell: r => `<b>${esc(r.name_shown)}</b>${r.place_shown ? ', ' + esc(r.place_shown) : ''}${r.child_age ? `<span class="sub">${esc(ageLine(r.child_age))}</span>` : ''}` },
      { label: 'From', cell: r => `${esc(SOURCE[r.source])}<span class="sub">${r.source === 'feedback' ? 'their link' : esc(r.created_by_name || '')} · ${esc(fmtDate(String(r.consent_at).slice(0, 10)))}</span>` },
      { label: 'Book', cell: r => esc(r.book_name || '—') },
      { label: 'Actions', cls: 'cell-actions', cell: r => (editable(r) ? `<button class="btn small" type="button" data-edit="${r.id}">Edit</button>` : '') + (r.customer_id ? ` <a class="btn small" href="#/customer/${r.customer_id}">Customer</a>` : '') },
    ], d.rows, { empty: { waiting: 'Nothing waiting', approved: 'No approved reviews yet', hidden: 'Nothing hidden' }[status], emptyHint: status === 'approved' ? 'Approve reviews under Waiting for approval.' : '' })}`;
  const f = box.querySelector('#rv-f');
  f.addEventListener('submit', e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); location.hash = '#/customers' + qs(v); });
  const picked = () => [...box.querySelectorAll('[data-sel]:checked')].map(c => Number(c.dataset.sel));
  box.addEventListener('change', e => {
    if (!e.target.dataset.sel) return;
    const ids = picked(); const bar = box.querySelector('#rv-bulk');
    bar.hidden = !ids.length; box.querySelector('#rv-n').textContent = `${ids.length} selected`;
  });
  box.addEventListener('click', async e => {
    const m = e.target.closest('[data-move]');
    if (m) {
      try { const r = await api('POST', '/api/website-reviews/status', { ids: picked(), status: m.dataset.move }); toast(`${r.changed} review${r.changed === 1 ? '' : 's'} changed`); renderReviews(page); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) reviewForm(d.rows.find(r => String(r.id) === ed.dataset.edit), () => renderReviews(page));
  });
}

/** Add a review (r = null) or change one: name and place shown, the child's age, the words, the book. */
function reviewForm(r, after) {
  const add = !r; const manual = add || r.source !== 'feedback';
  const books = state.books.filter(b => b.sku !== 'OTHER' && (b.active || (r && r.book_id === b.id))).map(b => [b.id, b.name]);
  const sources = Object.entries(SOURCE).filter(([k]) => k !== 'feedback');
  drawer({
    wide: true, title: add ? 'Add a review' : 'Change the review',
    body: `<form id="rv-form" novalidate>
      ${add ? `<div class="field"><label for="rv-cq">Customer (optional)</label><div class="inline-search"><input id="rv-cq" type="search" placeholder="Name or full number" autocomplete="off"><button class="btn" type="button" id="rv-find">Find</button></div>
        <select id="rv-cust" name="customer_id" class="top-gap" hidden></select><div class="hint">Leave it empty for someone not in the app, such as a Google review.</div></div>` : ''}
      ${!add && r.edited ? `<div class="notice info small">Their own words: “${esc(r.original_text)}”</div>` : ''}
      <div class="grid2"><div class="field"><label for="rv-name">Name shown *</label><input id="rv-name" name="name_shown" required maxlength="40" value="${esc(r ? r.name_shown : '')}"><div class="hint">First name only.</div></div>
        <div class="field"><label for="rv-place">Place shown</label><input id="rv-place" name="place_shown" maxlength="40" value="${esc(r ? r.place_shown || '' : '')}"><div class="hint">District or city.</div></div></div>
      <div class="grid2">${manual ? `<div class="field"><label for="rv-stars">Stars *</label><select id="rv-stars" name="stars">${options([5, 4, 3, 2, 1].map(s => [s, '★'.repeat(s)]), r ? r.stars : 5)}</select></div>` : `<div class="field"><span class="label">Stars</span><div>${starsRo(r.stars)} <span class="muted small">given by the customer</span></div></div>`}
        <div class="field"><label for="rv-age">Child's age</label><select id="rv-age" name="child_age">${options(AGES.map(a => [a, a.replace('-', '–') + ' years']), r ? r.child_age || '' : '', 'Not given')}</select></div></div>
      <div class="field"><label for="rv-text">${add ? 'Review, in their words *' : 'Review as shown *'}</label><textarea id="rv-text" name="text" rows="4" maxlength="1000" required>${esc(r ? r.text : '')}</textarea>
        ${!add && r.source === 'feedback' ? '<div class="hint">Fix spelling or shorten it. Their own words stay on their customer page.</div>' : ''}</div>
      <div class="grid2">${add ? `<div class="field"><label for="rv-src2">Where it came from *</label><select id="rv-src2" name="source">${options(sources, 'whatsapp')}</select></div>` : ''}
        <div class="field"><label for="rv-book2">Book</label><select id="rv-book2" name="book_id">${options(books, r ? r.book_id || '' : '', 'Not given')}</select></div></div>
      ${add ? `<fieldset class="consent-box"><legend class="sr-only">Customer's permission</legend><label class="check"><input type="checkbox" name="consent"> <b>The customer agreed to show this on the website</b></label>
        <div class="field"><label for="rv-how">How they agreed *</label><input id="rv-how" name="consent_note" maxlength="300" placeholder="e.g. Said OK in the WhatsApp chat on 26 Nov"></div></fieldset>
        <p class="muted small">It waits for the Admin or a Manager to approve it.</p>` : ''}
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="rv-form">${add ? 'Save — waits for approval' : 'Save'}</button>`,
    onMount: (d, close) => {
      const form = d.querySelector('#rv-form');
      if (add) {
        const sel = d.querySelector('#rv-cust'); let found = [];
        const find = async () => {
          const term = d.querySelector('#rv-cq').value.trim(); if (!term) return;
          try {
            const res = await get('/api/customers' + qs({ q: term }));
            found = [...(res.rows || []), ...(res.found ? [res.found] : [])].slice(0, 30);
            sel.innerHTML = options(found.map(c => [c.id, `${c.name} · ${c.phone || ''}${c.location ? ' · ' + c.location : ''}`]), '', found.length ? 'Choose the customer' : 'Nobody found');
            sel.hidden = false;
          } catch (err) { toast(err.message, 'error'); }
        };
        d.querySelector('#rv-find').addEventListener('click', find);
        d.querySelector('#rv-cq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
        sel.addEventListener('change', () => {
          const c = found.find(x => String(x.id) === sel.value); if (!c) return;
          const first = String(c.name || '').trim().split(/\s+/)[0];
          d.querySelector('#rv-name').value = /^[A-Z]+$|^[a-z]+$/.test(first) ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : first;
          d.querySelector('#rv-place').value = c.location || c.state || '';
        });
      }
      onSubmit(form, async v => {
        const body = { name_shown: v.name_shown, place_shown: v.place_shown, child_age: v.child_age || null, text: v.text, book_id: v.book_id ? Number(v.book_id) : null };
        if (manual) body.stars = Number(v.stars);
        let saved;
        if (add) saved = await api('POST', '/api/website-reviews', { ...body, customer_id: v.customer_id ? Number(v.customer_id) : null, source: v.source, consent: v.consent === true, consent_note: v.consent_note });
        else saved = await api('PUT', `/api/website-reviews/${r.id}`, body);
        close(); toast(add ? 'Review saved. It waits for approval.' : 'Review changed'); after(saved);
      });
    },
  });
}

async function download() {
  try {
    const res = await fetch('/api/website-reviews/download.xlsx', { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
    const count = Number(res.headers.get('X-Review-Count') || 0);
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'nalla-malayalam-website-reviews.xlsx';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${count} approved review${count === 1 ? '' : 's'} downloaded`);
  } catch (err) { toast(err.message, 'error'); }
}
