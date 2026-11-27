// Follow-up lists: customers saved from the Customers filters for the tele-sales team to work through.
// Each customer has a status; "Ordered again" and "Feedback received" are set by the app.
import { api, get, esc, html, raw, table, toast, options, fmtStamp, fmtDate, inr, canEdit, waLink, qs, wireFilters, parseHash, drawer, state } from '../core.js';
import { whatsappDrawer } from './messages.js';
import { callForm } from './calls.js';

const n = v => Number(v || 0).toLocaleString('en-IN');
const SUMMARY = ['Not contacted yet', 'Contacted', 'No answer', 'Feedback received', 'Review requested', 'Ordered again'];

export async function render(page, ctx) {
  if (ctx.id) return renderList(page, ctx);
  const d = await get('/api/followups');
  const pctOf = l => (l.total ? Math.round(((l.total - (l.counts['Not contacted yet'] || 0)) / l.total) * 100) : 0);
  const progress = l => `<progress max="100" value="${pctOf(l)}" aria-label="${pctOf(l)}% contacted"></progress> <span class="small muted">${pctOf(l)}%</span>`;
  const names = l => l.assignees.map(a => a.name + (a.active ? '' : ' (inactive)')).join(', ');
  const mine = d.lists.filter(l => l.assigned_to_me && !l.closed_at);
  const rest = d.lists.filter(l => !mine.includes(l));
  const cols = [
    { label: 'List', cell: l => `<a href="#/followups/${l.id}">${esc(l.name)}</a>${l.closed_at ? ' <span class="pill">Closed</span>' : ''}<span class="sub">${esc(l.created_by_name)} · ${esc(fmtStamp(l.created_at))}</span>${l.note ? `<span class="sub">${esc(l.note)}</span>` : ''}` },
    { label: 'Customers', cls: 'num', cell: l => n(l.total) },
    { label: 'Not contacted yet', cls: 'num', cell: l => n(l.counts['Not contacted yet']) },
    { label: 'Contacted', cls: 'num', cell: l => n(l.total - (l.counts['Not contacted yet'] || 0)) },
    { label: 'Ordered again', cls: 'num', cell: l => n(l.counts['Ordered again']) },
    { label: 'Progress', cell: progress },
    { label: 'Assigned to', cell: l => `${l.assignees.length ? esc(names(l)) : '<span class="muted">Nobody yet</span>'}${d.can_assign ? `<span class="sub"><button class="linkbtn" type="button" data-assign="${l.id}">${l.assignees.length ? 'Change' : 'Assign'}</button></span>` : ''}` },
  ];
  page.innerHTML = `<div class="page-head"><div><h1>Follow-up lists</h1><div class="sub">Customers saved from the Customers page for the team to call or message again. Make one with <strong>Save as a follow-up list</strong> on Customers.${d.can_assign ? ' Assign a list to the people who should work it.' : ''}</div></div>
      <div class="actions"><a class="btn" href="#/customers">Customers</a></div></div>
    ${mine.length ? `<section class="panel"><h2>Assigned to you</h2>${table([
      { label: 'List', cell: l => {
        const others = l.assignees.filter(a => a.id !== state.me.id).map(a => a.name);
        return `<a href="#/followups/${l.id}">${esc(l.name)}</a><span class="sub">Assigned by ${esc(l.assigned_by_name)} · ${esc(fmtStamp(l.assigned_at))}${others.length ? ` · with ${esc(others.join(', '))}` : ''}</span>${l.note ? `<span class="sub">${esc(l.note)}</span>` : ''}`;
      } },
      { label: 'Customers', cls: 'num', cell: l => n(l.total) },
      { label: 'Not contacted yet', cls: 'num', cell: l => n(l.counts['Not contacted yet']) },
      { label: 'Progress', cell: progress },
    ], mine)}</section><h2 class="top-gap">${state.me.own?.customers ? 'Lists you made' : 'All lists'}</h2>` : ''}
    ${table(cols, rest, mine.length ? { empty: 'No other lists' } : { empty: 'No follow-up lists yet', emptyHint: 'On Customers, choose the filters (for example "Not bought since 6 months") and press Save as a follow-up list.' })}`;
  page.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', () => {
    const l = d.lists.find(x => String(x.id) === b.dataset.assign);
    assignForm(l, () => render(page, ctx));
  }));
}

const ROLE_GROUP = [['telesales', 'Tele-sales'], ['online', 'Online'], ['onsite', 'Onsite'], ['manager', 'Manager']];
/** Admin or Manager: tick the people who work this list. */
async function assignForm(list, after) {
  const people = await get('/api/followups/people');
  const on = new Set(list.assignees.map(a => a.id));
  const groups = ROLE_GROUP.map(([role, label]) => [label, people.filter(p => p.role === role)]).filter(g => g[1].length);
  drawer({
    title: 'Assign this list',
    body: `<p><b>${esc(list.name)}</b></p><p class="muted small">The people ticked see this list under <b>Assigned to you</b> on Follow-up lists and can change statuses, WhatsApp and log calls. Only the Admin, a Manager or whoever made the list can assign, close or reopen it.</p>
      <form id="as-form" novalidate>${groups.map(([label, ps]) => `<fieldset class="assign-group"><legend>${esc(label)}</legend>${ps.map(p => `<label class="check"><input type="checkbox" name="u" value="${p.id}" ${on.has(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</fieldset>`).join('') || '<p class="muted">No active sales team logins.</p>'}</form>`,
    foot: '<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="as-form">Save</button>',
    onMount: (dd, close) => {
      const form = dd.querySelector('#as-form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = dd.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const ids = [...form.querySelectorAll('input[name=u]:checked')].map(x => Number(x.value));
          await api('PUT', `/api/followups/${list.id}/assignees`, { user_ids: ids });
          close(); toast(ids.length ? 'List assigned' : 'Nobody is assigned now'); after();
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      });
    },
  });
}

async function renderList(page, { id, query }) {
  const d = await get(`/api/followups/${id}`);
  const edit = canEdit('customers') && !d.closed_at;
  const st = query.status || '';
  const order = { 'Not contacted yet': 0, 'No answer': 1, Contacted: 2, 'Feedback requested': 3, 'Review requested': 4, 'Feedback received': 5, 'Review posted': 6, 'Not interested': 7, 'Ordered again': 8 };
  page.innerHTML = html`<div class="page-head"><div><h1>${d.name}</h1>
      <div class="sub">Made by ${d.created_by_name} on ${fmtDate(d.created_at.slice(0, 10))} · ${n(d.members.length)} customers${d.note ? ' · ' + d.note : ''}${d.closed_at ? ` · closed by ${d.closed_by_name || ''} on ${fmtDate(d.closed_at.slice(0, 10))}` : ''}</div>
      <div class="sub">${d.assignees.length ? `Assigned to ${d.assignees.map(a => a.name).join(', ')}` : 'Not assigned to anyone'}</div></div>
      <div class="actions"><a class="btn" href="#/followups">All lists</a>${raw(d.can_assign ? '<button class="btn" type="button" id="fl-assign">Assign</button>' : '')}${raw(edit ? '<button class="btn" type="button" id="fl-wa">WhatsApp the customers shown</button>' : '')}${raw(canEdit('customers') && d.can_manage ? `<button class="btn" type="button" id="fl-close">${d.closed_at ? 'Reopen list' : 'Close list'}</button>` : '')}</div></div>
    ${raw(d.closed_at ? '<div class="notice info">This list is closed: statuses can no longer be changed. Reopen it to carry on.</div>' : '')}
    <div class="stat-row">${raw(SUMMARY.map(s => `<a class="stat${st === s ? ' on' : ''}" href="#/followups/${id}${qs({ status: st === s ? '' : s })}"><b>${n(d.counts[s])}</b><span>${esc(s)}</span></a>`).join(''))}</div>
    <form class="filters" id="fl-filters">
      <div class="field grow"><label for="fl-q">Search</label><input id="fl-q" name="q" type="search" placeholder="Name, phone or customer ID" value="${query.q || ''}"></div>
      <div class="field"><label for="fl-st">Status</label><select id="fl-st" name="status">${raw(options(d.statuses, st, 'All statuses'))}</select></div>
      <div class="field"><label for="fl-so">Sort by</label><select id="fl-so" name="sort">${raw(options([['todo', 'Not contacted first'], ['recent', 'Last contacted first'], ['name', 'Name A–Z']], query.sort || 'todo'))}</select></div>
    </form>
    <p class="result-count" id="fl-count"></p><div id="fl-list"></div>`;
  let rows = [];
  const reload = () => renderList(page, { id, query: parseHash().query });
  const draw = () => {
    const f = parseHash().query; const q = (f.q || '').toLowerCase(); const sort = f.sort || 'todo';
    const all = d.members.filter(m => (!f.status || m.status === f.status) && (!q || `${m.name} ${m.phone} ${m.code}`.toLowerCase().includes(q)));
    if (sort === 'todo') all.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    else if (sort === 'recent') all.sort((a, b) => (b.last_contact?.at || '').localeCompare(a.last_contact?.at || ''));
    rows = all.slice(0, 500);
    page.querySelector('#fl-count').textContent = (all.length === d.members.length ? `${n(all.length)} customers` : `${n(all.length)} of ${n(d.members.length)} customers`) + (all.length > 500 ? '. Showing the first 500.' : '');
    page.querySelector('#fl-list').innerHTML = table([
      { label: 'Customer', cell: m => `${m.yours === false ? `<b>${esc(m.name)}</b>` : `<a href="#/customer/${m.id}">${esc(m.name)}</a>`}<span class="sub">${esc(m.phone || '')}${m.location ? ' · ' + esc(m.location) : ''}</span>` },
      { label: 'Status', cell: m => `${edit ? `<label class="sr-only" for="st-${m.id}">Status for ${esc(m.name)}</label><select id="st-${m.id}" data-st="${m.id}">${options(d.statuses, m.status)}</select>` : esc(m.status)}
        ${m.sale_no ? `<span class="sub">${esc(m.sale_no)} · ${esc(fmtDate(m.sale_date))} · ${esc(inr(m.sale_amount))}${m.status === 'Ordered again' ? ' (found by the app)' : ''}</span>` : ''}
        ${m.stars ? `<span class="sub">${'★'.repeat(m.stars)}${m.comment ? ` “${esc(m.comment.slice(0, 60))}”` : ''}</span>` : ''}
        ${m.status_at ? `<span class="sub">${m.status_by_name ? esc(m.status_by_name) : 'Set by the app'} · ${esc(fmtStamp(m.status_at))}</span>` : ''}` },
      { label: 'Last contact', cell: m => (m.last_contact ? `${esc(m.last_contact.how)}<span class="sub">${esc(fmtStamp(m.last_contact.at))} · ${esc(m.last_contact.by)}</span>` : '—') },
      { label: 'Actions', cls: 'cell-actions', cell: m => (edit ? `${waLink(m.phone) ? `<button class="btn small" type="button" data-wa="${m.id}">WhatsApp</button>` : ''}${canEdit('calls') && m.phone ? `<button class="btn small" type="button" data-call="${m.id}">Log a call</button>` : ''}` : '') },
    ], rows, { empty: 'No customers match', emptyHint: 'Clear the search or the status.' });
  };
  wireFilters(page.querySelector('#fl-filters'), draw);
  draw();
  page.querySelector('#fl-assign')?.addEventListener('click', () => assignForm(d, reload));
  page.querySelector('#fl-wa')?.addEventListener('click', () => whatsappDrawer(rows, { listId: d.id, after: reload }));
  page.querySelector('#fl-close')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await api('POST', `/api/followups/${id}/${d.closed_at ? 'reopen' : 'close'}`); toast(d.closed_at ? 'List reopened' : 'List closed'); reload(); } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  const box = page.querySelector('#fl-list');
  box.addEventListener('change', async e => {
    const s = e.target.closest('select[data-st]'); if (!s) return;
    s.disabled = true;
    try { await api('PATCH', `/api/followups/${id}/members/${s.dataset.st}`, { status: s.value }); toast('Status saved'); reload(); } catch (err) { toast(err.message, 'error'); s.disabled = false; }
  });
  box.addEventListener('click', e => {
    const w = e.target.closest('[data-wa]'); const c = e.target.closest('[data-call]');
    const m = d.members.find(x => String(x.id) === (w || c)?.dataset[w ? 'wa' : 'call']);
    if (!m) return;
    if (w) whatsappDrawer([m], { listId: d.id, after: reload });
    else callForm({ phone: m.phone, name: m.name, after: reload });
  });
}
