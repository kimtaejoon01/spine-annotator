CREATE TABLE IF NOT EXISTS presence (
  labeler_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen DESC);
