> 기본 Annotator 연결 버튼은 이제 같은 사이트의 브라우저 분석 페이지를 엽니다. 설치 없는 사용법은 [AI_BROWSER_KO.md](AI_BROWSER_KO.md)를 보세요. 아래는 별도 Python 앱 실행 안내입니다.

# Spine Annotator 통합 AI 앱

X-ray 파일을 올리면 **A 척추 분할 → 파편 제거/watershed → 번호 → Annotator v1/v2 꼭지점 → 예측 L5 기반 S1 상종판 → 대퇴골두 분할/원/중심**이 실행됩니다. Python 추론 서버가 제공하는 별도 브라우저 앱입니다.

## 실행

1. Python 3.10 이상이 설치된 컴퓨터에 이 저장소를 내려받습니다. 학습된 모델 폴더도 이 컴퓨터에 복사하거나, 이 컴퓨터에서 접근 가능한 Drive/디스크 경로에 둡니다.
2. Windows는 `start_ai.bat`, macOS/Linux는 저장소 폴더에서 `bash start_ai.command`를 실행합니다. 처음에는 PyTorch 등 의존성을 설치하므로 시간이 걸립니다. 이후에는 설치를 건너뜁니다.
3. 자동으로 열린 앱에서 **모델 설정 → 모델 폴더 4개 지정 → 모델 불러오기 → X-ray 업로드** 순서로 사용합니다. 연결 코드가 필요하면 실행 창에 표시된 코드를 입력합니다.

기본 앱 주소는 `http://127.0.0.1:8765/ai/`입니다. CUDA GPU가 있으면 우선 사용하며 CPU에서도 실행할 수 있습니다. macOS는 현재 CPU를 사용합니다. 종료는 실행 창에서 Ctrl+C입니다.

### 모델 폴더

| 종류 | 폴더에 필요한 파일 |
|---|---|
| 척추 번호 | `shared_mobilenet_roi_best.pt`, `shared_mobilenet_roi_config.json`, `geometry_scaler.joblib` |
| A 분할 | A 실행 폴더의 `config.json`, `checkpoints/*_best.pth` |
| S1 | `final_bundle` 안의 `bundle.json`, `weights.pt`, `prior.json`, `s1_predict.py` |
| 골두 | 같은 실행 폴더의 `coarse_best.pt`, `fine_best.pt`, `config.json`, `selected_threshold.json` |

기존 seed41 A 경로와 S1/FH 학습 경로를 자동 검색 기본값으로 사용합니다. `/content/drive/...` 경로는 Colab에서만 유효하므로 로컬 실행 시 실제 복사한 경로를 입력하세요. 모델 선택은 다음 실행에도 유지됩니다. 가중치와 원본 학습 결과에는 쓰지 않습니다.

## Annotator 연결

기본 Annotator의 AI 버튼은 이제 같은 사이트의 [브라우저 분석 페이지](AI_BROWSER_KO.md)로 연결됩니다. 이 Python 앱은 독립 분석·결과 다운로드 용도로 유지합니다.

## S1 · 골두

- S1은 예측 L5가 하나일 때 자동 계산합니다. 없거나 중복이면 후보를 선택해 S1만 다시 실행합니다. 유일한 L5 예측이 틀린 경우도 다른 후보를 직접 선택할 수 있습니다.
- 화면의 전방 방향을 기준으로 SA/SP/IA/IP 및 S1 앞/뒤 끝점을 적용합니다. 방향을 변경하면 다시 분석해야 합니다. v1/v2 및 표시 체크박스 변경에는 모델 재실행이 없습니다.
- 대퇴골두의 실제 분할 윤곽과 피팅 원을 구분합니다. FH1/FH2는 좌우 해부학적 구분이 아닙니다. 기존 모델의 검토 사유와 HC 보류 규칙을 유지합니다.
- 번호/꼭지점/S1/HC가 기존 앱 랜드마크로 들어가므로 기존 시상면 측정 패널이 이를 사용할 수 있습니다. 지표의 계산식은 이번 변경에서 수정하지 않았습니다.

## 저장 · 서버

결과 ZIP에는 원본 좌표 JSON, v1/v2 좌표 엑셀/CSV, 전체 해상도 오버레이, A 이진 마스크, watershed instance 마스크, 골두 마스크가 들어 있습니다. 원본 X-ray 자체는 ZIP에 넣지 않습니다.

서버 설정·최근 분석 캐시는 기본적으로 `~/.spine-annotator-ai`에 저장합니다. 한 번의 서버 실행에서 최근 10개 작업을 유지하며 오래된 작업 캐시는 정리됩니다. 필요한 결과는 ZIP으로 내려받으세요. 재시작 전 실행에서 남은 캐시는 종료 후 `sessions`, `incoming`, `pending` 폴더를 삭제해 정리할 수 있으며 모델 원본은 별도로 유지됩니다. `SPINE_AI_DATA` 환경변수로 캐시 위치를 바꿀 수 있습니다.

Python 모델은 Cloudflare Worker에서 실행하지 않습니다. 기존 웹앱 배포와 추론 서버 실행이 각각 필요합니다. 다른 GPU 서버를 사용할 경우 그 서버에 Python 앱과 모델을 놓고, 인증 코드와 HTTPS 주소를 설정한 뒤 해당 서버의 `/ai/` 페이지를 여세요. 기본 실행은 로컬 루프백만 수신합니다. API는 연결 코드 인증을 사용하며 원본 영상은 사용자가 지정한 추론 서버로만 전달합니다.

개발 실행:

```bash
python -m pip install -r ai_server/requirements.txt
python -m ai_server
```

검증: `npm test`, `npm run build`, `python -m unittest discover -s ai_server/tests`. Python 서비스 테스트는 FastAPI/httpx와 합성 모델을 사용합니다. 실제 학습 가중치를 이용한 GPU 추론·임상 성능은 별도로 확인해야 합니다. 실제 가중치는 저장소에 포함하지 않습니다.
