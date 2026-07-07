# Spine Annotator — 수정 내역

보안 항목(공유 비밀번호·SRI·레이트리밋)은 임시 사용이라 그대로 두었고,
에러 메시지는 요청대로 클라이언트로 계속 내려갑니다.

## 1. 빌드 패치 파이프라인 제거 (flatten)
- `scripts/`의 패치 48개를 한 번 실행한 결과를 소스에 확정 반영했습니다.
  이제 `src/`, `public/static/`가 실제 배포되는 코드와 일치합니다.
- `package.json`: `prebuild`(패치 실행) 단계 삭제 → `build`는 `vite build`만 수행.
- `scripts/` 디렉터리 전체 삭제.
- 동작은 그대로입니다(패치 결과 = 기존 배포 산출물). flatten 과정에서
  `verify-build-output` 통과 확인. 참고로 패치로만 존재하던 `ai-review.js` 등
  기능 파일도 이제 소스에 그대로 포함됩니다.

## 2. presence 테이블 PK 정합성 (런타임 500 수정)
- 기존 PK `(labeler_id, filename)` 복합키 + API의 `ON CONFLICT(labeler_id)` 조합은
  SQLite에서 오류를 냅니다.
- `migrations/0005_presence_pk_fix.sql` 추가: presence를 PK `labeler_id` 단독으로
  재생성(휘발성 heartbeat 데이터라 drop/recreate 안전). API 코드는 수정 불필요.

## 3. 마이그레이션 번호 충돌 해소
- `0003_notes.sql` → `0004_notes.sql` 로 리넘버링 (0003 중복 제거).

## 4. 입력 검증 추가 (src/api.ts)
- `sanitizePolygons()` 헬퍼 추가. PUT /labels, POST /migrate 에 적용.
  - 폴리곤 개수 상한 200, 폴리곤당 점 상한 2000
  - 좌표는 유한한 숫자만 허용(짝수 길이, 최소 3점), label은 문자열·40자 제한
  - 위반 시 400 + 메시지(클라이언트로 전달)
- GET /export: 과거의 잘못된 좌표 데이터는 스킵하여 NaN annotation 방지.

## 배포 시 주의
- D1에 마이그레이션 적용:
  `npx wrangler d1 migrations apply spine-annotator-production --remote`
- 0004_notes 리넘버링으로 인해, 이미 0003_notes를 적용했던 DB는
  0004_notes(CREATE TABLE IF NOT EXISTS)를 한 번 더 실행하지만 no-op이라 안전합니다.

## 손대지 않은 것
- app.js(약 1900줄) 대규모 리팩터링: 위험도가 커서 이번 범위에서 제외했습니다.
- 보안 관련 항목 전부(요청대로).
