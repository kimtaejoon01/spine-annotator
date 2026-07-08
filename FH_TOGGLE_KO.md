# FH 등 펠비스 버튼: 재클릭 취소 + 그린 후 폴리곤 모드 복귀

## 동작
- FH_L/FH_R/FH_LAT/HC_* 버튼을 '한 번 더' 누르면 그 모드가 취소되고
  기본 폴리곤 모드로 돌아옵니다(그리던 원도 취소).
- FH 원을 완성하면 자동으로 기본 폴리곤 모드로 복귀하고 버튼 활성도 해제됩니다.
  (연속으로 또 그리려면 버튼을 다시 누르면 됨)

## 변경 파일
- public/static/app.js       (버튼 토글 + circle-committed 이벤트 처리)
- public/static/annotator.js (원 완성 후 pendingLabel 초기화 + 이벤트 발생)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Pelvis buttons toggle off on re-click; return to polygon mode after circle"
  git push origin sagittal-measurements
  npm run deploy:preview
