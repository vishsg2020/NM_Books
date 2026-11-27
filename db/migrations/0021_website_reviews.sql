-- Website reviews (28 Nov 2026): reviews customers agreed to show on nallamalayalam.in, kept apart from the feedback
-- answers. The Admin or a Manager approves each one before it goes in the download for the website.

-- Feedback: the two questions about the child (styles C and F ask them), which page style and language the customer
-- used, and their answer to "may we show this on the website?". website_answer is changed only by the customer.
ALTER TABLE feedback ADD COLUMN changes_json TEXT;            -- ["Reads on their own", ...]
ALTER TABLE feedback ADD COLUMN child_age TEXT CHECK (child_age IN ('3-5', '6-8', '9-12', '12+'));
ALTER TABLE feedback ADD COLUMN style TEXT CHECK (style IN ('A', 'C', 'E', 'F'));
ALTER TABLE feedback ADD COLUMN lang TEXT CHECK (lang IN ('ml', 'en'));
ALTER TABLE feedback ADD COLUMN website_answer TEXT CHECK (website_answer IN ('yes', 'no'));
ALTER TABLE feedback ADD COLUMN website_answer_at TEXT;
ALTER TABLE feedback ADD COLUMN review_clicked_at TEXT;       -- tapped "write a review on the website"

CREATE TABLE website_reviews (
  id             SERIAL PRIMARY KEY,
  feedback_id    INTEGER UNIQUE REFERENCES feedback(id) ON DELETE SET NULL,  -- null: added by the team
  customer_id    INTEGER REFERENCES customers(id),                           -- null: someone not in the app
  name_shown     TEXT NOT NULL,                                              -- "Anitha"
  place_shown    TEXT,                                                       -- "Thrissur"
  child_age      TEXT CHECK (child_age IN ('3-5', '6-8', '9-12', '12+')),
  stars          INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text           TEXT NOT NULL,                                              -- as shown (the team may fix spelling)
  original_text  TEXT NOT NULL,                                              -- the customer's own words
  language       TEXT NOT NULL CHECK (language IN ('ml', 'en', 'mixed')),
  book_id        INTEGER REFERENCES books(id),
  source         TEXT NOT NULL CHECK (source IN ('feedback', 'whatsapp', 'call', 'google', 'instagram', 'other')),
  consent_at     TEXT NOT NULL,                                              -- when the customer agreed
  consent_by     INTEGER REFERENCES users(id),                               -- who noted it (null: the customer, on their link)
  consent_note   TEXT,                                                       -- how they agreed, for reviews added by the team
  status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'approved', 'hidden', 'withdrawn')),
  reviewed_by    INTEGER REFERENCES users(id),
  reviewed_at    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT now_iso(),
  updated_at     TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX ix_website_reviews_status ON website_reviews(status, id);
CREATE INDEX ix_website_reviews_customer ON website_reviews(customer_id);
ALTER TABLE website_reviews ENABLE ROW LEVEL SECURITY;
