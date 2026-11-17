-- Tele-sales call management (BA section 5): one record per call, follow-ups, and leads.

-- A person who has been called but has not bought yet is a Lead. The first purchase turns the same
-- record into a Customer, so the call history stays with them.
ALTER TABLE customers ADD COLUMN kind TEXT NOT NULL DEFAULT 'Customer' CHECK (kind IN ('Lead','Customer'));
CREATE INDEX ix_customers_kind ON customers(kind);

CREATE SEQUENCE call_number_seq;
CREATE TABLE calls (
  id             SERIAL PRIMARY KEY,
  call_no        TEXT NOT NULL UNIQUE,                         -- CL-000001
  called_at      TEXT NOT NULL,                                -- YYYY-MM-DDTHH:MM (IST)
  call_date      TEXT NOT NULL,                                -- YYYY-MM-DD (IST), for reports
  salesperson_id INTEGER NOT NULL REFERENCES users(id),
  customer_id    INTEGER NOT NULL REFERENCES customers(id),    -- the customer or lead who was called
  status         TEXT NOT NULL CHECK (status IN ('Answered','Not Answered','Busy','Switched Off','Wrong Number')),
  outcome        TEXT CHECK (outcome IN ('Interested','Not Interested','Follow-up','Sale')),
  remarks        TEXT,
  followup_at    TEXT,                                         -- YYYY-MM-DDTHH:MM, or just the date + T00:00 when no time was given
  followup_date  TEXT,                                         -- YYYY-MM-DD
  followup_done_by INTEGER REFERENCES calls(id),               -- the later call that completed this follow-up
  sale_id        INTEGER REFERENCES sales(id),                 -- the sale this call led to
  request_key    TEXT UNIQUE,
  created_at     TEXT NOT NULL DEFAULT now_iso(),
  updated_at     TEXT NOT NULL DEFAULT now_iso(),
  CHECK (outcome IS NULL OR status = 'Answered'),               -- an outcome needs a conversation
  CHECK ((followup_at IS NULL) = (followup_date IS NULL))
);
CREATE INDEX ix_calls_person_date ON calls(salesperson_id, call_date);
CREATE INDEX ix_calls_customer ON calls(customer_id, id);
CREATE INDEX ix_calls_followup ON calls(followup_date) WHERE followup_date IS NOT NULL AND followup_done_by IS NULL;
CREATE INDEX ix_calls_date ON calls(call_date);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
