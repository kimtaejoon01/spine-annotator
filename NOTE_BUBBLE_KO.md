# 추체별 메모를 이미지 위에 말풍선으로 표시

## 동작
- 추체에 메모를 적으면 그 추체 **오른쪽에 말풍선**이 뜹니다.
  (추체와 연결선 + 테두리 있는 반투명 상자 + 노란 글씨)
- 메모를 입력/수정하면 즉시 반영, 지우면 말풍선도 사라집니다.
- 패널의 **"메모 말풍선 표시"** 체크로 켜고 끌 수 있고, 이 설정은 전역 저장됩니다.
- 긴 메모는 14자씩 최대 3줄로 줄여서 표시(뒤는 … 처리) — 화면을 가리지 않게.
- 줌/화면맞춤에 따라 크기와 위치가 자동으로 맞춰집니다.

## 사용
1. 검수 패널에서 추체 선택 → 메모 입력 → 캔버스에 바로 말풍선 표시
2. 저장은 기존과 동일하게 [검수 저장]

## 변경 파일
- public/static/annotator.js        (말풍선 렌더링, setEndplateNotes)
- public/static/auto-endplate-ui.js (메모 전달, 표시 토글, 설정 저장)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Show per-vertebra memos as callout bubbles on canvas"
  git push origin sagittal-measurements
  npm run deploy:preview
