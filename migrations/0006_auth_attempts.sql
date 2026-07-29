-- 비밀번호 무차별 대입(brute force) 방어용 시도 기록
-- 공유 비밀번호 1개로만 보호되는 구조라, 최소한 온라인 추측 공격 비용은 올려둡니다.
-- IP 단위로 실패 횟수를 세고, 임계치를 넘으면 일정 시간 잠급니다.

CREATE TABLE IF NOT EXISTS auth_attempts (
  ip            TEXT PRIMARY KEY,   -- CF-Connecting-IP (없으면 'unknown')
  fail_count    INTEGER NOT NULL DEFAULT 0,
  first_fail_at TEXT NOT NULL,      -- ISO timestamp, 윈도우 시작점
  locked_until  TEXT                -- ISO timestamp, NULL 이면 잠금 아님
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_locked ON auth_attempts(locked_until);
