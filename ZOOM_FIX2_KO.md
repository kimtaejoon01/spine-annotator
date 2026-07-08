# 줌하면 종판선 사라지던 문제 — 재수정 + 선 두께 원복

## 이번 변경
1. 줌할 때마다 종판선 오버레이를 '다시 그림'.
   - 앱은 줌 시 refreshPolygonVisualScale()로 폴리곤을 재렌더하는데, 그 직후
     종판선도 저장해둔 좌표로 재렌더하도록 연결. 무엇이 지우든 매 줌마다 복원됨.
   - 오버레이는 전용 레이어(autoEndplateLayer)에 유지.
2. 선 두께를 '처음' 방식으로 원복.
   - strokeScaleEnabled:false / 25% 연장 제거 → 줌에 따라 함께 스케일되는
     기본 두께(strokeWidth 2, 점 반지름 3).

## 변경 파일
- public/static/annotator.js

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Redraw auto-endplate overlay on every zoom; restore original line thickness"
  git push origin sagittal-measurements
  npm run deploy:preview
