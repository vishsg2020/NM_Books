-- Roles & access: a Report Viewer role joins the others. What each role may see (View) and change (Edit) per area is set
-- by the Admin (Settings → Roles & access) and kept in settings 'role_access'; until then the defaults in src/access.js
-- apply, which are the access each role had before. This app already has an Admin, so no role is changed here.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'telesales', 'online', 'onsite', 'dispatch', 'viewer'));
