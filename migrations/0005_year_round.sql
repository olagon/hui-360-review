-- Phases 2 and 3: upward reviews, the board report, early signals, and year round features.
ALTER TABLE cycles ADD COLUMN upward INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_reports ADD COLUMN board_draft TEXT;
ALTER TABLE team_reports ADD COLUMN board_edited TEXT;
ALTER TABLE feedback_requests ADD COLUMN answered_at TEXT;
ALTER TABLE community_voices ADD COLUMN answered_at TEXT;

-- One label and tone per answer, from a short classification pass. Counts only ever leave the server.
CREATE TABLE response_signals (
  response_id TEXT PRIMARY KEY REFERENCES responses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  tone INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX mahalo_to ON mahalo(to_id);
CREATE INDEX feedback_to ON feedback_requests(to_id);
CREATE INDEX feedback_from ON feedback_requests(from_id);
CREATE INDEX voices_cycle ON community_voices(cycle_id, reviewee_id);
