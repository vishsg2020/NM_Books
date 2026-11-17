-- Sets and combos in the Book Master, and a reference for orders brought in from the old order sheet.

-- A 'Pack' (set or combo) has its own price and a list of the books inside it. It holds no stock of its
-- own: selling a pack moves the stock of each book inside. on_hand/reserved stay 0 on a pack row.
ALTER TABLE books ADD COLUMN kind TEXT NOT NULL DEFAULT 'Book' CHECK (kind IN ('Book','Pack'));
ALTER TABLE books ADD COLUMN mrp INTEGER CHECK (mrp IS NULL OR mrp >= 0);
ALTER TABLE books ADD CONSTRAINT pack_has_no_stock CHECK (kind = 'Book' OR (on_hand = 0 AND reserved = 0));

CREATE TABLE pack_items (
  pack_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id),
  qty     INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  PRIMARY KEY (pack_id, book_id),
  CHECK (pack_id <> book_id)
);
CREATE INDEX ix_pack_items_book ON pack_items(book_id);
ALTER TABLE pack_items ENABLE ROW LEVEL SECURITY;

-- Orders imported from the old sheet carry the sheet's Order ID here; it can be imported only once.
-- Imported orders are history: they never reserve or deduct stock.
ALTER TABLE sales ADD COLUMN import_ref TEXT;
CREATE UNIQUE INDEX ux_sales_import_ref ON sales (import_ref) WHERE import_ref IS NOT NULL;
ALTER TABLE customers ADD COLUMN pin TEXT;
