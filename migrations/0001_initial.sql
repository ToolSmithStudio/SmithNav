PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(id,user_id)
);
CREATE INDEX groups_owner ON groups(user_id,sort_order);
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(group_id,user_id) REFERENCES groups(id,user_id) ON DELETE CASCADE
);
CREATE INDEX links_owner ON links(user_id,group_id,sort_order);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(reset_at);
-- 数据库层保护最后一个可登录管理员，覆盖并发请求。
CREATE TRIGGER keep_last_admin_delete BEFORE DELETE ON users
WHEN OLD.role='admin' AND OLD.disabled=0 AND (SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0)=1
BEGIN SELECT RAISE(ABORT,'LAST_ADMIN'); END;
CREATE TRIGGER keep_last_admin_update BEFORE UPDATE OF role,disabled ON users
WHEN OLD.role='admin' AND OLD.disabled=0 AND (NEW.role!='admin' OR NEW.disabled=1)
AND (SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0)=1
BEGIN SELECT RAISE(ABORT,'LAST_ADMIN'); END;
