# 검수 모드 코너 드래그 — 진짜 원인 수정

## 원인 (앞선 수정이 안 먹힌 이유)
- 자동측정 오버레이 '전용 레이어'를 만들 때 Konva.Layer({ listening: false })로
  생성해 두었음. 레이어가 listening:false면 그 안의 자식이 draggable이어도
  마우스 이벤트를 **아예 받지 못함** → 드래그 불가.
  (앞서 그리기 차단을 넣었지만, 애초에 이벤트가 도달하지 않아 효과가 없었음)

## 수정
- 검수 모드일 때만 autoEndplateLayer.listening(true) + 그룹 listening(true).
  검수 모드가 꺼지면 다시 false → 평소엔 오버레이가 클릭을 가로채지 않음.
- 검수 모드 중 폴리곤 그리기 차단은 그대로 유지.

## 검증
- 구문검사, 전체 빌드 통과. 브랜치 대비 누락 메서드 0개.

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Fix: enable listening on endplate layer so review corners are draggable"
  git push origin sagittal-measurements
  npm run deploy:preview
