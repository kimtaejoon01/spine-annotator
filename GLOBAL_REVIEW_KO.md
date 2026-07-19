# 검수 모드 / 자동 측정을 '전역'으로 (이미지 넘겨도 유지)

## 변경
1. **검수 모드가 전역 설정**이 됨
   - 체크 상태를 브라우저에 저장(localStorage). 이미지를 넘겨도, 새로고침해도 유지.
   - 다음 이미지로 넘어가면 자동으로 검수 모드 그대로 → 바로 코너 교정 가능.
2. **"이미지 열면 자동 측정" 체크박스 추가 (기본 켬, 전역)**
   - 이미지를 열고 라벨이 로드되면 자동 측정을 자동 실행.
   - 이제 이미지마다 [자동 측정 실행]을 누를 필요 없음.
3. 저장된 검수본도 이미지 전환 시 자동으로 불러와 표시.
4. '종판선 표시' 체크 상태도 전역 저장.

## 동작 순서 (이미지 전환 시)
이미지 로드 → 라벨 로드 완료 → (자동) 검수본 불러오기 → (자동) 측정 실행
→ 검수 모드면 코너 즉시 드래그 가능

## 변경 파일
- public/static/app.js              (라벨 로딩 완료 이벤트 발생)
- public/static/auto-endplate-ui.js (전역 설정/자동 실행)
- public/static/annotator.js        (직전 꼭지점 비교 수정 포함본)
- public/static/style.css

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Make review mode and auto-measure global (persist across images)"
  git push origin sagittal-measurements
  npm run deploy:preview
