'use strict';
// Roles & access (Settings → Roles & access). The Admin sets, per role and area, — / View / Edit.
// The server checks this grid on every request (perm); the menu and buttons only follow it.
//
// Whose records a person sees stays fixed by role ("own only"): Tele-sales, Online and Onsite their own channel's sales
// and figures, Dispatch the orders not yet completed. Admin and Report Viewer see all records, like the Manager.
// Two things are never in the grid: Corrections (change a saved sale or payment, remove a call or visit, merge
// customers) and Users, roles & Settings. Both are Admin only.
const { HttpError, bad } = require('./util');
const { read, write } = require('./settings');

const ROLES = ['admin', 'manager', 'telesales', 'online', 'onsite', 'dispatch', 'viewer'];
const ROLE_NAMES = { admin: 'Admin', manager: 'Manager', telesales: 'Tele-sales', online: 'Online', onsite: 'Onsite', dispatch: 'Dispatch', viewer: 'Report Viewer' };
/** Roles that see every record (no "own only" limit). */
const WIDE = ['admin', 'manager', 'viewer'];
const LEVELS = ['none', 'view', 'edit'];

// Areas, in the order shown. own: roles limited to their own records there.
const AREAS = [
  { key: 'dashboard', name: 'Dashboard', note: 'figures for each role', own: ['telesales', 'online', 'onsite'] },
  { key: 'sales', name: 'Sales & payments', note: 'record a sale, payments, cancel', own: ['telesales', 'online', 'onsite', 'dispatch'] },
  { key: 'dispatch', name: 'Dispatch', note: 'order status (packing → delivered), daily dispatch report' },
  { key: 'delivery', name: 'Delivery check', note: 'call customers after dispatch: did the books arrive, are they happy' },
  { key: 'customers', name: 'Customers', note: 'list, edit, Update needed' },
  { key: 'webimport', name: 'Website orders', note: 'monthly website file upload' },
  { key: 'calls', name: 'Calls', note: 'calls, follow-ups, tele-sales report' },
  { key: 'visits', name: 'Visits', note: 'schools and bookstores' },
  { key: 'books', name: 'Book Master', note: 'books, sets, prices, discount groups' },
  { key: 'stock', name: 'Stock', note: 'stock movements, opening stock' },
  { key: 'profit', name: 'Costs & profit', note: 'costs per book, profit (hidden from the menu now)' },
  { key: 'reports', name: 'Reports', note: 'dashboard trends, tele-sales report, dispatch report — to read' },
  { key: 'insights', name: 'Insights', note: 'where, when and how customers buy; best time to call' },
  { key: 'prices', name: 'Prices & links', note: 'prices on every platform, offers and coupons, links to share' },
];
// Today's access (before roles could be changed), plus the Report Viewer; Insights (27 Nov 2026) for Manager, Tele-sales
// and Report Viewer; Delivery check (27 Nov 2026) for Manager and Dispatch, Report Viewer to read. Admin always has everything.
const DEFAULTS = {
  manager: { dashboard: 'view', sales: 'edit', dispatch: 'edit', delivery: 'edit', customers: 'edit', webimport: 'edit', calls: 'edit', visits: 'edit', books: 'view', stock: 'view', profit: 'view', reports: 'view', insights: 'view', prices: 'view' },
  telesales: { dashboard: 'view', sales: 'edit', customers: 'edit', calls: 'edit', books: 'view', insights: 'view', prices: 'view' },
  online: { dashboard: 'view', sales: 'edit', customers: 'edit', webimport: 'edit', books: 'view', prices: 'view' },
  onsite: { dashboard: 'view', sales: 'edit', customers: 'edit', visits: 'edit', books: 'view', prices: 'view' },
  dispatch: { dashboard: 'view', sales: 'view', dispatch: 'edit', delivery: 'edit', books: 'view' },
  viewer: { dashboard: 'view', reports: 'view', insights: 'view', prices: 'view', delivery: 'view' },
};
const EDITABLE = ['manager', 'telesales', 'online', 'onsite', 'dispatch', 'viewer'];

// "Whose records" (27 Nov 2026): for Tele-sales, Sales and Customers can be Own only or the Whole channel.
//   Own sales: orders where they are the sales person or that they entered.
//   Own customers: people they sold to, called, or put in a follow-up list they made.
// Saved in settings key 'role_scopes'. Other roles keep the fixed rules above.
const SCOPES = ['own', 'all'];
const SCOPED = [{ role: 'telesales', area: 'sales' }, { role: 'telesales', area: 'customers' }];
const SCOPE_DEFAULTS = { telesales: { sales: 'own', customers: 'own' } };
function normalizeScopes(s) {
  const out = {};
  for (const { role, area } of SCOPED) {
    const v = s && s[role] && s[role][area];
    (out[role] = out[role] || {})[area] = SCOPES.includes(v) ? v : SCOPE_DEFAULTS[role][area];
  }
  return out;
}

function normalize(grid) {
  const out = {};
  for (const r of EDITABLE) {
    out[r] = {};
    for (const a of AREAS) {
      const v = grid && grid[r] && grid[r][a.key];
      out[r][a.key] = LEVELS.includes(v) ? v : (DEFAULTS[r][a.key] || 'none');
    }
  }
  return out;
}
const defaults = () => normalize(null);
const isWide = role => WIDE.includes(role);

function createAccess(db) {
  // Kept for a few seconds per server instance; a save clears it here, other instances pick it up within seconds.
  let cache = null; let at = 0;
  async function grid() {
    if (cache && Date.now() - at < 5000) return cache;
    cache = normalize(await read(db, 'role_access')); at = Date.now();
    return cache;
  }
  let scache = null; let sat = 0;
  async function scopes() {
    if (scache && Date.now() - sat < 5000) return scache;
    scache = normalizeScopes(await read(db, 'role_scopes')); sat = Date.now();
    return scache;
  }
  async function saved() { return !!(await db.get(`SELECT 1 FROM settings WHERE key IN ('role_access', 'role_scopes')`)); }
  async function save(t, next, nextScopes) {
    await write(t, 'role_access', next); cache = null;
    if (nextScopes) { await write(t, 'role_scopes', nextScopes); scache = null; }
  }
  /** Is this person limited to their own records in this area (sales, customers)? */
  async function isOwn(user, area) {
    if (!user || !SCOPED.some(x => x.role === user.role && x.area === area)) return false;
    return (await scopes())[user.role][area] === 'own';
  }
  /** For the browser: the areas where this person sees only their own records. */
  async function ownFor(role) {
    const s = await scopes();
    return Object.fromEntries(SCOPED.filter(x => x.role === role).map(x => [x.area, s[role][x.area] === 'own']));
  }
  async function permsFor(role) {
    if (role === 'admin') return Object.fromEntries(AREAS.map(a => [a.key, 'edit']));
    const g = await grid();
    return { ...(g[role] || Object.fromEntries(AREAS.map(a => [a.key, 'none']))) };
  }
  /**
   * perm('customers'): GET needs View, anything else Edit. perm(['calls', 'reports']): any of them is enough.
   * { level: 'edit' } forces Edit; { wide: true } also needs a role that sees all records (Admin, Manager, Report Viewer).
   */
  const perm = (areas, { level, wide = false } = {}) => async (req, _res, next) => {
    try {
      if (!req.user) throw new HttpError(401, 'Please sign in');
      const need = level || (req.method === 'GET' || req.method === 'HEAD' ? 'view' : 'edit');
      const p = await permsFor(req.user.role);
      const list = [].concat(areas);
      const ok = list.some(a => LEVELS.indexOf(p[a] || 'none') >= LEVELS.indexOf(need));
      if (!ok) {
        if (need === 'edit' && list.some(a => p[a] === 'view')) throw new HttpError(403, 'You have view-only access here');
        throw new HttpError(403, 'You do not have access to this');
      }
      if (wide && !isWide(req.user.role)) throw new HttpError(403, 'You do not have permission for this action');
      next();
    } catch (e) { next(e); }
  };
  /** Admin only: Corrections, and Users, roles & Settings. */
  const requireAdmin = (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (req.user.role !== 'admin') return next(new HttpError(403, 'Only the Admin can do this'));
    next();
  };
  /** A role that sees all records (Admin, Manager, Report Viewer). */
  const requireWide = (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (!isWide(req.user.role)) return next(new HttpError(403, 'You do not have permission for this action'));
    next();
  };
  /** Checks a grid sent from Settings → Roles & access. Areas left out keep their default. */
  function parseGrid(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Send the access grid');
    for (const r of Object.keys(body)) {
      if (r === 'admin') throw bad('The Admin always has full access');
      if (!EDITABLE.includes(r)) throw bad(`Unknown role: ${r}`);
      for (const [a, v] of Object.entries(body[r] || {})) {
        if (!AREAS.some(x => x.key === a)) throw bad(`Unknown area: ${a}. Users, roles and Settings are for the Admin only.`);
        if (!LEVELS.includes(v)) throw bad(`${ROLE_NAMES[r]} · ${AREAS.find(x => x.key === a).name}: choose —, View or Edit`);
      }
    }
    return normalize(body);
  }
  function parseScopes(body) {
    if (body === undefined || body === null) return null;
    if (typeof body !== 'object' || Array.isArray(body)) throw bad('Send the own-only choices');
    for (const r of Object.keys(body)) for (const [a, v] of Object.entries(body[r] || {})) {
      if (!SCOPED.some(x => x.role === r && x.area === a)) throw bad(`Own only cannot be set for ${ROLE_NAMES[r] || r} · ${a}`);
      if (!SCOPES.includes(v)) throw bad('Choose Own only or Whole channel');
    }
    return normalizeScopes(body);
  }
  return { grid, scopes, saved, save, permsFor, perm, requireAdmin, requireWide, parseGrid, parseScopes, isOwn, ownFor };
}

module.exports = { ROLES, ROLE_NAMES, WIDE, LEVELS, AREAS, DEFAULTS, EDITABLE, SCOPED, SCOPE_DEFAULTS, normalize, normalizeScopes, defaults, isWide, createAccess };
