-- A customer can carry a second contact number (kept when two records of the same person are merged).
ALTER TABLE customers ADD COLUMN phone2 TEXT;
ALTER TABLE customers ADD COLUMN phone2_norm TEXT;
CREATE UNIQUE INDEX ux_customers_phone2 ON customers (phone2_norm) WHERE phone2_norm IS NOT NULL;
-- Set when someone has confirmed that a name the app flags (Malayalam script, unusual words) is correct.
ALTER TABLE customers ADD COLUMN name_ok INTEGER NOT NULL DEFAULT 0 CHECK (name_ok IN (0,1));

-- Where each customer came from: Order sheet, Sales (entered in the app), WhatsApp group, Website, Calls or Visits.
-- Existing records: from the first order they have; without an order, from the kind of record.
UPDATE customers c SET source = CASE
    WHEN f.ref LIKE 'WA-%' THEN 'WhatsApp group'
    WHEN f.ref LIKE 'WEB-%' THEN 'Website'
    WHEN f.ref IS NOT NULL THEN 'Order sheet'
    WHEN f.channel = 'Onsite' THEN 'Visits'
    ELSE 'Sales' END
  FROM (SELECT DISTINCT ON (customer_id) customer_id, import_ref AS ref, channel FROM sales
        WHERE customer_id IS NOT NULL ORDER BY customer_id, sale_date, id) f
  WHERE c.source IS NULL AND f.customer_id = c.id;
UPDATE customers SET source = 'Calls' WHERE source IS NULL AND kind = 'Lead';
UPDATE customers SET source = CASE WHEN type IN ('School','Bookstore') THEN 'Visits' ELSE 'Sales' END WHERE source IS NULL;
