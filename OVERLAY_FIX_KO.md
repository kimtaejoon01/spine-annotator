# 종판선 오버레이 보이게 + 사이드바 패널 마운트 수정

## 1. 종판선/점이 안 보이던 문제 (줌 배율)
- 척추 X-ray는 세로로 길어 화면맞춤 시 크게 축소됨. 선 두께/점 크기가
  이미지 좌표 기준이라 축소되면 0.5px 수준 → 사실상 안 보였음.
- 수정: 종판선을 strokeScaleEnabled:false 로 그려 줌과 무관하게 항상 보이게.
  점·글자도 현재 배율 기준 크기로. 종판선은 양쪽 25% 연장해 가독성 향상.
- 상종판=초록, 하종판=주황, 코너점=빨강(SA)/노랑(SP)/자홍(IA)/흰색(IP).

## 2. 사이드바 패널이 안 보이던 문제
- 패널을 #sidebarLeft 직속이 아니라 그 안의 .sidebar-scroll 안으로 마운트.

## 변경 파일
- public/static/annotator.js       (오버레이 렌더링)
- public/static/preprocess-ui.js   (패널 마운트)
- public/static/auto-endplate-ui.js(패널 마운트)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Overlay lines visible at any zoom; mount panels in sidebar scroll"
  git push origin sagittal-measurements
  npm run deploy:preview
