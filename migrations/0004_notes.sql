-- File-level notes / memo table
-- 라벨/COCO 데이터와 분리된 파일별 메모 저장소

CREATE TABLE IF NOT EXISTS notes (
  filename   TEXT PRIMARY KEY,
  note_text  TEXT NOT NULL DEFAULT '',
  labeler_id TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_labeler ON notes(labeler_id);
