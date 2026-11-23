-- Prices by channel now come from discount percentages (Settings → Discounts) applied to the MRP.
-- A set belongs to a discount group; a book or set without a group sells at MRP on every channel.
ALTER TABLE books ADD COLUMN discount_group TEXT;
UPDATE books SET discount_group = 'NM12' WHERE upper(sku) = 'NM-COMBO';
UPDATE books SET discount_group = 'KVS2' WHERE upper(sku) IN ('KVS-COMBO', 'KVS-23', 'KVS-13');
UPDATE books SET discount_group = 'KVS3' WHERE upper(sku) = 'KVS-BUNDLE2';
-- "All other sales are on MRP": the selling price of a set is its MRP; the discounts above make the channel prices.
UPDATE books SET price = mrp, updated_at = now_iso() WHERE mrp IS NOT NULL AND price <> mrp;
-- The fixed Website / Amazon prices are replaced by the discounts.
DELETE FROM book_prices;

-- Flipkart orders, at the Amazon rate.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_platform_check;
ALTER TABLE sales ADD CONSTRAINT sales_platform_check CHECK (platform IN ('Website', 'Amazon', 'Flipkart'));
