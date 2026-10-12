-- One overall report per review: what the whole Hui does well and where it struggles.
-- No names. The director edits it and can share it with everyone in the review.
CREATE TABLE team_reports (
  cycle_id INTEGER PRIMARY KEY REFERENCES cycles(id) ON DELETE CASCADE,
  draft TEXT,
  edited TEXT,
  shared_at TEXT
);
