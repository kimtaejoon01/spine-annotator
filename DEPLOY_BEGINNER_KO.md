# Spine Annotator 초보자용 Cloudflare 배포 가이드

이 가이드는 `spine-annotator-patched.tar.gz`를 Cloudflare Pages + D1에 배포하는 절차입니다.

## 준비물

1. Cloudflare 계정
2. Node.js 20 이상
3. 터미널 또는 VS Code Terminal
4. 이 프로젝트 압축 파일: `spine-annotator-patched.tar.gz`

## 1단계: 압축 풀기

압축 파일이 다운로드 폴더에 있다고 가정합니다.

### Mac / Linux

```bash
cd ~/Downloads
tar -xzf spine-annotator-patched.tar.gz
cd webapp
```

### Windows PowerShell

```powershell
cd $HOME\Downloads
tar -xzf spine-annotator-patched.tar.gz
cd webapp
```

## 2단계: 의존성 설치와 빌드 확인

```bash
npm install
npm run build
```

여기서 에러가 없으면 다음으로 넘어갑니다.

## 3단계: Cloudflare 로그인

```bash
npx wrangler login
```

브라우저가 열리면 Cloudflare에 로그인하고 허용합니다.

로그인 확인:

```bash
npx wrangler whoami
```

## 4단계: D1 데이터베이스 만들기

```bash
npx wrangler d1 create spine-annotator-production
```

실행 후 이런 결과가 나옵니다.

```text
[[d1_databases]]
binding = "DB"
database_name = "spine-annotator-production"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

여기서 `database_id` 값을 복사합니다.

## 5단계: wrangler.jsonc에 database_id 넣기

`webapp/wrangler.jsonc` 파일을 열어서 아래 값을 바꿉니다.

변경 전:

```jsonc
"database_id": "REPLACE_WITH_D1_DATABASE_ID"
```

변경 후 예시:

```jsonc
"database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## 6단계: DB 테이블 만들기

```bash
npm run db:migrate:remote
```

## 7단계: Pages 프로젝트 만들기

```bash
npx wrangler pages project create spine-annotator --production-branch main
```

이미 존재한다고 나오면 괜찮습니다. 다음 단계로 넘어가면 됩니다.

## 8단계: 로그인 비밀번호 설정

```bash
npm run secret:auth
```

비밀번호를 입력하라고 나오면 앱 접속에 사용할 비밀번호를 입력합니다.

예: `내가정한비밀번호123!`

## 9단계: 배포

```bash
npm run deploy
```

마지막에 이런 주소가 나옵니다.

```text
https://spine-annotator.pages.dev
```

접속은 보통 아래 주소로 하면 됩니다.

```text
https://spine-annotator.pages.dev/annotate
```

## 10단계: 배포 후 확인

1. `/annotate` 접속
2. 방금 설정한 비밀번호 입력
3. 라벨러 선택
4. 샘플 이미지 또는 로컬 폴더 연결
5. 폴리곤 하나 그리기
6. 새로고침 후 라벨이 다시 뜨는지 확인
7. Export COCO가 다운로드되는지 확인

## 자주 나는 오류

### `command not found: npm`

Node.js가 설치되지 않았습니다. Node.js 20 이상을 설치한 뒤 터미널을 다시 엽니다.

### `You must be logged in to use Wrangler`

아래를 다시 실행합니다.

```bash
npx wrangler login
```

### `database_id` 관련 오류

`wrangler.jsonc`의 `database_id`가 아직 `REPLACE_WITH_D1_DATABASE_ID`인지 확인합니다.

### `AUTH_PASSWORD is not configured`

아래를 다시 실행합니다.

```bash
npm run secret:auth
npm run deploy
```

### 배포는 됐는데 저장이 안 됨

대부분 D1 마이그레이션이 빠진 경우입니다.

```bash
npm run db:migrate:remote
npm run deploy
```
