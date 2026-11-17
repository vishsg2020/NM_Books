-- Settings the Admin can change: the choices in dropdown lists, and which costs count for each sales channel.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,            -- JSON
  updated_at TEXT NOT NULL DEFAULT now_iso()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- The lists are now kept in settings and checked by the app, so the fixed lists in the database are removed.
ALTER TABLE payments  DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE sales     DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales     DROP CONSTRAINT IF EXISTS sales_location_type_check;
ALTER TABLE calls     DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE calls     DROP CONSTRAINT IF EXISTS calls_outcome_check;
ALTER TABLE visits    DROP CONSTRAINT IF EXISTS visits_location_type_check;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_type_check;
