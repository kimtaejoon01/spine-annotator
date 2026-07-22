# 검수 전용 페이지 추가 — /review

annotate 페이지는 그대로 두고, 검수용 페이지를 새로 만들었습니다.
접속: 배포 주소 뒤에 **/review** (예: https://<앱주소>/review)
헤더의 "라벨링으로" 버튼으로 annotate와 오갈 수 있습니다.

## 핵심: 테스트셋만 모여서 나옴
- [원본 폴더] + [예측 마스크 폴더] 두 개를 연결하면,
  **두 곳에 모두 존재하는 파일만** 왼쪽 목록에 나옵니다 = 사실상 테스트셋.
- 목록에 개수 표시 + 파일명 검색. ↑/↓ 키 또는 버튼으로 다음/이전 이미지 이동.

## 한 화면에서 같이 보기 (툴바 체크박스)
- **사람 폴리곤** — 사람이 라벨링한 폴리곤
- **AI 마스크** — 예측 마스크에서 추출한 추체 윤곽(청록)
- **자동측정(사람)** — 사람 폴리곤 기반 종판/각도
- **자동측정(AI)** — AI 마스크 기반 종판/각도
- **검수 모드(드래그)** — 종판 코너를 끌어서 교정

## 오른쪽 패널
- LL/TK/CL/T1 slope를 **사람 vs AI vs 차이**로 비교 (차이 5° 초과는 빨강 강조)
- 품질 요약(정상/확인/보정)과 추체 개수를 양쪽 모두 표시
- 추체별 메모 + 이미지 전체 메모, [검수 저장](서버) / [JSON]
- Ctrl+Z 로 코너 교정 되돌리기

## 알고리즘 전환
헤더의 v1/v2 선택으로 사람·AI 측정을 동시에 다시 계산합니다.

## 주의
- binary 마스크라 **붙어 있는 추체는 한 덩어리**로 잡힙니다.
  "AI 마스크" 체크로 분리 상태를 꼭 눈으로 확인하세요.
- AI 라벨은 위에서부터 순서대로 부여되므로 시작 라벨이 정확해야 합니다
  (사람 라벨의 start_label을 자동으로 따릅니다).

## 변경/추가 파일
- (신규) public/static/review-page.js
- (수정) src/index.tsx  — /review 라우트
- (포함) ai-measure.js, auto-endplate.js, auto-endplate-ui.js, annotator.js, style.css

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Add /review page: test-set only, human vs AI measurement with review tools"
  git push origin sagittal-measurements
  npm run deploy:preview
