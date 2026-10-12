-- Hawaiian (or any language) screen text, edited by admins in Settings, Translations.
-- These override the starter file public/assets/i18n/haw.json without a deploy.
CREATE TABLE translations (
  lang TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  PRIMARY KEY (lang, key)
);
