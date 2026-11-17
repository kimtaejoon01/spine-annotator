-- Separate S1 expert annotations from general labels and endplate review.
CREATE TABLE IF NOT EXISTS s1_expert_review (
 filename TEXT PRIMARY KEY,
 image_width INTEGER NOT NULL,
 image_height INTEGER NOT NULL,
 polygon_json TEXT NOT NULL,
 endplate_json TEXT NOT NULL,
 decision TEXT NOT NULL DEFAULT 'pending',
 notes TEXT NOT NULL DEFAULT '',
 reviewer TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_s1_expert_review_updated ON s1_expert_review(updated_at DESC);
