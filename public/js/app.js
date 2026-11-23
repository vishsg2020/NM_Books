import { state, api, get, esc, html, raw, roleName, parseHash, loadLookups, toast, onSubmit, stateBox, closeDrawer, startTheme } from './core.js';
import * as dashboard from './pages/dashboard.js';
import * as sales from './pages/sales.js';
import * as customers from './pages/customers.js';
import * as calls from './pages/calls.js';
import * as visits from './pages/visits.js';
import * as profit from './pages/profit.js';
import * as settings from './pages/settings.js';
import * as dispatch from './pages/dispatch.js';
import * as webimport from './pages/webimport.js';
import * as books from './pages/books.js';
import * as inventory from './pages/inventory.js';
import * as users from './pages/users.js';

const app = document.getElementById('app');
const ALL = ['admin', 'manager', 'telesales', 'online', 'onsite', 'dispatch'];
const SELLERS = ['admin', 'manager', 'telesales', 'online', 'onsite'];

const NAV = [
  { group: null, items: [{ path: 'dashboard', label: 'Dashboard', roles: ALL }] },
  { group: 'Sales', items: [
    { path: 'sales', label: 'Sales', roles: SELLERS },
    { path: 'sales', label: 'Orders', roles: ['dispatch'] },
    { path: 'customers', label: 'Customers', roles: SELLERS },
    { path: 'dispatch', label: 'Dispatch report', roles: ['admin', 'manager', 'dispatch'] },
    { path: 'webimport', label: 'Website orders', roles: ['admin', 'manager', 'online'] },
  ] },
  { group: 'Tele-sales', items: [
    { path: 'calls', label: 'Calls', roles: ['admin', 'manager', 'telesales'] },
    { path: 'callreport', label: 'Tele-sales report', roles: ['admin', 'manager', 'telesales'] },
  ] },
  { group: 'Onsite', items: [
    { path: 'visits', label: 'Visits', roles: ['admin', 'manager', 'onsite'] },
  ] },
  { group: 'Books', items: [
    { path: 'books', label: 'Book Master', roles: ALL },
    { path: 'inventory', label: 'Stock movements', roles: ['admin', 'manager'] },
    // Costs & profit is hidden for now; the page still works at #/profit.
  ] },
  { group: 'Manage', items: [
    { path: 'users', label: 'Users', roles: ['admin'] },
    { path: 'settings', label: 'Settings', roles: ['admin'] },
  ] },
];

const ROUTES = {
  dashboard: dashboard.render,
  sales: sales.renderList,
  customers: customers.renderList,
  customer: customers.renderProfile,
  calls: calls.renderList,
  visits: visits.renderList,
  profit: profit.render,
  settings: settings.render,
  dispatch: dispatch.render,
  webimport: webimport.render,
  callreport: calls.renderReport,
  books: books.render,
  inventory: inventory.render,
  users: users.render,
  account: users.renderAccount,
};

function renderLogin(message) {
  document.title = 'Sign in · Nalla Malayalam';
  app.innerHTML = html`<div class="login-wrap">
    <div class="login-art">
      <img class="login-logo" src="img/logo-white.png" alt="" width="640" height="784">
      <h1 class="sr-only">Nalla Malayalam</h1>
      <p>Books, stock, sales and customers, in one place.</p>
    </div>
    <main class="login-form">
      <form id="login" novalidate>
        <h2>Sign in</h2>
        <p class="muted">Use the account your Admin created for you.</p>
        ${raw(message ? `<div class="notice info">${esc(message)}</div>` : '')}
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary" type="submit">Sign in</button>
      </form>
    </main></div>`;
  const form = document.getElementById('login');
  onSubmit(form, async d => {
    if (!d.email || !d.password) throw new Error('Enter your email and password');
    const r = await api('POST', '/api/login', d);
    state.me = r.user;
    await boot();
  });
}

function renderShell() {
  const me = state.me;
  document.title = 'Nalla Malayalam · Book sales';
  const nav = NAV.map(g => {
    const items = g.items.filter(i => i.roles.includes(me.role));
    if (!items.length) return '';
    return (g.group ? `<li class="nav-group" aria-hidden="true">${esc(g.group)}</li>` : '') +
      items.map(i => `<li><a href="#/${i.path}" data-nav="${i.path}">${esc(i.label)}</a></li>`).join('');
  }).join('');
  app.innerHTML = `
    <div class="topbar"><button type="button" id="menu-btn" aria-expanded="false" aria-controls="side">Menu</button>
      <span class="brand-mark logo-mask" aria-hidden="true"></span><strong>Nalla Malayalam</strong></div>
    <div class="shell">
      <nav class="side" id="side" aria-label="Main">
        <a class="brand" href="#/dashboard" aria-label="Nalla Malayalam, go to dashboard">
          <span class="brand-logo logo-mask" aria-hidden="true"></span>
          <span class="brand-sub">Book sales &amp; inventory</span></a>
        <ul class="nav">${nav}</ul>
        <div class="side-foot">
          <div class="who">${esc(me.name)}</div><div class="role">${esc(roleName(me.role))}</div>
          <a href="#/account">Change password</a> · <button class="linkbtn" type="button" id="logout">Sign out</button>
        </div>
      </nav>
      <main class="main" id="page" tabindex="-1"></main>
    </div>`;
  document.getElementById('logout').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    state.me = null; renderLogin('You have signed out.');
  });
  const side = document.getElementById('side'); const mb = document.getElementById('menu-btn');
  mb.addEventListener('click', () => { const o = side.classList.toggle('open'); mb.setAttribute('aria-expanded', o); });
  side.addEventListener('click', e => { if (e.target.closest('a')) { side.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); } });
}

let renderSeq = 0;
async function route() {
  if (!state.me) return;
  closeDrawer();
  const { parts, query } = parseHash();
  const name = parts[0] || 'dashboard';
  const page = document.getElementById('page');
  document.querySelectorAll('[data-nav]').forEach(a => a.toggleAttribute('aria-current', false));
  const navName = { customer: 'customers' }[name] || name;
  document.querySelector(`[data-nav="${navName}"]`)?.setAttribute('aria-current', 'page');
  const fn = ROUTES[name];
  const seq = ++renderSeq;
  if (!fn) { page.innerHTML = stateBox('error', 'Page not found', 'Use the menu to find what you need.'); return; }
  page.innerHTML = stateBox('loading');
  // Render into a detached container and swap it in only if this is still the latest navigation,
  // so a slow page can never overwrite the page the user moved on to.
  const view = document.createElement('div');
  try {
    await fn(view, { id: parts[1], query, isCurrent: () => seq === renderSeq });
    if (seq !== renderSeq) return;
    page.replaceChildren(view);
    page.focus({ preventScroll: true });
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err.status === 403) page.innerHTML = stateBox('error', 'You do not have access to this page', 'Ask the Admin if you need it.');
    else if (err.status === 404) page.innerHTML = stateBox('error', 'Not found', err.message);
    else page.innerHTML = stateBox('error', 'Could not load this page', err.message);
  }
}

async function boot() {
  try {
    const r = await get('/api/me');
    state.me = r.user;
  } catch { state.me = null; }
  if (!state.me) return renderLogin();
  await loadLookups();
  renderShell();
  if (!location.hash || location.hash === '#/') history.replaceState(null, '', '#/dashboard');
  await route();
}

startTheme();
window.addEventListener('hashchange', route);
window.addEventListener('nm:signed-out', () => { if (state.me) { state.me = null; renderLogin('Your session has ended. Please sign in again.'); } });
window.addEventListener('nm:changed', () => { loadLookups().catch(() => {}); });
window.addEventListener('unhandledrejection', e => { toast(e.reason?.message || 'Something went wrong', 'error'); });
boot();
