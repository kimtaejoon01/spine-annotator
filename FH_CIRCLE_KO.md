# FH(대퇴골두) 라벨: 폴리곤 → 중심 클릭 원(circle)

## 변경
- FH_L / FH_R / FH_LAT 버튼을 누른 뒤:
  - 캔버스에서 대퇴골두 '중심을 클릭'하면 그 중심으로 원이 생깁니다.
  - 클릭 후 드래그하면 반경을 조절, 그냥 클릭만 하면 기본 반경(이미지 크기 비례).
- 원은 32각형 폴리곤으로 저장되어 기존 export/편집/렌더와 그대로 호환됩니다.
  (label=FH_*, manualLabel=true, shape:'circle')
- HC(HC_L/R/LAT)는 기존처럼 점 클릭 유지.

## 함께 포함 (일관성)
- app.js에는 직전 'AI 마스크 파일명 정규식(v\\d+)' 수정도 포함되어 있습니다.
- ai-review.js도 동일 수정 포함.

## 변경 파일
- public/static/app.js       (FH 버튼 circle 모드 + AI 정규식 수정 + 도구 전환)
- public/static/annotator.js (circle 그리기: mousedown 중심 / drag 반경 / mouseup 생성)
- public/static/ai-review.js (AI 정규식 수정)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "FH label as center-click circle; include AI mask regex fix"
  git push origin sagittal-measurements
  npm run deploy:preview

## 참고
- 기본 반경이 마음에 안 들면 annotator.js의 defR 계산(현재 이미지 짧은변 4%)을 조정.
- 만든 원 크기를 나중에 바꾸려면: 지금은 편집 모드에서 점 이동으로 변형 가능(원형 유지 리사이즈는 원하면 별도 추가).
