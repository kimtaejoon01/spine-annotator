-- presence 테이블 PK 정합성 수정
-- 기존 0002_presence.sql은 PK (labeler_id, filename) 복합키로 만드는데,
-- API는 ON CONFLICT(labeler_id) upsert를 써서 SQLite 오류가 났음.
-- (0002_runtime_tables.sql이 단독 PK로 새로 만들려 했으나, 파일명 정렬상
--  0002_presence.sql이 먼저 적용돼 복합키가 남는 문제가 있어 제거하고 이 파일로 통합.)
-- presence는 30초 heartbeat용 휘발성 데이터라 재생성해도 안전하다.
DROP TABLE IF EXISTS presence;
CREATE TABLE presence (
  labeler_id TEXT PRIMARY KEY,   -- 라벨러당 1행
  filename   TEXT NOT NULL DEFAULT '',
  last_seen  TEXT NOT NULL       -- ISO timestamp, 마지막 heartbeat
);
CREATE INDEX IF NOT EXISTS idx_presence_filename ON presence(filename);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen DESC);
