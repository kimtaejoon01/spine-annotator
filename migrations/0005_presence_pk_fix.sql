-- presence 테이블 PK 정합성 수정
-- 기존: PRIMARY KEY (labeler_id, filename) → 복합키
-- API는 ON CONFLICT(labeler_id) upsert를 사용하는데, labeler_id 단독 UNIQUE가
-- 없어 SQLite가 "ON CONFLICT clause does not match..." 오류를 던졌음.
-- 의도(=라벨러당 1행, 파일 열면 filename 갱신)에 맞게 PK를 labeler_id 단독으로 변경.
--
-- presence는 30초 heartbeat용 휘발성 데이터라 재생성해도 안전하다.
DROP TABLE IF EXISTS presence;
CREATE TABLE presence (
  labeler_id TEXT PRIMARY KEY,   -- 라벨러당 1행
  filename   TEXT NOT NULL DEFAULT '',
  last_seen  TEXT NOT NULL       -- ISO timestamp, 마지막 heartbeat
);
CREATE INDEX IF NOT EXISTS idx_presence_filename ON presence(filename);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen DESC);
