# 전처리 뷰 — opencv 제거 / 순수 JS 전환 (프리즈 해결)

## 문제
- 요추용(CLAHE) 클릭 시 opencv.js(10MB WASM)를 메인 스레드에서 로드·컴파일하다
  화면이 멈춤("OpenCV 로딩 중"에서 프리즈).

## 해결
- opencv.js 의존성을 **완전히 제거**하고 CLAHE·Canny를 순수 JS로 직접 구현.
  → 10MB 다운로드/WASM 컴파일 없음, CDN/네트워크 문제 없음, 프리즈 없음.
- 무거운 Anisotropic Diffusion 프리셋(노이즈억제)은 처리 해상도를 더 낮춰(≤900px)
  프리즈를 방지. 각 단계 사이에 yield를 넣어 UI가 멈추지 않도록 함.
- 다크 테마 버튼 색상 수정 포함.

## 적용 (webapp 폴더)
  tar xzf <이 압축파일> -C .
  # 이전에 self-host로 넣었던 opencv.js가 있으면 삭제 (없으면 무시됨)
  Remove-Item public\static\opencv.js -ErrorAction SilentlyContinue
  git add -A
  git commit -m "Preprocessing: drop opencv.js, implement CLAHE/Canny in pure JS (fix freeze)"
  git push origin sagittal-measurements
  npm run deploy:preview

## 변경 파일
- public/static/preprocess.js (CLAHE/Canny 순수 JS, opencv 제거, aniso 경량화)
- public/static/style.css (다크 테마 색상)
- (삭제) public/static/opencv.js
