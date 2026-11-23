-- Tele-sales: the customer's State and District; a COD charge and a delivery charge on an order.
ALTER TABLE customers ADD COLUMN state TEXT;                       -- `location` holds the district
ALTER TABLE sales ADD COLUMN delivery_charge INTEGER NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0);
ALTER TABLE sales ADD COLUMN cod_charge INTEGER NOT NULL DEFAULT 0 CHECK (cod_charge >= 0);
-- total_amount = the books + delivery_charge + cod_charge.

-- Customers whose location is already a Kerala district get the State filled in.
UPDATE customers SET state = 'Kerala' WHERE state IS NULL AND location IN
  ('Thiruvananthapuram','Kollam','Pathanamthitta','Alappuzha','Kottayam','Idukki','Ernakulam','Thrissur','Palakkad','Malappuram','Kozhikode','Wayanad','Kannur','Kasaragod');
