-- 자동 종판(4코너) 검수 결과 저장
-- data_json 구조:
-- {
--   "corners": { "T5": {"SA":[x,y],"SP":[x,y],"IA":[x,y],"IP":[x,y]}, ... },  -- 교수님 수정본(수정한 것만)
--   "notes":   { "T5": "여기는 상종판이 한 칸 위" },                          -- 추체별 메모
--   "imageNote": "전반적으로 T4 이상 판독 어려움",                             -- 이미지 전체 메모
--   "auto":    { ... }                                                        -- 그때의 자동결과 스냅샷(비교용)
-- }
CREATE TABLE IF NOT EXISTS endplate_review (
  filename   TEXT PRIMARY KEY,
  data_json  TEXT NOT NULL,
  reviewer   TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_endplate_review_updated ON endplate_review(updated_at DESC);
