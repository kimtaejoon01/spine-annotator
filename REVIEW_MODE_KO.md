# 자동 종판 검수(교수님 리뷰) 기능

## 무엇이 되나
1. **코너 드래그 수정**: "검수 모드" 체크 → 자동으로 잡힌 4코너(SA/SP/IA/IP)를
   마우스로 끌어서 교정. 교정한 추체는 교수님 값으로 저장됨.
2. **색 구분 비교**:
   - 자동: 상종판 초록 / 하종판 주황 (교정본이 있으면 점선·반투명으로 뒤에 남음)
   - 검수: 상종판 파랑 / 하종판 보라 (실선으로 위에)
   → 자동 vs 교수님 차이가 한눈에 보임.
3. **메모 2단계**: 추체별 메모 + 이미지 전체 메모.
4. **각도 비교표**: LL/TK/CL을 '자동' vs '검수' 두 열로 나란히 표시.
5. **저장/내보내기**: 서버(D1)에 저장(이미지별), JSON 내보내기.

## 사용 흐름
1. [자동 측정 실행] → 자동 종판 표시
2. "검수 모드" 체크 → 코너 점이 커지고 드래그 가능
3. 틀린 코너를 끌어서 교정 (교정 즉시 파랑 선으로 표시, 각도표도 갱신)
4. 추체 선택 → 메모 입력 / 전체 메모 입력
5. [검수 저장] (서버 저장) 또는 [JSON] (파일로)
6. 되돌리려면 추체 선택 후 [되돌리기] → 그 추체만 자동값 복귀

## 서버 (마이그레이션 필요)
- migrations/0006_endplate_review.sql : endplate_review 테이블
- API: GET /api/review/:filename, PUT /api/review/:filename, GET /api/review (전체)

## 변경/추가 파일
- (신규) migrations/0006_endplate_review.sql
- (수정) src/api.ts                        검수 API
- (수정) public/static/annotator.js        2색 오버레이 + 드래그 코너
- (수정) public/static/auto-endplate-ui.js 검수 UI/저장/메모/비교
- (수정) public/static/style.css           스타일

## 적용 (webapp)
  tar xzf <이 압축파일> -C .
  git add -A
  git commit -m "Add endplate review mode: draggable corners, memos, auto-vs-review compare"
  git push origin sagittal-measurements
  npm run db:migrate:remote     ← 꼭 실행 (새 테이블)
  npm run deploy:preview
