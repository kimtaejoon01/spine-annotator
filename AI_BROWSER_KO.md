# Spine Annotator 안에서 AI 분석

Annotator 상단 **AI 자동 분석**을 누르면 같은 사이트의 `/ai-web/` 페이지가 열립니다. 영상이 열려 있으면 현재 영상을 전달하며, 빈 상태에서는 분석 페이지에서 파일을 선택할 수 있습니다. 터미널, Python 설치, 로컬 서버 주소 입력은 필요하지 않습니다.

1. **모델 폴더 선택**에서 브라우저용 변환 결과 폴더를 선택합니다. 또는 사이트에 준비된 **기본 모델 불러오기**를 누릅니다.
2. **모델 불러오기**를 누릅니다. 처음에는 실행 환경을 다운로드하고 각 모델의 출력값을 확인합니다.
3. LAT X-ray를 선택하면 척추 A 분할 → 파편 제거/watershed → 번호 → v1/v2 꼭지점 → S1 → 대퇴골두/HC 순으로 분석합니다.
4. 원본 옆에 결과를 표시합니다. L5를 선택해 S1만 다시 계산하거나 v1/v2·표시 구조를 바꿀 수 있습니다.
5. **Annotator 편집 라벨로 적용** 또는 결과 ZIP/좌표 JSON 다운로드를 누릅니다. 기존 편집 라벨 교체에는 확인창이 표시되고 Ctrl+Z로 되돌릴 수 있습니다.

영상과 가중치는 추론 서버에 전송하지 않습니다. 계산은 Web Worker 안의 ONNX Runtime Web + Pyodide에서 실행합니다. 런타임/과학 연산 패키지는 고정 버전 CDN에서 내려받습니다. 모델 저장을 선택하면 모델 파일만 이 사이트의 IndexedDB에 보관합니다. 브라우저 데이터 삭제 시 없어질 수 있습니다. 영상과 결과는 페이지 메모리에만 두며 결과 다운로드는 사용자가 선택합니다.

GPU 사용 가능 여부를 확인하고, 연산 미지원/수치 검증 실패 단계는 CPU로 전환합니다. 번호의 RoiAlign/GRU는 CPU에서 실행합니다. GPU에서 실행할 수 없는 컴퓨터에서도 CPU 추론을 시도하지만 전체 X-ray와 여러 모델은 메모리와 시간이 필요합니다. **실행 중단**은 워커를 종료하며 다시 실행하려면 모델을 다시 불러와야 합니다. 영상은 32 MB/3,200만 화소 이하의 PNG/JPEG/단일 TIFF/BMP를 지원합니다. EXIF 자동 회전을 적용하지 않은 원본 좌표를 사용합니다.

## 학습 가중치 준비 (한 번만)

기존 `.pt/.pth`는 그대로 브라우저에서 실행하지 못합니다. 모델 소유자가 Colab 또는 학습 컴퓨터에서 한 번 ONNX로 변환해야 합니다. 페이지의 **모델 준비 안내**에 [Colab 변환 노트북](public/ai-web/export_browser.ipynb)이 있습니다.

개인 모델 경로는 `spine_browser_model_paths.json`에 보관합니다. 이 설정 파일을 변환 노트북에서 처음 한 번 선택하면 Drive 최상위 폴더에 저장하고 다음 실행부터 재사용합니다. 네 모델 경로 키는 `NUMBER_RUN`, `A_RUN`, `S1_BUNDLE`, `FH_RUN`입니다. 학습 가중치 자체를 ChatGPT에 다시 첨부할 필요 없이 Drive를 연결한 Colab에서 변환합니다. 설정 파일은 공개 GitHub에 올리지 않습니다.

GitHub에서 코드를 받을 때는 `codex/integrated-ai-app` 브랜치를 사용합니다:

```bash
git fetch origin
git switch codex/integrated-ai-app
git pull --ff-only origin codex/integrated-ai-app
npm ci
npm run build
```

이후 기존 웹앱 배포 절차로 `dist`를 배포하면 같은 사이트의 `/ai-web/` 페이지가 제공됩니다. 기본 브랜치에서 `git pull`만 하는 경우에는 이 작업 브랜치의 변경이 포함되지 않습니다. 모델은 Colab에서 변환한 폴더를 해당 페이지에서 선택합니다.

CLI로 변환할 경우:

```bash
python -m pip install -r ai_server/browser-export-requirements.txt
python -m ai_server.export_browser --number NUMBER_RUN --a A_RUN --s1 S1_BUNDLE --fh FH_RUN --output NEW_OUTPUT_DIR
```

- 번호: `shared_mobilenet_roi_best.pt`, `shared_mobilenet_roi_config.json`, `geometry_scaler.joblib`
- A: 실제 `A_*` 실행 폴더의 `config.json`, `checkpoints/*_best.pth`
- S1: `final_bundle/bundle.json`, `weights.pt`, `prior.json` 등 원본 bundle 전체
- 대퇴골두: `coarse_best.pt`, `fine_best.pt`, `config.json`, `selected_threshold.json`

학습 결과는 읽기만 하며 새 출력 폴더가 이미 있으면 변환을 중단합니다. 재학습하지 않습니다. A의 EMA 선택·TTA, 모델별 전처리, 파편 제거/watershed, S1 prior, 골두 원 피팅/HC 보류 정책을 유지합니다. 번호 후보가 23개를 넘으면 전체 후보에 raw 번호를 표시합니다. 원본 GT 없이 정확도나 정답/오답 색은 표시하지 않습니다.

변환기는 6개 ONNX 그래프와 설정, 출력 검증용 NPZ를 만듭니다. 번호 모델은 가변 후보 1/8/23/26개를 비교합니다. 모든 그래프의 PyTorch ↔ ONNX CPU 값이 허용 오차 안에 들어갈 때만 manifest를 생성합니다. 브라우저도 각 단계 출력값을 다시 비교하고 불일치하면 준비 완료로 표시하지 않습니다. 이 검사는 임상 성능을 보장하지 않습니다.

## 웹사이트에 기본 모델 포함

현재 저장소에 실제 학습 가중치는 없습니다. 변환 결과를 사이트의 `/ai-models/default/manifest.json` 및 같은 경로의 모델 파일로 제공하면 **기본 모델 불러오기**가 활성화됩니다. 공개 URL로 제공한 모델은 방문자가 다운로드할 수 있습니다. 로컬 폴더 선택은 모델 공개 없이 동작합니다.

[Cloudflare Pages의 단일 파일 한도는 25 MiB](https://developers.cloudflare.com/pages/platform/limits/#file-size)입니다. 기본 모델을 제공하려면 같은 도메인의 `/ai-models/default/*`를 객체 저장소 등으로 연결하여 제공하세요. 가중치를 Git에 커밋하지 않습니다. 현재 모델 크기는 여러 개의 수십~수백 MB 수준일 수 있으므로 단순 public 폴더 복사 후 Pages 빌드만으로 모든 가중치를 배포했다고 간주하면 안 됩니다.

현재 소스 변경만으로 운영 웹사이트가 갱신되지는 않습니다. 해당 배포 브랜치에 병합하고 기존 호스팅 배포 과정을 거쳐야 `/ai-web/`이 열립니다. 기존 Python 실행 앱 `/ai/`와 `start_ai.*`는 별도로 남아 있습니다.

## 개발 검증

`npm test`, `npm run build`, `python tools/build_browser_ops.py`. 마지막 명령은 원본 코드에서 검토된 순수 연산을 복사해 브라우저 배포 파일을 생성합니다. 모델 묶음에서 Python/JavaScript를 읽어 실행하지 않습니다.

실제 모델 구조에 무작위 가중치를 넣은 ONNX 변환·수치 검증과 합성 입력 검증은 학습 가중치 및 실제 X-ray 평가와 구분합니다. 실제 학습 가중치가 준비되면 변환 후 대표 영상을 원본 Python 추론과 비교해야 합니다.

### 이번 변경에서 확인한 범위

- 기존 검사 포함 Node 테스트 24개와 웹앱 빌드 통과.
- 실제 모델 구조에 무작위 가중치를 넣고 6개 그래프 변환 및 원본 PyTorch ↔ ONNX CPU 비교 통과. 번호는 후보 1/8/23/26개를 확인했습니다.
- 동일 그래프를 실제 Pyodide 및 ONNX Runtime Web WASM으로 실행하여 6개 출력 비교 통과.
- 합성 영상으로 전체 파이프라인, 전방 반전 꼭지점, 수동 L5 → S1 재계산, PNG 및 ZIP 생성 통과.
- DOM 환경에서 모델 선택/불러오기, 영상 선택, 결과 표시, 실행 중단 후 상태 복구 확인.
- 실제 학습 가중치, WebGPU 하드웨어, 전체 브라우저 화면 렌더링 검증은 아직 하지 못했습니다. 이 환경의 Chromium 다운로드가 실패했습니다.
