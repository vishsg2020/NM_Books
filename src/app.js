'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAuth, requireAuth } = require('./auth');
const { HttpError } = require('./util');
const { createAccess } = require('./access');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  // Netlify (and most hosts) sit behind a proxy; trust it so req.ip is the visitor's address.
  if (process.env.TRUST_PROXY || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) app.set('trust proxy', process.env.TRUST_PROXY || true);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use('/api/imports', express.json({ limit: '6mb' })); // an uploaded order file
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const auth = createAuth(db);
  app.use(auth.loadUser);

  // CSRF defence: state-changing API calls must be JSON and carry a custom header,
  // which browsers will not send cross-site without a CORS preflight (none is allowed).
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.get('X-Requested-With') !== 'nm-app') return next(new HttpError(403, 'Missing request header'));
    }
    next();
  });

  const access = createAccess(db);
  const ctx = { db, auth, access, perm: access.perm, requireAdmin: access.requireAdmin, requireWide: access.requireWide };
  app.post('/api/login', async (req, res) => {
    const body = req.body || {};
    const user = await auth.login(req, res, body.email, body.password);
    res.json({ user });
  });
  app.post('/api/logout', async (req, res) => { await auth.logout(req, res); res.json({ ok: true }); });
  app.get('/api/health', async (_req, res) => { await db.get('SELECT 1 AS ok'); res.json({ ok: true }); });
  // The colour theme, before sign-in too (the sign-in page uses it). Not secret.
  app.get('/api/theme', async (_req, res) => { res.set('Cache-Control', 'no-cache'); res.json({ name: await require('./routes/settings').getTheme(db) }); });

  // The customer feedback page: public, no sign-in. Each link carries one customer's random token.
  require('./routes/followups').publicRoutes(app, db);
  app.get('/f/:token', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, '..', 'public', 'feedback.html')); });
  app.use('/api', requireAuth);
  app.use('/api', (req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
  require('./routes/users')(app, ctx);
  require('./routes/books')(app, ctx);
  require('./routes/inventory')(app, ctx);
  require('./routes/customers')(app, ctx);
  require('./routes/sales')(app, ctx);
  require('./routes/dashboard')(app, ctx);
  require('./routes/trends')(app, ctx);
  require('./routes/calls')(app, ctx);
  require('./routes/visits')(app, ctx);
  require('./routes/profit')(app, ctx);
  require('./routes/settings')(app, ctx);
  require('./routes/edits')(app, ctx);
  require('./routes/dispatch-report')(app, ctx);
  require('./routes/imports')(app, ctx);
  require('./routes/access')(app, ctx);
  require('./routes/insights')(app, ctx);
  require('./routes/pricelist')(app, ctx);
  require('./routes/delivery')(app, ctx);
  require('./routes/reviews')(app, ctx);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  // Code and pages are re-checked on every load, so an update shows up at once; fonts and images can be kept.
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', setHeaders: (res, file) => {
    res.set('Cache-Control', /\.(woff2|png|jpg|svg)$/.test(file) ? 'public, max-age=86400' : 'no-cache');
  } }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'A value has the wrong format' });
    if (err.code === '23505') return res.status(409).json({ error: 'This record already exists' });
    if (['23503', '23514', '23502'].includes(err.code)) return res.status(400).json({ error: 'The data violates a database rule: ' + err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });
  return app;
}

module.exports = { createApp };
