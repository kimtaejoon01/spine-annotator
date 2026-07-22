# 마스크 표시 방식 수정 + 검수 페이지 그리기 비활성화

## 1. "웬 윤곽선?" — 마스크 PNG를 그대로 겹쳐 보이도록 변경
- 기존: 마스크에서 뽑은 폴리곤 윤곽선을 그림 (별 모양으로 꼬이기도 함)
- 변경: **마스크 PNG 자체를 청록 반투명으로 오버레이**합니다.
  실제 예측 결과가 픽셀 그대로 보이므로 판단이 정확합니다.
- 폴리곤 추출은 **측정용으로 내부에서만** 계속 사용합니다(화면에는 안 그림).

## 2. 별 모양으로 꼬이던 윤곽선 자체도 수정
- 원인: 경계점을 '중심 기준 각도순'으로 정렬 → 오목한 모양에서 앞뒤로 튐.
- 수정: **Moore-neighbor 경계 추적**으로 실제 윤곽을 순서대로 따라가도록 변경.
- 검증: 오목한 C자 모양에서 평균 간격 4.88 / 최대 점프 5.00 → 꼬임 없음.
  (측정 정확도에도 직접 영향이 있던 부분입니다)

## 3. 검수 페이지에서 점이 찍히던 문제
- 검수 페이지의 캔버스가 '그리기' 상태라 클릭하면 폴리곤 점이 생기고
  흰 선이 그려졌습니다.
- annotator에 readOnly 모드를 추가하고 검수 페이지에서 켰습니다.
  → 이제 클릭해도 그려지지 않고, 검수 모드의 코너 드래그만 동작합니다.

## 변경 파일
- public/static/ai-measure.js  (경계 추적, maskToColorCanvas)
- public/static/review-page.js (마스크 이미지 오버레이, readOnly)
- public/static/annotator.js   (readOnly, setAiMaskImage)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Overlay mask PNG directly; fix contour tracing; read-only review canvas"
  git push origin sagittal-measurements
  npm run deploy:preview
