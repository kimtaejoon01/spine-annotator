# 전처리 뷰 기능 추가 (표시 전용)

Lateral X-ray에서 어깨/견갑골에 가린 척추체를 보기 위한 실시간 전처리 뷰.
**원본 픽셀과 라벨 좌표는 절대 변경하지 않습니다(화면 표시만 변경).**

## 추가/변경 파일
- (신규) `public/static/preprocess.js` — 전처리 엔진
- (신규) `public/static/preprocess-ui.js` — 프리셋 툴바 + 파라미터 패널
- (수정) `public/static/annotator.js` — 원본 이미지 보관 + 처리 캔버스 적용 훅 + 이미지 로드 이벤트
- (수정) `public/static/app.js` — 전처리 UI 초기화 호출(import 1줄 + init 1줄)
- (수정) `public/static/style.css` — UI 스타일

## 동작
- 캔버스 상단에 프리셋 버튼 7개(원본/요추용/상부흉추용/최강조합/노이즈억제/경계표시/반전).
  활성 프리셋은 빨간 테두리 표시.
- 왼쪽 사이드바에 "전처리 뷰" 패널 — 활성 프리셋의 파라미터 슬라이더 + 리셋.
- 슬라이더는 디바운스(160ms) 후 실시간 반영.

## 구현 방식 (브라우저 전용, 명세서의 Python은 미사용)
- 가벼운 연산(Percentile Normalize / Gamma / Unsharp / Anisotropic Diffusion / Invert)은
  순수 JS로 구현 → 실시간.
- 무거운 연산(CLAHE / Canny)은 opencv.js(WASM)를 **지연 로딩**.
  해당 프리셋을 처음 누를 때만 다운로드되고(≈8MB, 브라우저 캐시), 이후 재사용.
  안 쓰면 로드되지 않아 평소 앱은 가벼움.
- 성능: 처리는 표시 해상도(긴 변 ≤1400px)로 다운스케일 + 디바운스 + 결과 캐시.
  (display 전용이라 다운스케일해도 라벨 좌표엔 영향 없음.)
- 처리 순서는 명세서 규칙 준수: normalize→gamma→clahe→unsharp→aniso→(canny|invert).

## 검증
- 순수 JS 연산(normalize/gamma/unsharp/aniso/invert) 단위 테스트 통과.
- 전체 `npm run build` 통과, 정적 에셋 배포 확인.
- (미검증) 실제 브라우저 렌더링/UX와 opencv.js 런타임 로드는 배포 후 눈으로 확인 필요.

## 아직 안 넣은 것 (원하면 추가)
- 척추체별 메타데이터(view_used/view_params/confidence/occluded_by):
  저장 직렬화(annotator의 폴리곤 serialize) 확장이 필요해 v2로 분리.
  현재 활성 뷰는 window.__spinePreprocess.view 로 참조 가능(추후 저장 배선용).
- 커스텀 뷰 저장(사용자 정의 순서/파라미터) — 선택 사항.
