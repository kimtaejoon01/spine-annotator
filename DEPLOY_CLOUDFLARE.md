# Cloudflare 직접 배포 가이드

이 프로젝트는 Cloudflare Pages Functions + D1 기준으로 배포합니다.

## 0. 준비

- Node.js 20 이상 권장
- Cloudflare 계정
- 이 폴더(`webapp`)에서 명령 실행

```bash
npm install
npm run build
```

## 1. 로컬 개발 비밀번호 설정

운영 보안을 위해 코드 안의 기본 비밀번호는 제거했습니다. 로컬에서도 `.dev.vars`가 필요합니다.

```bash
cp .dev.vars.example .dev.vars
# .dev.vars 파일에서 AUTH_PASSWORD를 원하는 값으로 수정
npm run dev
```

## 2. Cloudflare 로그인

```bash
npx wrangler login
```

## 3. D1 데이터베이스 생성

```bash
npx wrangler d1 create spine-annotator-production
```

명령 결과에 나오는 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 복사합니다.

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "spine-annotator-production",
    "database_id": "여기에_실제_database_id"
  }
]
```

## 4. 운영 DB 마이그레이션

```bash
npm run db:migrate:remote
```

기존 Genspark D1 데이터가 있다면, 먼저 raw export JSON으로 백업한 뒤 별도 import 스크립트를 만들어 옮기는 방식이 안전합니다.

## 5. Pages 프로젝트 생성 및 secret 설정

처음 한 번만 프로젝트를 만듭니다.

```bash
npx wrangler pages project create spine-annotator --production-branch main
npm run secret:auth
```

`npm run secret:auth` 실행 후 사용할 공유 비밀번호를 입력합니다.

## 6. 배포

```bash
npm run deploy
```

배포 후 출력되는 `*.pages.dev` 주소에서 `/annotate`로 접속합니다.

## 7. 배포 후 점검

1. `/annotate` 접속
2. 설정한 비밀번호로 로그인
3. 라벨러 선택
4. 샘플 또는 로컬 폴더로 이미지 로드
5. 폴리곤 1개 생성 후 자동 저장 확인
6. 새로고침 후 라벨이 복원되는지 확인
7. 전체 내보내기에서 COCO JSON 다운로드 확인

## 8. 주의사항

- 파일명에 환자 식별자가 포함되어 있으면 D1에 저장됩니다. 배포 전 파일명을 익명화하는 것을 권장합니다.
- 이 앱은 현재 이미지를 서버에 업로드하지 않고, 라벨 JSON과 파일명만 D1에 저장합니다.
- 여러 사람이 같은 파일을 동시에 수정하면 이제 `version` 충돌을 감지해 마지막 저장이 조용히 덮어쓰는 문제를 줄입니다.
