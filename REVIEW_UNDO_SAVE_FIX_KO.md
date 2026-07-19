# 검수 저장 안 되던 문제 + Ctrl+Z 되돌리기

## 1. "이미지를 먼저 선택하세요" 뜨며 저장 안 되던 문제
- 원인: 제가 현재 파일명을 엉뚱한 곳(window.__spineCurrentFile / DOM)에서 읽었는데,
  앱은 실제로 state.filename 에 보관 중이었음 → 항상 빈 값 → 저장 거부.
- 수정:
  - app.js가 파일명이 바뀌는 모든 경로(폴더 선택 / 파일 열기 / 샘플)에서
    window.__spineCurrentFile 와 window.__spineState 를 갱신하도록 함.
  - 검수 UI는 state.filename 을 우선 읽도록 변경.

## 2. Ctrl+Z 로 검수 코너 교정 되돌리기
- 검수 모드에서 Ctrl+Z 를 누르면 마지막 코너 교정(또는 '되돌리기' 동작)이 취소됨.
  최대 50단계까지 누적. 상태줄에 남은 단계 표시.
- 검수 모드가 꺼져 있으면 기존 폴리곤 undo가 그대로 동작(충돌 없음).

## 변경 파일
- public/static/app.js               (파일명 노출, Ctrl+Z 훅)
- public/static/auto-endplate-ui.js  (undo 스택, 파일명 읽기 수정)
- public/static/annotator.js         (직전 드래그 수정 포함본)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Fix review save (filename) and add Ctrl+Z undo for corner edits"
  git push origin sagittal-measurements
  npm run deploy:preview
