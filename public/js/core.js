// Shared helpers: API calls, escaping, formatting, drawers, toasts, forms.
// lists: the dropdown choices the Admin maintains under Settings (payment methods, call statuses, …).
export const state = { me: null, books: [], people: [], lists: {}, locked: {}, listNames: {}, charges: {} };

export class ApiError extends Error {
  constructor(status, data) { super((data && data.error) || `Request failed (${status})`); this.status = status; this.data = data || {}; }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nm-app' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the server. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && url !== '/api/login') { window.dispatchEvent(new Event('nm:signed-out')); }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const get = url => api('GET', url);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, c => ESC[c]));
/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...vals) {
  return strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = vals[i - 1];
    const str = v && v.__raw !== undefined ? v.__raw : Array.isArray(v) ? v.map(x => (x && x.__raw !== undefined ? x.__raw : esc(x))).join('') : esc(v);
    return out + str + s;
  }, '');
}
export const raw = s => ({ __raw: s ?? '' });

export const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS = DAYS;
export function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${wd} ${day} ${MONTHS[m - 1]} ${y}`;
}
export function fmtTime(t) {
  if (!t) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
export const fmtDT = dt => (dt ? `${fmtDate(dt)}, ${fmtTime(dt.slice(11, 16))}` : '');
export const fmtMonth = m => { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}`; };
export function fmtStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function todayLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

const PILL = {
  Confirmed: 'blue', Packing: 'amber', 'Ready to Dispatch': 'amber', Dispatched: 'blue', Delivered: 'green', Completed: 'green', Cancelled: '',
  Paid: 'green', 'Partially Paid': 'amber', Unpaid: 'red', COD: 'blue', Overdue: 'red',
  Active: 'green', Inactive: '', 'Low stock': 'amber', 'Out of stock': 'red', 'In stock': 'green',
  'Tele-sales': '', Online: '', Onsite: '',
};
export const pill = (text, cls) => raw(`<span class="pill ${cls ?? PILL[text] ?? ''}">${esc(text)}</span>`);
export const ROLES = [['telesales', 'Tele-sales Team'], ['online', 'Online Sales Team'], ['onsite', 'Onsite Sales Team'], ['dispatch', 'Dispatch Team'], ['viewer', 'Report Viewer'], ['manager', 'Manager'], ['admin', 'Admin']];
export const roleName = r => (ROLES.find(x => x[0] === r) || [r, r])[1];
/** The one channel a channel role sells in (undefined for Admin and Manager, who can use all three). */
export const myChannel = () => ({ telesales: 'Tele-sales', online: 'Online', onsite: 'Onsite' }[state.me?.role]);

// ---------- Toasts ----------
export function toast(msg, kind = '') {
  const zone = document.querySelector('.toast-zone');
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.setAttribute('role', 'status'); t.textContent = msg;
  zone.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

// ---------- Drawer ----------
let openDrawer = null;
// Changes whenever a drawer opens or closes, or the page changes. Code that opens a drawer after
// waiting for the server checks it, so a late answer never pops a drawer over what the user moved on to.
let drawerGen = 0;
export const drawerGeneration = () => drawerGen;
/**
 * Opens a side drawer. `body` is HTML; `onMount(el, close)` wires behaviour.
 * Returns a close function.
 */
export function drawer({ title, body, foot = '', onMount, onClose, wide = false }) {
  closeDrawer();
  drawerGen++;
  const back = document.createElement('div'); back.className = 'drawer-backdrop';
  const d = document.createElement('section');
  d.className = 'drawer' + (wide ? ' wide' : ''); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.setAttribute('aria-labelledby', 'drawer-title');
  d.innerHTML = `<div class="drawer-head"><h2 id="drawer-title">${esc(title)}</h2><button class="close-x" type="button" aria-label="Close">×</button></div>
    <div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ''}`;
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); d.remove(); document.removeEventListener('keydown', onKey); openDrawer = null; drawerGen++; prevFocus && prevFocus.focus && prevFocus.focus(); onClose && onClose(); };
  const onKey = e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // keep focus inside
      const f = [...d.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  back.addEventListener('click', close);
  d.querySelector('.close-x').addEventListener('click', close);
  d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.append(back, d);
  openDrawer = close;
  onMount && onMount(d, close);
  const first = d.querySelector('input:not([type=hidden]), select, textarea');
  (first || d.querySelector('.close-x')).focus();
  return close;
}
export function closeDrawer() { drawerGen++; if (openDrawer) openDrawer(); }

/** Simple confirm dialog built on the drawer. Resolves true/false. */
export function confirmBox({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let decided = false;
    drawer({
      title,
      body: `<p>${message}</p>`,
      foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" id="cb-ok">${esc(confirmLabel)}</button>`,
      onMount: (d, close) => {
        d.querySelector('#cb-ok').addEventListener('click', () => { decided = true; close(); resolve(true); });
        const obs = new MutationObserver(() => { if (!d.isConnected) { obs.disconnect(); if (!decided) resolve(false); } });
        obs.observe(document.body, { childList: true });
      },
    });
  });
}

// ---------- Forms ----------
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}
export function showFormError(form, err) {
  let box = form.querySelector('.form-error');
  if (!box) { box = document.createElement('div'); box.className = 'notice error form-error'; box.setAttribute('role', 'alert'); form.prepend(box); }
  box.textContent = err.message || String(err);
  form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  const field = err.data && err.data.field;
  if (field) {
    const lbl = [...form.querySelectorAll('label')].find(l => l.textContent.replace('*', '').trim().toLowerCase() === field.toLowerCase());
    if (lbl) { lbl.closest('.field')?.classList.add('invalid'); }
  }
  box.scrollIntoView({ block: 'nearest' });
}
export function clearFormError(form) { form.querySelector('.form-error')?.remove(); form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid')); }

/** Guards a submit handler against double submission; disables submit buttons while running. */
export function onSubmit(form, handler) {
  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const btns = [...document.querySelectorAll(`button[form="${form.id}"], #${form.id} button[type=submit]`)];
    btns.forEach(b => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Saving…'; });
    try { clearFormError(form); await handler(formData(form), e); }
    catch (err) { if (form.isConnected) showFormError(form, err); else toast(err.message || String(err), 'error'); }
    finally { busy = false; btns.forEach(b => { if (b.isConnected) { b.disabled = false; b.textContent = b.dataset.label; } }); }
  });
}

export const opt = (value, label, selected) => `<option value="${esc(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
export const options = (list, selected, blank) => (blank !== undefined ? opt('', blank, selected) : '') + list.map(x => (Array.isArray(x) ? opt(x[0], x[1], selected) : opt(x, x, selected))).join('');

export function stateBox(kind, title, text = '') {
  return `<div class="state ${kind === 'error' ? 'error' : ''}" role="${kind === 'error' ? 'alert' : 'status'}">${kind === 'loading' ? '<span class="loading">Loading</span>' : `<strong>${esc(title)}</strong>${esc(text)}`}</div>`;
}

/** Renders a table; columns: [{ label, cell(row) => html, cls }] */
export function table(cols, rows, { empty = 'Nothing here yet.', emptyHint = '', rowAttr } = {}) {
  if (!rows.length) return `<div class="table-wrap">${stateBox('empty', empty, emptyHint)}</div>`;
  return `<div class="table-wrap"><table class="responsive"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}" scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr ${rowAttr ? rowAttr(r) : ''}>${cols.map(c => `<td class="${c.cls || ''}" data-label="${esc(c.label)}"><div>${c.cell(r)}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------- Routing helpers ----------
export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function go(path) { if (location.hash !== '#' + path) location.hash = path; else window.dispatchEvent(new HashChangeEvent('hashchange')); }
export function setQuery(q) {
  const { path } = parseHash();
  const clean = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined && v !== null));
  const qs = new URLSearchParams(clean).toString();
  history.replaceState(null, '', '#' + path + (qs ? '?' + qs : ''));
}
export const qs = obj => { const s = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString(); return s ? '?' + s : ''; };
export const can = (...roles) => state.me && roles.includes(state.me.role);
// ---------- Roles & access ----------
// state.me.perms comes from the server: { area: 'none' | 'view' | 'edit' }. The server checks the same on every request;
// these only decide what the menu and buttons show.
const LV = { none: 0, view: 1, edit: 2 };
const level = a => [].concat(a).reduce((m, x) => Math.max(m, LV[(state.me?.perms || {})[x]] || 0), 0);
export const canView = a => level(a) >= 1;
export const canEdit = a => level(a) >= 2;
export const isAdmin = () => state.me?.role === 'admin';
/** Admin, Manager and Report Viewer see every record; the other roles only their own. */
export const wide = () => ['admin', 'manager', 'viewer'].includes(state.me?.role);

export async function loadLookups() {
  state.books = await get('/api/books');
  const st = await get('/api/settings/lists'); state.lists = st.lists; state.locked = st.locked; state.listNames = st.names; state.charges = st.charges || {}; state.discounts = st.discounts || {}; state.discountGroups = st.discount_groups || []; state.discountChannels = st.discount_channels || []; state.themes = st.themes || []; state.messages = st.messages || { templates: {} }; state.messageKinds = st.message_kinds || []; state.messageFields = st.message_fields || []; applyTheme(st.theme);
  state.people = wide() ? await get('/api/users/salespeople') : [];
}
/** Debounces a handler (search boxes). */
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
/** Reads the filter form into the URL, then calls reload. Used by every list page. */
export function wireFilters(form, reload) {
  const run = () => { setQuery(formData(form)); reload(); };
  form.addEventListener('change', run);
  form.addEventListener('input', debounce(e => { if (e.target.type === 'search') run(); }, 300));
  form.addEventListener('submit', e => e.preventDefault());
  form.querySelector('[data-clear]')?.addEventListener('click', () => { form.reset(); form.querySelectorAll('input:not([type=hidden]), select').forEach(el => { el.value = ''; }); run(); });
}

// ---------- Clipboard ----------
export async function copyText(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the clipboard API.
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    if (!ok) { toast('Could not copy. Select the link and copy it manually.', 'error'); return; }
  }
  toast(done);
}

// ---------- WhatsApp (one customer at a time) ----------
/** A wa.me link that opens WhatsApp with the message typed in. Indian numbers get the 91 country code. */
export function waLink(phone, text) {
  let d = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = '91' + d;
  if (d.length < 11) return null;
  return `https://wa.me/${d}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

// ---------- Corrections ----------
/** Asks for the reason for a correction or removal, runs `run(reason)`, and on success closes and calls `then()`. Shows the server's message if it is refused. */
export function reasonBox({ title, message = '', confirmLabel = 'Confirm', danger = false, run, then, back }) {
  drawer({
    title,
    body: `<form id="rb-form" novalidate>${message ? `<p>${message}</p>` : ''}<div class="field"><label for="rb-reason">Reason *</label><textarea id="rb-reason" name="reason" maxlength="300" required></textarea>
      <div class="hint">Kept in the history with your name and the time.</div></div></form>`,
    foot: `<button class="btn" type="button" id="rb-back">Back</button><button class="btn ${danger ? 'danger' : 'primary'}" type="submit" form="rb-form">${esc(confirmLabel)}</button>`,
    onMount: (d, close) => {
      d.querySelector('#rb-back').addEventListener('click', () => { close(); back && back(); });
      onSubmit(d.querySelector('#rb-form'), async v => { if (!v.reason.trim()) throw new Error('Give the reason'); await run(v.reason.trim()); close(); then && then(); }); // `then` runs after this box has closed, so it may open another
    },
  });
}

// States and union territories, for a customer's address. Kerala's districts are offered as a list.
export const STATES = ['Kerala', 'Tamil Nadu', 'Karnataka', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry', 'Outside India'];
export const KERALA_DISTRICTS = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod'];
/** The District field for a State: a list for Kerala, a text box for anywhere else. */
export function districtField(stateName, value = '', id = 's-loc') {
  const v = value || '';
  if (stateName === 'Kerala') return `<label for="${id}">District</label><select id="${id}" name="location">${options([...KERALA_DISTRICTS, ...(v && !KERALA_DISTRICTS.includes(v) ? [v] : [])], v, 'Select district')}</select>`;
  return `<label for="${id}">District</label><input id="${id}" name="location" maxlength="100" placeholder="District or city" value="${esc(v)}">`;
}

// ---------- Colour theme (Settings → Theme, chosen by the Admin) ----------
// Each theme is a [data-theme] block in styles.css. The choice is kept in this browser too, so the next page load
// starts in the right colours before the server answers.
const THEME_COLOURS = { green: '#6ABD45', blue: '#4A9BE0', teal: '#2FB3A4', maroon: '#C25A6C', purple: '#9B78D6', orange: '#EE9A3E', charcoal: '#4A555E' };
export function applyTheme(name) {
  const t = THEME_COLOURS[name] ? name : 'green';
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOURS[t]);
  try { localStorage.setItem('nm-theme', t); } catch { /* not kept */ }
}
export function startTheme() {
  try { const t = localStorage.getItem('nm-theme'); if (t) applyTheme(t); } catch { /* none kept */ }
  fetch('/api/theme', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(r => { if (r && r.name) applyTheme(r.name); }).catch(() => {});
}
