# 전처리 뷰 — 버그 수정 (색상 + opencv 로드)

## 1. 다크 테마 버튼 색상 수정
- 프리셋 버튼 글자가 검게 보이던 문제 → 앱의 GitHub 다크 테마 변수
  (--bg-tertiary / --text-primary / --accent-red 등)에 맞게 수정.
- 변경: public/static/style.css

## 2. opencv.js 로드 실패 대응 (CLAHE / Canny)
- 기존엔 docs.opencv.org 하나만 시도해서 그게 막히면 실패했음.
- 이제 (1) 로컬 /static/opencv.js → (2) jsDelivr → (3) docs.opencv.org 순으로
  폴백하고, 전부 실패하면 다음에 재시도 가능하게 함.
- 변경: public/static/preprocess.js

## 3. opencv.js 자가호스팅 (권장, 네트워크 무관 확실)
- public/static/opencv.js (약 10MB) 를 리포에 포함.
  로더가 이 파일을 최우선으로 쓰므로, 병원/사내망에서 CDN이 막혀도
  CLAHE/Canny가 그냥 동작함. (외부 네트워크 호출 없음)
- 이 파일은 Cloudflare Pages로 그대로 배포됨(파일당 25MB 한도 내).

## 적용
webapp 폴더에서:
  tar xzf <이 압축파일 경로> -C .
  git add -A
  git commit -m "Fix preprocessing UI colors; self-host opencv.js; multi-CDN fallback"
  git push origin sagittal-measurements
그리고 배포:
  npm run deploy:preview
(주의: opencv.js 10MB가 한 번 업로드됩니다.)
