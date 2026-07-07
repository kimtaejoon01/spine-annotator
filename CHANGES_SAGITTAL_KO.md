# sagittal-measurements — 수정 내역 (배포 가능 상태로 복구)

로그인은 요청대로 넣지 않았습니다(이 브랜치는 인증 없이 그대로).
아래는 "빌드가 깨져 배포 불가"였던 문제를 포함해, 정리한 내용입니다.

## 1. 깨진 빌드 수리 (가장 중요)
- 패치 체인이 `annotator.js`의 `normalizeVertebraLabelsByY` 메서드를
  **중복 삽입**해 `}) {` 구문 오류를 만들었고, `verify-build-output`이
  배포를 막고 있었습니다. 중복 본문과 깨진 시그니처를 제거해 수리.
- 이제 `npm run build`가 정상 완료됩니다(vite가 dist/_worker.js 생성 확인).

## 2. 빌드 패치 파이프라인 제거 (flatten)
- `scripts/`의 패치 102개를 실행한 결과를 소스에 확정 반영.
  이제 `src/`, `public/static/`가 실제 배포 코드와 일치합니다.
- `package.json`: `predev`/`prebuild`(패치·검증) 제거 → `build`는 `vite build`만.
- `scripts/` 전체 삭제.

## 3. CI 워크플로우 2개 제거
- `.github/workflows/disable-auth-on-branch.yml`,
  `.github/workflows/absorb-build-patches.yml` 삭제.
  둘 다 `scripts/`에 의존해 flatten 후 무의미하고, 특히 disable-auth는
  실수로 재실행/머지되면 위험해서 제거했습니다.
  (인증 비활성화는 이미 소스에 반영돼 있으므로 워크플로우 없이도 그대로 유지됩니다.)

## 4. 마이그레이션 충돌 해소 + presence 실수정
- 기존: 0002가 둘(`0002_presence`/`0002_runtime_tables`), 0003도 둘로 충돌.
- 정리:
  - `0002_runtime_tables.sql` 삭제(아래 0005로 통합)
  - `0003_notes.sql` → `0004_notes.sql`
  - `0005_presence_pk_fix.sql` 추가: presence를 PK `labeler_id` 단독으로
    재생성. 기존 복합 PK 때문에 `ON CONFLICT(labeler_id)`가 런타임 오류를
    내던 문제를 실제로 해결(휘발성 데이터라 drop/recreate 안전).

## 5. 입력 검증 추가 (main과 동일)
- `sanitizePolygons()`를 PUT /labels, POST /migrate에 적용
  (폴리곤 200개·점 2000개 상한, 좌표는 유한 숫자만, label 40자).
- GET /export: 잘못된 좌표는 스킵해 NaN annotation 방지.
- landmarks 저장 로직은 그대로 유지.

## 배포 시
- D1 마이그레이션 적용: `npm run db:migrate:remote`
  (0004_notes는 CREATE IF NOT EXISTS라 재실행돼도 no-op)
- 배포: `npm run deploy:preview` (sagittal-measurements 브랜치로)

## 손대지 않은 것
- 로그인(요청대로 미포함) / measurements·landmark 기능 로직
