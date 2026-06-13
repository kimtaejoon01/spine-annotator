# 패치 요약

## 수정한 내용

1. 운영 기본 비밀번호 제거
   - `AUTH_PASSWORD`가 없으면 API가 500 설정 오류를 반환합니다.
   - `.dev.vars.example` 추가.

2. 동시 편집 보호 추가
   - 저장 payload에 `version` 포함.
   - 서버가 현재 버전과 클라이언트 버전을 비교합니다.
   - 충돌 시 409 `version_conflict` 반환.
   - 프론트에서 “최신 불러오기” 토스트 표시.

3. COCO export 이미지 크기 보강
   - `image_width`, `image_height` 컬럼 추가.
   - 저장 시 원본 이미지 크기 저장.
   - 서버 COCO export의 `images[]`에 `width`, `height` 포함.

4. Presence 중복 라우트 정리
   - 중복 `GET /api/presence` 제거.
   - 기존 `POST /api/presence` 호환은 유지하고, 프론트가 쓰는 `PUT/DELETE`도 유지.

5. TypeScript / 보안 점검
   - `@cloudflare/workers-types` 추가.
   - `npx tsc --noEmit` 통과.
   - `npm audit` 취약점 0개로 정리.

6. 배포 스크립트 추가
   - `db:migrate:local`
   - `db:migrate:remote`
   - `secret:auth`
   - `deploy`

## 검증 결과

- `npm run build`: 통과
- `npx tsc --noEmit`: 통과
- `node --check public/static/*.js`: 통과
- `npm audit`: 취약점 0개
- `wrangler d1 migrations apply --local`: 통과
- 로컬 Pages Functions API 테스트:
  - 인증 성공/실패 확인
  - 라벨 저장 확인
  - stale version 저장 시 409 conflict 확인
  - COCO export에서 width/height 확인
