# 자동(점선) 잘 보이게 + 단축키 패널 접기

## 1. 검수본 vs 자동본 비교에서 자동 점선이 안 보이던 문제
- 반투명(opacity 0.55)을 제거해 **불투명**으로.
- 점선일 때 선을 더 두껍게(2 → 2.5), 대시 간격도 길게(6/4 → 10/5)
  → 실선(검수본)과 구분되면서도 뚜렷하게 보임.

## 2. 단축키 패널이 왼쪽 메뉴를 너무 차지하던 문제
- 단축키 패널을 접이식(details)으로 바꾸고 **기본은 접힘** 상태.
  제목을 클릭하면 펼쳐지고, 화살표로 상태 표시.
- 기존 설정 버튼(톱니)과 상단 단축키 버튼(Ctrl+K)은 그대로 동작.

## 변경 파일
- public/static/annotator.js (점선 스타일)
- src/index.tsx             (단축키 패널 → details)
- public/static/style.css   (접이식 패널 스타일)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Make auto endplate dashes clearly visible; collapse shortcut panel by default"
  git push origin sagittal-measurements
  npm run deploy:preview
