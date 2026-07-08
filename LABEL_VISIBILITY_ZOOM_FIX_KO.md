# '사람 라벨 보기' 꺼도 줌하면 라벨이 되살아나던 버그 수정

- 원인: 줌 시 refreshPolygonVisualScale() → renderPolygons() 재렌더가
  polyLayer를 다시 보이게 만들어, 숨김 상태가 풀림. (자동측정 기능과 무관한 기존 버그)
- 수정: 재렌더 직후 '사람 라벨 보기' 체크박스의 실제 상태를 polyLayer에 다시 적용.
  이제 줌해도 숨김이 유지됨.
- 변경: public/static/annotator.js

## 적용
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Fix: keep human-label hidden state after zoom re-render"
  git push origin sagittal-measurements
  npm run deploy:preview
