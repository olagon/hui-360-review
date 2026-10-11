-- Core schema. Reviewer identity is never stored next to a response:
-- response_link holds only a one way hash (see functions/lib/assign.js).

CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  preferred_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'lead', 'staff')),
  team TEXT,
  start_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'haw', 'both'))
);

CREATE TABLE value_sets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE "values" (
  id INTEGER PRIMARY KEY,
  values_set_id INTEGER NOT NULL REFERENCES value_sets(id) ON DELETE CASCADE,
  name_haw TEXT NOT NULL,
  name_en TEXT,
  olelo_noeau TEXT,
  olelo_noeau_meaning TEXT,
  description TEXT,
  ord INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cycles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  opens_at TEXT,
  closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'published')),
  values_set_id INTEGER REFERENCES value_sets(id),
  published_at TEXT
);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('self', 'peer', 'upward', 'community')),
  ord INTEGER NOT NULL DEFAULT 0,
  prompt_en TEXT NOT NULL,
  prompt_haw TEXT,
  kind TEXT NOT NULL DEFAULT 'story' CHECK (kind IN ('story', 'short', 'mahalo', 'scale')),
  required INTEGER NOT NULL DEFAULT 0,
  five_min INTEGER NOT NULL DEFAULT 0,
  value_id INTEGER REFERENCES "values"(id) ON DELETE SET NULL
);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES staff(id),
  reviewee_id INTEGER NOT NULL REFERENCES staff(id),
  kind TEXT NOT NULL CHECK (kind IN ('self', 'peer', 'upward')),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'done')),
  UNIQUE (cycle_id, reviewer_id, reviewee_id, kind)
);

-- id is random and created_at is a date only, so neither leaks write order.
CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  reviewee_id INTEGER NOT NULL REFERENCES staff(id),
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  body TEXT,
  audio_key TEXT,
  transcript TEXT,
  language TEXT,
  created_at TEXT NOT NULL DEFAULT (date('now')),
  signed_name TEXT
);
CREATE INDEX responses_reviewee ON responses(cycle_id, reviewee_id);

CREATE TABLE response_link (
  response_id TEXT PRIMARY KEY REFERENCES responses(id) ON DELETE CASCADE,
  assignment_hash TEXT NOT NULL
);
CREATE INDEX response_link_hash ON response_link(assignment_hash);

CREATE TABLE summaries (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  reviewee_id INTEGER NOT NULL REFERENCES staff(id),
  draft TEXT,
  edited TEXT,
  talk_story_prep TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'shared')),
  shared_body TEXT,
  shared_at TEXT,
  UNIQUE (cycle_id, reviewee_id)
);

CREATE TABLE employee_reflection (
  id INTEGER PRIMARY KEY,
  summary_id INTEGER NOT NULL UNIQUE REFERENCES summaries(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'met', 'carried', 'dropped'))
);

CREATE TABLE mahalo (
  id INTEGER PRIMARY KEY,
  from_id INTEGER REFERENCES staff(id),
  to_id INTEGER NOT NULL REFERENCES staff(id),
  body TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE feedback_requests (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES staff(id),
  to_id INTEGER NOT NULL REFERENCES staff(id),
  prompt TEXT NOT NULL,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kuleana (
  staff_id INTEGER PRIMARY KEY REFERENCES staff(id),
  title TEXT,
  responsibilities TEXT,
  works_with TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE community_voices (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  reviewee_id INTEGER NOT NULL REFERENCES staff(id),
  token TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  response TEXT,
  who TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
