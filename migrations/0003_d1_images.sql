-- Preserve existing R2 metadata until each owner migrates their images.
ALTER TABLE images ADD COLUMN data BLOB;
ALTER TABLE images ADD COLUMN storage TEXT NOT NULL DEFAULT 'r2' CHECK(storage IN ('r2','d1'));
DROP TRIGGER image_object_cleanup;
CREATE TRIGGER image_object_cleanup AFTER DELETE ON images WHEN OLD.storage='r2'
BEGIN INSERT OR IGNORE INTO object_gc(object_key) VALUES(OLD.object_key); END;
