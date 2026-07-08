# 폴리곤 자동 측정 기능 (랜드마크 불필요)

폴리곤만으로 각 추체의 상/하 종판을 자동 추정해 sagittal 각도를 계산합니다.
(Genspark Python 스크립트의 브라우저 JS 포팅. 원본 픽셀/라벨 좌표 불변.)

## 동작
- 왼쪽 사이드바 "폴리곤 자동 측정" 패널 → [자동 측정 실행]
- 계산: LL(요추전만), TK(흉추후만), CL(경추만곡), T1 slope,
  분절 각(seg), 추체 쐐기각(wedge).
- 캔버스에 상종판(초록)·하종판(주황)·4코너 점 오버레이 (체크박스로 on/off).
- [CSV] 버튼으로 결과 내보내기.

## 알고리즘 (파이썬과 동일)
- minAreaRect(회전 캘리퍼스)로 종판 방향축 추정 → 앞/뒤×상/하 4구역 극단점을
  코너(SA/SP/IA/IP)로 선택 → 상/하 종판 독립(쐐기/사다리꼴 표현 가능).
- Cobb각 = 두 종판 벡터 사이 각(≤90로 접음).
- 기본 범위: LL L1–L5, TK T4–T12, CL C2–C7 (auto-endplate.js DEFAULT_RANGES에서 조정).
- 보정 1곳: T1 slope는 임상 관례대로 [0,90]로 접음(수평=0). 파이썬 원본은 180 근처로 나왔음.

## 이 패키지에 포함 (전처리 최신본도 함께)
- (신규) auto-endplate.js, auto-endplate-ui.js
- (신규/최신) preprocess.js  ← opencv 제거·순수 JS CLAHE/Canny (프리즈 해결본)
- (신규) preprocess-ui.js
- (수정) annotator.js  ← 전처리 캔버스 훅 + 자동측정 오버레이
- (수정) app.js        ← 두 UI 초기화
- (수정) style.css     ← 두 기능 스타일

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  Remove-Item public\static\opencv.js -ErrorAction SilentlyContinue
  git add -A
  git commit -m "Add polygon-based auto endplate measurement; native-JS preprocessing"
  git push origin sagittal-measurements
  npm run deploy:preview

## 검증
- 기하 엔진(minAreaRect/4코너/Cobb/slope) 단위 테스트 통과
  (수평=0°, 10°기울기=10°, LL 30°, 쐐기 0° 등).
- 전체 빌드 통과. (오버레이/패널의 실제 렌더링은 배포 후 눈으로 확인 권장.)

## 참고
- 이 자동 측정은 랜드마크 기반 측정 패널과 별개로 동작합니다(공존 가능).
- 폴리곤 라벨(C2..L5)이 정확해야 각 범위 계산이 맞습니다.
