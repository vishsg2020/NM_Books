-- Onsite visits (BA section 4.4): a visit is recorded whether or not books were sold, and schools and
-- bookstores are saved locations that can be picked again on the next visit.

-- A school or bookstore may have no phone number on record, so the number is no longer compulsory.
-- (The unique index on phone_norm still stops two records sharing a number.)
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE customers ALTER COLUMN phone_norm DROP NOT NULL;
ALTER TABLE customers ADD COLUMN contact_person TEXT;
CREATE INDEX ix_customers_location_name ON customers (type, lower(name));

CREATE SEQUENCE visit_number_seq;
CREATE TABLE visits (
  id              SERIAL PRIMARY KEY,
  visit_no        TEXT NOT NULL UNIQUE,                        -- V-000001
  visit_date      TEXT NOT NULL,                               -- YYYY-MM-DD (IST)
  salesperson_id  INTEGER NOT NULL REFERENCES users(id),
  customer_id     INTEGER REFERENCES customers(id),            -- the saved school or bookstore; null for an exhibition
  location_type   TEXT NOT NULL CHECK (location_type IN ('School','Bookstore','Exhibition')),
  location_name   TEXT NOT NULL,
  address         TEXT,
  contact_person  TEXT,
  contact_phone   TEXT,
  outcome         TEXT NOT NULL CHECK (outcome IN ('Sale','Order taken','No sale','Payment collected')),
  remarks         TEXT,
  next_visit_date TEXT,
  next_visit_done_by INTEGER REFERENCES visits(id),            -- the later visit that this one was waiting for
  sale_id         INTEGER REFERENCES sales(id),                -- the sale or order made on this visit
  request_key     TEXT UNIQUE,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX ix_visits_person_date ON visits(salesperson_id, visit_date);
CREATE INDEX ix_visits_customer ON visits(customer_id, id);
CREATE INDEX ix_visits_date ON visits(visit_date);
CREATE INDEX ix_visits_next ON visits(next_visit_date) WHERE next_visit_date IS NOT NULL AND next_visit_done_by IS NULL;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
