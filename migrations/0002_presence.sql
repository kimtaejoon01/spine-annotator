-- Presence (현재 작업 중인 사람 추적)
-- labeler_id+filename 조합으로 유일 → 한 사람이 같은 파일 열면 갱신
CREATE TABLE IF NOT EXISTS presence (
  labeler_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  last_seen TEXT NOT NULL,    -- ISO timestamp, 마지막 heartbeat
  PRIMARY KEY (labeler_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_presence_filename ON presence(filename);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen DESC);
