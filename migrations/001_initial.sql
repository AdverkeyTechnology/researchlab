



CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  added_at BIGINT NOT NULL,
  PRIMARY KEY (project_id, email)
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  format TEXT NOT NULL,          -- pdf | image | html | markdown | text | file
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_name TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'project',  -- project | restricted
  source TEXT NOT NULL DEFAULT 'upload',   -- upload | paste | api
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_access (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  PRIMARY KEY (report_id, email)
);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_at BIGINT NOT NULL,
  last_used BIGINT
);

CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_uploads (id TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, pathname TEXT UNIQUE NOT NULL, email TEXT NOT NULL, filename TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS report_project_idx ON reports(project_id);
CREATE INDEX IF NOT EXISTS comments_report_idx ON comments(report_id);
CREATE INDEX IF NOT EXISTS member_email_idx ON project_members(email);
