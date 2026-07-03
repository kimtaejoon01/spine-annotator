import { Hono } from 'hono'
import { renderer } from './renderer'
import { apiRoutes } from './api'

type Bindings = {
  DB: D1Database
  AUTH_PASSWORD?: string  // wrangler secret으로 주입
}

const app = new Hono<{ Bindings: Bindings }>()

app.use(renderer)

// API 라우트 (인증 포함)
app.route('/api', apiRoutes)

// 메인 페이지 - 라벨링 화면으로 바로 이동
app.get('/', (c) => {
  return c.redirect('/annotate')
})


// AI 추론 결과 전용 비교 페이지
app.get('/ai-review', (c) => {
  return c.render(
    <div id="ai-review-root" class="ai-review-root">
      <header class="app-header ai-review-header">
        <div class="header-left">
          <span class="app-title"><i class="fas fa-robot"></i> AI 결과 비교</span>
          <span class="file-info"><span id="reviewFileName">이미지 폴더를 연결하세요</span></span>
        </div>
        <div class="header-right">
          <button class="btn-secondary" id="reviewConnectImages"><i class="fas fa-folder-open"></i> 원본 이미지 폴더</button>
          <button class="btn-secondary" id="reviewAddAiFolder"><i class="fas fa-layer-group"></i> AI 폴더 추가</button>
          <button class="btn-secondary" id="reviewAddAiParent"><i class="fas fa-sitemap"></i> 상위 폴더 일괄 추가</button>
          <button class="btn-secondary" id="reviewRefresh"><i class="fas fa-sync"></i> 새로고침</button>
          <button class="btn-secondary" id="reviewClearAi"><i class="fas fa-times"></i> AI 폴더 초기화</button>
          <a class="btn-secondary" href="/annotate"><i class="fas fa-edit"></i> 라벨링으로</a>
        </div>
      </header>

      <div class="ai-review-layout">
        <aside class="ai-review-sidebar">
          <div class="panel">
            <h3 class="panel-title"><i class="fas fa-images"></i> 원본 이미지 <span class="label-count" id="reviewImageCount">0</span></h3>
            <div id="reviewImageStatus" class="folder-status"><span class="folder-status-empty"><i class="fas fa-info-circle"></i> 원본 폴더 없음</span></div>
            <input id="reviewSearch" class="select-input file-search" placeholder="파일명 검색..." />
            <ul id="reviewImageList" class="file-list"></ul>
          </div>
          <div class="panel">
            <h3 class="panel-title"><i class="fas fa-layer-group"></i> AI 결과 폴더 <span class="label-count" id="reviewAiCount">0</span></h3>
            <div id="reviewAiFolderList" class="ai-review-folder-list"><p class="empty-state">AI 결과 폴더를 여러 개 추가할 수 있습니다.</p></div>
          </div>
          <div class="panel">
            <h3 class="panel-title"><i class="fas fa-sliders-h"></i> 보기 설정</h3>
            <label class="control-label">AI 투명도 <span id="reviewOpacityValue">45</span>%</label>
            <input id="reviewOpacity" type="range" min="0" max="100" value="45" />
            <label class="control-label">카드 열 수</label>
            <select id="reviewColumns" class="select-input">
              <option value="2" selected>2열</option>
              <option value="3">3열</option>
              <option value="4">4열</option>
            </select>
            <p class="note-hint">휠 줌/드래그 팬은 라벨링 화면과 같은 방식으로 모든 비교 카드에 동시에 적용됩니다.</p>
          </div>
        </aside>

        <main class="ai-review-main">
          <div class="ai-review-toolbar">
            <button class="btn-secondary" id="reviewPrev"><i class="fas fa-chevron-left"></i> 이전</button>
            <button class="btn-secondary" id="reviewFit"><i class="fas fa-compress-arrows-alt"></i> 맞춤</button>
            <span id="reviewZoomLabel" class="zoom-level">100%</span>
            <button class="btn-secondary" id="reviewNext">다음 <i class="fas fa-chevron-right"></i></button>
            <span id="reviewMatchSummary" class="ai-review-summary">-</span>
          </div>
          <div id="reviewStage" class="ai-review-stage">
            <div id="reviewGrid" class="ai-review-grid cols-2">
              <div class="ai-review-empty">
                <i class="fas fa-folder-open fa-3x"></i>
                <p>원본 이미지 폴더와 AI 결과 폴더를 연결하세요.</p>
              </div>
            </div>
          </div>
        </main>
      </div>
      <script type="module" src="/static/ai-review.js"></script>
    </div>
  )
})

// 라벨링 화면 (Phase 1 프로토타입)
app.get('/annotate', (c) => {
  return c.render(
    <div id="app-root">
      {/* 상단 헤더 */}
      <header class="app-header">
        <div class="header-left">
          <span class="app-title">
            <i class="fas fa-bone"></i> Spine Annotator
          </span>
          <span class="file-info" id="fileInfo">
            <span id="fileName">샘플 이미지 로드 중...</span>
            <span class="view-badge" id="viewBadge">--</span>
          </span>
        </div>
        <div class="header-right">
          {/* 라벨러(작업자) 선택 */}
          <button class="labeler-pill" id="labelerBtn" title="현재 라벨러 변경">
            <span class="labeler-dot" id="labelerDot"></span>
            <span id="labelerLabel">라벨러 선택</span>
            <i class="fas fa-caret-down" style="font-size:11px; opacity:0.7"></i>
          </button>
          <button class="btn-secondary" id="connectFolderBtn" title="로컬 이미지 폴더 연결">
            <i class="fas fa-folder-open"></i> <span id="folderBtnLabel">폴더 연결</span>
          </button>
          <button class="btn-secondary" id="loadSampleBtn">
            <i class="fas fa-image"></i> 샘플
          </button>
          <label class="btn-secondary" for="fileUpload" title="단일 파일 열기">
            <i class="fas fa-upload"></i> 파일
            <input
              type="file"
              id="fileUpload"
              accept="image/png,image/jpeg"
              style="display:none"
            />
          </label>
          <button class="btn-secondary" id="openKeymapBtn" title="단축키 설정 (Ctrl+K)">
            <i class="fas fa-keyboard"></i>
          </button>
          <a class="btn-secondary" href="/manual" target="_blank" title="사용 매뉴얼 열기 (새 탭)">
            <i class="fas fa-book"></i>
          </a>
          <button class="btn-primary" id="exportBtn" title="현재 이미지의 COCO JSON 미리보기/다운로드">
            <i class="fas fa-download"></i> 현재
          </button>
          <button class="btn-primary" id="exportAllBtn" title="모든 파일 일괄 내보내기">
            <i class="fas fa-cloud-download-alt"></i> 전체 내보내기
          </button>
        </div>
      </header>

      {/* 메인 작업 영역 */}
      <div class="workspace">
        {/* 좌측 사이드바 접힘 시 펼치기 버튼 */}
        <button class="sidebar-expand-btn sidebar-expand-left hidden" id="expandLeftBtn" title="좌측 패널 펼치기">
          <i class="fas fa-chevron-right"></i>
        </button>

        {/* 좌측 사이드바: 시작 척추뼈 + 옵션 */}
        <aside class="sidebar-left" id="sidebarLeft">
          <div class="sidebar-header">
            <span class="sidebar-title">설정</span>
            <button class="sidebar-toggle-btn" id="collapseLeftBtn" title="패널 접기">
              <i class="fas fa-chevron-left"></i>
            </button>
          </div>
          <div class="sidebar-scroll">
          {/* 파일 목록 (로컬 폴더 연결) */}
          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-folder"></i> 이미지 폴더
              <span class="label-count" id="fileCount">0</span>
            </h3>
            <div id="folderStatus" class="folder-status">
              <span class="folder-status-empty">
                <i class="fas fa-info-circle"></i> 폴더가 연결되지 않았습니다
              </span>
            </div>
            <div class="folder-controls hidden" id="folderControls">
              <input
                type="text"
                id="fileSearch"
                class="select-input file-search"
                placeholder="파일명 검색..."
              />
              <div class="filter-row">
                <button class="filter-btn active" data-filter="all">전체</button>
                <button class="filter-btn" data-filter="AP">AP</button>
                <button class="filter-btn" data-filter="LAT">LAT</button>
              </div>
            </div>
            <ul class="file-list" id="fileList">
              {/* JS가 동적으로 채움 */}
            </ul>
          </div>

          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-flag"></i> 시작 척추뼈
            </h3>
            <p class="panel-desc">이미지에서 가장 위에 보이는 척추뼈를 선택하세요</p>
            <select id="startVertebra" class="select-input">
              <optgroup label="경추 (Cervical)">
                <option value="C1">C1</option>
                <option value="C2" selected>C2</option>
                <option value="C3">C3</option>
                <option value="C4">C4</option>
                <option value="C5">C5</option>
                <option value="C6">C6</option>
                <option value="C7">C7</option>
              </optgroup>
              <optgroup label="흉추 (Thoracic)">
                <option value="T1">T1</option>
                <option value="T2">T2</option>
                <option value="T3">T3</option>
                <option value="T4">T4</option>
                <option value="T5">T5</option>
                <option value="T6">T6</option>
                <option value="T7">T7</option>
                <option value="T8">T8</option>
                <option value="T9">T9</option>
                <option value="T10">T10</option>
                <option value="T11">T11</option>
                <option value="T12">T12</option>
              </optgroup>
              <optgroup label="요추 (Lumbar)">
                <option value="L1">L1</option>
                <option value="L2">L2</option>
                <option value="L3">L3</option>
                <option value="L4">L4</option>
                <option value="L5">L5</option>
              </optgroup>
              <optgroup label="천추 (Sacrum)">
                <option value="S1">S1</option>
              </optgroup>
            </select>
          </div>

          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-sliders-h"></i> 이미지 조정
            </h3>
            <div class="control-group">
              <label>
                밝기 <span id="brightnessValue">0</span>
              </label>
              <input
                type="range"
                id="brightness"
                min="-100"
                max="100"
                value="0"
                step="1"
              />
            </div>
            <div class="control-group">
              <label>
                대비 <span id="contrastValue">0</span>
              </label>
              <input
                type="range"
                id="contrast"
                min="-100"
                max="100"
                value="0"
                step="1"
              />
            </div>
            <div class="control-group">
              <label class="checkbox-label">
                <input type="checkbox" id="invertImage" />
                <span>색상 반전 (Invert)</span>
              </label>
            </div>
            <button class="btn-secondary btn-full" id="resetImageBtn">
              <i class="fas fa-undo"></i> 초기화
            </button>
          </div>

          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-search-plus"></i> 줌
            </h3>
            <div class="zoom-controls">
              <button class="btn-icon" id="zoomOutBtn" title="줌 아웃 (-)">
                <i class="fas fa-minus"></i>
              </button>
              <span class="zoom-level" id="zoomLevel">100%</span>
              <button class="btn-icon" id="zoomInBtn" title="줌 인 (+)">
                <i class="fas fa-plus"></i>
              </button>
            </div>
            <button class="btn-secondary btn-full" id="zoomFitBtn">
              <i class="fas fa-expand"></i> 화면 맞춤
            </button>
            <button class="btn-secondary btn-full" id="zoom100Btn">
              <i class="fas fa-search"></i> 100%
            </button>
          </div>

          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-keyboard"></i> 단축키
              <button class="panel-action-btn" id="openShortcutsBtn" title="단축키 설정">
                <i class="fas fa-cog"></i>
              </button>
            </h3>
            <ul class="shortcut-list" id="shortcutList">
              {/* JS가 동적으로 채움 */}
            </ul>
            <p class="panel-desc" style="margin-top:8px">
              <i class="fas fa-info-circle"></i> 항목을 클릭하면 키를 변경할 수 있어요
            </p>
          </div>
          </div> {/* /sidebar-scroll */}
        </aside>
        {/* 좌측 리사이저 */}
        <div class="sidebar-resizer sidebar-resizer-left" id="resizerLeft" title="드래그하여 너비 조절"></div>

        {/* 중앙 캔버스 영역 */}
        <main class="canvas-area">
          <div class="canvas-toolbar">
            <div class="tool-group">
              <button class="tool-btn active" id="toolDraw" title="그리기 (D)">
                <i class="fas fa-draw-polygon"></i> 그리기
              </button>
              <button class="tool-btn" id="toolEdit" title="편집 (E)">
                <i class="fas fa-edit"></i> 편집
              </button>
              <button class="tool-btn" id="toolDelete" title="삭제 (X)">
                <i class="fas fa-trash"></i> 삭제
              </button>
            </div>
            <div class="tool-group">
              <button class="tool-btn" id="undoBtn" title="실행 취소 (Ctrl+Z)">
                <i class="fas fa-undo"></i>
              </button>
              <button class="tool-btn" id="redoBtn" title="다시 실행 (Ctrl+Y)">
                <i class="fas fa-redo"></i>
              </button>
            </div>
            <div class="tool-group tool-info">
              <span id="statusText">그리기 모드 - 캔버스를 클릭하여 점을 추가하세요</span>
            </div>
          </div>
          <div id="canvasContainer" class="canvas-container">
            <div id="canvasStage"></div>
            <div class="canvas-placeholder" id="canvasPlaceholder">
              <i class="fas fa-x-ray fa-4x"></i>
              <p>이미지를 불러오는 중...</p>
            </div>
          </div>
        </main>

        {/* 우측 리사이저 */}
        <div class="sidebar-resizer sidebar-resizer-right" id="resizerRight" title="드래그하여 너비 조절"></div>

        {/* 우측 사이드바: 라벨 목록 */}
        <aside class="sidebar-right" id="sidebarRight">
          <div class="sidebar-header">
            <button class="sidebar-toggle-btn" id="collapseRightBtn" title="패널 접기">
              <i class="fas fa-chevron-right"></i>
            </button>
            <span class="sidebar-title">라벨</span>
          </div>
          <div class="sidebar-scroll">
          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-layer-group"></i> 보기 / AI 결과
            </h3>
            <div class="control-group">
              <label class="checkbox-label">
                <input type="checkbox" id="toggleLabelOverlay" checked />
                <span>사람 라벨 보기</span>
              </label>
            </div>
            <button class="btn-secondary btn-full" id="originalOnlyBtn" title="원본 이미지만 보기. H를 누르고 있는 동안에도 사람 라벨이 숨겨집니다.">
              <i class="fas fa-eye-slash"></i> 원본만 보기
            </button>
            <div class="ai-panel-divider"></div>
            <div class="ai-folder-row">
              <button class="btn-secondary btn-full" id="connectAiFolderBtn" title="표준화된 AI mask PNG 폴더 연결">
                <i class="fas fa-robot"></i> AI 폴더 연결
              </button>
              <button class="btn-icon" id="refreshAiFolderBtn" title="AI 폴더 다시 스캔">
                <i class="fas fa-sync"></i>
              </button>
            </div>
            <div id="aiFolderStatus" class="ai-folder-status empty">AI mask 폴더가 연결되지 않았습니다</div>
            <div class="control-group">
              <label class="checkbox-label">
                <input type="checkbox" id="toggleAiOverlay" checked />
                <span>AI 결과 보기</span>
              </label>
            </div>
            <div class="control-group">
              <label>
                AI 투명도 <span id="aiOpacityValue">45</span>
              </label>
              <input type="range" id="aiOpacity" min="0" max="100" value="45" step="1" />
            </div>
            <div id="aiRegionControls" class="ai-region-controls"></div>
            <p class="panel-desc" style="margin-top:8px">
              파일명 규칙: 원본_AIresult_부위_모델_v0.png
            </p>
          </div>
          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-eye"></i> 표시
            </h3>
            <label class="checkbox-label" title="라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다">
              <input type="checkbox" id="humanLabelOverlayToggle" checked />
              <span>선/이름표 보기</span>
            </label>
          </div>
          <div class="panel panel-full">
            <h3 class="panel-title">
              <i class="fas fa-list"></i> 라벨 목록
              <span class="label-count" id="labelCount">0</span>
            </h3>
            <div class="label-list" id="labelList">
              <p class="empty-state">폴리곤을 그려서 라벨을 추가하세요</p>
            </div>
          </div>
          <div class="panel" id="notePanel">
            <h3 class="panel-title">
              <i class="fas fa-sticky-note"></i> 파일 메모
            </h3>
            <textarea id="fileNoteInput" class="note-textarea" placeholder="이 이미지에 대한 메모를 적으세요. 예: AI mask 밀림, 판독 주의점, 나중에 재확인 등"></textarea>
            <div class="note-footer">
              <span id="noteStatus" class="note-status">메모 없음</span>
              <button class="btn-secondary btn-small" id="exportNotesBtn" title="메모만 별도 JSON으로 내보내기">
                <i class="fas fa-download"></i> 메모 내보내기
              </button>
            </div>
            <p class="note-hint">메모는 COCO/라벨 JSON에 포함되지 않고 별도로 저장됩니다.</p>
          </div>
          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-save"></i> 저장
            </h3>
            <p class="autosave-info">
              <i class="fas fa-cloud"></i>
              <span id="saveStatus">자동 저장됨</span>
            </p>
            <button class="btn-secondary btn-full" id="clearAllBtn">
              <i class="fas fa-trash-alt"></i> 모두 지우기
            </button>
          </div>
          </div> {/* /sidebar-scroll */}
        </aside>

        {/* 우측 사이드바 접힘 시 펼치기 버튼 */}
        <button class="sidebar-expand-btn sidebar-expand-right hidden" id="expandRightBtn" title="우측 패널 펼치기">
          <i class="fas fa-chevron-left"></i>
        </button>
      </div>

      {/* COCO 미리보기 모달 */}
      <div class="modal hidden" id="cocoModal">
        <div class="modal-content">
          <div class="modal-header">
            <h2>
              <i class="fas fa-file-code"></i> COCO JSON 미리보기
            </h2>
            <button class="btn-icon" id="closeCocoBtn">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <pre id="cocoOutput"></pre>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="copyCocoBtn">
              <i class="fas fa-copy"></i> 복사
            </button>
            <button class="btn-primary" id="downloadCocoBtn">
              <i class="fas fa-download"></i> JSON 다운로드
            </button>
          </div>
        </div>
      </div>

      {/* 단축키 설정 모달 */}
      <div class="modal hidden" id="shortcutsModal">
        <div class="modal-content modal-content-md">
          <div class="modal-header">
            <h2>
              <i class="fas fa-keyboard"></i> 단축키 설정
            </h2>
            <button class="btn-icon" id="closeShortcutsBtn">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-desc">
              <i class="fas fa-info-circle"></i>
              키 칸을 클릭한 뒤 원하는 키를 누르세요. (Ctrl, Shift, Alt 조합 가능)
              <br />
              <kbd>Esc</kbd>로 변경 취소, 같은 키를 다른 액션에 할당하면 기존 할당이 해제됩니다.
            </p>
            <div id="shortcutsEditor">
              {/* JS가 동적으로 채움 */}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="resetShortcutsBtn">
              <i class="fas fa-undo"></i> 기본값으로 복원
            </button>
            <button class="btn-primary" id="closeShortcutsBtn2">
              <i class="fas fa-check"></i> 완료
            </button>
          </div>
        </div>
      </div>

      {/* 전체 일괄 내보내기 모달 */}
      <div class="modal hidden" id="exportAllModal">
        <div class="modal-content modal-content-md">
          <div class="modal-header">
            <h2>
              <i class="fas fa-cloud-download-alt"></i> 전체 내보내기
            </h2>
            <button class="btn-icon" id="closeExportAllBtn">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-desc">
              <i class="fas fa-info-circle"></i>
              서버에 저장된 모든 라벨을 한 번에 내려받습니다. 필터로 조건 지정 가능.
            </p>

            <div class="export-options">
              <div class="export-row">
                <label class="export-label">형식</label>
                <div class="export-radios">
                  <label class="radio-pill">
                    <input type="radio" name="exportFormat" value="coco" checked />
                    <span>COCO (통합 학습용)</span>
                  </label>
                  <label class="radio-pill">
                    <input type="radio" name="exportFormat" value="raw" />
                    <span>Raw JSON (백업/복원용)</span>
                  </label>
                </div>
              </div>

              <div class="export-row">
                <label class="export-label">뷰 타입</label>
                <div class="export-radios">
                  <label class="radio-pill"><input type="radio" name="exportView" value="" checked /><span>전체</span></label>
                  <label class="radio-pill"><input type="radio" name="exportView" value="AP" /><span>AP만</span></label>
                  <label class="radio-pill"><input type="radio" name="exportView" value="LAT" /><span>LAT만</span></label>
                </div>
              </div>

              <div class="export-row">
                <label class="export-label">라벨러</label>
                <div class="export-radios">
                  <label class="radio-pill"><input type="radio" name="exportLabeler" value="" checked /><span>전체</span></label>
                  <label class="radio-pill"><input type="radio" name="exportLabeler" value="park" /><span>박성배</span></label>
                  <label class="radio-pill"><input type="radio" name="exportLabeler" value="kim" /><span>김태준</span></label>
                  <label class="radio-pill"><input type="radio" name="exportLabeler" value="hwang" /><span>황회진</span></label>
                </div>
              </div>

              <div class="export-row">
                <label class="export-label">최소 폴리곤 수</label>
                <div class="export-radios">
                  <label class="radio-pill"><input type="radio" name="exportMinPolys" value="0" checked /><span>전체 (1개 이상)</span></label>
                  <label class="radio-pill"><input type="radio" name="exportMinPolys" value="25" /><span>완성 (25개)</span></label>
                </div>
              </div>
            </div>

            <div id="exportSummary" class="export-summary">
              <div class="export-summary-loading">통계 로딩 중...</div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="exportRefreshBtn">
              <i class="fas fa-sync"></i> 통계 갱신
            </button>
            <button class="btn-primary" id="exportDownloadBtn">
              <i class="fas fa-download"></i> 다운로드
            </button>
          </div>
        </div>
      </div>

      {/* 비밀번호(인증) 모달 - 첫 진입 시 강제 */}
      <div class="modal" id="authModal">
        <div class="modal-content modal-content-sm">
          <div class="modal-header">
            <h2>
              <i class="fas fa-lock"></i> 접속 비밀번호
            </h2>
          </div>
          <div class="modal-body">
            <p class="modal-desc">
              <i class="fas fa-info-circle"></i>
              팀에 공유된 비밀번호를 입력해주세요. 입력 후 이 브라우저에 기억됩니다.
            </p>
            <form id="authForm" style="display:flex; flex-direction:column; gap:12px; margin-top:14px;">
              <input
                type="password"
                id="authPasswordInput"
                placeholder="비밀번호"
                autocomplete="current-password"
                style="padding:10px 14px; font-size:15px; background:var(--bg-elev); border:2px solid var(--border); border-radius:8px; color:var(--text); font-family:inherit;"
              />
              <div id="authError" class="auth-error hidden" style="color:#ff7a7a; font-size:13px;"></div>
              <button type="submit" class="btn-primary" style="padding:10px 16px; font-size:14px;">
                <i class="fas fa-sign-in-alt"></i> 입장
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* 라벨러(작업자) 선택 모달 */}
      <div class="modal hidden" id="labelerModal">
        <div class="modal-content modal-content-sm">
          <div class="modal-header">
            <h2>
              <i class="fas fa-user-md"></i> 현재 라벨러 선택
            </h2>
            <button class="btn-icon" id="closeLabelerBtn">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-desc">
              <i class="fas fa-info-circle"></i>
              누가 작업 중인지 선택해주세요. 라벨 저장 시 마지막 수정자로 기록되며,
              파일 목록의 상태 점이 해당 색상으로 표시됩니다.
            </p>
            <div id="labelerList" class="labeler-list">
              {/* JS가 동적으로 채움 */}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

// ================================================================
// /manual - 사용 매뉴얼 페이지
// ================================================================
app.get('/manual', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spine Annotator 매뉴얼</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="/static/manual.css" />
</head>
<body>
  <header class="manual-header">
    <div class="manual-header-inner">
      <a href="/annotate" class="back-link"><i class="fas fa-arrow-left"></i> 라벨링 화면으로</a>
      <h1><i class="fas fa-book"></i> Spine Annotator 사용 매뉴얼</h1>
      <div class="manual-meta">척추 X-ray 폴리곤 라벨링 도구 · v1.0</div>
    </div>
  </header>

  <nav class="manual-toc">
    <strong>목차</strong>
    <ol>
      <li><a href="#overview">개요</a></li>
      <li><a href="#labeler">라벨러(작업자) 설정</a></li>
      <li><a href="#quickstart">빠른 시작 (5분)</a></li>
      <li><a href="#folder">로컬 이미지 폴더 연결</a></li>
      <li><a href="#drawing">폴리곤 그리기</a></li>
      <li><a href="#editing">편집 모드</a></li>
      <li><a href="#labels">라벨 자동 할당 / 시작 라벨</a></li>
      <li><a href="#view">뷰 조작 (줌·팬·필터)</a></li>
      <li><a href="#shortcuts">단축키 전체 목록</a></li>
      <li><a href="#export">COCO 내보내기</a></li>
      <li><a href="#workflow">권장 작업 흐름</a></li>
      <li><a href="#troubleshoot">자주 묻는 질문 / 트러블슈팅</a></li>
    </ol>
  </nav>

  <main class="manual-main">

    <section id="overview">
      <h2>1. 개요</h2>
      <p>
        Spine Annotator는 척추 X-ray(전체 척추, AP/LAT) 이미지를 대상으로
        <strong>척추체(vertebral body) 25개 클래스(C1–S1)</strong>를 폴리곤으로 라벨링하기 위한 웹 도구입니다.
        결과는 segmentation 모델 학습용 <strong>COCO JSON</strong> 형식으로 내보낼 수 있습니다.
      </p>
      <ul class="feature-list">
        <li><i class="fas fa-folder"></i> 로컬 폴더 연결 (700+ 이미지도 서버 업로드 없이 작업)</li>
        <li><i class="fas fa-draw-polygon"></i> Konva.js 기반 정밀한 폴리곤 그리기/편집</li>
        <li><i class="fas fa-magic"></i> Y좌표 기준 라벨 자동 할당 (위→아래)</li>
        <li><i class="fas fa-keyboard"></i> 모든 단축키 커스터마이즈 가능, 한/영 IME 무관</li>
        <li><i class="fas fa-save"></i> 파일별 자동 저장 (브라우저 LocalStorage)</li>
        <li><i class="fas fa-file-export"></i> COCO 형식 JSON 내보내기</li>
      </ul>
    </section>

    <section id="labeler">
      <h2>2. 라벨러(작업자) 설정</h2>
      <p>
        앱을 처음 열면 <strong>라벨러 선택 모달</strong>이 자동으로 뜹니다.
        본인 이름을 선택하면 헤더 우측에 색상 점과 함께 표시됩니다.
      </p>

      <h3>현재 등록된 라벨러</h3>
      <table class="action-table">
        <thead><tr><th>이름</th><th>색상</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>박성배</strong> (교수님)</td>
            <td><span class="dot" style="background:#f0b35e; box-shadow:0 0 0 3px rgba(240,179,94,0.25)"></span> 골드</td>
          </tr>
          <tr>
            <td><strong>김태준</strong></td>
            <td><span class="dot" style="background:#4f9ef8; box-shadow:0 0 0 3px rgba(79,158,248,0.25)"></span> 블루</td>
          </tr>
          <tr>
            <td><strong>황회진</strong></td>
            <td><span class="dot" style="background:#d18ce8; box-shadow:0 0 0 3px rgba(209,140,232,0.25)"></span> 보라</td>
          </tr>
        </tbody>
      </table>

      <h3>동작 방식</h3>
      <ul>
        <li>라벨 저장 시 <strong>마지막 수정자</strong>로 기록됨</li>
        <li>왼쪽 파일 목록의 상태 점이 <strong>마지막 수정자 색</strong>으로 표시됨</li>
        <li>다른 라벨러가 수정하면 점 색이 바뀜 (예: 박성배 → 김태준이 수정 → 점이 블루로)</li>
        <li>점에 마우스 올리면 "박성배(교수님) · 25개 라벨" 식으로 정보 표시</li>
      </ul>

      <h3>라벨러 변경</h3>
      <p>
        헤더 좌측의 <span class="ui-btn" style="border-radius:999px">● 박성배 ▾</span> pill 버튼을 클릭하면
        라벨러를 변경할 수 있습니다. (브라우저별로 따로 저장됨)
      </p>

      <div class="callout warn">
        <i class="fas fa-exclamation-triangle"></i>
        <div>
          <strong>중요:</strong> 작업 시작 전에 반드시 본인 이름이 선택되어 있는지 확인하세요.
          다른 사람 계정으로 저장된 라벨은 점 색깔로만 구분할 수 있습니다.
        </div>
      </div>
    </section>

    <section id="quickstart">
      <h2>3. 빠른 시작 (5분)</h2>
      <ol class="steps">
        <li>
          <strong>이미지 열기</strong>
          <p>헤더의 <span class="ui-btn"><i class="fas fa-folder-open"></i> 폴더 연결</span> 또는
          <span class="ui-btn"><i class="fas fa-upload"></i> 파일</span> 또는
          <span class="ui-btn"><i class="fas fa-image"></i> 샘플</span>을 누릅니다.</p>
        </li>
        <li>
          <strong>시작 척추 라벨 선택</strong>
          <p>왼쪽 사이드바의 <em>시작 라벨</em> 드롭다운에서 이미지 최상단에 보이는 척추(예: C2, T1, L1)를 선택합니다.</p>
        </li>
        <li>
          <strong>그리기 모드 진입</strong>
          <p><kbd>I</kbd>를 누르거나 도구 버튼의 <i class="fas fa-pencil-alt"></i> 그리기를 클릭합니다.</p>
        </li>
        <li>
          <strong>점 찍기 → 완성</strong>
          <p>척추체 외곽을 따라 클릭하여 점을 찍습니다. 3개 이상 찍은 후 <kbd>Q</kbd>(순서대로 완성) 또는 <kbd>W</kbd>(각도순 자동 정렬 완성).</p>
        </li>
        <li>
          <strong>다음 척추로 반복</strong>
          <p>완성된 폴리곤은 자동으로 라벨이 할당됩니다(Y좌표 기준). 25개 모두 라벨링되면 라벨이 모두 채워집니다.</p>
        </li>
        <li>
          <strong>COCO 내보내기</strong>
          <p>헤더 우측의 <span class="ui-btn primary"><i class="fas fa-download"></i> COCO 미리보기</span> → 다운로드.</p>
        </li>
      </ol>
    </section>

    <section id="folder">
      <h2>4. 로컬 이미지 폴더 연결</h2>
      <div class="callout info">
        <i class="fas fa-info-circle"></i>
        <div>
          <strong>왜 폴더 연결인가?</strong><br/>
          700개·14GB 같은 큰 데이터셋을 서버에 올리지 않고도, 각자의 PC에 있는 이미지를 직접 읽어 작업할 수 있습니다.
          서버에는 <strong>라벨 메타데이터만</strong> 저장됩니다.
        </div>
      </div>

      <h3>지원 브라우저</h3>
      <ul>
        <li>✅ <strong>Chrome / Edge</strong> (File System Access API 지원)</li>
        <li>❌ Firefox / Safari — 단일 파일 업로드만 가능</li>
      </ul>

      <h3>사용법</h3>
      <ol class="steps">
        <li>헤더의 <span class="ui-btn"><i class="fas fa-folder-open"></i> 폴더 연결</span> 클릭</li>
        <li>X-ray PNG 파일들이 있는 폴더 선택 → 권한 허용</li>
        <li>왼쪽 사이드바에 파일 목록이 표시됩니다 (AP/LAT 자동 분류)</li>
        <li>파일을 클릭하면 캔버스에 로드됨</li>
        <li>다음 세션에서도 자동 복원됩니다 (브라우저에 폴더 핸들 저장)</li>
      </ol>

      <h3>파일 목록 UI</h3>
      <ul>
        <li><span class="badge ap">AP</span> / <span class="badge lat">LAT</span> — 파일명에서 자동 파싱</li>
        <li><span class="dot gray"></span> 라벨 없음 / <span class="dot green"></span> 라벨 있음 (LocalStorage 기준)</li>
        <li>검색창에 파일명 일부를 입력해서 빠르게 찾기</li>
        <li>전체 / AP / LAT 필터 버튼으로 보기 조절</li>
      </ul>
    </section>

    <section id="drawing">
      <h2>5. 폴리곤 그리기</h2>

      <h3>기본 흐름</h3>
      <ol class="steps">
        <li><kbd>I</kbd>로 그리기 모드 진입</li>
        <li>척추체 외곽을 클릭하여 점 추가 (최소 3점)</li>
        <li>완성:
          <ul>
            <li><kbd>Q</kbd> — 클릭한 <strong>순서대로</strong> 연결 (점을 시계방향으로 잘 찍은 경우)</li>
            <li><kbd>W</kbd> — <strong>각도순 자동 정렬</strong>로 완성 (점 순서가 뒤죽박죽이어도 볼록 다각형으로 자동 정리)</li>
            <li>마지막 점에서 <strong>더블클릭</strong>으로도 완성 가능</li>
          </ul>
        </li>
        <li><kbd>E</kbd> — 마지막 점 한 개 되돌리기 (실수했을 때)</li>
        <li><kbd>Esc</kbd> — 그리기 전체 취소</li>
      </ol>

      <h3>🖊️ 자유곡선 (둥근 모서리)</h3>
      <p>
        클릭만으로 그리면 꼭짓점이 뾰족해집니다. 둥근 외곽을 그리려면:
      </p>
      <ol class="steps">
        <li><kbd>S</kbd> 키를 <strong>누른 상태로 유지</strong></li>
        <li>마우스를 누른 채로 외곽을 따라 <strong>드래그</strong> — 이동 거리에 따라 점이 자동 추가됨</li>
        <li>마우스 떼기 → 일시 정지 (다시 드래그 가능)</li>
        <li><kbd>S</kbd> 떼면 일반 클릭 모드로 복귀</li>
        <li><kbd>Q</kbd>로 완성</li>
      </ol>
      <p>
        <strong>혼합 사용 가능:</strong> 직선 부분은 클릭, 곡선 부분은 S+마우스 이동 — 한 폴리곤 안에서 자유롭게 섞어도 됩니다.
      </p>

      <div class="callout tip">
        <i class="fas fa-lightbulb"></i>
        <div>
          <strong>팁:</strong> 척추체는 보통 4각형에 가까우므로 4개 점이면 충분합니다.
          압박골절·변형 등 둥근 외곽은 <kbd>S</kbd>+드래그로 자유곡선을 사용하세요.
          점이 너무 많아지면 학습 데이터 용량이 커지므로, 곡률이 큰 부분만 자유곡선을 쓰는 게 좋습니다.
        </div>
      </div>
    </section>

    <section id="editing">
      <h2>6. 편집 모드</h2>

      <p><kbd>O</kbd>로 편집 모드 진입. 이미 그린 폴리곤을 수정합니다.</p>

      <h3>점 조작</h3>
      <table class="action-table">
        <thead><tr><th>동작</th><th>방법</th></tr></thead>
        <tbody>
          <tr><td>폴리곤 선택</td><td>폴리곤 내부 클릭</td></tr>
          <tr><td>점 이동</td><td>점을 드래그</td></tr>
          <tr><td>점 추가</td><td>변(테두리) 위에 마우스 → 점선 미리보기 → 클릭</td></tr>
          <tr><td>점 삭제</td><td>점 위에서 <kbd>R</kbd> (또는 우클릭 / 더블클릭)</td></tr>
        </tbody>
      </table>

      <h3>그리던 폴리곤을 편집 모드에서 마무리</h3>
      <p>
        그리기 모드에서 점을 몇 개 찍다가 <kbd>O</kbd>로 편집 모드로 전환할 수 있습니다.
        이때 찍은 점들은 <strong>그대로 유지</strong>되며, 드래그로 위치를 미세 조정한 뒤
        <kbd>Q</kbd> 또는 <kbd>W</kbd>로 완성할 수 있습니다.
      </p>

      <div class="callout warn">
        <i class="fas fa-exclamation-triangle"></i>
        <div>최소 점 개수는 <strong>3개</strong>입니다. 3개 미만에서 완성을 시도하면 자동으로 취소됩니다.</div>
      </div>
    </section>

    <section id="labels">
      <h2>7. 라벨 자동 할당 / 시작 라벨</h2>
      <p>
        폴리곤이 완성될 때마다 모든 폴리곤이 <strong>Y좌표(무게중심) 기준 위에서 아래로</strong> 정렬되고,
        <em>시작 라벨</em>부터 순서대로 자동 할당됩니다.
      </p>

      <h3>예시</h3>
      <ul>
        <li>시작 라벨 = <code>T1</code>, 폴리곤 12개 → T1, T2, ..., T12 자동 할당</li>
        <li>시작 라벨 = <code>L1</code>, 폴리곤 6개 → L1, L2, L3, L4, L5, S1 자동 할당</li>
      </ul>

      <p>지원 라벨 시퀀스 (위→아래):</p>
      <code class="block">C1 → C2 → C3 → C4 → C5 → C6 → C7 → T1 → T2 → ... → T12 → L1 → L2 → L3 → L4 → L5 → S1</code>

      <h3>수동 라벨 변경</h3>
      <p>오른쪽 사이드바의 폴리곤 목록에서 라벨을 클릭하여 직접 변경할 수 있습니다.</p>
    </section>

    <section id="view">
      <h2>8. 뷰 조작</h2>
      <h3>줌 / 팬</h3>
      <ul>
        <li><strong>줌:</strong> 마우스 휠 (커서 위치 기준)</li>
        <li><strong>줌 인/아웃:</strong> <kbd>+</kbd> / <kbd>-</kbd></li>
        <li><strong>화면 맞춤:</strong> <kbd>0</kbd></li>
        <li><strong>팬(이동):</strong> <kbd>Space</kbd> 누른 채로 드래그</li>
      </ul>

      <h3>이미지 필터 (오른쪽 사이드바)</h3>
      <ul>
        <li><strong>밝기 / 대비:</strong> 슬라이더로 조절</li>
        <li><strong>색반전:</strong> 토글 (X-ray 음영 반전 시 더 잘 보일 때)</li>
      </ul>

      <h3>사이드바</h3>
      <ul>
        <li>좌/우 사이드바 너비는 <strong>경계선 드래그</strong>로 조절</li>
        <li>접기/펼치기 버튼으로 캔버스를 최대화 가능</li>
      </ul>
    </section>

    <section id="shortcuts">
      <h2>9. 단축키 전체 목록</h2>

      <p>
        <strong>모든 단축키는 커스터마이즈 가능</strong>합니다. 헤더의 <i class="fas fa-keyboard"></i> 버튼 또는 <kbd>Ctrl</kbd>+<kbd>K</kbd>.<br/>
        한/영 입력 상태와 무관하게 <strong>물리적 키 위치</strong>로 동작합니다 (IME 안전).
      </p>

      <h3>도구</h3>
      <table class="action-table">
        <tr><td><kbd>I</kbd></td><td>그리기 도구</td></tr>
        <tr><td><kbd>O</kbd></td><td>편집 도구</td></tr>
        <tr><td><kbd>P</kbd></td><td>삭제 도구</td></tr>
      </table>

      <h3>그리기</h3>
      <table class="action-table">
        <tr><td><kbd>Q</kbd></td><td>완성 (순서대로 연결)</td></tr>
        <tr><td><kbd>W</kbd></td><td>자유 완성 (각도순 자동 정렬)</td></tr>
        <tr><td><kbd>E</kbd></td><td>마지막 점 취소</td></tr>
        <tr><td><kbd>S</kbd> + 마우스 이동</td><td>🖊️ 자유곡선 (S 누른 채 마우스 이동으로 점 자동 추가)</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>그리기 전체 취소</td></tr>
      </table>

      <h3>편집</h3>
      <table class="action-table">
        <tr><td><kbd>R</kbd></td><td>마우스 아래 점 삭제</td></tr>
        <tr><td><kbd>Delete</kbd></td><td>선택한 폴리곤 삭제</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>실행 취소</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>Y</kbd></td><td>다시 실행</td></tr>
      </table>

      <h3>보기</h3>
      <table class="action-table">
        <tr><td><kbd>Space</kbd> (홀드)</td><td>팬 모드</td></tr>
        <tr><td><kbd>+</kbd> / <kbd>-</kbd></td><td>줌 인 / 줌 아웃</td></tr>
        <tr><td><kbd>0</kbd></td><td>화면 맞춤</td></tr>
      </table>

      <h3>마우스 동작 (변경 불가)</h3>
      <table class="action-table">
        <tr><td>좌클릭</td><td>점 찍기 (그리기 모드)</td></tr>
        <tr><td>더블클릭</td><td>폴리곤 완성 (그리기 모드)</td></tr>
        <tr><td>변 위 클릭</td><td>점 추가 (편집 모드)</td></tr>
        <tr><td>점 드래그</td><td>점 이동 (편집 모드)</td></tr>
        <tr><td>점 우클릭 / 더블클릭</td><td>점 삭제 (편집 모드)</td></tr>
        <tr><td>휠</td><td>줌</td></tr>
      </table>
    </section>

    <section id="export">
      <h2>10. COCO 내보내기</h2>
      <p>
        헤더의 <span class="ui-btn primary"><i class="fas fa-download"></i> COCO 미리보기</span> 버튼을 누르면
        현재 이미지의 라벨을 <strong>COCO segmentation 형식</strong> JSON으로 미리 볼 수 있고 다운로드할 수 있습니다.
      </p>

      <h3>출력 형식</h3>
      <pre class="code-block">{
  "images": [{
    "id": 1,
    "file_name": "patient_001_AP.png",
    "width": 1024,
    "height": 2048
  }],
  "annotations": [{
    "id": 1,
    "image_id": 1,
    "category_id": 8,            // T1 = 8 (C1=1, C2=2, ..., S1=25)
    "segmentation": [[x1,y1,x2,y2,...]],
    "bbox": [x, y, w, h],
    "area": 12345.6,
    "iscrowd": 0
  }, ...],
  "categories": [
    { "id": 1, "name": "C1" }, { "id": 2, "name": "C2" }, ...
    { "id": 25, "name": "S1" }
  ]
}</pre>

      <h3>면적 / bbox 계산</h3>
      <ul>
        <li><strong>bbox:</strong> 점들의 min/max x,y로 계산</li>
        <li><strong>area:</strong> Shoelace 공식 (실제 폴리곤 면적, 픽셀²)</li>
      </ul>
    </section>

    <section id="workflow">
      <h2>11. 권장 작업 흐름</h2>
      <ol class="steps">
        <li><strong>폴더 연결</strong> — 한 번만 연결하면 다음 세션에도 자동 복원</li>
        <li><strong>파일 선택</strong> — AP / LAT 필터로 한 가지 뷰만 먼저 처리하는 것을 권장</li>
        <li><strong>시작 라벨 설정</strong> — 이미지 상단에 보이는 척추로 (예: C2 또는 T1)</li>
        <li><strong>위에서 아래로 순서대로</strong> 폴리곤 그리기
          <ul>
            <li>일반적으로 <kbd>I</kbd> → 점 4개 클릭 → <kbd>Q</kbd> 반복</li>
            <li>점 순서가 꼬였으면 <kbd>W</kbd>로 자동 정렬</li>
          </ul>
        </li>
        <li><strong>편집 모드</strong>로 점들 미세 조정 (<kbd>O</kbd> → 드래그)</li>
        <li><strong>자동 저장</strong> — 파일 전환 시 자동으로 LocalStorage에 저장됨</li>
        <li><strong>COCO 내보내기</strong> — 작업 완료 후 JSON 다운로드</li>
      </ol>

      <div class="callout tip">
        <i class="fas fa-lightbulb"></i>
        <div>
          <strong>효율 팁:</strong>
          왼손은 키보드(<kbd>I</kbd>/<kbd>O</kbd>/<kbd>Q</kbd>/<kbd>W</kbd>/<kbd>E</kbd>/<kbd>R</kbd>),
          오른손은 마우스로 작업하면 한 이미지(25개 라벨)당 2–3분 안에 완성할 수 있습니다.
        </div>
      </div>
    </section>

    <section id="troubleshoot">
      <h2>12. 자주 묻는 질문 / 트러블슈팅</h2>

      <details open>
        <summary>Q. 단축키가 안 먹어요</summary>
        <ul>
          <li>입력창(input/textarea)에 포커스가 있는지 확인 → 캔버스를 한 번 클릭</li>
          <li>커스터마이즈한 단축키가 충돌하지 않는지 → <kbd>Ctrl</kbd>+<kbd>K</kbd> → "기본값으로 복원"</li>
          <li>옛 버전 캐시 가능성 → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>로 강력 새로고침</li>
        </ul>
      </details>

      <details>
        <summary>Q. 폴리곤이 완성되지 않아요</summary>
        <ul>
          <li>최소 점 3개가 찍혀 있어야 합니다 (1–2개는 자동 취소됨)</li>
          <li>그리기 모드(<kbd>I</kbd>) 또는 편집 모드(<kbd>O</kbd>) 상태인지 확인</li>
          <li>상태바(화면 하단)에 현재 점 개수가 표시됩니다</li>
        </ul>
      </details>

      <details>
        <summary>Q. 폴더 연결이 안 됩니다</summary>
        <ul>
          <li>Chrome 또는 Edge를 사용하시나요? Firefox/Safari는 미지원</li>
          <li>HTTPS 환경이어야 합니다 (이 사이트는 OK)</li>
          <li>처음 연결 시 폴더 읽기 권한 허용을 눌렀는지 확인</li>
        </ul>
      </details>

      <details>
        <summary>Q. 라벨이 저장되었는지 어떻게 확인하나요?</summary>
        <ul>
          <li>파일 목록의 <span class="dot green"></span> 초록 점 = 라벨 있음 / <span class="dot gray"></span> 회색 = 없음</li>
          <li>저장은 자동입니다 (파일 전환·완성·삭제 시)</li>
          <li>저장 위치: 브라우저 LocalStorage (다른 PC/브라우저로는 전이 안 됨)</li>
        </ul>
      </details>

      <details>
        <summary>Q. 다른 PC로 작업 내용을 옮기려면?</summary>
        <ul>
          <li>현재는 COCO JSON 내보내기로 각 이미지별 라벨을 받아 보관할 수 있습니다</li>
          <li>팀 공유는 Phase 2에서 추가 예정 (서버 동기화)</li>
        </ul>
      </details>

      <details>
        <summary>Q. 줌 감도가 너무 세거나 약해요</summary>
        <ul>
          <li>현재 지수형 줌(0.0005 sensitivity)으로 튜닝되어 있습니다</li>
          <li>마우스/트랙패드별 차이가 크면 알려주세요 — 추가 조정 가능</li>
        </ul>
      </details>

      <details>
        <summary>Q. 25개 척추체를 다 라벨링할 수 없는 이미지는?</summary>
        <ul>
          <li>보이는 만큼만 라벨링하면 됩니다 — 시작 라벨부터 순서대로 자동 할당됨</li>
          <li>예: 흉추만 보이는 이미지 → 시작 라벨 T1로 설정, 12개 폴리곤 → T1~T12</li>
        </ul>
      </details>
    </section>

    <footer class="manual-footer">
      <p>
        <i class="fas fa-bone"></i> Spine Annotator · Phase 1 MVP<br/>
        피드백·버그 제보: <a href="/annotate">라벨링 화면</a>으로 돌아가서 작업을 계속하세요.
      </p>
    </footer>

  </main>
</body>
</html>`)
})

export default app
