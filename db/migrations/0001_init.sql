-- Nalla Malayalam book inventory & sales: initial schema (PostgreSQL / Supabase).
-- Applied in name order by src/migrate.js. Never edit an applied migration; add a new numbered file instead.
-- Phase 1: users and access control, Book Master, inventory, sales entry, payments, customers.

-- UTC timestamp as ISO-8601 text, the format the app uses everywhere.
CREATE FUNCTION now_iso() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

CREATE SEQUENCE sale_number_seq;
CREATE SEQUENCE customer_number_seq;

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','telesales','online','onsite','dispatch')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT now_iso()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

-- Failed sign-in attempts (shared across serverless instances).
CREATE TABLE login_failures (
  key        TEXT PRIMARY KEY,
  first_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  count      INTEGER NOT NULL DEFAULT 1
);

-- ── Book Master ────────────────────────────────────────────────────────────
-- on_hand  = physical copies in the store room.
-- reserved = copies promised to confirmed orders that have not been dispatched yet.
-- Available to sell = on_hand - reserved. Both figures only ever change together with a
-- stock_movements row, inside one transaction (see src/stock.js).
CREATE TABLE books (
  id          SERIAL PRIMARY KEY,
  sku         TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT,
  price       INTEGER NOT NULL CHECK (price >= 0),            -- selling price in whole rupees
  description TEXT,
  min_stock   INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  on_hand     INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved    INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT now_iso(),
  updated_at  TEXT NOT NULL DEFAULT now_iso(),
  CHECK (reserved <= on_hand)
);
CREATE UNIQUE INDEX ux_books_sku ON books (lower(sku));
CREATE UNIQUE INDEX ux_books_name ON books (lower(name));

-- ── Customers ──────────────────────────────────────────────────────────────
-- Created automatically from sales entries. The contact number identifies an existing customer.
CREATE TABLE customers (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,                              -- C-00001
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  phone_norm TEXT NOT NULL,                                     -- digits only, used for matching
  address    TEXT,
  location   TEXT,
  type       TEXT NOT NULL DEFAULT 'Individual' CHECK (type IN ('Individual','School','Bookstore','Other')),
  created_at TEXT NOT NULL DEFAULT now_iso(),
  updated_at TEXT NOT NULL DEFAULT now_iso()
);
CREATE UNIQUE INDEX ux_customers_phone ON customers (phone_norm);
CREATE INDEX ix_customers_name ON customers (lower(name));

-- ── Sales ──────────────────────────────────────────────────────────────────
CREATE TABLE sales (
  id               SERIAL PRIMARY KEY,
  sale_no          TEXT NOT NULL UNIQUE,                        -- S-000001
  sale_date        TEXT NOT NULL,                               -- YYYY-MM-DD (IST)
  channel          TEXT NOT NULL CHECK (channel IN ('Tele-sales','Online','Onsite')),
  salesperson_id   INTEGER NOT NULL REFERENCES users(id),
  customer_id      INTEGER REFERENCES customers(id),            -- null only when no contact number is available
  customer_name    TEXT NOT NULL,                               -- as entered on this sale
  customer_phone   TEXT,
  address          TEXT,
  -- Online
  platform         TEXT CHECK (platform IN ('Website','Amazon')),
  platform_order_id TEXT,
  -- Onsite
  location_type    TEXT CHECK (location_type IN ('School','Bookstore','Exhibition')),
  location_name    TEXT,
  contact_person   TEXT,
  next_visit_date  TEXT,
  -- Fulfilment. Orders: Confirmed → Packing → Ready to Dispatch → Dispatched → Delivered.
  -- An onsite sale handed over on the spot is Completed straight away.
  status           TEXT NOT NULL CHECK (status IN ('Confirmed','Packing','Ready to Dispatch','Dispatched','Delivered','Completed','Cancelled')),
  -- Money (whole rupees). amount_received is the sum of this sale's payments.
  total_amount     INTEGER NOT NULL CHECK (total_amount >= 0),
  amount_received  INTEGER NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  payment_method   TEXT CHECK (payment_method IN ('UPI','Bank Transfer','COD','Cash','Card','Other')),
  payment_status   TEXT NOT NULL CHECK (payment_status IN ('Paid','Partially Paid','Unpaid','COD')),
  due_date         TEXT,
  remarks          TEXT,
  cancel_reason    TEXT,
  request_key      TEXT UNIQUE,                                 -- one-time key from the form: a double click saves once
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT now_iso(),
  updated_at       TEXT NOT NULL DEFAULT now_iso(),
  CHECK (amount_received <= total_amount)
);
CREATE INDEX ix_sales_date ON sales(sale_date);
CREATE INDEX ix_sales_customer ON sales(customer_id);
CREATE INDEX ix_sales_salesperson ON sales(salesperson_id, sale_date);
CREATE INDEX ix_sales_channel ON sales(channel, sale_date);
CREATE INDEX ix_sales_status ON sales(status);
-- The same marketplace order cannot be entered twice.
CREATE UNIQUE INDEX ux_sales_platform_order ON sales (platform, lower(platform_order_id))
  WHERE platform_order_id IS NOT NULL AND status <> 'Cancelled';

CREATE TABLE sale_items (
  id         SERIAL PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total INTEGER NOT NULL CHECK (line_total = qty * unit_price),
  UNIQUE (sale_id, book_id)
);
CREATE INDEX ix_sale_items_book ON sale_items(book_id);

-- Every payment is recorded against its order; an order can have several.
CREATE TABLE payments (
  id         SERIAL PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  method     TEXT NOT NULL CHECK (method IN ('UPI','Bank Transfer','COD','Cash','Card','Other')),
  paid_on    TEXT NOT NULL,
  note       TEXT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX ix_payments_sale ON payments(sale_id);
CREATE INDEX ix_payments_date ON payments(paid_on);

-- ── Stock movement history ─────────────────────────────────────────────────
-- One row per change. on_hand_delta / reserved_delta are what the movement did to the book's figures;
-- on_hand_after / reserved_after are the figures straight after it.
CREATE TABLE stock_movements (
  id             SERIAL PRIMARY KEY,
  at             TEXT NOT NULL DEFAULT now_iso(),
  book_id        INTEGER NOT NULL REFERENCES books(id),
  type           TEXT NOT NULL CHECK (type IN ('Opening stock','Stock received','Stock issued','Stock reserved','Reservation released',
                                               'Stock dispatched','Onsite sale','Stock returned','Damaged stock','Stock adjustment')),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  on_hand_delta  INTEGER NOT NULL,
  reserved_delta INTEGER NOT NULL,
  on_hand_after  INTEGER NOT NULL,
  reserved_after INTEGER NOT NULL,
  sale_id        INTEGER REFERENCES sales(id),
  note           TEXT,
  user_id        INTEGER REFERENCES users(id)
);
CREATE INDEX ix_stock_book ON stock_movements(book_id, id);
CREATE INDEX ix_stock_sale ON stock_movements(sale_id);
CREATE INDEX ix_stock_at ON stock_movements(at);

CREATE TABLE audit_events (
  id          SERIAL PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT now_iso(),
  user_id     INTEGER REFERENCES users(id),
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT
);
CREATE INDEX ix_audit_entity ON audit_events(entity, entity_id);
