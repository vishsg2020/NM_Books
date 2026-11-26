// Settings → Roles & access (Admin only): what each role can see (View) and change (Edit), per area.
// The server checks the same grid on every request; the menu and buttons only follow it.
// Wide screens show the whole grid; a phone shows one role at a time.
import { api, get, esc, html, raw, toast, fmtStamp } from '../core.js';

const LV = [['none', '—'], ['view', 'View'], ['edit', 'Edit']];
const sel = (id, label, v, data) => `<label class="sr-only" for="${id}">${esc(label)}</label><select id="${id}" class="lv-${v}" ${data}>${LV.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

export async function render(page) {
  const d = await get('/api/access');
  const g = JSON.parse(JSON.stringify(d.grid)); // what is on screen
  const roles = d.roles.filter(r => r.editable);
  const own = (r, a) => ((a.own || []).includes(r.key) ? '<span class="own">own only</span>' : '');
  const fixed = n => `<tr class="fixed"><th scope="row"><b>${n[0]}</b><span class="sub">${n[1]}</span></th><td><span class="locked">Edit</span></td><td colspan="${roles.length}" class="muted small">${n[2]}</td></tr>`;
  page.innerHTML = html`<section class="panel"><form id="ac-form" novalidate>
      <p class="small muted">— hidden · <b>View</b> see, no changes · <b>Edit</b> see and change. “Own only” is fixed by role: Tele-sales, Online and Onsite see their own channel's sales and figures; Dispatch sees orders not yet completed.
        ${d.customised ? `Last changed ${esc(fmtStamp(d.updated_at))}.` : 'This is the default access.'}</p>
      <div class="ac-desk access-wrap"><table class="access-grid"><thead><tr><th scope="col">Area</th><th scope="col">Admin</th>${raw(roles.map(r => `<th scope="col">${esc(r.name)}</th>`).join(''))}</tr></thead>
      <tbody>${raw(d.areas.map(a => `<tr><th scope="row"><b>${esc(a.name)}</b><span class="sub">${esc(a.note)}</span></th><td><span class="locked">Edit</span></td>${roles.map(r =>
        `<td>${sel(`ac-${r.key}-${a.key}`, `${r.name}: ${a.name}`, g[r.key][a.key], `data-role="${r.key}" data-area="${a.key}"`)}${own(r, a)}</td>`).join('')}</tr>`).join('')
        + fixed(['Corrections', 'change a saved sale or payment, remove a call or visit, merge customers', 'Admin only.'])
        + fixed(['Users, roles &amp; Settings', 'logins, this page, discounts, charges, theme, lists', 'Admin only. This cannot be given to other roles.']))}</tbody></table></div>
      <div class="ac-phone"><div class="field"><label for="ac-role">Role</label><select id="ac-role">${raw(roles.map(r => `<option value="${r.key}">${esc(r.name)}</option>`).join(''))}</select></div><div id="ac-list"></div>
        <p class="muted small">Corrections, and Users, roles &amp; Settings: Admin only.</p></div>
      <div class="field top-gap"><label for="ac-reason">Reason for the change</label><input id="ac-reason" name="reason" maxlength="300" placeholder="e.g. Accounts needs to see the dispatch report"></div>
      <div class="btn-row ac-buttons"><button class="btn" type="button" id="ac-reset">Reset to defaults</button><button class="btn primary" type="submit">Save access</button></div>
    </form></section>`;
  const form = page.querySelector('#ac-form');
  const phoneList = () => {
    const r = roles.find(x => x.key === form.querySelector('#ac-role').value);
    form.querySelector('#ac-list').innerHTML = d.areas.map(a => `<div class="ac-row"><div><b>${esc(a.name)}</b>${own(r, a)}</div>${sel(`acp-${a.key}`, `${r.name}: ${a.name}`, g[r.key][a.key], `data-role="${r.key}" data-area="${a.key}"`)}</div>`).join('');
  };
  const paint = () => { form.querySelectorAll('.ac-desk select[data-role]').forEach(s => { s.value = g[s.dataset.role][s.dataset.area]; s.className = 'lv-' + s.value; }); phoneList(); };
  phoneList();
  form.querySelector('#ac-role').addEventListener('change', phoneList);
  form.addEventListener('change', e => {
    const s = e.target; if (!s.matches('select[data-role]')) return;
    g[s.dataset.role][s.dataset.area] = s.value; paint();
  });
  page.querySelector('#ac-reset').addEventListener('click', () => {
    for (const r of roles) Object.assign(g[r.key], d.defaults[r.key]);
    paint(); toast('Defaults filled in. Save access to apply them.');
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await api('PUT', '/api/access', { grid: g, reason: form.reason.value });
      toast('Access saved'); window.dispatchEvent(new Event('nm:access'));
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
}
