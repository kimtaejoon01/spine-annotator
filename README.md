# Spine Annotator - 척추 X-ray 폴리곤 라벨링 앱

## 프로젝트 개요
- **Name**: Spine Annotator
- **Goal**: Whole spine X-ray 이미지에 척추체(vertebral body)를 폴리곤으로 라벨링하는 웹앱.
  의료 영상 segmentation 모델 학습용 GT 데이터셋(COCO 포맷) 생성.
- **Target Users**: 박성배 교수님 연구실 (3명) — 박성배, 김태준, 황회진

## 🆕 Phase 2.1 — 실시간 협업 (2026-06-02 추가)

- **🔄 실시간 자동 동기화 (5초 주기)**
  - 다른 컴퓨터/팀원이 저장한 라벨이 5초 이내에 내 파일 목록에도 반영됨
  - 새로고침 필요 없음
  - `/api/sync` 통합 엔드포인트로 라벨 메타 + presence 한 번에
- **👥 실시간 작업자 표시 (Presence)**
  - 누가 지금 어느 파일을 보고 있는지 파일 목록에 라벨러 색상 점으로 표시 (pulse 애니메이션)
  - 5초마다 heartbeat → 30초 동안 신호 없으면 자동 만료
  - 페이지 닫을 때 sendBeacon으로 즉시 정리
- **⚠️ 동시 편집 충돌 경고 배너**
  - 내가 작업 중인 파일을 다른 사람도 열면 상단에 노란 배너 표시
  - 누가 함께 보고 있는지 라벨러 이름 + 색상 점 표시
- **🔃 원격 변경 자동/수동 반영**
  - 내가 작업 안 한 파일을 다른 사람이 저장 → 토스트 + 자동 갱신
  - 내가 폴리곤 그리는 중 → "최신 불러오기" 버튼 토스트 (덮어쓰기 방지)
- **⏸️ 백그라운드 탭 절약**
  - 다른 탭으로 전환 시 폴링 자동 중지, 돌아오면 즉시 한 번 동기화 후 재개

## Phase 2 (서버 저장소 + 인증)

### ✅ 완료된 신규 기능 (2026-06-02)
- **🗄️ Cloudflare D1 서버 저장**
  - 모든 라벨이 D1 DB에 영구 보관 → 브라우저 캐시 비워도 안전
  - 컴퓨터를 바꿔도 같은 라벨 데이터 접근 가능
  - 마지막 수정자(`labeler_id`)와 수정 시각 자동 기록
- **🔐 공유 비밀번호 인증**
  - 첫 접속 시 비밀번호 입력 모달 표시
  - `X-Auth-Token` 헤더로 모든 API 호출 보호
  - 비밀번호는 브라우저(localStorage)에 기억됨 — 한 번만 입력
  - **기본 비밀번호 없음** — 운영/로컬 모두 `AUTH_PASSWORD` 설정 필요
- **📦 일괄 내보내기 (전체 내보내기 버튼)**
  - 한 번에 모든 라벨을 다운로드
  - 필터: 형식(COCO/Raw), 뷰(AP/LAT/전체), 라벨러(개별/전체), 최소 폴리곤 수(완성된 25개만)
  - 통계 미리보기 (총 개수, 라벨러별, 뷰별)
- **🔁 자동 마이그레이션 헬퍼**
  - LocalStorage에 남아있던 기존 라벨을 서버로 이관하는 헬퍼 내장 (`api.js`의 `migrateLegacyLabels`)
- **💾 오프라인 캐시 + 재전송 큐**
  - 서버 통신 실패 시 LocalStorage에 임시 저장
  - 네트워크 복구되면 자동 재전송

### ✅ Phase 1 기능 (유지)
- Konva.js 폴리곤 그리기/편집/삭제, 자동 순서 라벨링 (C1~S1)
- 줌/팬, 밝기/대비/색반전, Undo/Redo (50단계)
- 파일 업로드 (PNG/JPG) + 파일명 자동 파싱 (`{PID}_{YYYYMMDD}_{AP|LAT}.png`)
- File System Access API 로컬 폴더 연결
- 단축키 설정 (기본 IOP 도구 / QWE 그리기 동작)
- 사용 매뉴얼 페이지 (`/manual`)
- 라벨러 시스템 (박성배/김태준/황회진, 사람별 색상 점)

### 🚧 미구현 (Phase 3+)
- R2 이미지 업로드 (현재는 로컬 폴더 연결 또는 단일 파일 업로드만)
- 교수님 검수 워크플로우 (승인/반려, 코멘트)
- 이미지 잠금 (동시 편집 방지)
- 진행률 대시보드 (라벨러별 진척도)

## URLs
- **Production**: <https://21182b24-1fd9-44b3-8955-b053e80a31c4.vip.gensparksite.com/annotate>
  - ⚠️ 새 URL입니다. 기존 `spine-annotator.pages.dev`는 더 이상 업데이트 안 됨
  - Genspark 호스팅 Cloudflare Workers for Platform (D1 포함)
- **Local Dev**: http://localhost:3000/annotate
- **Routes**:
  - `GET /` → `/annotate` 리다이렉트
  - `GET /annotate` → 라벨링 화면
  - `GET /manual` → 사용 매뉴얼

## API 엔드포인트 (인증 필요 — `X-Auth-Token` 헤더)

| Method | Path | 용도 |
|--------|------|------|
| POST | `/api/auth/check` | 비밀번호 검증 (인증 불필요) |
| GET | `/api/labels` | 모든 라벨 메타 목록 (filename, view, labeler, polygon_count, updated_at) |
| GET | `/api/labels/:filename` | 단일 파일 라벨 전체 (polygons 포함) |
| PUT | `/api/labels/:filename` | 라벨 저장/덮어쓰기 (upsert + version 증가) |
| DELETE | `/api/labels/:filename` | 라벨 삭제 |
| GET | `/api/export?format=coco\|raw&view=AP\|LAT&labeler=park\|kim\|hwang&min_polygons=N` | 일괄 내보내기 |
| GET | `/api/stats` | 라벨러별/뷰별 통계 |
| GET | `/api/sync?since=<ISO>` | 통합 동기화 (labels + presence 한 번에) |
| PUT | `/api/presence` | 현재 작업 중 파일 heartbeat (5초마다) |
| DELETE | `/api/presence` | 작업 종료 / 탭 닫기 신호 |

## 사용 방법

### 첫 접속
1. 위 Production URL로 접속
2. 비밀번호 입력 모달이 뜨면 배포 시 설정한 `AUTH_PASSWORD` 입력 → "입장"
3. 우측 상단 "라벨러 선택" 클릭 → 본인(박성배/김태준/황회진) 선택
4. 작업 시작

### 폴더 단위 작업 (700장 데이터셋용)
1. **"폴더 연결"** → 척추 X-ray 폴더 선택
2. 좌측 파일 목록에서 파일 클릭 → 캔버스에 로드
3. 시작 척추뼈 선택 → 폴리곤 그리기 (점 클릭, Enter로 완성)
4. 자동 저장 (서버 D1으로 전송) — 우측 "자동 저장됨" 표시
5. 다른 파일 클릭 → 작업한 라벨은 서버에서 자동 복원

### 일괄 내보내기 (전체 데이터셋 추출)
1. 헤더의 **"전체 내보내기"** 버튼 클릭
2. 필터 선택 (COCO 추천, AP/LAT/완성된 것만 등)
3. "통계 갱신"으로 현재 상황 확인
4. "다운로드" → `spine-annotations-{filter}-{date}.json` 파일 저장

### 비밀번호 설정/변경 방법 (관리자)
```bash
# Cloudflare Pages secret 설정/변경
npm run secret:auth

# 로컬 개발용
cp .dev.vars.example .dev.vars
# .dev.vars 안의 AUTH_PASSWORD 값을 원하는 비밀번호로 수정
```

## 데이터 구조

### D1 Schema
**`migrations/0001_initial_schema.sql`** — 라벨 본체
```sql
CREATE TABLE labels (
  filename TEXT PRIMARY KEY,
  view_type TEXT,         -- AP | LAT
  start_label TEXT,        -- C1~S1
  polygons_json TEXT,      -- JSON 배열
  labeler_id TEXT,         -- park | kim | hwang
  polygon_count INTEGER,
  updated_at TEXT,         -- ISO timestamp
  created_at TEXT,
  version INTEGER          -- 저장할 때마다 +1
);
-- 인덱스: by labeler, view, updated_at DESC
```

**`migrations/0002_presence.sql`** — 실시간 작업자 추적
```sql
CREATE TABLE presence (
  labeler_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  last_seen TEXT NOT NULL,   -- ISO timestamp, 5초마다 heartbeat
  PRIMARY KEY (labeler_id, filename)
);
-- 30초 동안 heartbeat 없으면 만료
```

### Polygon (내부 표현)
```js
{ id: 1, label: "C2", points: [x1,y1,x2,y2,...] }
```

### COCO 출력
```js
{
  info: { description, version, date_created, filters },
  images: [{ id, file_name, width, height }],
  categories: [{ id: 1, name: "C1", supercategory: "vertebra" }, ...], // 25개
  annotations: [{ id, image_id, category_id, segmentation, bbox, area, iscrowd: 0 }]
}
```

## 기술 스택
- **Frontend**: Konva.js 9.3.6 + Vanilla JS ES modules + FontAwesome
- **Backend**: Hono 4 (TypeScript, Cloudflare Workers)
- **Storage**: Cloudflare D1 (SQLite, 영구)
- **Local cache**: LocalStorage (오프라인 fallback + 재전송 큐)
- **Build**: Vite + @hono/vite-cloudflare-pages
- **Hosting**: Genspark-managed Cloudflare Workers for Platform

## 라벨 정의 (25개)
- **Cervical**: C1, C2, C3, C4, C5, C6, C7 (빨강)
- **Thoracic**: T1~T12 (노랑)
- **Lumbar**: L1, L2, L3, L4, L5 (파랑)
- **Sacrum**: S1 (보라)

## 라벨러 정의 (3명, 색상별)
- 박성배 교수님 (`park`): 골드 `#f0b35e`
- 김태준 (`kim`): 블루 `#4f9ef8`
- 황회진 (`hwang`): 퍼플 `#d18ce8`

## 개발 명령
```bash
npm install                       # 의존성 설치
npm run build                     # 프로덕션 빌드 → dist/
npx wrangler d1 migrations apply spine-annotator-production --local  # 로컬 D1 마이그레이션
pm2 start ecosystem.config.cjs    # 로컬 서버 시작
pm2 logs spine-annotator --nostream # 로그 확인
npm run db:migrate:local          # 로컬 D1 마이그레이션
npm run db:migrate:remote         # 운영 D1 마이그레이션
npm run secret:auth               # 운영 AUTH_PASSWORD secret 설정
npm run deploy                    # Cloudflare Pages 배포
```

## Deployment
- **Platform**: Cloudflare Pages Functions + D1
- **Status**: 직접 배포 필요
- **Project name**: `spine-annotator` 권장
- **D1 Database**: `spine-annotator-production` 권장
- 자세한 절차는 `DEPLOY_CLOUDFLARE.md` 참고
