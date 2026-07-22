# 자동 측정 v1 / v2 + 검증(품질) 알고리즘

## 1. 알고리즘 2종 선택
패널 상단 드롭다운에서 선택하며, 선택은 전역 저장됩니다.
- **v1 (4코너)** — 기존 방식. 앞/뒤 × 위/아래 4구역의 극단점을 코너로.
- **v2 (종판피팅)** — 상·하 끝 30% 구간의 점들을 모아 **주방향(PCA) 직선 피팅**.
  점이 많고 노이즈가 있을 때 극단점 하나에 휘둘리지 않아 더 안정적입니다.
  (오버레이·검수 호환을 위해 피팅된 그룹의 양 끝점을 4코너로 변환해 표시)

## 2. 검증 알고리즘 (C2 양옆 오인 등 자동 검출)
각 추체마다 3가지 이상 신호를 확인합니다.
- **이웃과 각도 급변**: 인접 추체 종판각 중앙값과 35° 이상 차이
- **척추축과 나란함**: 종판이 척추 진행축과 40° 미만으로 나란함
  → C2/압박골절 등에서 종판이 '양옆'으로 잡히는 경우가 여기 걸립니다
- **상·하 종판 모순**: 한 추체 안에서 상/하 기울기 차 40° 초과

판정:
- 신호 2개 이상 → **축보정(fallback)**: y축(수직) 기준으로 재계산
- 신호 1개 → **확인필요(review)**
- 0개 → 정상(ok)

## 3. 화면 표시
- 종판선 색: 정상=초록/주황, **확인필요=노랑**, **축보정=빨강**
- 패널에 요약: `정상 n · 확인필요 n · 축보정 n (v1|v2)`
- "의심 추체" 펼치기 → 추체별 사유 표시 (예: `C2(축보정: 이웃과 각도 급변, 척추축과 나란함)`)

## 4. 검증 결과 (합성 데이터 테스트)
- 정상 배열: 전부 ok
- 세로로 오인된 추체 삽입: 해당 추체가 **fallback**으로 검출 + 사유 표시 (v1/v2 모두)
- C2는 기존 특례(짧은 변을 전후축)로 정상 처리됨

## 변경 파일
- public/static/auto-endplate.js     (v2 피팅, 검증, computeSagittal)
- public/static/auto-endplate-ui.js  (알고리즘 선택, 품질 요약)
- public/static/annotator.js         (품질별 색상)
- public/static/style.css

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Add auto-measure v2 (endplate group fitting) and validation with quality flags"
  git push origin sagittal-measurements
  npm run deploy:preview
