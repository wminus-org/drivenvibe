-- Hosted-relay waitlist: only the email and when it was added (see the form text on drivenvibe.com).
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
