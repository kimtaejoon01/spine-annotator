# 검수 페이지: 스페이스 화면이동 복구 + 폴더 연결 기억

## 1. 스페이스+드래그 화면 이동이 안 되던 문제
- 원인: readOnly 때문이 아니라, 검수 페이지에 **스페이스 키 핸들러 자체가 없었습니다**
  (라벨링 페이지에만 있었음).
- 수정: 검수 페이지에도 스페이스 누름/뗌 처리를 추가했습니다.
  누르는 동안 팬 모드(커서 손모양), 떼면 해제. 휠 줌은 기존대로 동작.
- readOnly는 '그리기/편집'만 막고 팬·줌은 막지 않습니다(확인 완료).

## 2. 폴더 연결이 기억되지 않던 문제
- 원인: 라벨링 페이지는 폴더 핸들을 IndexedDB에 저장하는데,
  검수 페이지는 저장 없이 매번 새로 고르게 되어 있었습니다.
  (게다가 기존 저장 함수는 키가 1개뿐이라 폴더 2개를 따로 못 담았음)
- 수정:
  - fs.js에 **키를 지정해 저장/복원**하는 함수 추가(pickFolderAs/restoreFolderAs)
  - 검수 페이지가 원본 폴더와 마스크 폴더를 각각 저장 → 다음에 들어오면 자동 복원
  - 브라우저가 권한을 다시 요구하는 경우, 해당 버튼이 주황색으로 표시되며
    한 번 누르면 권한 허용 후 바로 목록이 뜹니다(폴더를 다시 찾을 필요 없음)

## 변경 파일
- public/static/review-page.js
- public/static/fs.js
- public/static/style.css

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Review page: restore space-pan and remember connected folders"
  git push origin sagittal-measurements
  npm run deploy:preview
