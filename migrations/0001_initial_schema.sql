-- Spine Annotator 초기 스키마
-- labels: 파일별 폴리곤 라벨 데이터

CREATE TABLE IF NOT EXISTS labels (
  filename       TEXT PRIMARY KEY,         -- 이미지 파일명 (고유)
  view_type      TEXT,                     -- AP / LAT
  start_label    TEXT,                     -- 시작 척추 라벨 (예: T1)
  polygons_json  TEXT NOT NULL,            -- 폴리곤 배열 JSON
  labeler_id     TEXT,                     -- 마지막 수정자 (park/kim/hwang)
  polygon_count  INTEGER NOT NULL DEFAULT 0, -- 폴리곤 개수 (목록 표시 최적화)
  updated_at     TEXT NOT NULL,            -- ISO 8601 timestamp
  created_at     TEXT NOT NULL,            -- ISO 8601 timestamp
  version        INTEGER NOT NULL DEFAULT 1 -- 낙관적 동시편집 감지용
);

CREATE INDEX IF NOT EXISTS idx_labels_labeler ON labels(labeler_id);
CREATE INDEX IF NOT EXISTS idx_labels_view ON labels(view_type);
CREATE INDEX IF NOT EXISTS idx_labels_updated ON labels(updated_at DESC);
