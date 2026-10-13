-- Settings, Ask for a change (temporary). The log stays after the feature is removed.
CREATE TABLE change_requests (
  id INTEGER PRIMARY KEY,
  asked_by TEXT NOT NULL,
  request TEXT NOT NULL,
  issue INTEGER,
  branch TEXT,
  status TEXT NOT NULL DEFAULT 'asked',
  summary TEXT,
  version TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
