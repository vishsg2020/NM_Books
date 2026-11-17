-- Cost of each book or set, for the Costs & profit page. Amounts are rupees per copy sold (paise allowed);
-- royalty and commission are a percentage of the price the copy is sold at.
CREATE TABLE book_costs (
  book_id        INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  printing       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (printing >= 0),
  packing        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (packing >= 0),
  postal         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (postal >= 0),
  misc           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (misc >= 0),
  ad_cost        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (ad_cost >= 0),
  amazon_fee     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amazon_fee >= 0),
  royalty_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (royalty_pct BETWEEN 0 AND 100),
  commission_pct NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
  updated_at     TEXT NOT NULL DEFAULT now_iso()
);
ALTER TABLE book_costs ENABLE ROW LEVEL SECURITY;
