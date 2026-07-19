# 핫픽스 2 — 어제 드린 핫픽스 파일이 손상본이었습니다 (죄송합니다)

## 무슨 일이었나
- 어제 보낸 annotator.js는 1520줄짜리 '손상된' 파일이었습니다.
  zoomToFit / onWheel / updateStatus / setPanMode / zoomTo 등 다수 메서드가 빠져 있어
  - 이미지 로드 후 화면맞춤 실패 → 엉뚱하게 확대된 채로 표시
  - 휠 줌, 상태표시, 팬(스페이스), 줌 버튼 모두 에러
  - "이미지를 불러오는 중" 문구가 안 사라짐
  이 증상들이 전부 여기서 나왔습니다.

## 이번 파일 (1866줄, 정상본)
검증 내역:
- 브랜치 원본 대비 누락 메서드 **0개** (76개 전부 존재 + 신규 4개)
- 파일 내부 this.xxx() 호출 46개 전부 정의 확인
- 외부(app.js/landmark-tools/visibility 등) 호출 41개 전부 확인
  (deleteLandmark 등 6개는 landmark-tools.js가 런타임 주입하는 것으로 정상)
- node 구문검사 + 전체 vite 빌드 통과

## 포함 기능 (그대로 유지)
FH 2클릭 원, E 취소, 더블클릭 완성 제거, 자동종판 오버레이(줌 유지/점 크기 고정),
검수 모드(코너 드래그·2색 비교), 랜드마크 모드 폴리곤 숨김.

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Hotfix2: restore complete annotator.js (previous hotfix was truncated)"
  git push origin sagittal-measurements
  npm run deploy:preview
