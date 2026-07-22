# ai-review 페이지 제거 + 검수 모드 이원화(사람/AI)

## 1. /ai-review 페이지 제거
- src/index.tsx 의 /ai-review 라우트 삭제
- public/static/ai-review.js 파일 삭제
- 남은 참조 없음(확인 완료). 검수는 /review 페이지로 일원화됩니다.

## 2. 검수 데이터를 '사람 자동측정용' / 'AI 자동측정용'으로 분리
- 종판 코너 교정과 추체별 메모를 **두 벌로 따로 보관**합니다.
- 툴바의 "자동측정(AI)" 체크 상태가 곧 검수 대상입니다.
  - 체크 해제 → 사람 자동측정 검수
  - 체크 → AI 자동측정 검수
- 전환하면 그쪽 교정본/메모로 즉시 바뀝니다(서로 섞이지 않음).
- 오른쪽 패널에 **"검수 대상: 사람/AI 자동측정"** 표시를 추가해 헷갈리지 않게 했습니다.
- Ctrl+Z 되돌리기도 각 대상별로 올바르게 동작합니다.
- 이미지 전체 메모는 공용(하나)입니다.

## 저장 형식
  { human: {corners, notes}, ai: {corners, notes}, imageNote, method, ... }
- 예전에 저장한 데이터(구분 없던 형식)는 불러올 때 **자동으로 '사람'쪽으로 이관**됩니다.

## 변경 파일
- src/index.tsx              (ai-review 라우트 제거, 검수 대상 표시)
- public/static/review-page.js
- public/static/style.css
- (삭제) public/static/ai-review.js  ← 아래 명령으로 함께 삭제해야 합니다

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  Remove-Item public\static\ai-review.js -ErrorAction SilentlyContinue
  git add -A
  git commit -m "Remove ai-review page; split review data into human/AI measurement"
  git push origin sagittal-measurements
  npm run deploy:preview
