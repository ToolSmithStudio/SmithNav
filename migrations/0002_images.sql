CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(id,user_id)
);
CREATE INDEX images_owner ON images(user_id,created_at);
ALTER TABLE links ADD COLUMN image_id TEXT REFERENCES images(id) ON DELETE RESTRICT;
-- 同时在数据库约束图片归属，防止并发修改绕过 API 检查。
CREATE TRIGGER link_image_insert BEFORE INSERT ON links
WHEN NEW.image_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM images WHERE id=NEW.image_id AND user_id=NEW.user_id AND ready=1)
BEGIN SELECT RAISE(ABORT,'IMAGE_OWNER'); END;
CREATE TRIGGER link_image_update BEFORE UPDATE OF image_id,user_id ON links
WHEN NEW.image_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM images WHERE id=NEW.image_id AND user_id=NEW.user_id AND ready=1)
BEGIN SELECT RAISE(ABORT,'IMAGE_OWNER'); END;
CREATE TRIGGER image_quota BEFORE INSERT ON images
WHEN (SELECT COUNT(*) FROM images WHERE user_id=NEW.user_id)>=200
BEGIN SELECT RAISE(ABORT,'IMAGE_QUOTA'); END;
-- 先删除用户的导航，再级联图片，避免 RESTRICT 外键阻止删除用户。
CREATE TRIGGER user_links_cleanup BEFORE DELETE ON users
BEGIN DELETE FROM links WHERE user_id=OLD.id; END;
-- R2 删除失败时，队列保留到下一次清理；数据库事务和对象删除无需假装原子。
CREATE TABLE object_gc (object_key TEXT PRIMARY KEY);
CREATE TRIGGER image_object_cleanup AFTER DELETE ON images
BEGIN INSERT OR IGNORE INTO object_gc(object_key) VALUES(OLD.object_key); END;
