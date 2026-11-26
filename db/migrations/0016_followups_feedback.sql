-- Follow-up lists, WhatsApp messages sent to customers, and customer feedback.

-- A follow-up list: customers picked with the Customers filters and saved under a name, for the tele-sales team to
-- work through. The members are fixed when the list is made; each has a status the team updates.
CREATE TABLE follow_up_lists (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  note         TEXT,
  filters_json TEXT,                                            -- the Customers filters the list was made from
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT now_iso(),
  closed_at    TEXT,
  closed_by    INTEGER REFERENCES users(id)
);
CREATE TABLE follow_up_members (
  list_id     INTEGER NOT NULL REFERENCES follow_up_lists(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status      TEXT NOT NULL DEFAULT 'Not contacted yet' CHECK (status IN ('Not contacted yet', 'Contacted', 'No answer',
                'Feedback requested', 'Feedback received', 'Review requested', 'Review posted', 'Ordered again', 'Not interested')),
  status_at   TEXT,
  status_by   INTEGER REFERENCES users(id),                     -- null: set by the app (an order, a feedback answer)
  sale_id     INTEGER REFERENCES sales(id),                     -- for "Ordered again": the first order after the list was made
  PRIMARY KEY (list_id, customer_id)
);
CREATE INDEX ix_follow_up_members_customer ON follow_up_members(customer_id);

-- Each WhatsApp message opened for a customer (the person presses Send in WhatsApp, so this is "opened", not "delivered").
CREATE TABLE customer_messages (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  kind        TEXT NOT NULL CHECK (kind IN ('feedback', 'review', 'coupon', 'new_product', 'academy', 'share', 'custom')),
  list_id     INTEGER REFERENCES follow_up_lists(id) ON DELETE SET NULL,
  book_id     INTEGER REFERENCES books(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX ix_customer_messages_customer ON customer_messages(customer_id, id);

-- Feedback: a personal link (random token) sent to one customer; the answer is given on a public page with no sign-in.
CREATE TABLE feedback (
  id           SERIAL PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  requested_by INTEGER REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT now_iso(),
  stars        INTEGER CHECK (stars BETWEEN 1 AND 5),
  liked_json   TEXT,                                            -- ["Pictures", "Easy to read"]
  reasons_json TEXT,                                            -- ["For my child to learn Malayalam"]
  comment      TEXT,
  submitted_at TEXT,
  updated_at   TEXT
);
CREATE INDEX ix_feedback_customer ON feedback(customer_id, id);
CREATE INDEX ix_feedback_submitted ON feedback(submitted_at) WHERE submitted_at IS NOT NULL;

ALTER TABLE follow_up_lists   ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback          ENABLE ROW LEVEL SECURITY;
