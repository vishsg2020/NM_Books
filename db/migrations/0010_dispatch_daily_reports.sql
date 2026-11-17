-- Daily dispatch reports can now be entered in the app as well as imported from the old Google Form.
-- 'form' rows come from the import and are replaced by it; 'manual' rows are typed in the app and are never touched by the import.
ALTER TABLE dispatch_history ADD COLUMN source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','manual'));
ALTER TABLE dispatch_history ADD COLUMN user_id INTEGER REFERENCES users(id);
