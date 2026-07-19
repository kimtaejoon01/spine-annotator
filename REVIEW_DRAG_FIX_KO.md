# 검수 모드에서 코너 드래그가 안 되던 문제 수정

## 원인
- 검수 모드에서도 '그리기' 도구가 그대로 살아 있어서, 코너를 잡으려고 누르면
  그 클릭이 폴리곤 점 추가로도 처리됨 → 드래그가 방해받고 점만 찍힘.

## 수정
- 검수 모드가 켜져 있는 동안에는 캔버스 클릭이 폴리곤 그리기로 가지 않도록 차단.
  (검수 모드 = 코너 교정 전용 모드)
- 코너 노드에 식별 속성(endplateCorner)을 달아, 코너를 클릭한 경우에도 그리기 차단.
- 커서 표시(grab) 유지.

## 사용법
1. [자동 측정 실행]
2. "검수 모드" 체크 → 이때는 폴리곤이 그려지지 않고 코너만 드래그됩니다.
3. 코너를 끌어 교정 → 파란 선(검수본)으로 표시, 각도표 갱신
4. 검수 끝나면 체크 해제 → 다시 평소처럼 폴리곤 그리기 가능

## 검증
- 브랜치 대비 누락 메서드 0개(전체 파리티 확인), 구문검사·전체 빌드 통과.

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Fix: block polygon drawing while endplate review mode is active"
  git push origin sagittal-measurements
  npm run deploy:preview
