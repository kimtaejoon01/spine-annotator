# 핫픽스: 초기화 크래시 + 로그인 안 됨

## 원인
- 직전 '검수 모드' 패키지에서 제 코드 치환 실수로 annotator.js의
  onMouseDown / onMouseUp / _commitCircle / _clearCirclePreview 메서드가 삭제됨.
- 그래서 landmark-tools.js:22의 annotator.onMouseDown.bind(...)가 터지고
  앱 초기화가 중단 → 화면·로그인 모두 먹통이 됨.

## 수정
- 삭제된 4개 메서드를 (FH 원 2클릭 로직 포함) 복원.
- 빌드/구문 검증 완료. 로그인 실패는 이 크래시의 결과였고, 복원으로 해결됨.

## 변경 파일
- public/static/annotator.js  (이 파일만 교체하면 됨)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Hotfix: restore mouse handlers/circle helpers deleted in review-mode change"
  git push origin sagittal-measurements
  npm run deploy:preview
