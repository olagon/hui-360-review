-- One row per AI call: what it was for, which model, when, how big, and whether it worked.
-- Never the words sent or written. Shown in Settings, AI log, and used to label each draft.
CREATE TABLE ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT,
  kind TEXT NOT NULL,      -- letter, prep, team, board, signals, or answers (a letter started from the answers, no AI)
  cycle_id INTEGER,
  staff_id INTEGER,        -- the person a letter or prep is about
  model TEXT NOT NULL,     -- the model id, or 'none'
  input_tokens INTEGER,
  output_tokens INTEGER,
  ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT
);
CREATE INDEX ai_runs_target ON ai_runs (kind, cycle_id, staff_id, id);
