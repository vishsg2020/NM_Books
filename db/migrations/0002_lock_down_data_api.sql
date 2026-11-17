-- Supabase automatically exposes tables in the public schema through its REST/GraphQL Data API.
-- This app never uses that API: it connects to Postgres directly as the table owner.
-- Enabling row-level security with no policies makes every table unreadable and unwritable through
-- the Data API, while the app's own connection (the table owner) is unaffected.
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_failures    ENABLE ROW LEVEL SECURITY;
ALTER TABLE books             ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
