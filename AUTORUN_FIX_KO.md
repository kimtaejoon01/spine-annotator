# "이미지 열면 자동 측정"이 동작 안 하던 문제 수정

## 원인
- 라벨 로딩 완료 이벤트(spine:labels-loaded)를 넣을 때, 앵커로 삼은 코드가
  여러 곳에 있어서 **엉뚱한 함수(restoreVisibleLandmarksAfterLoad)** 안에 삽입됐음.
  → loadLabelsFromStorage 가 끝나도 이벤트가 안 나가서 자동 측정이 실행되지 않음.

## 수정
1. 이벤트를 loadLabelsFromStorage 안 **세 경로 모두**(라벨 있음/없음/에러)에 삽입.
   삽입 위치를 실제로 검증함.
2. 이벤트에 의존하지 않는 안전장치 추가:
   이미지 전환 후 폴리곤이 준비될 때까지 최대 3초간 확인하다가(250ms 간격)
   2개 이상 준비되면 자동 측정 실행. 어떤 로딩 경로에서도 동작.

## 변경 파일
- public/static/app.js
- public/static/auto-endplate-ui.js

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Fix auto-measure on image open (event was inserted in wrong function)"
  git push origin sagittal-measurements
  npm run deploy:preview
