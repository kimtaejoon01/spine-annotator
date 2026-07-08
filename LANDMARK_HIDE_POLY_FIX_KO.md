# 랜드마크 모드에서 폴리곤이 겹쳐 보이던 문제 수정

## 원인
- 랜드마크(corner/centroid) 모드는 updateModeVisibility가 폴리곤 레이어를 숨기지만,
  줌/재렌더 시 renderPolygons()와 (직전에 넣은) 라벨-가시성 재적용이
  '사람 라벨 보기' 체크박스 기준으로 폴리곤을 다시 보이게 만들어 충돌했음.

## 수정
- 폴리곤 레이어 가시성을 "사람 라벨 ON AND 현재 폴리곤 모드"일 때만 true로.
  (annotator.__activeAnnotationMode === 'polygon' 조건 추가; 3+1곳)
- updateModeVisibility의 폴리곤 모드 분기도 '사람 라벨 보기' 상태를 반영.
- 결과: 랜드마크 모드에선 줌을 해도 폴리곤이 안 보임. 폴리곤 모드로 돌아오면
  체크박스 상태대로 표시.

## 변경 파일
- public/static/annotator.js
- public/static/landmark-tools.js

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Hide polygons in landmark mode (respect mode + human-label toggle)"
  git push origin sagittal-measurements
  npm run deploy:preview
