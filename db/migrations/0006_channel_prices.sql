-- Price by channel: a book or set can have its own price for Website orders and for Amazon orders.
-- Where none is set, the normal selling price (the tele-sales / WhatsApp price) applies.
CREATE TABLE book_prices (
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  channel_key TEXT NOT NULL CHECK (channel_key IN ('Website','Amazon')),
  price       INTEGER NOT NULL CHECK (price >= 0),
  PRIMARY KEY (book_id, channel_key)
);
ALTER TABLE book_prices ENABLE ROW LEVEL SECURITY;
