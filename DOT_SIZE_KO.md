# 축소 상태에서 꼭지점이 너무 커 보이던 문제

## 원인
- 검수 기능 추가로 한 자리에 점이 2개(자동 점 + 검수 드래그 핸들) 그려지고,
  핸들이 1.8배라 화면맞춤(축소) 상태에서는 척추체보다 점이 더 커 보였음.
- 점 크기가 '화면 기준 고정'이라 척추체가 작게 보일수록 상대적으로 과해짐.

## 수정
- 점 크기를 **각 추체의 종판 길이에 비례**하도록 변경(길이의 10%).
  단, 화면 기준 최소 1.8px ~ 최대 4.5px로 제한 → 많이 축소해도 과하지 않고,
  확대해도 지나치게 커지지 않음.
- 검수 핸들 배율을 1.8배 → 1.35배로 축소.
- 화면맞춤(zoomToFit) 직후에도 오버레이를 다시 그려 크기가 즉시 갱신되게 함.

## 변경 파일
- public/static/annotator.js

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Scale endplate corner dots to vertebra size with screen clamps"
  git push origin sagittal-measurements
  npm run deploy:preview
