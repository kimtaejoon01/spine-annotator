# 코너 점이 줌인 시 너무 커지던 문제 수정

- 원인: 점 반지름이 이미지 좌표 기준이라 줌인하면 함께 커짐.
- 수정: 줌마다 재렌더될 때 현재 배율로 점 크기를 계산 → 화면상 항상 ~3.5px 유지.
  글자 크기도 동일 처리. 선 두께는 그대로(스케일 유지).
- 변경: public/static/annotator.js

## 적용
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Keep auto-endplate corner dots constant screen size on zoom"
  git push origin sagittal-measurements
  npm run deploy:preview
