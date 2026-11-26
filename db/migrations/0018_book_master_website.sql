-- Book Master in line with the website admin (27 Nov 2026): website SKUs and names, Malayalam titles, authors and
-- product links. The Kuttivayana Series 1 + 3 set is not on the website and keeps its own SKU.
ALTER TABLE books ADD COLUMN name_ml TEXT;      -- Malayalam title
ALTER TABLE books ADD COLUMN author TEXT;
ALTER TABLE books ADD COLUMN website_url TEXT;  -- the product page on nallamalayalam.in
ALTER TABLE books ADD COLUMN amazon_url TEXT;

UPDATE books b SET sku = v.new_sku, name = v.name, name_ml = v.ml, author = v.author,
    website_url = CASE WHEN v.slug IS NULL THEN b.website_url ELSE 'https://www.nallamalayalam.in/books/' || v.slug END, updated_at = now_iso()
FROM (VALUES
  ('NM-P1', 'NMP1OCT2026', 'Nalla Malayalam - Part 1', 'നല്ലമലയാളം ഭാഗം ഒന്ന് – മാമ്പഴം', 'Ajay Venu Peringassery', 'nalla-malayalam-part-1'),
  ('NM-P2', 'NMP2OCT2026', 'Nalla Malayalam - Part 2', 'നല്ലമലയാളം ഭാഗം രണ്ട് - കൊളുന്ത്', NULL, 'nalla-malayalam-part-2'),
  ('KVS1-1', 'KVS1MAMOCT2026', 'Mambazhakkallan', 'മാമ്പഴക്കള്ളൻ', 'Muthumani', 'mambazhakkallan'),
  ('KVS1-2', 'KVS1CHANGOCT2026', 'Changattham', 'ചങ്ങാത്തം', 'Ajay Venu Peringassery', 'changattham'),
  ('KVS1-3', 'KVS1MIMAOCT2026', 'Mittuvum Makkalum', 'മിട്ടുവും മക്കളും', NULL, 'mittuvum-makkalum'),
  ('KVS1-4', 'KVS1AKSHOCT2026', 'Aksharappattukal', 'അക്ഷരപ്പാട്ടുകൾ', 'Ajay Venu Peringassery', 'aksharappattukal'),
  ('KVS2-1', 'KVS2DOLOCT2026', 'Dolphinte Aagraham', 'ഡോൾഫിന്റെ ആഗ്രഹം', 'Ajay Venu Peringassery', 'dolphinte-aagraham'),
  ('KVS2-2', 'KVS2PPOCT2026', 'Pachakkarippattukal', 'പച്ചക്കറിപ്പാട്ടുകൾ', 'Jeeshma Krishnan', 'pachakkarippattukal'),
  ('KVS2-3', 'KVS2KKOCT2026', 'Koottinte Kathakal', 'കൂട്ടിന്റെ കഥകൾ', 'Ajay Venu Peringassery', 'koottinte-kathakal'),
  ('KVS2-4', 'KVS2KNKOCT2026', 'Kunjunakshathrathinte Katha', 'കുഞ്ഞുനക്ഷത്രത്തിന്റെ കഥ', 'Jeeshma Krishnan', 'kunjunakshathrathinte-katha'),
  ('KVS3-1', 'KVS3APMNOV2026', 'Appooppan Maram', 'അപ്പൂപ്പൻ മരം', NULL, 'appooppan-maram'),
  ('KVS3-2', 'KVS3KJKLNOV2026', 'Kunjananayum Kunjikiliyum', 'കുഞ്ഞനാനയും കുഞ്ഞിക്കിളിയും', NULL, 'kunjananayum-kunjikiliyum'),
  ('KVS3-3', 'KVS3MZSNOV2026', 'Mazhayude Santhosham', 'മഴയുടെ സന്തോഷം', 'Muthumani', 'mazhayude-santhosham'),
  ('KVS3-4', 'KVS3SPKNOV2026', 'Spider Kuttappan', 'സ്പൈഡർ കുട്ടപ്പൻ', 'Ajay Venu Peringassery', 'spider-kuttappan'),
  ('NM-COMBO', 'NMCOMBOOCT2026', 'Nalla Malayalam - Bundle', 'നല്ലമലയാളം മാമ്പഴം & കൊളുന്ത്', 'Ajay Venu Peringassery', 'nalla-malayalam-bundle'),
  ('KVS1', 'KVS1BUNDLEOCT2026', 'Nalla Malayalam Kuttivayana Series 1', 'നല്ല മലയാളം കുട്ടിവായന സീരീസ് 1', NULL, 'nalla-malayalam-kuttivayana-series-1'),
  ('KVS2', 'KVS2BUNDLEOCT2026', 'Nalla Malayalam Kuttivayana Series 2', 'നല്ല മലയാളം കുട്ടിവായന സീരീസ് 2', NULL, 'nalla-malayalam-kuttivayana-series-2'),
  ('KVS3', 'KVS3BUNDLENOV2026', 'Nalla Malayalam Kuttivayana Series 3', 'നല്ല മലയാളം കുട്ടിവായന സീരീസ് 3', NULL, 'nalla-malayalam-kuttivayana-series-3'),
  ('KVS-COMBO', 'KVS12BUNDLEOCT2026', 'Nalla Malayalam Kuttivayana Series 1 & 2', 'കുട്ടിവായന സീരീസ് 1 & 2', NULL, 'nalla-malayalam-kuttivayana-series-bundle-1'),
  ('KVS-23', 'KVS23BUNDLENOV2026', 'Nalla Malayalam Kuttivayana Series 2 & 3', 'കുട്ടിവായന സീരീസ് 2 & 3', NULL, NULL),
  ('KVS-BUNDLE2', 'KVS123BUNDLENOV2026', 'Nalla Malayalam Kuttivayana Series 1, 2 & 3', 'കുട്ടിവായന സീരീസ് 1, 2 & 3', NULL, 'nalla-malayalam-kuttivayana-series-bundle-2'),
  ('KVS-13', 'KVS-13', 'Nalla Malayalam Kuttivayana Series 1 & 3', 'കുട്ടിവായന സീരീസ് 1 & 3', NULL, NULL)
) AS v(old_sku, new_sku, name, ml, author, slug)
WHERE upper(b.sku) = v.old_sku;

-- Two bundles kept in the app that the old data never had: Series 2 & 3 and Series 1 & 3.
-- Added only when all twelve books are there (a new, empty database gets them from scripts/catalogue.js).
INSERT INTO books (sku, name, category, kind, mrp, price, discount_group, name_ml)
SELECT v.sku, v.name, 'Kuttivayana', 'Pack', v.mrp, v.mrp, 'KVS2', v.ml
FROM (VALUES
  ('KVS23BUNDLENOV2026', 'Nalla Malayalam Kuttivayana Series 2 & 3', 760, 'കുട്ടിവായന സീരീസ് 2 & 3'),
  ('KVS-13', 'Nalla Malayalam Kuttivayana Series 1 & 3', 770, 'കുട്ടിവായന സീരീസ് 1 & 3')
) AS v(sku, name, mrp, ml)
WHERE NOT EXISTS (SELECT 1 FROM books x WHERE upper(x.sku) = v.sku)
  AND (SELECT count(*) FROM books WHERE sku IN ('KVS1MAMOCT2026', 'KVS1CHANGOCT2026', 'KVS1MIMAOCT2026', 'KVS1AKSHOCT2026',
       'KVS2DOLOCT2026', 'KVS2PPOCT2026', 'KVS2KKOCT2026', 'KVS2KNKOCT2026',
       'KVS3APMNOV2026', 'KVS3KJKLNOV2026', 'KVS3MZSNOV2026', 'KVS3SPKNOV2026')) = 12;
INSERT INTO pack_items (pack_id, book_id, qty)
SELECT p.id, b.id, 1
FROM (VALUES
  ('KVS23BUNDLENOV2026', 'KVS2DOLOCT2026'), ('KVS23BUNDLENOV2026', 'KVS2PPOCT2026'), ('KVS23BUNDLENOV2026', 'KVS2KKOCT2026'), ('KVS23BUNDLENOV2026', 'KVS2KNKOCT2026'),
  ('KVS23BUNDLENOV2026', 'KVS3APMNOV2026'), ('KVS23BUNDLENOV2026', 'KVS3KJKLNOV2026'), ('KVS23BUNDLENOV2026', 'KVS3MZSNOV2026'), ('KVS23BUNDLENOV2026', 'KVS3SPKNOV2026'),
  ('KVS-13', 'KVS1MAMOCT2026'), ('KVS-13', 'KVS1CHANGOCT2026'), ('KVS-13', 'KVS1MIMAOCT2026'), ('KVS-13', 'KVS1AKSHOCT2026'),
  ('KVS-13', 'KVS3APMNOV2026'), ('KVS-13', 'KVS3KJKLNOV2026'), ('KVS-13', 'KVS3MZSNOV2026'), ('KVS-13', 'KVS3SPKNOV2026')
) AS v(pack, book)
JOIN books p ON p.sku = v.pack
JOIN books b ON b.sku = v.book
WHERE NOT EXISTS (SELECT 1 FROM pack_items i WHERE i.pack_id = p.id);

-- Settings and follow-up lists that name books by SKU.
UPDATE settings SET value = replace(replace(replace(replace(replace(replace(replace(value,
    '"NM-P1"', '"NMP1OCT2026"'), '"NM-P2"', '"NMP2OCT2026"'), '"NM-COMBO"', '"NMCOMBOOCT2026"'), '"KVS-COMBO"', '"KVS12BUNDLEOCT2026"'),
    '"KVS1"', '"KVS1BUNDLEOCT2026"'), '"KVS2"', '"KVS2BUNDLEOCT2026"'), '"KVS3"', '"KVS3BUNDLENOV2026"')
  WHERE key = 'next_book';
UPDATE follow_up_lists SET filters_json = replace(replace(replace(replace(replace(filters_json,
    '"NM-P1>NM-P2"', '"NMP1OCT2026>NMP2OCT2026"'), '"NM-COMBO>KVS1"', '"NMCOMBOOCT2026>KVS1BUNDLEOCT2026"'),
    '"KVS1>KVS2"', '"KVS1BUNDLEOCT2026>KVS2BUNDLEOCT2026"'), '"KVS2>KVS3"', '"KVS2BUNDLEOCT2026>KVS3BUNDLENOV2026"'),
    '"KVS-COMBO>KVS3"', '"KVS12BUNDLEOCT2026>KVS3BUNDLENOV2026"')
  WHERE filters_json LIKE '%ready_for%';

-- Offers and coupons the tele team can tell customers about (the website applies the code itself).
CREATE TABLE coupons (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  offer       TEXT NOT NULL,                       -- what it gives: "10% off your next order"
  conditions  TEXT,                                -- who and when: "after a website review"
  works_on    TEXT NOT NULL DEFAULT 'Website',     -- Website, WhatsApp / phone, Amazon, Everywhere
  valid_from  TEXT,                                -- YYYY-MM-DD; empty: from now
  valid_to    TEXT,                                -- YYYY-MM-DD; empty: no end date
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT now_iso(),
  updated_at  TEXT NOT NULL DEFAULT now_iso(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX ux_coupons_code ON coupons (upper(code));
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
