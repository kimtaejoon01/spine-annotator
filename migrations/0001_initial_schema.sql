CREATE TABLE IF NOT EXISTS labels (
  filename TEXT PRIMARY KEY,
  view_type TEXT,
  start_label TEXT,
  image_width INTEGER,
  image_height INTEGER,
  polygons_json TEXT NOT NULL DEFAULT '[]',
  labeler_id TEXT,
  polygon_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_labels_labeler ON labels(labeler_id);
CREATE INDEX IF NOT EXISTS idx_labels_view ON labels(view_type);
CREATE INDEX IF NOT EXISTS idx_labels_updated ON labels(updated_at DESC);
