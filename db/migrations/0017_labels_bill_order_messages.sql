-- Packing labels, bills and order WhatsApp updates.
-- A gift pack is ticked on the sale; the courier and tracking number are added before printing the label or when the
-- order is marked Dispatched.
ALTER TABLE sales ADD COLUMN gift_pack INTEGER NOT NULL DEFAULT 0 CHECK (gift_pack IN (0, 1));
ALTER TABLE sales ADD COLUMN courier TEXT;
ALTER TABLE sales ADD COLUMN tracking_no TEXT;

-- Two more WhatsApp messages: the order confirmation and the dispatched message (with the order they are about).
ALTER TABLE customer_messages DROP CONSTRAINT IF EXISTS customer_messages_kind_check;
ALTER TABLE customer_messages ADD CONSTRAINT customer_messages_kind_check
  CHECK (kind IN ('feedback', 'review', 'coupon', 'new_product', 'academy', 'share', 'custom', 'order', 'dispatched'));
ALTER TABLE customer_messages ADD COLUMN sale_id INTEGER REFERENCES sales(id);
