# FH 원: 2클릭 방식 (반경 조절 가능)

## 사용법
- FH_L / FH_R / FH_LAT 버튼을 누른 뒤 캔버스에서:
  1) 첫 클릭 = 원의 '가장자리' 점 하나
  2) 둘째 클릭 = '중심'
  → 둘째 클릭을 중심으로, 반경 = 두 점 사이 거리인 원이 생성됩니다.
  (마우스를 움직이면 원 미리보기가 커서를 중심으로 실시간 표시)
- HC(HC_L/R/LAT)는 기존처럼 점 클릭.

## 구현
- 원은 32각형 폴리곤으로 저장(label=FH_*, shape:'circle') → export/편집/렌더 호환.
- 라벨 버튼을 다시 누르거나 바꾸면 그리던 첫 점은 취소됩니다.

## 변경 파일
- public/static/annotator.js (2클릭 원 로직)
- public/static/app.js       (FH circle 모드, 안내 문구; AI 정규식 수정 포함)
- public/static/ai-review.js (AI 정규식 수정 포함)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "FH circle via two clicks (edge point then center)"
  git push origin sagittal-measurements
  npm run deploy:preview
