-- Daily dispatch counts brought in from the old "Daily Dispatch - Report" Google Form.
-- History only: these rows never change stock. Dispatches made in the app are read from the orders themselves.
CREATE TABLE dispatch_history (
  id      SERIAL PRIMARY KEY,
  day     TEXT NOT NULL,                              -- YYYY-MM-DD
  book_id INTEGER NOT NULL REFERENCES books(id),
  label   TEXT NOT NULL DEFAULT '',                   -- the name as written in the form, for items filed under "Other titles"
  qty     INTEGER NOT NULL CHECK (qty > 0),
  UNIQUE (day, book_id, label)
);
CREATE INDEX ix_dispatch_history_day ON dispatch_history(day);
ALTER TABLE dispatch_history ENABLE ROW LEVEL SECURITY;
