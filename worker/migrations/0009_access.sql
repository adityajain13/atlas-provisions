-- Addresses the app lets in, added and removed by admins under Household > App access. ALLOWED_EMAILS in the
-- Worker settings still works as a fallback. Nothing is seeded, so existing access is unchanged.
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  note TEXT
);
