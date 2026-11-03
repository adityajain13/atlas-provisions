-- Email-code sign-in (same tables and columns as Atlas Journeys)
CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  link_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- 1-year rolling sessions (only a SHA-256 of the cookie token is stored)
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_email ON sessions(email);
