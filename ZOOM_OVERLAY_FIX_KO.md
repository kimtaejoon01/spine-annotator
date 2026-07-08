# 줌하면 종판선이 사라지던 문제 수정

## 원인
- 자동측정 종판선을 measurementLayer(랜드마크 측정 오버레이와 공유)에 그렸는데,
  줌 시 측정 갱신이 renderMeasurementDebugOverlay() → measurementLayer.destroyChildren()
  를 호출해 그 레이어를 통째로 비움 → 종판선도 같이 삭제됨.

## 수정
- 자동측정 전용 Konva 레이어(autoEndplateLayer)를 새로 만들어 거기에만 그림.
  다른 시스템이 건드리지 않으므로 줌/측정 갱신에도 사라지지 않음.
  (줌은 스테이지 전체에 적용되어 이 레이어도 함께 이동/확대됨.)

## 변경 파일
- public/static/annotator.js

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Auto-endplate overlay on dedicated layer (survives zoom/measurement redraw)"
  git push origin sagittal-measurements
  npm run deploy:preview
