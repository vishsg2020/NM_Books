-- Where a customer record came from when it was not made by a sale (for example the WhatsApp sales group), and a short note.
ALTER TABLE customers ADD COLUMN source TEXT;
ALTER TABLE customers ADD COLUMN notes TEXT;
CREATE INDEX ix_customers_source ON customers(source) WHERE source IS NOT NULL;
