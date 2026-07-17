# 더블클릭으로 폴리곤 완성되는 동작 제거

- 실수로 자주 눌려 거슬린다는 요청 반영. onDoubleClick의 완성 동작을 제거.
- 폴리곤 완성은 그대로 사용 가능: Q(순서대로) / W(각도순) / Enter / 시작점 클릭.
- 변경: public/static/annotator.js

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Remove double-click-to-complete polygon (accidental triggers)"
  git push origin sagittal-measurements
  npm run deploy:preview
