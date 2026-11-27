-- Delivery check (27 Nov 2026): the dispatch team calls customers a few days after their parcel was sent
-- (India Post, DTDC; not Amazon or Flipkart) and notes whether the books arrived and how they liked them.
-- One row per call. Which orders are due is worked out from these rows and the day the order's stock was dispatched.
CREATE TABLE delivery_checks (
  id          SERIAL PRIMARY KEY,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  result      TEXT NOT NULL CHECK (result IN ('happy', 'not_happy', 'not_delivered', 'no_answer', 'wrong_number', 'returned')),
  note        TEXT,                                 -- what the customer said; needed for not_happy, not_delivered, returned
  checked_by  INTEGER NOT NULL REFERENCES users(id),
  checked_at  TEXT NOT NULL DEFAULT now_iso(),
  -- "Needs action" (not happy, not delivered, returned) is closed with what was done.
  sorted_at   TEXT,
  sorted_by   INTEGER REFERENCES users(id),
  sorted_note TEXT
);
CREATE INDEX ix_delivery_checks_sale ON delivery_checks(sale_id, id);
CREATE INDEX ix_delivery_checks_open ON delivery_checks(result) WHERE sorted_at IS NULL;
ALTER TABLE delivery_checks ENABLE ROW LEVEL SECURITY;
