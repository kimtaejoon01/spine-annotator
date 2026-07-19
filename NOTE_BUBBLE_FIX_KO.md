# 메모 말풍선이 안 보이던 문제

## 가장 흔한 원인
- 메모는 **추체를 선택한 상태**에서만 저장됩니다. 추체를 안 고르고 메모칸에
  입력하면 지금까지는 아무 반응 없이 무시돼서(저장도 X, 말풍선도 X)
  "안 보인다"로 느껴졌습니다.

## 이번 수정
1. 추체 미선택 상태로 입력하면 **경고 문구**를 띄웁니다:
   "⚠ 먼저 위에서 추체를 선택하세요 (메모가 저장되지 않습니다)"
2. 자동 측정을 실행하면 첫 추체를 **자동 선택**해 둡니다(바로 입력 가능).
3. 메모칸 안내문을 "① 추체 선택 → ② 메모 입력"으로 변경.

## 확인 방법
1. [자동 측정 실행] (종판선이 보여야 함)
2. 드롭다운에서 추체 선택 (예: T5)
3. 메모 입력 → 그 추체 오른쪽에 노란 테두리 말풍선이 즉시 표시
4. 안 보이면 "메모 말풍선 표시" 체크가 켜져 있는지 확인

## 변경 파일
- public/static/auto-endplate-ui.js, style.css
- public/static/annotator.js (말풍선 렌더링 포함본)

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Warn when memo typed without vertebra selected; auto-select first"
  git push origin sagittal-measurements
  npm run deploy:preview
