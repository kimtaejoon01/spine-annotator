/* ================================================================
   Spine Annotator - 메인 진입점
   ================================================================ */

import { SpineAnnotator } from './annotator.js'
import { LABELS, ALL_LABELS, parseFilename, getRegionColor } from './labels.js'
import { exportToCOCO } from './coco.js'
import { installLat5PointLandmarks } from './landmark-tools.js'
import { renderSagittalMeasurementPanel } from './measurements.js'
import { initNotesModule, loadCurrentNote as loadCurrentNoteFromModule } from './modules/notes.js'
import { initVisibilityControls, refreshVisibilityControls } from './modules/visibility.js'
import { initPreprocessUI } from './preprocess-ui.js'
import { initAutoEndplateUI } from './auto-endplate-ui.js'
import {
  ACTIONS,
  normalizeKey,
  loadShortcuts,
  saveShortcuts,
  resetShortcuts,
  findAction,
  displayKey,
  groupActionsByCategory,
  isForbidden,
} from './shortcuts.js'
import {
  isSupported as isFsSupported,
  pickFolder,
  restoreFolder,
  forgetFolder,
  ensurePermission,
  queryPermission,
  listImageFiles,
  fileHandleToUrl,
} from './fs.js'
import {
  LABELERS,
  getCurrentLabelerId,
  getCurrentLabeler,
  setCurrentLabeler,
  getLabelerById,
  labelerDisplay,
} from './labelers.js'
import {
  verifyPassword,
  hasAuthToken,
  setAuthToken,
  listLabelMeta,
  getCachedLabelMeta,
  loadLabel,
  saveLabel,
  deleteLabel,
  loadNote,
  saveNote,
  exportNotes,
  exportAll,
  getStats,
  migrateLegacyLabels,
  findLegacyLabels,
  flushPendingSaves,
  sendPresence,
  clearPresence,
  clearPresenceBeacon,
  syncState,
} from './api.js'

// 서버 라벨 메타 캐시 (파일목록 점 색용)
let serverLabelMetaMap = new Map() // filename → {labeler_id, polygon_count, updated_at, view_type}

// 실시간 presence (다른 사람이 작업 중인 파일)
// filename → [{ labeler_id, seconds_ago }, ...]
let presenceMap = new Map()

// 폴링 타이머
let pollTimer = null
const POLL_INTERVAL_MS = 2000  // 5초 → 2초로 단축
const LABEL_OVERLAY_VISIBLE_KEY = 'spine-annotator:label-overlay-visible'
const HUMAN_LABEL_VISIBLE_KEY = 'spine-annotator:human-label-visible'

// 전역 상태
const state = {
  annotator: null,
  filename: 'sample.png',
  viewType: 'AP',
  patientId: '',
  studyDate: '',
  imageWidth: 0,
  imageHeight: 0,
  labelVersion: null,
  landmarkApi: null,
  shortcuts: loadShortcuts(), // 사용자 단축키 매핑

  // 로컬 폴더 연결
  folderHandle: null,        // FileSystemDirectoryHandle
  folderName: '',            // 표시용
  files: [],                 // [{name, handle}] 정렬된 이미지 파일 목록
  fileFilter: 'all',         // 'all' | 'AP' | 'LAT'
  fileSearch: '',            // 검색어 (lowercase)
  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용),

  // 파일별 메모장 (라벨/COCO와 분리)
  noteLoading: false,
  noteSaveTimer: null,
  noteLastSavedAt: null,

  // AI mask 오버레이
  aiFolderHandle: null,
  aiFolderName: '',
  aiFiles: [],
  aiByBase: new Map(),
  aiSelectedModel: { cervical: '', thoracic: '', lumbar: '' },
  aiRegionVisible: { cervical: true, thoracic: true, lumbar: true },
  aiMaskVisible: false,
  aiCompareVisible: true,
  aiCompareRenderToken: 0,
  aiCompareCache: new Map(),
  aiCompareZoom: 1,
  aiComparePanX: 0,
  aiComparePanY: 0,
  aiCompareDragging: false,
  aiOpacity: 45,
  aiObjectUrls: [],
  aiLoadToken: 0,
  humanLabelVisible: loadHumanLabelVisible(),
  labelOverlayVisible: loadLabelOverlayVisible(),
  lineNameVisible: true,
  originalOnly: false,
}


// ================================================================
// 검수용 표시 토글
// ================================================================
function loadHumanLabelVisible() {
  try {
    const raw = localStorage.getItem(HUMAN_LABEL_VISIBLE_KEY)
    return raw == null ? true : raw !== 'false'
  } catch {
    return true
  }
}

function loadLabelOverlayVisible() {
  try {
    const raw = localStorage.getItem(LABEL_OVERLAY_VISIBLE_KEY)
    return raw == null ? true : raw !== 'false'
  } catch {
    return true
  }
}

function setHumanLabelVisible(visible) {
  state.humanLabelVisible = visible !== false
  try { localStorage.setItem(HUMAN_LABEL_VISIBLE_KEY, String(state.humanLabelVisible)) } catch {}
  if (state.annotator && typeof state.annotator.setHumanLabelVisible === 'function') {
    state.annotator.setHumanLabelVisible(state.humanLabelVisible)
  }
}

function setLabelOverlayVisible(visible) {
  state.labelOverlayVisible = visible !== false
  try { localStorage.setItem(LABEL_OVERLAY_VISIBLE_KEY, String(state.labelOverlayVisible)) } catch {}
  if (state.annotator && typeof state.annotator.setLabelOverlayVisible === 'function') {
    state.annotator.setLabelOverlayVisible(state.labelOverlayVisible)
  }
}

function bindLabelOverlayToggle() {
  const human = document.getElementById('toggleLabelOverlay')
  if (human) {
    human.checked = state.humanLabelVisible !== false
    const span = human.closest('label')?.querySelector('span')
    if (span) span.textContent = '사람 라벨 보기'
    if (!human.dataset.correctHumanLabelBound) {
      human.dataset.correctHumanLabelBound = '1'
      human.addEventListener('change', (e) => {
        e.stopImmediatePropagation()
        setHumanLabelVisible(human.checked)
      }, true)
    }
  }

  const lineName = document.getElementById('humanLabelOverlayToggle')
  if (lineName) {
    lineName.checked = state.labelOverlayVisible !== false
    const span = lineName.closest('label')?.querySelector('span')
    if (span) span.textContent = '선/이름표 보기'
    if (!lineName.dataset.correctLineNameBound) {
      lineName.dataset.correctLineNameBound = '1'
      lineName.addEventListener('change', (e) => {
        e.stopImmediatePropagation()
        setLabelOverlayVisible(lineName.checked)
      }, true)
    }
  }

  setHumanLabelVisible(state.humanLabelVisible !== false)
  setLabelOverlayVisible(state.labelOverlayVisible !== false)
}

// ================================================================
// 초기화
// ================================================================
window.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('canvasStage')) return
  console.log('[App] Initializing Spine Annotator...')

  // Annotator 인스턴스 생성
  state.annotator = new SpineAnnotator({
    container: 'canvasStage',
    onPolygonsChange: handlePolygonsChange,
    onZoomChange: handleZoomChange,
    onStatusChange: handleStatusChange,
  })
  state.landmarkApi = installLat5PointLandmarks({
    annotator: state.annotator,
    getViewType: () => state.viewType,
    onChange: () => {
      refreshSagittalMeasurements()
      autoSave()
    },
  })
  window.__spineAnnotator = state.annotator
  window.__spineState = state

  // 전처리 뷰 UI 초기화 (프리셋 토글 + 파라미터 패널)
  try { initPreprocessUI(state.annotator) } catch (e) { console.error('preprocess UI init 실패', e) }

  // 폴리곤 자동 측정 UI 초기화
  try { initAutoEndplateUI(state.annotator) } catch (e) { console.error('auto-endplate UI init 실패', e) }

  installPelvisRuntimeFinalFixes()

  // UI 이벤트 바인딩
  bindUIEvents()
  setTimeout(ensurePelvisPanelCollapseHardFix, 0) // PELVIS_PANEL_COLLAPSE_HARD_CALL_BIND
  setTimeout(initRightSidebarCompactUI, 0)
  initVisibilityControls({ state, annotator: state.annotator })
  bindKeyboardEvents()

  // 단축키 UI 초기 렌더링
  renderShortcutList()

  // 라벨러 UI 초기화
  initLabelerUI()

  // 인증 UI 초기화
  initAuthUI()

  // 인증 토큰 없으면 비밀번호 모달 띄우고 대기
  if (!hasAuthToken()) {
    openAuthModal()
    return  // 인증 완료 후 콜백에서 나머지 초기화
  }

  // 토큰 있으면 정상 초기화
  await continueAfterAuthSuccess()
})

/**
 * 인증 완료 후 초기화 단계
 */
async function postAuthInit() {
  // 서버에서 라벨 메타 받아오기 (파일 목록 점 색용)
  try {
    const items = await listLabelMeta()
    serverLabelMetaMap.clear()
    for (const item of items) {
      serverLabelMetaMap.set(item.filename, item)
    }
    console.log(`[App] Loaded ${items.length} label metas from server`)
  } catch (err) {
    console.warn('[App] Failed to load label metas:', err)
    if (err.status === 401) {
      openAuthModal()
      return
    }
  }

  // 옛 LocalStorage 데이터 마이그레이션 알림
  const legacy = findLegacyLabels()
  if (legacy.length > 0) {
    console.log(`[App] Found ${legacy.length} legacy labels in LocalStorage, offering migration`)
    setTimeout(() => offerLegacyMigration(legacy.length), 1500)
  }

  // 보류 중인 저장 재시도
  flushPendingSaves().then(results => {
    if (results.length > 0) console.log('[App] Flushed pending saves:', results)
  }).catch(() => {})

  // 로컬 폴더 자동 복원 시도 (실패해도 무시)
  await tryRestoreFolder()
  await tryRestoreAiFolder()

  // 폴더가 복원되지 않았으면 샘플 이미지 자동 로드
  if (!state.folderHandle) {
    await loadSampleImage()
  }

  // 라벨러 미설정이면 선택 모달 자동으로 띄움
  if (!getCurrentLabelerId()) {
    setTimeout(() => openLabelerModal(), 300)
  }

  // 실시간 폴링 시작 (5초마다 라벨 메타 + presence 갱신)
  startPolling()

  // 창 닫을 때 presence 정리 (keepalive fetch + DELETE)
  window.addEventListener('beforeunload', () => {
    const lid = getCurrentLabelerId()
    if (lid) clearPresenceBeacon(lid)
  })

  // 탭 전환 시 presence 일시 정지/재개
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // 백그라운드 가면 폴링 중지 (5초마다 일하지 않게)
      stopPolling()
    } else {
      // 다시 포커스 받으면 즉시 한 번 동기화하고 폴링 재개
      pollUpdates()
      startPolling()
    }
  })

  initPelvisLabelControls()
  ensurePelvisPanelCollapseHardFix() // PELVIS_PANEL_COLLAPSE_HARD_CALL_AFTER_INIT
  initRightSidebarCompactUI()
  renderSagittalMeasurementPanel([], {
    filename: state.filename,
    viewType: state.viewType,
    landmarks: state.annotator?.getLandmarks?.() || [],
  })
  initPelvisLabelControls()
  initRightSidebarCompactUI()
  renderSagittalMeasurementPanel([], {
    filename: state.filename,
    viewType: state.viewType,
    landmarks: state.annotator?.getLandmarks?.() || [],
  })
  console.log('[App] Ready.')
  ensurePelvisPanelCollapseHardFix() // PELVIS_PANEL_COLLAPSE_HARD_CALL_READY
}

// ----------------------------------------------------------------
// 실시간 폴링 (5초마다 라벨 메타 + presence 동기화)
// ----------------------------------------------------------------
function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(pollUpdates, POLL_INTERVAL_MS)
  // 즉시 1회
  pollUpdates()
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollUpdates() {
  const myLabelerId = getCurrentLabelerId()

  // 1) presence heartbeat (내가 어느 파일 작업 중인지 서버에 알림)
  if (myLabelerId) {
    const isRealFile = state.filename
      && state.filename !== 'sample.png'
      && !state.filename.startsWith('sample_')
    sendPresence(myLabelerId, isRealFile ? state.filename : '').catch(() => {})
  }

  // 2) /api/sync 한 번에 라벨 메타 + presence 동기화
  try {
    const data = await syncState()
    if (!data || !data.ok) return

    const serverTime = data.server_time ? new Date(data.server_time).getTime() : Date.now()

    // ── 라벨 메타 업데이트 — 변경 감지
    let metaChanged = false
    const newMetaMap = new Map()
    for (const item of (data.labels || [])) newMetaMap.set(item.filename, item)

    if (newMetaMap.size !== serverLabelMetaMap.size) {
      metaChanged = true
    } else {
      for (const [fn, item] of newMetaMap) {
        const old = serverLabelMetaMap.get(fn)
        if (!old || old.updated_at !== item.updated_at || old.polygon_count !== item.polygon_count) {
          metaChanged = true
          break
        }
      }
    }
    serverLabelMetaMap = newMetaMap

    // ── presence 업데이트 (내 자신 제외, seconds_ago 계산)
    let presenceChanged = false
    const newPresenceMap = new Map()
    for (const p of (data.presence || [])) {
      if (p.labeler_id === myLabelerId) continue
      const lastSeenMs = new Date(p.last_seen).getTime()
      const secondsAgo = Math.max(0, Math.round((serverTime - lastSeenMs) / 1000))
      const enriched = { ...p, seconds_ago: secondsAgo }
      const arr = newPresenceMap.get(p.filename) || []
      arr.push(enriched)
      newPresenceMap.set(p.filename, arr)
    }
    // presence 변경 감지 (사람/파일 조합 바뀌었는지)
    const oldKeys = JSON.stringify([...presenceMap.entries()].map(([k, v]) => [k, v.map(x => x.labeler_id).sort()]).sort())
    const newKeys = JSON.stringify([...newPresenceMap.entries()].map(([k, v]) => [k, v.map(x => x.labeler_id).sort()]).sort())
    if (oldKeys !== newKeys) presenceChanged = true
    presenceMap = newPresenceMap

    // ── UI 갱신
    if ((metaChanged || presenceChanged) && state.files.length > 0) {
      renderFileList()
    }

    // ── 현재 열려있는 파일에 대한 처리
    if (state.filename) {
      // (a) 다른 사람이 지금 내 파일을 함께 보고 있는지 → 경고 배너
      updateCollisionBanner(state.filename, myLabelerId)

      // (b) 다른 사람이 방금 저장했는지 → 자동 갱신 또는 토스트
      const meta = serverLabelMetaMap.get(state.filename)
      if (meta && meta.labeler_id && meta.labeler_id !== myLabelerId) {
        const lastSeen = meta.updated_at
        if (lastSeen !== state.lastSeenRemoteUpdate) {
          state.lastSeenRemoteUpdate = lastSeen
          if (state.lastSeenRemoteUpdateInitialized) {
            // 두 번째 이후 변경 → 사용자에게 확인 후 갱신
            const labeler = getLabelerById(meta.labeler_id)
            handleRemoteUpdate(state.filename, labeler ? labeler.name : meta.labeler_id, meta.polygon_count)
          }
          state.lastSeenRemoteUpdateInitialized = true
        }
      }
    }
  } catch (e) {
    // 폴링 실패는 조용히 (네트워크 일시 단절)
  }
}

/**
 * 현재 파일에 다른 사람이 동시에 작업 중이면 상단에 경고 배너 표시
 */
function updateCollisionBanner(filename, myLabelerId) {
  let banner = document.getElementById('collisionBanner')

  // 내 파일에 대한 다른 사람 presence
  const watchers = (presenceMap.get(filename) || []).filter(w => w.labeler_id !== myLabelerId)

  if (watchers.length === 0) {
    if (banner) banner.classList.remove('show')
    return
  }

  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'collisionBanner'
    banner.className = 'collision-banner'
    document.body.appendChild(banner)
  }

  const names = watchers.map(w => {
    const lab = getLabelerById(w.labeler_id)
    return lab ? lab.name : w.labeler_id
  })
  const colorDots = watchers.map(w => {
    const lab = getLabelerById(w.labeler_id)
    const color = lab ? lab.color : '#888'
    return `<span class="collision-dot" style="background:${color}"></span>`
  }).join('')

  banner.innerHTML = `
    <i class="fas fa-exclamation-triangle"></i>
    ${colorDots}
    <strong>${escapeHtml(names.join(', '))}</strong>님이 같은 파일을 보고 있습니다.
    <span class="collision-hint">동시 편집은 서로의 작업을 덮어쓸 수 있어요.</span>
  `
  banner.classList.add('show')
}

/**
 * 다른 사람이 저장한 변경분을 어떻게 적용할지
 * - 내가 폴리곤을 안 그리고 있으면 → 조용히 자동 새로고침
 * - 내가 작업 중이면 → 토스트 + "지금 새로고침" 버튼
 */
function handleRemoteUpdate(filename, remoteName, polygonCount) {
  if (!state.annotator) return

  // 현재 내 폴리곤이 비어있거나, 캔버스에 별다른 작업 안 했으면 자동 갱신
  const myPolygons = state.annotator.getPolygons() || []
  const isEmpty = myPolygons.length === 0

  if (isEmpty) {
    console.log(`[Sync] Auto-refreshing ${filename} from ${remoteName}`)
    loadLabelsFromStorage(filename).catch(() => {})
    showRemoteUpdateNotice(remoteName, polygonCount, false)
  } else {
    // 내 작업이 있으면 자동 덮어쓰기 위험 → 토스트로 묻기
    showRemoteUpdateNotice(remoteName, polygonCount, true)
  }
}

function showConflictNotice(err) {
  let toast = document.getElementById('remoteUpdateToast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'remoteUpdateToast'
    toast.className = 'remote-update-toast'
    document.body.appendChild(toast)
  }

  toast.innerHTML = `
    <div class="toast-msg">
      <i class="fas fa-exclamation-triangle"></i>
      다른 사용자가 먼저 저장했습니다. 현재 파일의 최신 라벨을 불러와야 합니다.
    </div>
    <div class="toast-actions">
      <button class="toast-btn toast-btn-primary" id="toastReloadBtn">
        <i class="fas fa-download"></i> 최신 불러오기
      </button>
      <button class="toast-btn" id="toastDismissBtn">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `
  const reloadBtn = toast.querySelector('#toastReloadBtn')
  const dismissBtn = toast.querySelector('#toastDismissBtn')
  if (reloadBtn) reloadBtn.addEventListener('click', () => {
    if (!confirm('현재 작업 중인 라벨이 서버 데이터로 교체됩니다. 진행할까요?')) return
    loadLabelsFromStorage(state.filename).catch(() => {})
    toast.classList.remove('show')
  })
  if (dismissBtn) dismissBtn.addEventListener('click', () => toast.classList.remove('show'))
  toast.classList.add('show', 'with-actions')
  clearTimeout(toast._hideTimer)
}

function showRemoteUpdateNotice(name, count, needsConfirm = false) {
  let toast = document.getElementById('remoteUpdateToast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'remoteUpdateToast'
    toast.className = 'remote-update-toast'
    document.body.appendChild(toast)
  }

  if (needsConfirm) {
    // 내 작업 있을 때 — 사용자가 직접 누르도록
    toast.innerHTML = `
      <div class="toast-msg">
        <i class="fas fa-sync"></i>
        <strong>${escapeHtml(name)}</strong>님이 이 파일을 저장했습니다 (${count}개 라벨).
      </div>
      <div class="toast-actions">
        <button class="toast-btn toast-btn-primary" id="toastReloadBtn">
          <i class="fas fa-download"></i> 최신 불러오기
        </button>
        <button class="toast-btn" id="toastDismissBtn">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `
    const reloadBtn = toast.querySelector('#toastReloadBtn')
    const dismissBtn = toast.querySelector('#toastDismissBtn')
    if (reloadBtn) reloadBtn.addEventListener('click', () => {
      if (!confirm('현재 작업 중인 라벨이 서버 데이터로 교체됩니다. 진행할까요?')) return
      loadLabelsFromStorage(state.filename).catch(() => {})
      toast.classList.remove('show')
    })
    if (dismissBtn) dismissBtn.addEventListener('click', () => toast.classList.remove('show'))
    toast.classList.add('show', 'with-actions')
    clearTimeout(toast._hideTimer)
    // 액션 토스트는 자동으로 안 사라짐
  } else {
    // 자동 갱신 알림
    toast.classList.remove('with-actions')
    toast.innerHTML = `
      <div class="toast-msg">
        <i class="fas fa-check-circle"></i>
        <strong>${escapeHtml(name)}</strong>님의 최신 작업 (${count}개 라벨)을 불러왔습니다.
      </div>
    `
    toast.classList.add('show')
    clearTimeout(toast._hideTimer)
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 4000)
  }
}

/**
 * 옛 LocalStorage 데이터를 서버로 옮길지 묻기
 */
async function offerLegacyMigration(count) {
  const ok = confirm(
    `📦 옛 브라우저 저장소에서 라벨 ${count}개를 발견했습니다.\n\n` +
    `서버로 업로드해서 영구 보존할까요?\n\n` +
    `[확인] 서버로 옮기기 (LocalStorage는 백업으로 유지)\n` +
    `[취소] 나중에`
  )
  if (!ok) return
  try {
    const results = await migrateLegacyLabels({ deleteAfter: false })
    const ok = results.filter(r => r.ok).length
    const fail = results.filter(r => !r.ok).length
    alert(`마이그레이션 완료\n성공: ${ok}개\n실패: ${fail}개`)
    // 서버 메타 다시 로드
    const items = await listLabelMeta()
    serverLabelMetaMap.clear()
    for (const item of items) serverLabelMetaMap.set(item.filename, item)
    if (state.files.length > 0) renderFileList()
  } catch (err) {
    alert('마이그레이션 실패: ' + err.message)
  }
}

// ================================================================
// UI 이벤트
// ================================================================
function bindUIEvents() {
  // 시작 척추뼈 변경
  document.getElementById('startVertebra').addEventListener('change', (e) => {
    state.annotator.setStartLabel(e.target.value)
  })

  // 이미지 조정
  const brightness = document.getElementById('brightness')
  const contrast = document.getElementById('contrast')
  const invert = document.getElementById('invertImage')

  brightness.addEventListener('input', (e) => {
    document.getElementById('brightnessValue').textContent = e.target.value
    state.annotator.setImageFilter({
      brightness: parseFloat(e.target.value),
      contrast: parseFloat(contrast.value),
      invert: invert.checked,
    })
  })
  contrast.addEventListener('input', (e) => {
    document.getElementById('contrastValue').textContent = e.target.value
    state.annotator.setImageFilter({
      brightness: parseFloat(brightness.value),
      contrast: parseFloat(e.target.value),
      invert: invert.checked,
    })
  })
  invert.addEventListener('change', () => {
    state.annotator.setImageFilter({
      brightness: parseFloat(brightness.value),
      contrast: parseFloat(contrast.value),
      invert: invert.checked,
    })
  })

  document.getElementById('resetImageBtn').addEventListener('click', () => {
    brightness.value = 0
    contrast.value = 0
    invert.checked = false
    document.getElementById('brightnessValue').textContent = '0'
    document.getElementById('contrastValue').textContent = '0'
    state.annotator.setImageFilter({ brightness: 0, contrast: 0, invert: false })
  })

  // 줌
  document.getElementById('zoomInBtn').addEventListener('click', () => {
    state.annotator.zoomBy(1.2)
  })
  document.getElementById('zoomOutBtn').addEventListener('click', () => {
    state.annotator.zoomBy(1 / 1.2)
  })
  document.getElementById('zoomFitBtn').addEventListener('click', () => {
    state.annotator.zoomToFit()
  })
  document.getElementById('zoom100Btn').addEventListener('click', () => {
    state.annotator.zoomTo(1)
  })

  // 도구
  document.getElementById('toolDraw').addEventListener('click', () => setTool('draw'))
  document.getElementById('toolEdit').addEventListener('click', () => setTool('edit'))
  document.getElementById('toolDelete').addEventListener('click', () => setTool('delete'))

  // 사이드바 접기/펼치기 + 너비 조절
  bindSidebarControls()

  // Undo/Redo
  document.getElementById('undoBtn').addEventListener('click', () => state.annotator.undo())
  document.getElementById('redoBtn').addEventListener('click', () => state.annotator.redo())

  // 모두 지우기
  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (confirm('모든 라벨을 지우시겠습니까?')) {
      state.annotator.clearAll()
    }
  })

  // 파일별 메모장
  initNotesModule({
    state,
    loadNote,
    saveNote,
    exportNotes,
    getCurrentLabelerId,
    openAuthModal,
  })

  // 파일 업로드
  document.getElementById('fileUpload').addEventListener('change', handleFileUpload)
  document.getElementById('loadSampleBtn').addEventListener('click', loadSampleImage)

  // 폴더 연결
  document.getElementById('connectFolderBtn').addEventListener('click', handleConnectFolder)

  // 보기 / AI mask 오버레이
  bindOverlayControls()

  // 파일 검색
  const searchInput = document.getElementById('fileSearch')
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.fileSearch = e.target.value.toLowerCase().trim()
      renderFileList()
    })
  }

  // AP/LAT 필터
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.fileFilter = btn.dataset.filter
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      renderFileList()
    })
  })

  // Export
  document.getElementById('exportBtn').addEventListener('click', showCocoPreview)
  document.getElementById('exportAllBtn').addEventListener('click', openExportAllModal)
  document.getElementById('closeExportAllBtn').addEventListener('click', closeExportAllModal)
  document.getElementById('exportRefreshBtn').addEventListener('click', refreshExportStats)
  document.getElementById('exportDownloadBtn').addEventListener('click', handleExportAllDownload)
  document.getElementById('exportAllModal').addEventListener('click', (e) => {
    if (e.target.id === 'exportAllModal') closeExportAllModal()
  })
  document.getElementById('closeCocoBtn').addEventListener('click', () => {
    document.getElementById('cocoModal').classList.add('hidden')
  })
  document.getElementById('copyCocoBtn').addEventListener('click', copyCocoJson)
  document.getElementById('downloadCocoBtn').addEventListener('click', downloadCocoJson)

  // 단축키 설정 모달 (헤더 버튼 + 우측 패널 버튼 둘 다 연결)
  document.getElementById('openShortcutsBtn').addEventListener('click', () => openShortcutsModal())
  const headerKeymapBtn = document.getElementById('openKeymapBtn')
  if (headerKeymapBtn) {
    headerKeymapBtn.addEventListener('click', () => openShortcutsModal())
  }
  document.getElementById('closeShortcutsBtn').addEventListener('click', closeShortcutsModal)
  document.getElementById('closeShortcutsBtn2').addEventListener('click', closeShortcutsModal)
  document.getElementById('resetShortcutsBtn').addEventListener('click', () => {
    if (confirm('모든 단축키를 기본값으로 복원할까요?')) {
      state.shortcuts = resetShortcuts()
      renderShortcutList()
      renderShortcutsEditor()
    }
  })
  // 모달 배경 클릭으로 닫기
  document.getElementById('shortcutsModal').addEventListener('click', (e) => {
    if (e.target.id === 'shortcutsModal') closeShortcutsModal()
  })

  // 초기 사이드바 단축키 목록 렌더링
  renderShortcutList()
}

function setTool(tool) {
  const landmarkMode = state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon'
  if (landmarkMode) {
    state.annotator.setFreehandMode?.(false)
    state.annotator.cancelDrawing?.()
  }
  state.annotator.setTool(tool)
  state.annotator.renderLandmarks?.()
  state.annotator.enforceAnnotationModeVisibility?.()
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tool' + tool[0].toUpperCase() + tool.slice(1)).classList.add('active')
}

// ================================================================
// 보기 / AI mask 오버레이
// ================================================================
const AI_REGIONS = [
  { id: 'cervical', label: 'Cervical', color: '#bc8cff' },
  { id: 'thoracic', label: 'Thoracic', color: '#58a6ff' },
  { id: 'lumbar', label: 'Lumbar', color: '#3fb950' },
]

function bindOverlayControls() {
  const labelToggle = document.getElementById('toggleLabelOverlay')
  if (labelToggle) {
    labelToggle.checked = state.labelOverlayVisible
    labelToggle.addEventListener('change', (e) => {
      state.originalOnly = false
      updateOriginalOnlyButton()
      setHumanLabelVisible(e.target.checked)
    })
  }
  ensureAiComparePanel()
  injectAiCompareControls()
  const aiToggle = document.getElementById('toggleAiOverlay')
  if (aiToggle) {
    const labelSpan = aiToggle.closest('label')?.querySelector('span')
    if (labelSpan) labelSpan.textContent = '현재 화면에 AI 겹쳐보기'
    aiToggle.checked = state.aiMaskVisible
    aiToggle.addEventListener('change', (e) => {
      state.aiMaskVisible = e.target.checked
      state.originalOnly = false
      updateOriginalOnlyButton()
      state.annotator.setAiMaskVisible(state.aiMaskVisible)
      applyAiOverlayForCurrentFile().catch(() => {})
    })
  }
  const opacity = document.getElementById('aiOpacity')
  if (opacity) {
    opacity.value = String(state.aiOpacity)
    const value = document.getElementById('aiOpacityValue')
    if (value) value.textContent = String(state.aiOpacity)
    opacity.addEventListener('input', (e) => {
      state.aiOpacity = Number(e.target.value)
      if (value) value.textContent = String(state.aiOpacity)
      state.annotator.setAiMaskOpacity(state.aiOpacity)
      updateAiComparePanel(state.currentAiCompareItems || []).catch(() => {})
    })
  }
  const originalOnlyBtn = document.getElementById('originalOnlyBtn')
  if (originalOnlyBtn) originalOnlyBtn.addEventListener('click', toggleOriginalOnly)
  const connectAiBtn = document.getElementById('connectAiFolderBtn')
  if (connectAiBtn) connectAiBtn.addEventListener('click', handleConnectAiFolder)
  const refreshAiBtn = document.getElementById('refreshAiFolderBtn')
  if (refreshAiBtn) refreshAiBtn.addEventListener('click', () => scanAiFolder().catch(err => alert('AI 폴더 새로고침 실패: ' + err.message)))
  renderAiRegionControls()
  updateAiFolderStatus()
}

function injectAiCompareControls() {
  if (document.getElementById('toggleAiCompare')) return
  const status = document.getElementById('aiFolderStatus')
  if (!status) return
  status.insertAdjacentHTML('afterend', '<div class="control-group"><label class="checkbox-label"><input type="checkbox" id="toggleAiCompare" checked /><span>AI 비교창 보기</span></label></div>')
  const cb = document.getElementById('toggleAiCompare')
  cb.checked = state.aiCompareVisible
  cb.addEventListener('change', (e) => {
    state.aiCompareVisible = e.target.checked
    updateAiComparePanel(state.currentAiCompareItems || []).catch(() => {})
  })
}

function ensureAiComparePanel() {
  if (document.getElementById('aiComparePanel')) return
  const container = document.getElementById('canvasContainer')
  if (!container) return
  const panel = document.createElement('div')
  panel.id = 'aiComparePanel'
  panel.className = 'ai-compare-panel hidden'
  panel.innerHTML = '<div class="ai-compare-header"><span><i class="fas fa-robot"></i> AI 비교</span><div class="ai-compare-actions"><button class="btn-icon" id="aiCompareZoomOut" title="축소"><i class="fas fa-search-minus"></i></button><button class="btn-icon" id="aiCompareZoomReset" title="맞춤"><span>100</span></button><button class="btn-icon" id="aiCompareZoomIn" title="확대"><i class="fas fa-search-plus"></i></button><button class="btn-icon" id="closeAiComparePanel" title="비교창 닫기"><i class="fas fa-times"></i></button></div></div><div class="ai-compare-body"><div class="ai-compare-stage"><div class="ai-compare-image-wrap"><canvas id="aiCompareCanvas"></canvas></div></div><div id="aiCompareCaption" class="ai-compare-caption">AI mask 폴더를 연결하세요</div></div>'
  container.appendChild(panel)
  document.getElementById('closeAiComparePanel')?.addEventListener('click', () => {
    state.aiCompareVisible = false
    const cb = document.getElementById('toggleAiCompare')
    if (cb) cb.checked = false
    updateAiComparePanel([]).catch(() => {})
  })
  initAiCompareZoomControls()
}

function initAiCompareZoomControls() {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  if (!stage || stage.dataset.zoomReady === '1') return
  stage.dataset.zoomReady = '1'

  document.getElementById('aiCompareZoomIn')?.addEventListener('click', () => zoomAiCompareAtCenter((state.aiCompareZoom || 1) * 1.2))
  document.getElementById('aiCompareZoomOut')?.addEventListener('click', () => zoomAiCompareAtCenter((state.aiCompareZoom || 1) / 1.2))
  document.getElementById('aiCompareZoomReset')?.addEventListener('click', () => resetAiCompareZoom())

  stage.addEventListener('wheel', (e) => {
    e.preventDefault()

    // 본 앱 라벨링 캔버스와 같은 wheel 정규화/감도 로직.
    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= 16
    else if (e.deltaMode === 2) dy *= 100
    dy = Math.max(-200, Math.min(200, dy))
    const sensitivity = 0.0005
    const factor = Math.exp(-dy * sensitivity)

    const rect = stage.getBoundingClientRect()
    zoomAiCompareAtPoint((state.aiCompareZoom || 1) * factor, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }, { passive: false })

  stage.addEventListener('pointerdown', (e) => {
    state.aiCompareDragging = true
    state.aiCompareDragStartX = e.clientX
    state.aiCompareDragStartY = e.clientY
    state.aiCompareStartPanX = state.aiComparePanX || 0
    state.aiCompareStartPanY = state.aiComparePanY || 0
    stage.setPointerCapture?.(e.pointerId)
    stage.classList.add('dragging')
    e.preventDefault()
  })

  stage.addEventListener('pointermove', (e) => {
    if (!state.aiCompareDragging) return
    state.aiComparePanX = (state.aiCompareStartPanX || 0) + (e.clientX - state.aiCompareDragStartX)
    state.aiComparePanY = (state.aiCompareStartPanY || 0) + (e.clientY - state.aiCompareDragStartY)
    applyAiCompareTransform()
    e.preventDefault()
  })

  const stopDrag = (e) => {
    if (!state.aiCompareDragging) return
    state.aiCompareDragging = false
    stage.releasePointerCapture?.(e.pointerId)
    stage.classList.remove('dragging')
    e.preventDefault()
  }
  stage.addEventListener('pointerup', stopDrag)
  stage.addEventListener('pointercancel', stopDrag)
  stage.addEventListener('dblclick', () => resetAiCompareZoom())
}

function zoomAiCompareAtCenter(newScale) {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  if (!stage) return
  zoomAiCompareAtPoint(newScale, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 })
}

function zoomAiCompareAtPoint(newScale, point) {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  if (!stage || !wrap) return

  newScale = Math.max(0.25, Math.min(20, Number(newScale) || 1))
  const oldScale = state.aiCompareZoom || 1

  const layoutX = wrap.offsetLeft
  const layoutY = wrap.offsetTop
  const panX = state.aiComparePanX || 0
  const panY = state.aiComparePanY || 0

  // 본 앱의 zoomAtPoint와 같은 원리:
  // 포인터 아래의 이미지 좌표가 줌 전/후에도 같은 위치에 남도록 pan을 재계산합니다.
  const pointTo = {
    x: (point.x - layoutX - panX) / oldScale,
    y: (point.y - layoutY - panY) / oldScale,
  }

  state.aiCompareZoom = newScale
  state.aiComparePanX = point.x - layoutX - pointTo.x * newScale
  state.aiComparePanY = point.y - layoutY - pointTo.y * newScale
  applyAiCompareTransform()
}

function resetAiCompareZoom() {
  state.aiCompareZoom = 1
  state.aiComparePanX = 0
  state.aiComparePanY = 0
  applyAiCompareTransform()
}

function applyAiCompareTransform() {
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  const resetBtn = document.getElementById('aiCompareZoomReset')
  if (!wrap) return
  const z = state.aiCompareZoom || 1
  wrap.style.transform = 'translate(' + (state.aiComparePanX || 0) + 'px, ' + (state.aiComparePanY || 0) + 'px) scale(' + z + ')'
  wrap.style.transformOrigin = '0 0'
  wrap.classList.toggle('zoomed', z > 1)
  if (resetBtn) resetBtn.textContent = Math.round(z * 100)
}


async function updateAiComparePanel(maskItems = []) {
  ensureAiComparePanel()
  state.currentAiCompareItems = maskItems
  const panel = document.getElementById('aiComparePanel')
  const canvas = document.getElementById('aiCompareCanvas')
  const caption = document.getElementById('aiCompareCaption')
  if (!panel || !canvas || !caption) return

  const show = state.aiCompareVisible && !state.originalOnly && !!state.currentImageUrl
  panel.classList.toggle('hidden', !show)
  if (!show) return

  const renderToken = (state.aiCompareRenderToken || 0) + 1
  state.aiCompareRenderToken = renderToken

  try {
    const names = await renderAiCompareCanvas(canvas, maskItems, renderToken)
    if (renderToken !== state.aiCompareRenderToken) return
    if (!maskItems.length) caption.textContent = '현재 이미지에 매칭된 AI mask가 없습니다.'
    else caption.textContent = names.length ? names.join(' / ') : 'AI mask를 표시하지 못했습니다. 폴더 새로고침을 눌러보세요.'
  } catch (err) {
    if (renderToken !== state.aiCompareRenderToken) return
    console.warn('[AI compare] canvas render failed:', err)
    caption.textContent = 'AI 비교창 렌더링 실패: ' + (err.message || err)
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function renderAiCompareCanvas(canvas, maskItems = [], renderToken = 0) {
  const baseImg = await loadImageElement(state.currentImageUrl)
  if (renderToken !== state.aiCompareRenderToken) return []

  const w = baseImg.naturalWidth || baseImg.width
  const h = baseImg.naturalHeight || baseImg.height
  if (!w || !h) throw new Error('원본 이미지 크기를 읽지 못했습니다')

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(baseImg, 0, 0, w, h)

  const alphaScale = Math.max(0, Math.min(100, Number(state.aiOpacity || 45))) / 100
  const names = []

  for (const item of maskItems) {
    if (renderToken !== state.aiCompareRenderToken) return names
    const maskImg = await loadImageElement(item.url)
    if (renderToken !== state.aiCompareRenderToken) return names

    const rgb = hexToRgbForCompare(item.color || '#58a6ff')
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const tctx = tmp.getContext('2d', { willReadFrequently: true })
    tctx.imageSmoothingEnabled = false

    // 핵심: 원본과 mask를 CSS로 따로 맞추지 않고, 원본 canvas 좌표계에 mask를 직접 리사이즈해서 그립니다.
    // 이렇게 해야 object-fit/브라우저 scaling 때문에 AI mask가 밀려 보이지 않습니다.
    tctx.drawImage(maskImg, 0, 0, w, h)
    const imgData = tctx.getImageData(0, 0, w, h)
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i]
      const g = imgData.data[i + 1]
      const b = imgData.data[i + 2]
      const a = imgData.data[i + 3]
      const bright = Math.max(r, g, b)
      if (a > 0 && bright >= 128) {
        imgData.data[i] = rgb.r
        imgData.data[i + 1] = rgb.g
        imgData.data[i + 2] = rgb.b
        imgData.data[i + 3] = Math.round(230 * alphaScale)
      } else {
        imgData.data[i + 3] = 0
      }
    }
    tctx.putImageData(imgData, 0, 0)
    ctx.drawImage(tmp, 0, 0)
    names.push((item.region || '') + ': ' + (item.modelKey || item.model || 'model'))
  }

  updateAiCompareCanvasSize()
  return names
}

function updateAiCompareCanvasSize() {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  const canvas = document.getElementById('aiCompareCanvas')
  if (!stage || !wrap || !canvas || !canvas.width || !canvas.height) return

  const maxW = Math.max(1, stage.clientWidth - 2)
  const maxH = Math.max(1, stage.clientHeight - 2)
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1)
  const cssW = Math.max(1, Math.round(canvas.width * scale))
  const cssH = Math.max(1, Math.round(canvas.height * scale))
  wrap.style.width = cssW + 'px'
  wrap.style.height = cssH + 'px'
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'
  applyAiCompareTransform()
}

function colorizeMaskForCompare(src, color) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const rgb = hexToRgbForCompare(color)
      const alphaScale = Math.max(0, Math.min(100, Number(state.aiOpacity || 45))) / 100
      for (let i = 0; i < image.data.length; i += 4) {
        const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2], a = image.data[i + 3]
        const bright = Math.max(r, g, b)
        if (a > 0 && bright >= 128) {
          image.data[i] = rgb.r
          image.data[i + 1] = rgb.g
          image.data[i + 2] = rgb.b
          image.data[i + 3] = Math.round(230 * alphaScale)
        } else {
          image.data[i + 3] = 0
        }
      }
      ctx.putImageData(image, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = src
  })
}

function hexToRgbForCompare(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{6})$/i)
  if (!m) return { r: 88, g: 166, b: 255 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toggleOriginalOnly() {
  state.originalOnly = !state.originalOnly
  updateOriginalOnlyButton()
  state.annotator.setLabelOverlayVisible(state.originalOnly ? false : state.labelOverlayVisible)
  state.annotator.setAiMaskVisible(state.originalOnly ? false : state.aiMaskVisible)
  updateAiComparePanel(state.currentAiCompareItems || []).catch(() => {})
}
function updateOriginalOnlyButton() {
  const btn = document.getElementById('originalOnlyBtn')
  if (!btn) return
  btn.classList.toggle('active', state.originalOnly)
  btn.innerHTML = state.originalOnly ? '<i class="fas fa-eye"></i> 원본만 보는 중' : '<i class="fas fa-eye-slash"></i> 원본만 보기'
}
const AI_FOLDER_DB_NAME = 'spine-annotator-fs'
const AI_FOLDER_STORE_NAME = 'handles'
const AI_FOLDER_HANDLE_KEY = 'aiMaskFolder'

function openAiFolderDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AI_FOLDER_DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(AI_FOLDER_STORE_NAME)) db.createObjectStore(AI_FOLDER_STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveAiFolderHandle(handle) {
  try {
    const db = await openAiFolderDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AI_FOLDER_STORE_NAME, 'readwrite')
      tx.objectStore(AI_FOLDER_STORE_NAME).put(handle, AI_FOLDER_HANDLE_KEY)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[AI folder] save failed:', err)
  }
}

async function loadAiFolderHandle() {
  try {
    const db = await openAiFolderDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(AI_FOLDER_STORE_NAME, 'readonly')
      const req = tx.objectStore(AI_FOLDER_STORE_NAME).get(AI_FOLDER_HANDLE_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[AI folder] restore failed:', err)
    return null
  }
}

async function tryRestoreAiFolder() {
  const handle = await loadAiFolderHandle()
  if (!handle) return false
  state.aiFolderHandle = handle
  state.aiFolderName = handle.name || '이전 AI 폴더'
  updateAiFolderStatus('이전 AI 폴더를 다시 연결할 수 있습니다: ' + state.aiFolderName, 'connected')
  renderAiRegionControls()
  try {
    let perm = 'prompt'
    if (typeof handle.queryPermission === 'function') perm = await handle.queryPermission({ mode: 'read' })
    if (perm !== 'granted' && typeof handle.requestPermission === 'function') {
      perm = await handle.requestPermission({ mode: 'read' })
    }
    if (perm === 'granted') {
      await scanAiFolder()
      return true
    }
    updateAiFolderStatus('AI 폴더 권한이 필요합니다. AI 폴더 다시 연결을 눌러주세요: ' + state.aiFolderName, 'empty')
  } catch (err) {
    updateAiFolderStatus('AI 폴더 다시 연결 필요: ' + state.aiFolderName, 'empty')
  }
  return false
}

async function handleConnectAiFolder() {
  if (!window.showDirectoryPicker) { alert('이 브라우저는 AI 폴더 연결을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.'); return }
  try {
    const handle = await window.showDirectoryPicker({ id: 'spine-annotator-ai-results', mode: 'read', startIn: 'pictures' })
    state.aiFolderHandle = handle
    state.aiFolderName = handle.name
    await saveAiFolderHandle(handle)
    await scanAiFolder()
  } catch (err) {
    if (err.name === 'AbortError') return
    alert('AI 폴더 연결 실패: ' + err.message)
  }
}
async function scanAiFolder() {
  if (!state.aiFolderHandle) { updateAiFolderStatus('AI 폴더가 연결되지 않았습니다', 'empty'); return }
  const files = await listAiMaskFilesRecursive(state.aiFolderHandle)
  state.aiFiles = files
  state.aiByBase = new Map()
  for (const item of files) {
    const arr = state.aiByBase.get(item.base) || []
    arr.push(item)
    state.aiByBase.set(item.base, arr)
  }
  updateAiFolderStatus(files.length + '개 AI mask 연결됨', 'connected')
  renderAiRegionControls()
  await applyAiOverlayForCurrentFile()
}
async function listAiMaskFilesRecursive(dirHandle, prefix = '') {
  const out = []
  for await (const [name, entry] of dirHandle.entries()) {
    const relPath = prefix ? prefix + '/' + name : name
    if (entry.kind === 'directory') { out.push(...await listAiMaskFilesRecursive(entry, relPath)); continue }
    const ext = name.split('.').pop()?.toLowerCase()
    if (!['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) continue
    const parsed = parseAiMaskFile(name, relPath)
    if (parsed) out.push({ ...parsed, name, path: relPath, handle: entry })
  }
  out.sort((a, b) => (a.base + '_' + a.region + '_' + a.modelKey).localeCompare(b.base + '_' + b.region + '_' + b.modelKey, undefined, { numeric: true }))
  return out
}
function parseAiMaskFile(name, relPath = name) {
  const noExt = name.replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '')
  let m = noExt.match(/^(?<base>.+)_AIresult_(?<region>cervical|thoracic|lumbar)_(?<model>.+)_(?<version>v\d+)$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, m.groups.version)
  m = noExt.match(/^(?<base>.+)_(?<region>cervical|lumbar)_(?<model>.+)_binary_full$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, 'v0')
  const parts = relPath.split('/')
  if (/_mask$/i.test(noExt) && parts.length >= 3) return normalizeAiMeta(parts[parts.length - 3], 'thoracic', parts[parts.length - 2], 'v0')
  m = noExt.match(/^(?<base>.+?)_(?<model>Weighted_Ensemble|Majority_Vote|U_Net|Coordconv_UNet|Center_plus_Coordconv)_mask$/i)
  if (m) return normalizeAiMeta(m.groups.base, 'thoracic', m.groups.model, 'v0')
  return null
}
function normalizeAiMeta(base, region, model, version) {
  const normalizedModel = slugAiName(model)
  const normalizedVersion = String(version || 'v0').toLowerCase()
  return { base, region: String(region).toLowerCase(), model: normalizedModel, version: normalizedVersion, modelKey: normalizedModel + '_' + normalizedVersion }
}
function slugAiName(name) {
  return String(name).normalize('NFKC').replace(/^[A-Z]_/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase()
}
function imageBaseName(filename) { return String(filename || '').replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '') }
function getAiCandidatesForCurrentFile() { return state.aiByBase.get(imageBaseName(state.filename)) || [] }
function renderAiRegionControls() {
  const container = document.getElementById('aiRegionControls')
  if (!container) return
  const candidates = getAiCandidatesForCurrentFile()
  container.innerHTML = ''
  if (!state.aiFolderHandle) { container.innerHTML = '<div class="ai-empty">AI mask 폴더를 연결하면 부위별 모델을 선택할 수 있습니다.</div>'; return }
  for (const region of AI_REGIONS) {
    const items = candidates.filter(x => x.region === region.id)
    const modelKeys = [...new Set(items.map(x => x.modelKey))]
    if (!state.aiSelectedModel[region.id] && modelKeys.length > 0) state.aiSelectedModel[region.id] = preferDefaultModel(modelKeys)
    if (state.aiSelectedModel[region.id] && !modelKeys.includes(state.aiSelectedModel[region.id]) && modelKeys.length > 0) state.aiSelectedModel[region.id] = preferDefaultModel(modelKeys)
    const row = document.createElement('div')
    row.className = 'ai-region-row'
    const options = items.length === 0 ? '<option>결과 없음</option>' : modelKeys.map(k => '<option value="' + escapeHtml(k) + '" ' + (k === state.aiSelectedModel[region.id] ? 'selected' : '') + '>' + escapeHtml(k) + '</option>').join('')
    row.innerHTML = '<label class="checkbox-label ai-region-check"><input type="checkbox" ' + (state.aiRegionVisible[region.id] ? 'checked' : '') + ' ' + (items.length === 0 ? 'disabled' : '') + ' /><span class="ai-color-dot" style="background:' + region.color + '"></span><span>' + region.label + '</span></label><select class="select-input ai-model-select" ' + (items.length === 0 ? 'disabled' : '') + '>' + options + '</select>'
    row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => { state.aiRegionVisible[region.id] = e.target.checked; applyAiOverlayForCurrentFile().catch(() => {}) })
    row.querySelector('select').addEventListener('change', (e) => { state.aiSelectedModel[region.id] = e.target.value; applyAiOverlayForCurrentFile().catch(() => {}) })
    container.appendChild(row)
  }
}
function preferDefaultModel(modelKeys) { return modelKeys.find(k => k.includes('weighted_ensemble')) || modelKeys[0] || '' }
async function applyAiOverlayForCurrentFile() {
  const token = ++state.aiLoadToken
  revokeAiObjectUrls()
  if (!state.annotator) return

  renderAiRegionControls()
  const candidates = getAiCandidatesForCurrentFile()
  const selected = []
  for (const region of AI_REGIONS) {
    if (!state.aiRegionVisible[region.id]) continue
    const item = candidates.find(x => x.region === region.id && x.modelKey === state.aiSelectedModel[region.id])
    if (item) selected.push({ ...item, color: region.color })
  }

  const maskItems = []
  for (const item of selected) {
    const obj = await fileHandleToUrl(item.handle)
    state.aiObjectUrls.push(obj.url)
    maskItems.push({ ...item, url: obj.url })
  }
  if (token !== state.aiLoadToken) {
    revokeAiObjectUrls()
    return
  }

  state.annotator.setAiMaskOpacity(state.aiOpacity)
  if (state.aiMaskVisible && !state.originalOnly) {
    state.annotator.setAiMaskVisible(true)
    await state.annotator.loadAiMasks(maskItems)
  } else {
    state.annotator.clearAiMasks()
    state.annotator.setAiMaskVisible(false)
  }
  await updateAiComparePanel(maskItems)
}
function revokeAiObjectUrls() { for (const url of state.aiObjectUrls) URL.revokeObjectURL(url); state.aiObjectUrls = [] }
function updateAiFolderStatus(message, type = null) {
  const el = document.getElementById('aiFolderStatus')
  if (!el) return
  if (!message) {
    if (state.aiFolderHandle) { message = (state.aiFolderName || 'AI 폴더') + ' · ' + state.aiFiles.length + '개 mask'; type = 'connected' }
    else { message = 'AI mask 폴더가 연결되지 않았습니다'; type = 'empty' }
  }
  el.className = 'ai-folder-status ' + (type || 'empty')
  el.textContent = message
}


// ================================================================
// 우측 사이드바 간단 보기 / 접이식 패널
// ================================================================
function initRightSidebarCompactUI() {
  const sidebar = document.getElementById('sidebarRight')
  if (!sidebar || sidebar.dataset.compactUiReady === '1') return
  sidebar.dataset.compactUiReady = '1'

  const COMPACT_KEY = 'spine-annotator:right-sidebar-compact'
  const PANEL_PREFIX = 'spine-annotator:right-panel-collapsed:'

  const header = sidebar.querySelector('.sidebar-header')
  if (header && !header.querySelector('.sidebar-header-actions')) {
    const actions = document.createElement('div')
    actions.className = 'sidebar-header-actions'

    const compactBtn = document.createElement('button')
    compactBtn.type = 'button'
    compactBtn.className = 'sidebar-compact-toggle'
    compactBtn.title = '우측 패널 간단 보기 전환'
    compactBtn.innerHTML = '<i class="fas fa-compress-alt"></i><span>간단</span>'
    actions.appendChild(compactBtn)
    header.appendChild(actions)

    const applyCompact = (enabled) => {
      sidebar.classList.toggle('right-sidebar-compact', !!enabled)
      compactBtn.classList.toggle('active', !!enabled)
      try { localStorage.setItem(COMPACT_KEY, String(!!enabled)) } catch {}
    }

    let initialCompact = false
    try { initialCompact = localStorage.getItem(COMPACT_KEY) === 'true' } catch {}
    applyCompact(initialCompact)

    compactBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      applyCompact(!sidebar.classList.contains('right-sidebar-compact'))
    })
  }

  const panels = [...sidebar.querySelectorAll('.panel')]
  panels.forEach((panel, index) => {
    const title = panel.querySelector(':scope > .panel-title')
    if (!title || panel.dataset.collapsibleReady === '1') return
    panel.dataset.collapsibleReady = '1'

    const titleText = title.textContent.replace(/s+/g, ' ').trim()
    const key = PANEL_PREFIX + titleText

    let body = panel.querySelector(':scope > .panel-body')
    if (!body) {
      body = document.createElement('div')
      body.className = 'panel-body'
      const move = []
      for (const child of [...panel.children]) {
        if (child !== title) move.push(child)
      }
      move.forEach(child => body.appendChild(child))
      panel.appendChild(body)
    }

    if (!title.querySelector('.panel-collapse-toggle')) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'panel-collapse-toggle'
      btn.title = '섹션 접기/펼치기'
      btn.innerHTML = '<i class="fas fa-chevron-up"></i>'
      title.appendChild(btn)
    }

    const shouldDefaultCollapse = /파일 메모|저장/.test(titleText)
    let collapsed = shouldDefaultCollapse
    try {
      const stored = localStorage.getItem(key)
      if (stored != null) collapsed = stored === 'true'
    } catch {}

    const applyCollapsed = (value) => {
      panel.classList.toggle('panel-collapsed', !!value)
      const icon = title.querySelector('.panel-collapse-toggle i')
      if (icon) {
        icon.classList.toggle('fa-chevron-up', !value)
        icon.classList.toggle('fa-chevron-down', !!value)
      }
      try { localStorage.setItem(key, String(!!value)) } catch {}
    }
    applyCollapsed(collapsed)

    title.addEventListener('click', (e) => {
      if (e.target.closest('input, select, textarea, button:not(.panel-collapse-toggle), a')) return
      applyCollapsed(!panel.classList.contains('panel-collapsed'))
    })
  })
}


// ================================================================
// Final pelvis label runtime guard
// ================================================================
const PELVIS_EXTRA_LABELS_FINAL = ['FH_L', 'FH_R', 'HC_L', 'HC_R', 'FH_LAT', 'HC_LAT']
const PELVIS_POINT_LABELS_FINAL = ['HC_L', 'HC_R', 'HC_LAT']

function isFinalPelvisLabel(label) {
  return PELVIS_EXTRA_LABELS_FINAL.includes(label)
}

function clearPelvisLabelActiveButtonsFinal() {
  document.querySelectorAll('.pelvis-label-btn.active').forEach(btn => btn.classList.remove('active'))
}

function makePelvisPanelCollapsibleFinal() {
  const panel = document.getElementById('pelvisLabelPanel')
  if (!panel || panel.dataset.finalCollapsibleReady === '1') return
  panel.dataset.finalCollapsibleReady = '1'

  const title = panel.querySelector(':scope > .panel-title') || panel.querySelector('.panel-title')
  if (!title) return

  let body = panel.querySelector(':scope > .panel-body')
  if (!body) {
    body = document.createElement('div')
    body.className = 'panel-body pelvis-label-body'
    ;[...panel.children].forEach(child => {
      if (child !== title) body.appendChild(child)
    })
    panel.appendChild(body)
  }

  if (!title.querySelector('.panel-collapse-toggle')) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'panel-collapse-toggle'
    btn.title = '섹션 접기/펼치기'
    btn.innerHTML = '<i class="fas fa-chevron-up"></i>'
    title.appendChild(btn)
  }

  const applyCollapsed = (value) => {
    panel.classList.toggle('panel-collapsed', !!value)
    const icon = title.querySelector('.panel-collapse-toggle i')
    if (icon) {
      icon.classList.toggle('fa-chevron-up', !value)
      icon.classList.toggle('fa-chevron-down', !!value)
    }
    try { localStorage.setItem('spine-annotator:pelvis-panel-collapsed', String(!!value)) } catch {}
  }

  let collapsed = false
  try { collapsed = localStorage.getItem('spine-annotator:pelvis-panel-collapsed') === 'true' } catch {}
  applyCollapsed(collapsed)

  title.addEventListener('click', (e) => {
    if (e.target.closest('button:not(.panel-collapse-toggle), input, select, textarea, a')) return
    applyCollapsed(!panel.classList.contains('panel-collapsed'))
  })
}

function installPelvisRuntimeFinalFixes() {
  const a = state.annotator
  if (!a || a._pelvisRuntimeFinalFixed === true) return
  a._pelvisRuntimeFinalFixed = true

  if (!('pendingLabel' in a)) a.pendingLabel = null
  if (!('pendingLabelMode' in a)) a.pendingLabelMode = 'polygon'

  a.setPendingLabel = function(label, mode = '') {
    this.pendingLabel = label || null
    this.pendingLabelMode = mode || (PELVIS_POINT_LABELS_FINAL.includes(label) ? 'point' : 'polygon')
    if (typeof this.updateStatus === 'function') this.updateStatus()
  }

  const originalRelabelAll = typeof a.relabelAll === 'function' ? a.relabelAll.bind(a) : null
  a.relabelAll = function() {
    try {
      const startIdx = Math.max(0, LABELS.indexOf(this.startLabel || 'C2'))
      const autoPolygons = (this.polygons || []).filter(p => {
        if (!p) return false
        if (p.manualLabel === true) return false
        if (isFinalPelvisLabel(p.label)) return false
        return true
      })
      autoPolygons.forEach(p => { p._centroidY = computeSimpleCentroidYFinal(p.points) })
      autoPolygons.sort((x, y) => x._centroidY - y._centroidY)
      autoPolygons.forEach((p, i) => {
        p.label = LABELS[startIdx + i] || '?'
      })
      ;(this.polygons || []).forEach(p => { p._centroidY = computeSimpleCentroidYFinal(p.points) })
      ;(this.polygons || []).sort((x, y) => x._centroidY - y._centroidY)
    } catch (err) {
      if (originalRelabelAll) originalRelabelAll()
    }
  }

  const originalAddPoint = typeof a.addPoint === 'function' ? a.addPoint.bind(a) : null
  if (originalAddPoint) {
    a.addPoint = function(x, y) {
      const pending = this.pendingLabel
      if (!this.drawing && PELVIS_POINT_LABELS_FINAL.includes(pending)) {
        const scale = Math.max(0.1, this.stage?.scaleX?.() || 1)
        const r = 5 / scale
        const maxId = (this.polygons || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0)
        this.polygons.push({
          id: Math.max(Date.now(), maxId + 1),
          label: pending,
          points: [x, y - r, x + r, y, x, y + r, x - r, y],
          manualLabel: true,
          landmark: true,
        })
        this.pendingLabel = null
        this.pendingLabelMode = 'polygon'
        if (typeof this.renderPolygons === 'function') this.renderPolygons()
        if (typeof this.pushHistory === 'function') this.pushHistory()
        if (typeof this.notifyPolygons === 'function') this.notifyPolygons()
        if (typeof this.updateStatus === 'function') this.updateStatus()
        clearPelvisLabelActiveButtonsFinal()
        return
      }
      return originalAddPoint(x, y)
    }
  }

  const originalFinishDrawing = typeof a.finishDrawing === 'function' ? a.finishDrawing.bind(a) : null
  if (originalFinishDrawing) {
    a.finishDrawing = function(opts = {}) {
      const pending = this.pendingLabel
      const shouldUsePending = isFinalPelvisLabel(pending) && !PELVIS_POINT_LABELS_FINAL.includes(pending)
      const beforeIds = new Set((this.polygons || []).map(p => p.id))
      const result = originalFinishDrawing(opts)
      if (shouldUsePending) {
        const created = (this.polygons || []).find(p => !beforeIds.has(p.id))
        if (created) {
          created.label = pending
          created.manualLabel = true
          created.landmark = false
          this.pendingLabel = null
          this.pendingLabelMode = 'polygon'
          if (typeof this.relabelAll === 'function') this.relabelAll()
          if (typeof this.renderPolygons === 'function') this.renderPolygons()
          if (typeof this.pushHistory === 'function') this.pushHistory()
          if (typeof this.notifyPolygons === 'function') this.notifyPolygons()
          if (typeof this.updateStatus === 'function') this.updateStatus()
          clearPelvisLabelActiveButtonsFinal()
        }
      }
      return result
    }
  }
}

function computeSimpleCentroidYFinal(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return 0
  let cy = 0
  let n = 0
  for (let i = 1; i < pts.length; i += 2) {
    cy += Number(pts[i]) || 0
    n++
  }
  return n ? cy / n : 0
}


// ================================================================
// Hard fix: collapsible pelvis label panel
// ================================================================
function ensurePelvisPanelCollapseHardFix() {
  const attach = () => {
    const panel = document.getElementById('pelvisLabelPanel')
    if (!panel) return false

    const title = panel.querySelector(':scope > .panel-title') || panel.querySelector('.panel-title')
    if (!title) return false

    let body = panel.querySelector(':scope > .panel-body')
    if (!body) {
      body = document.createElement('div')
      body.className = 'panel-body pelvis-label-body'
      for (const child of [...panel.children]) {
        if (child !== title) body.appendChild(child)
      }
      panel.appendChild(body)
    }

    let btn = title.querySelector('.panel-collapse-toggle')
    if (!btn) {
      btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'panel-collapse-toggle'
      btn.title = '섹션 접기/펼치기'
      btn.innerHTML = '<i class="fas fa-chevron-up"></i>'
      title.appendChild(btn)
    }

    const applyCollapsed = (collapsed) => {
      panel.classList.toggle('panel-collapsed', !!collapsed)
      const icon = btn.querySelector('i')
      if (icon) {
        icon.classList.toggle('fa-chevron-up', !collapsed)
        icon.classList.toggle('fa-chevron-down', !!collapsed)
      }
      try { localStorage.setItem('spine-annotator:pelvis-panel-collapsed', String(!!collapsed)) } catch {}
    }

    if (panel.dataset.pelvisCollapseHardReady !== '1') {
      panel.dataset.pelvisCollapseHardReady = '1'
      let initial = false
      try { initial = localStorage.getItem('spine-annotator:pelvis-panel-collapsed') === 'true' } catch {}
      applyCollapsed(initial)

      title.addEventListener('click', (e) => {
        if (e.target.closest('button:not(.panel-collapse-toggle), input, select, textarea, a')) return
        applyCollapsed(!panel.classList.contains('panel-collapsed'))
      })
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        applyCollapsed(!panel.classList.contains('panel-collapsed'))
      })
    }

    return true
  }

  if (attach()) return
  setTimeout(attach, 0)
  setTimeout(attach, 100)
  setTimeout(attach, 300)
  setTimeout(attach, 800)
}

// ================================================================
// 키보드 단축키
// ================================================================
const heldHoldables = new Set() // 누르고 있는 동안 동작하는 키 (중복 keydown 방지)

function bindKeyboardEvents() {
  window.addEventListener('keydown', (e) => {
    // 단축키 입력 대기 중일 땐 모든 키 차단 (모달의 키 캡처가 우선)
    if (window._capturingShortcut) return

    // input/textarea/select 안에서는 단축키 무시
    const tag = e.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    const normalized = normalizeKey(e)
    if (!normalized) return

    if (normalized === 'h') {
      state.annotator.setLabelOverlayVisible(false)
      e.preventDefault()
      return
    }

    const action = findAction(state.shortcuts, normalized)
    if (!action) return

    // Holdable: 누르고 있는 동안 한 번만 실행 (예: Space로 팬 모드)
    if (action.isHoldable) {
      if (heldHoldables.has(action.actionId)) {
        e.preventDefault()
        return
      }
      heldHoldables.add(action.actionId)
    }

    const handled = runAction(action.actionId)
    if (handled) e.preventDefault()
  })

  window.addEventListener('keyup', (e) => {
    if (window._capturingShortcut) return
    const normalized = normalizeKey(e)
    if (!normalized) return

    // holdable 액션의 해제
    if (normalized === 'h') {
      state.annotator.setLabelOverlayVisible(state.labelOverlayVisible && !state.originalOnly)
      e.preventDefault()
      return
    }

    for (const id of heldHoldables) {
      if (state.shortcuts[id] === normalized) {
        heldHoldables.delete(id)
        if (id === 'panMode') state.annotator.setPanMode(false)
        if (id === 'freehandMode') state.annotator.setFreehandMode(false)
      }
    }
  })
}

/**
 * 액션 ID로 실제 동작 실행
 * @returns {boolean} 처리되면 true (preventDefault 호출용)
 */
function runAction(actionId) {
  const landmarkMode = state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon'
  switch (actionId) {
    case 'finishPolygon': state.annotator.finishDrawing(); return true
    case 'finishPolygonFree': state.annotator.finishDrawing({ angularSort: true }); return true
    case 'cancelDrawing': state.annotator.cancelDrawing(); return true
    case 'removeLastPoint':
      if (landmarkMode) return !!state.annotator.deleteLastLandmarkPoint?.()
      if (state.annotator.cancelOrDeleteLastCircle?.()) return true
      state.annotator.removeLastPoint()
      return true
    case 'deleteSelected':
      state.annotator.deleteSelected()
      return true
    case 'removeHoveredVertex': return state.annotator.removeHoveredVertex()
    case 'toolDraw': setTool('draw'); return true
    case 'toolEdit': setTool('edit'); return true
    case 'toolDelete': setTool('delete'); return true
    case 'undo':
      // 검수 모드에서는 코너 교정 되돌리기를 우선 처리
      if (window.__spineReviewUndo && window.__spineReviewUndo()) return true
      state.annotator.undo(); return true
    case 'redo': state.annotator.redo(); return true
    case 'panMode': state.annotator.setPanMode(true); return true
    case 'freehandMode':
      if (landmarkMode) {
        state.annotator.setFreehandMode?.(false)
        state.annotator.cancelDrawing?.()
        return true
      }
      state.annotator.setFreehandMode(true)
      return true
    case 'zoomIn': state.annotator.zoomBy(1.2); return true
    case 'zoomOut': state.annotator.zoomBy(1 / 1.2); return true
    case 'zoomFit': state.annotator.zoomToFit(); return true
    case 'openShortcuts': openShortcutsModal(); return true
  }
  return false
}

// ================================================================
// 이미지 로드
// ================================================================
async function loadSampleImage() {
  // 샘플 X-ray 이미지를 로드 (외부 의료 영상 샘플)
  const sampleUrl = '/static/sample-spine.png'
  state.currentImageUrl = sampleUrl
  state.currentImageUrl = sampleUrl
  state.filename = 'sample_00000000_AP.png'
  try { window.__spineCurrentFile = state.filename } catch (e) {}
  resetLandmarksForFileSwitch()
  state.viewType = 'AP'
  state.patientId = 'sample'
  state.studyDate = ''

  try {
    await state.annotator.loadImage(sampleUrl)
    updateFileInfo()
    document.getElementById('canvasPlaceholder').classList.add('hidden')
  } catch (err) {
    console.error('Sample image load failed:', err)
    // 샘플 이미지가 없으면 placeholder 유지
    document.getElementById('fileName').textContent = '샘플 이미지 없음 - 파일을 열어주세요'
  }
}

function handleFileUpload(e) {
  const file = e.target.files[0]
  if (!file) return

  state.filename = file.name
  try { window.__spineCurrentFile = state.filename } catch (e) {}
  resetLandmarksForFileSwitch()
  const parsed = parseFilename(file.name)
  state.patientId = parsed.patientId
  state.studyDate = parsed.studyDate
  state.viewType = parsed.viewType || 'AP'

  const url = URL.createObjectURL(file)
  state.currentImageUrl = url
  state.annotator.loadImage(url).then(() => {
    updateFileInfo()
    document.getElementById('canvasPlaceholder').classList.add('hidden')
    applyAiOverlayForCurrentFile().catch(() => {})
  })
}

function updateFileInfo() {
  document.getElementById('fileName').textContent = state.filename
  const badge = document.getElementById('viewBadge')
  badge.textContent = state.viewType
  badge.setAttribute('data-view', state.viewType)
  state.imageWidth = state.annotator.imageWidth
  state.imageHeight = state.annotator.imageHeight
  renderAiRegionControls()
  renderAiRegionControls()
  loadCurrentNoteFromModule().catch(err => console.warn('Note load failed:', err))
  loadCurrentNoteFromModule().catch(err => console.warn('Note load failed:', err))
}

function refreshSagittalMeasurements() {
  if (!state.annotator || typeof renderSagittalMeasurementPanel !== 'function') return
  renderSagittalMeasurementPanel([], {
    filename: state.filename,
    viewType: state.viewType,
    landmarks: state.annotator.getLandmarks?.() || [],
  })
  state.annotator.renderMeasurementDebugOverlay?.()
}

// ================================================================
// 폴리곤 변경 → 우측 라벨 목록 업데이트
// ================================================================
function handlePolygonsChange(polygons) {
  const list = document.getElementById('labelList')
  const count = document.getElementById('labelCount')
  count.textContent = polygons.length

  if (polygons.length === 0) {
    list.innerHTML = '<p class="empty-state">폴리곤을 그려서 라벨을 추가하세요</p>'
  } else {
    list.innerHTML = ''
    polygons.forEach((poly) => {
      const item = createLabelItem(poly)
      list.appendChild(item)
    })
  }

  renderSagittalMeasurementPanel([], {
    filename: state.filename,
    viewType: state.viewType,
    landmarks: state.annotator?.getLandmarks?.() || [],
  })

  refreshSagittalMeasurements()

  renderSagittalMeasurementPanel([], {
    filename: state.filename,
    viewType: state.viewType,
    landmarks: state.annotator?.getLandmarks?.() || [],
  })

  refreshSagittalMeasurements()

  // 자동 저장 (LocalStorage)
  autoSave()
}

function createLabelItem(poly) {
  const item = document.createElement('div')
  item.className = 'label-item'
  if (poly.selected) item.classList.add('selected')
  item.dataset.id = poly.id

  const color = getRegionColor(poly.label)

  // 라벨 변경 드롭다운
  const select = document.createElement('select')
  select.className = 'label-name-select'
  ALL_LABELS.forEach((lbl) => {
    const opt = document.createElement('option')
    opt.value = lbl
    opt.textContent = lbl
    if (lbl === poly.label) opt.selected = true
    select.appendChild(opt)
  })
  select.addEventListener('click', (e) => e.stopPropagation())
  select.addEventListener('change', (e) => {
    state.annotator.setLabelForPolygon(poly.id, e.target.value)
  })

  item.innerHTML = `
    <div class="label-color" style="background:${color}"></div>
  `
  item.appendChild(select)

  const pts = document.createElement('span')
  pts.className = 'label-points'
  pts.textContent = `${poly.points.length / 2}pt`
  item.appendChild(pts)

  const actions = document.createElement('div')
  actions.className = 'label-actions'
  const delBtn = document.createElement('button')
  delBtn.className = 'label-action-btn'
  delBtn.title = '삭제'
  delBtn.innerHTML = '<i class="fas fa-trash"></i>'
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    state.annotator.deletePolygon(poly.id)
  })
  actions.appendChild(delBtn)
  item.appendChild(actions)

  item.addEventListener('click', () => {
    state.annotator.selectPolygon(poly.id)
  })

  return item
}

// ================================================================
// 줌/상태 핸들러
// ================================================================
function handleZoomChange(zoom) {
  document.getElementById('zoomLevel').textContent = `${Math.round(zoom * 100)}%`
}

function handleStatusChange(text) {
  document.getElementById('statusText').textContent = text
}

// ================================================================
// 자동 저장 (LocalStorage)
// ================================================================
let saveTimer = null
async function persistCurrentLabelsNow(filenameOverride = state.filename) {
  if (!state.annotator || !filenameOverride) return
  const labelerId = getCurrentLabelerId()
  const polygons = state.annotator.getPolygons?.() || []
  const landmarks = state.annotator.getLandmarks?.() || []
  const payload = {
    view_type: state.viewType,
    start_label: state.annotator.startLabel,
    polygons,
    landmarks,
    labeler_id: labelerId,
    image_width: state.imageWidth || null,
    image_height: state.imageHeight || null,
    version: state.labelVersion,
  }

  const saveStatus = document.getElementById('saveStatus')
  try {
    const result = await saveLabel(filenameOverride, payload)
    const labeler = getCurrentLabeler()
    const labelerSuffix = labeler ? ` · ${labeler.name}` : ''
    if (filenameOverride === state.filename && result.version != null) state.labelVersion = result.version
    if (saveStatus && filenameOverride === state.filename) {
      saveStatus.textContent = '서버 저장됨 (' + new Date().toLocaleTimeString() + labelerSuffix + ')'
      saveStatus.classList.remove('save-error')
    }
    serverLabelMetaMap.set(filenameOverride, {
      filename: filenameOverride,
      view_type: state.viewType,
      labeler_id: labelerId,
      polygon_count: polygons.length,
      landmark_count: landmarks.length,
      updated_at: result.updated_at || new Date().toISOString(),
      version: result.version ?? state.labelVersion,
      image_width: state.imageWidth || null,
      image_height: state.imageHeight || null,
    })
    if (state.files.length > 0) renderFileList()
  } catch (err) {
    console.error('Immediate save failed:', err)
    if (saveStatus && filenameOverride === state.filename) {
      if (err.status === 401) {
        saveStatus.textContent = '⚠️ 인증 만료 - 비밀번호 재입력 필요'
        saveStatus.classList.add('save-error')
        openAuthModal()
      } else if (err.status === 409) {
        saveStatus.textContent = '⚠️ 다른 사용자가 먼저 저장함 - 최신 불러오기 필요'
        saveStatus.classList.add('save-error')
        showConflictNotice(err)
      } else {
        saveStatus.textContent = '⚠️ 서버 저장 실패 (로컬 백업됨, 자동 재시도)'
        saveStatus.classList.add('save-error')
      }
    }
  }
}

function autoSave() {
  // 파일 전환 중엔 저장 보류 (빈 상태로 덮어쓰지 않기)
  if (state._suspendAutoSave) return

  if (saveTimer) clearTimeout(saveTimer)
  document.getElementById('saveStatus').textContent = '저장 중...'

  saveTimer = setTimeout(async () => {
    if (state._suspendAutoSave) return
    await persistCurrentLabelsNow()
    saveTimer = null
    return
    const labelerId = getCurrentLabelerId()
    const polygons = state.annotator.getPolygons()
    const landmarks = state.annotator.getLandmarks?.() || []

    const payload = {
      view_type: state.viewType,
      start_label: state.annotator.startLabel,
      polygons,
      landmarks,
      labeler_id: labelerId,
      image_width: state.imageWidth || null,
      image_height: state.imageHeight || null,
      version: state.labelVersion,
    }

    const saveStatus = document.getElementById('saveStatus')
    try {
      const result = await saveLabel(state.filename, payload)
      const labeler = getCurrentLabeler()
      const labelerSuffix = labeler ? ` · ${labeler.name}` : ''
      if (result.version != null) state.labelVersion = result.version
      saveStatus.textContent = '서버 저장됨 (' + new Date().toLocaleTimeString() + labelerSuffix + ')'
      saveStatus.classList.remove('save-error')

      // 서버 메타 캐시 갱신
      serverLabelMetaMap.set(state.filename, {
        filename: state.filename,
        view_type: state.viewType,
        labeler_id: labelerId,
        polygon_count: polygons.length,
        landmark_count: landmarks.length,
        updated_at: result.updated_at || new Date().toISOString(),
        version: result.version ?? state.labelVersion,
        image_width: state.imageWidth || null,
        image_height: state.imageHeight || null,
      })
      // 파일 목록의 라벨 상태 점(dot) 즉시 갱신
      if (state.files.length > 0) renderFileList()
      // 다음 폴링 사이클을 앞당겨서 다른 변경사항도 빨리 받아오기
      if (pollTimer) {
        clearInterval(pollTimer)
        setTimeout(() => {
          pollUpdates().catch(() => {})
          pollTimer = setInterval(pollUpdates, POLL_INTERVAL_MS)
        }, 200)
      }
    } catch (err) {
      console.error('Auto-save failed:', err)
      if (err.status === 401) {
        saveStatus.textContent = '⚠️ 인증 만료 - 비밀번호 재입력 필요'
        saveStatus.classList.add('save-error')
        openAuthModal()
      } else if (err.status === 409) {
        saveStatus.textContent = '⚠️ 다른 사용자가 먼저 저장함 - 최신 불러오기 필요'
        saveStatus.classList.add('save-error')
        showConflictNotice(err)
      } else {
        saveStatus.textContent = '⚠️ 서버 저장 실패 (로컬 백업됨, 자동 재시도)'
        saveStatus.classList.add('save-error')
      }
    }
  }, 300)  // 디바운스 단축 (500 → 300ms)
}

// ================================================================
// 파일별 메모장 - 라벨/COCO와 분리 저장
// ================================================================
function bindNoteControls() {
  const input = document.getElementById('fileNoteInput')
  if (input && !input.dataset.bound) {
    input.dataset.bound = '1'
    input.addEventListener('input', () => {
      if (state.noteLoading) return
      setNoteStatus('저장 대기...', false)
      scheduleNoteSave()
    })
  }
  const exportBtn = document.getElementById('exportNotesBtn')
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = '1'
    exportBtn.addEventListener('click', downloadAllNotes)
  }
}
function setNoteStatus(text, isError = false) {
  const el = document.getElementById('noteStatus')
  if (!el) return
  el.textContent = text
  el.classList.toggle('save-error', !!isError)
}
async function loadNoteForCurrentFile() {
  const input = document.getElementById('fileNoteInput')
  if (!input || !state.filename) return
  state.noteLoading = true
  input.disabled = true
  input.value = ''
  setNoteStatus('메모 불러오는 중...', false)
  try {
    const data = await loadNote(state.filename)
    input.value = data.note_text || ''
    input.disabled = false
    if (data.exists && data.updated_at) setNoteStatus('메모 저장됨 ' + new Date(data.updated_at).toLocaleTimeString(), false)
    else setNoteStatus('메모 없음', false)
  } catch (err) {
    input.disabled = false
    if (err.status === 401) openAuthModal()
    setNoteStatus('메모 로드 실패', true)
  } finally {
    state.noteLoading = false
  }
}
function scheduleNoteSave() {
  if (state.noteSaveTimer) clearTimeout(state.noteSaveTimer)
  state.noteSaveTimer = setTimeout(() => saveCurrentNoteNow().catch(err => {
    console.error('Note save failed:', err)
    if (err.status === 401) openAuthModal()
    setNoteStatus('메모 저장 실패', true)
  }), 700)
}
async function saveCurrentNoteNow() {
  const input = document.getElementById('fileNoteInput')
  if (!input || !state.filename || state.noteLoading) return
  const labelerId = getCurrentLabelerId()
  setNoteStatus('메모 저장 중...', false)
  const result = await saveNote(state.filename, { note_text: input.value, labeler_id: labelerId })
  state.noteLastSavedAt = result.updated_at || new Date().toISOString()
  setNoteStatus(input.value.trim() ? '메모 저장됨 ' + new Date(state.noteLastSavedAt).toLocaleTimeString() : '메모 없음', false)
}
async function downloadAllNotes() {
  try {
    if (state.noteSaveTimer) { clearTimeout(state.noteSaveTimer); state.noteSaveTimer = null; await saveCurrentNoteNow() }
    const data = await exportNotes()
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const payload = { type: 'spine-annotator-file-notes', exported_at: data.exported_at || new Date().toISOString(), count: (data.items || []).length, items: data.items || [] }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'spine-file-notes-' + ts + '.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    alert('메모 내보내기 실패: ' + err.message)
  }
}

// ================================================================
// COCO Export
// ================================================================
function showCocoPreview() {
  const polygons = state.annotator.getPolygons()
  const landmarks = state.annotator.getLandmarks?.() || []
  if (polygons.length === 0 && landmarks.length === 0) {
    alert('라벨/랜드마크가 없습니다. 폴리곤이나 랜드마크를 먼저 그려주세요.')
    return
  }

  const coco = exportToCOCO({
    filename: state.filename,
    width: state.imageWidth,
    height: state.imageHeight,
    polygons,
    landmarks,
  })
  coco.landmarks = landmarks

  const formatted = JSON.stringify(coco, null, 2)
  document.getElementById('cocoOutput').textContent = formatted
  document.getElementById('cocoModal').classList.remove('hidden')
}

async function copyCocoJson() {
  const text = document.getElementById('cocoOutput').textContent
  try {
    await navigator.clipboard.writeText(text)
    alert('클립보드에 복사되었습니다.')
  } catch (err) {
    alert('복사 실패: ' + err.message)
  }
}

function downloadCocoJson() {
  const text = document.getElementById('cocoOutput').textContent
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = state.filename.replace(/\.(png|jpg|jpeg)$/i, '') + '_coco.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ================================================================
// 사이드바 컨트롤: 접기/펼치기 + 너비 조절
// ================================================================
const SIDEBAR_STORAGE_KEY = 'spine-annotator:sidebar'

function bindSidebarControls() {
  const sidebarLeft = document.getElementById('sidebarLeft')
  const sidebarRight = document.getElementById('sidebarRight')
  const collapseLeftBtn = document.getElementById('collapseLeftBtn')
  const collapseRightBtn = document.getElementById('collapseRightBtn')
  const expandLeftBtn = document.getElementById('expandLeftBtn')
  const expandRightBtn = document.getElementById('expandRightBtn')
  const resizerLeft = document.getElementById('resizerLeft')
  const resizerRight = document.getElementById('resizerRight')

  // 저장된 설정 복원
  const saved = loadSidebarState()
  applySidebarState(saved)

  // 접기/펼치기
  collapseLeftBtn.addEventListener('click', () => toggleSidebar('left', true))
  collapseRightBtn.addEventListener('click', () => toggleSidebar('right', true))
  expandLeftBtn.addEventListener('click', () => toggleSidebar('left', false))
  expandRightBtn.addEventListener('click', () => toggleSidebar('right', false))

  // 드래그 리사이저
  attachResizer(resizerLeft, sidebarLeft, 'left')
  attachResizer(resizerRight, sidebarRight, 'right')

  // 더블클릭으로 기본 너비 복원
  resizerLeft.addEventListener('dblclick', () => {
    sidebarLeft.style.width = '260px'
    saveSidebarState()
    notifyCanvasResize()
  })
  resizerRight.addEventListener('dblclick', () => {
    sidebarRight.style.width = '260px'
    saveSidebarState()
    notifyCanvasResize()
  })
}

function toggleSidebar(side, collapsed) {
  const sidebar = document.getElementById(side === 'left' ? 'sidebarLeft' : 'sidebarRight')
  const resizer = document.getElementById(side === 'left' ? 'resizerLeft' : 'resizerRight')
  const expandBtn = document.getElementById(side === 'left' ? 'expandLeftBtn' : 'expandRightBtn')

  if (collapsed) {
    sidebar.classList.add('collapsed')
    resizer.classList.add('hidden')
    expandBtn.classList.remove('hidden')
  } else {
    sidebar.classList.remove('collapsed')
    resizer.classList.remove('hidden')
    expandBtn.classList.add('hidden')
  }
  saveSidebarState()
  // 캔버스 크기 갱신은 transition 끝난 뒤 트리거
  setTimeout(notifyCanvasResize, 220)
}

function attachResizer(handle, sidebar, side) {
  let dragging = false
  let startX = 0
  let startWidth = 0

  handle.addEventListener('mousedown', (e) => {
    if (sidebar.classList.contains('collapsed')) return
    dragging = true
    startX = e.clientX
    startWidth = sidebar.getBoundingClientRect().width
    handle.classList.add('dragging')
    sidebar.style.transition = 'none'
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  })

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    const delta = e.clientX - startX
    let newWidth = side === 'left' ? startWidth + delta : startWidth - delta
    // 최소/최대 제한 (CSS와 일치)
    newWidth = Math.max(180, Math.min(500, newWidth))
    sidebar.style.width = newWidth + 'px'
    // 캔버스도 실시간 리사이즈
    notifyCanvasResize()
  })

  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('dragging')
    sidebar.style.transition = ''
    document.body.style.cursor = ''
    saveSidebarState()
  })
}

function notifyCanvasResize() {
  // Konva stage가 컨테이너 크기를 다시 인식하도록 리사이즈 이벤트 전파
  if (state.annotator) state.annotator.resize()
}

function saveSidebarState() {
  const sidebarLeft = document.getElementById('sidebarLeft')
  const sidebarRight = document.getElementById('sidebarRight')
  const data = {
    leftCollapsed: sidebarLeft.classList.contains('collapsed'),
    rightCollapsed: sidebarRight.classList.contains('collapsed'),
    leftWidth: sidebarLeft.style.width || '',
    rightWidth: sidebarRight.style.width || '',
  }
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.warn('Sidebar state save failed:', err)
  }
}

function loadSidebarState() {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function applySidebarState(data) {
  if (!data) return
  const sidebarLeft = document.getElementById('sidebarLeft')
  const sidebarRight = document.getElementById('sidebarRight')

  if (data.leftWidth) sidebarLeft.style.width = data.leftWidth
  if (data.rightWidth) sidebarRight.style.width = data.rightWidth
  if (data.leftCollapsed) toggleSidebar('left', true)
  if (data.rightCollapsed) toggleSidebar('right', true)
}

// ================================================================
// 단축키: 사이드바 목록 렌더링
// ================================================================
function renderShortcutList() {
  const ul = document.getElementById('shortcutList')
  ul.innerHTML = ''

  // 추가 정보 (마우스 동작) - 변경 불가
  const fixedItems = [
    { label: '점 찍기 (그리기)', keys: ['클릭'] },
    { label: '폴리곤 완성 (그리기)', keys: ['더블클릭'] },
    { label: '점 추가 (편집)', keys: ['변 위 클릭'] },
    { label: '점 삭제 (편집)', keys: ['점 우클릭', '점 더블클릭'] },
    { label: '점 이동 (편집)', keys: ['점 드래그'] },
    { label: '줌', keys: ['휠'] },
  ]
  for (const item of fixedItems) {
    const li = document.createElement('li')
    li.style.cursor = 'default'
    li.innerHTML = `
      <span class="shortcut-label">${item.label}</span>
      <span class="shortcut-keys">${item.keys.map(k => `<kbd>${k}</kbd>`).join('')}</span>
    `
    ul.appendChild(li)
  }

  // 액션별 단축키
  for (const action of ACTIONS) {
    const li = document.createElement('li')
    li.title = '클릭하여 변경'
    const keyStr = state.shortcuts[action.id] || action.defaultKey
    li.innerHTML = `
      <span class="shortcut-label">${action.label}</span>
      <span class="shortcut-keys"><kbd>${displayKey(keyStr) || '(없음)'}</kbd></span>
    `
    li.addEventListener('click', () => openShortcutsModal(action.id))
    ul.appendChild(li)
  }
}

// ================================================================
// 단축키: 설정 모달
// ================================================================
function openShortcutsModal(focusActionId) {
  document.getElementById('shortcutsModal').classList.remove('hidden')
  renderShortcutsEditor(typeof focusActionId === 'string' ? focusActionId : null)
}

function closeShortcutsModal() {
  cancelKeyCapture()
  document.getElementById('shortcutsModal').classList.add('hidden')
}

function renderShortcutsEditor(focusActionId) {
  const container = document.getElementById('shortcutsEditor')
  container.innerHTML = ''
  const groups = groupActionsByCategory()

  for (const [category, actions] of Object.entries(groups)) {
    const section = document.createElement('div')
    section.className = 'shortcut-category'

    const title = document.createElement('div')
    title.className = 'shortcut-category-title'
    title.textContent = category
    section.appendChild(title)

    for (const action of actions) {
      const row = document.createElement('div')
      row.className = 'shortcut-row'

      const label = document.createElement('div')
      label.className = 'shortcut-row-label'
      label.textContent = action.label
      row.appendChild(label)

      const btn = document.createElement('button')
      btn.className = 'shortcut-key-btn'
      btn.dataset.actionId = action.id
      btn.textContent = displayKey(state.shortcuts[action.id]) || '(없음)'
      btn.addEventListener('click', () => startKeyCapture(btn, action.id))
      row.appendChild(btn)

      section.appendChild(row)
    }
    container.appendChild(section)
  }

  if (focusActionId) {
    const btn = container.querySelector(`[data-action-id="${focusActionId}"]`)
    if (btn) {
      btn.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setTimeout(() => startKeyCapture(btn, focusActionId), 200)
    }
  }
}

let capturingButton = null
let captureKeydownHandler = null

function startKeyCapture(btn, actionId) {
  cancelKeyCapture()

  capturingButton = btn
  btn.classList.add('listening')
  btn.textContent = '키 입력 대기...'
  window._capturingShortcut = true

  captureKeydownHandler = (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      cancelKeyCapture()
      btn.textContent = displayKey(state.shortcuts[actionId]) || '(없음)'
      return
    }

    const normalized = normalizeKey(e)
    if (!normalized) return

    if (isForbidden(normalized)) {
      btn.textContent = `사용 불가: ${normalized}`
      setTimeout(() => {
        if (capturingButton === btn) {
          btn.textContent = '키 입력 대기...'
        }
      }, 1500)
      return
    }

    assignShortcut(actionId, normalized)
    cancelKeyCapture()
  }

  window.addEventListener('keydown', captureKeydownHandler, true)
}

function cancelKeyCapture() {
  if (captureKeydownHandler) {
    window.removeEventListener('keydown', captureKeydownHandler, true)
    captureKeydownHandler = null
  }
  if (capturingButton) {
    capturingButton.classList.remove('listening')
    capturingButton = null
  }
  window._capturingShortcut = false
}

function assignShortcut(actionId, newKey) {
  // 다른 액션이 같은 키를 쓰고 있으면 해제
  for (const [id, key] of Object.entries(state.shortcuts)) {
    if (id !== actionId && key === newKey) {
      state.shortcuts[id] = ''
    }
  }
  state.shortcuts[actionId] = newKey
  saveShortcuts(state.shortcuts)
  renderShortcutsEditor()
  renderShortcutList()
}

// ================================================================
// 로컬 폴더 연결 (File System Access API)
// ================================================================

/**
 * 페이지 진입 시 저장된 폴더 핸들 복원 시도
 * 권한이 살아있으면 자동 연결, 아니면 사용자가 "다시 연결" 버튼 누를 때까지 대기
 */
async function tryRestoreFolder() {
  if (!isFsSupported()) {
    showFolderUnsupported()
    return
  }
  const handle = await restoreFolder()
  if (!handle) return

  // 권한 상태만 조회 (실제 요청은 사용자 클릭 시)
  const perm = await queryPermission(handle)
  if (perm === 'granted') {
    state.folderHandle = handle
    state.folderName = handle.name
    await scanFolder()
  } else {
    // 권한 만료 - 사용자에게 재연결 안내
    state.folderHandle = handle  // 핸들은 메모리에 들고만 있고, 권한은 클릭 시 요청
    state.folderName = handle.name
    showFolderNeedsPermission()
  }
}

/**
 * '폴더 연결' 버튼 클릭 핸들러
 * - 이미 핸들이 있고 권한이 prompt면 → 재승인 요청
 * - 그 외엔 새 폴더 선택 다이얼로그
 */
async function handleConnectFolder() {
  if (!isFsSupported()) {
    alert('이 브라우저는 폴더 연결을 지원하지 않습니다.\nChrome 또는 Edge (버전 86+)를 사용해주세요.')
    return
  }

  // 이미 핸들이 있는데 권한만 없는 경우 → 재승인
  if (state.folderHandle) {
    const perm = await queryPermission(state.folderHandle)
    if (perm !== 'granted') {
      const ok = await ensurePermission(state.folderHandle)
      if (ok) {
        await scanFolder()
        return
      }
    } else {
      // 이미 연결됨 → 다른 폴더로 변경할지 확인
      const change = confirm(`현재 "${state.folderName}" 폴더가 연결되어 있습니다.\n다른 폴더로 변경할까요?`)
      if (!change) return
    }
  }

  // 새 폴더 선택
  try {
    const handle = await pickFolder()
    if (!handle) return  // 사용자가 취소
    state.folderHandle = handle
    state.folderName = handle.name
    await scanFolder()
  } catch (err) {
    alert('폴더 연결 실패: ' + err.message)
  }
}

/**
 * 연결된 폴더의 이미지 파일 목록 스캔
 */
async function scanFolder() {
  if (!state.folderHandle) return

  try {
    const allFiles = await listImageFiles(state.folderHandle)
    const files = allFiles.filter(f => !parseAiMaskFile(f.name, f.name))
    state.files = files

    updateFolderStatus(`연결됨: ${files.length}개 이미지`, 'connected')
    document.getElementById('folderControls').classList.remove('hidden')
    document.getElementById('fileCount').textContent = files.length
    document.getElementById('folderBtnLabel').textContent = state.folderName.length > 12
      ? state.folderName.slice(0, 12) + '…'
      : state.folderName

    renderFileList()
  } catch (err) {
    console.error('[fs] scan failed:', err)
    updateFolderStatus('폴더 읽기 실패: ' + err.message, 'warning')
  }
}

function showFolderUnsupported() {
  updateFolderStatus(
    '이 브라우저는 폴더 연결을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.',
    'warning'
  )
  document.getElementById('connectFolderBtn').disabled = true
}

function showFolderNeedsPermission() {
  const html = `
    <div class="folder-status-warning">
      <i class="fas fa-lock"></i> 권한이 만료되었습니다
      <span class="folder-name">${escapeHtml(state.folderName)}</span>
    </div>
    <div class="folder-status-actions">
      <button class="folder-mini-btn" id="reconnectBtn">
        <i class="fas fa-check"></i> 다시 연결
      </button>
      <button class="folder-mini-btn danger" id="forgetBtn">
        <i class="fas fa-times"></i> 잊기
      </button>
    </div>
  `
  document.getElementById('folderStatus').innerHTML = html
  document.getElementById('reconnectBtn').addEventListener('click', handleConnectFolder)
  document.getElementById('forgetBtn').addEventListener('click', handleForgetFolder)
  document.getElementById('folderBtnLabel').textContent = '다시 연결'
}

async function handleForgetFolder() {
  if (!confirm('폴더 연결을 해제할까요?\n(폴더 안의 파일은 그대로 유지됩니다)')) return
  await forgetFolder()
  state.folderHandle = null
  state.folderName = ''
  state.files = []
  state.fileSearch = ''
  state.fileFilter = 'all'

  document.getElementById('folderControls').classList.add('hidden')
  document.getElementById('fileCount').textContent = '0'
  document.getElementById('folderBtnLabel').textContent = '폴더 연결'
  document.getElementById('fileList').innerHTML = ''
  updateFolderStatus('폴더가 연결되지 않았습니다', 'empty')
}

function updateFolderStatus(message, type = 'empty') {
  const el = document.getElementById('folderStatus')
  let icon = 'info-circle'
  if (type === 'connected') icon = 'check-circle'
  if (type === 'warning') icon = 'exclamation-triangle'

  if (type === 'connected') {
    el.innerHTML = `
      <span class="folder-status-connected">
        <i class="fas fa-${icon}"></i> ${escapeHtml(message)}
        <span class="folder-name">${escapeHtml(state.folderName)}</span>
      </span>
      <div class="folder-status-actions">
        <button class="folder-mini-btn" id="rescanBtn" title="폴더 다시 스캔">
          <i class="fas fa-sync"></i> 새로고침
        </button>
        <button class="folder-mini-btn danger" id="disconnectBtn" title="연결 해제">
          <i class="fas fa-unlink"></i> 해제
        </button>
      </div>
    `
    document.getElementById('rescanBtn').addEventListener('click', scanFolder)
    document.getElementById('disconnectBtn').addEventListener('click', handleForgetFolder)
  } else {
    el.innerHTML = `
      <span class="folder-status-${type}">
        <i class="fas fa-${icon}"></i> ${escapeHtml(message)}
      </span>
    `
  }
}

/**
 * 파일 목록 렌더링 (필터 + 검색 적용)
 */
function renderFileList() {
  const ul = document.getElementById('fileList')
  ul.innerHTML = ''

  // 필터링
  const filtered = state.files.filter((f) => {
    const parsed = parseFilename(f.name)
    const view = (parsed.viewType || '').toUpperCase()
    if (state.fileFilter !== 'all' && view !== state.fileFilter) return false
    if (state.fileSearch && !f.name.toLowerCase().includes(state.fileSearch)) return false
    return true
  })

  if (filtered.length === 0) {
    ul.innerHTML = '<li class="file-list-empty">조건에 맞는 파일이 없습니다</li>'
    return
  }

  // 서버 메타에서 라벨 정보 조회 (마지막 수정자 색상 표시)
  for (const f of filtered) {
    const parsed = parseFilename(f.name)
    const view = (parsed.viewType || '').toUpperCase() || '--'
    const meta = serverLabelMetaMap.get(f.name)
    const hasLabels = !!(meta && ((meta.polygon_count || 0) > 0 || (meta.landmark_count || 0) > 0))
    const labeler = meta ? getLabelerById(meta.labeler_id) : null
    const isActive = f.name === state.filename

    // 점 색상 결정
    let dotStyle = ''
    let dotTitle = '라벨 없음'
    if (hasLabels) {
      if (labeler) {
        dotStyle = `background: ${labeler.color}; box-shadow: 0 0 0 2px ${labeler.colorDim};`
        dotTitle = `${labeler.name}${labeler.title ? '(' + labeler.title + ')' : ''} · ${meta.polygon_count}개 라벨`
      } else {
        dotStyle = `background: #7ee787;` // 기본(라벨러 미지정 옛 데이터)
        dotTitle = `라벨 ${meta.polygon_count}개 (작성자 미지정)`
      }
    }

    // 다른 사람이 작업 중인지 (presence)
    const activeWatchers = presenceMap.get(f.name) || []
    let presenceHtml = ''
    if (activeWatchers.length > 0) {
      const tips = []
      for (const w of activeWatchers) {
        const wLabeler = getLabelerById(w.labeler_id)
        const wName = wLabeler ? wLabeler.name : w.labeler_id
        const wColor = wLabeler ? wLabeler.color : '#888'
        tips.push(`${wName} (${w.seconds_ago}초 전)`)
        presenceHtml += `<span class="file-presence-dot" style="background:${wColor}" title="${escapeHtml(wName + '님 작업 중')}"></span>`
      }
      presenceHtml = `<span class="file-presence-group" title="${escapeHtml('지금 작업 중: ' + tips.join(', '))}">${presenceHtml}</span>`
    }

    const li = document.createElement('li')
    li.className = 'file-list-item' + (isActive ? ' active' : '') + (activeWatchers.length > 0 ? ' has-presence' : '')
    li.dataset.name = f.name
    li.title = f.name

    li.innerHTML = `
      <span class="file-status-dot ${hasLabels ? 'has-labels' : ''}" style="${dotStyle}" title="${escapeHtml(dotTitle)}"></span>
      <span class="file-name">${escapeHtml(f.name)}</span>
      ${presenceHtml}
      <span class="file-view-badge" data-view="${view}">${view}</span>
    `
    li.addEventListener('click', () => loadFileFromFolder(f))
    ul.appendChild(li)
  }
}

/**
 * 폴더 안의 파일을 캔버스에 로드
 * @param {{name:string, handle:FileSystemFileHandle}} fileEntry
 */
function resetLandmarksForFileSwitch() {
  if (!state.annotator) return
  state.annotator.loadLandmarks?.([])
  state.annotator.setPendingLandmark?.(null)
  state.landmarkApi?.refresh?.()
}

async function waitForPendingAutoSaveBeforeFileSwitch() {
  if (!saveTimer || state._suspendAutoSave) return
  clearTimeout(saveTimer)
  saveTimer = null
  await persistCurrentLabelsNow()
}

async function loadFileFromFolder(fileEntry) {
  try {
    await waitForPendingAutoSaveBeforeFileSwitch()
    // 이전 ObjectURL 해제
    if (state.currentObjectUrl) {
      URL.revokeObjectURL(state.currentObjectUrl)
      state.currentObjectUrl = null
    }

    const { url } = await fileHandleToUrl(fileEntry.handle)
    state.currentObjectUrl = url
    state.currentImageUrl = url
    state.filename = fileEntry.name
    try { window.__spineCurrentFile = state.filename } catch (e) {}
    resetLandmarksForFileSwitch()
    // 새 파일 열림 → 원격 수정 감지 초기화 (처음 로드는 알림 X)
    state.lastSeenRemoteUpdate = null
    state.lastSeenRemoteUpdateInitialized = false

    // 즉시 presence 전송 (작업 시작 신호)
    const lid = getCurrentLabelerId()
    if (lid) sendPresence(lid, fileEntry.name).catch(() => {})

    const parsed = parseFilename(fileEntry.name)
    state.patientId = parsed.patientId
    state.studyDate = parsed.studyDate
    state.viewType = parsed.viewType || 'AP'

    await state.annotator.loadImage(url)
    updateFileInfo()
    document.getElementById('canvasPlaceholder').classList.add('hidden')

    // 저장된 라벨 불러오기 (서버에서)
    await loadLabelsFromStorage(fileEntry.name)

    // 현재 이미지에 맞는 AI mask가 있으면 겹쳐 표시
    await applyAiOverlayForCurrentFile()

    // 파일 목록 활성 상태 갱신
    renderFileList()
  } catch (err) {
    console.error('Load file failed:', err)
    alert('파일 로드 실패: ' + err.message)
  }
}

/**
 * 해당 파일명에 대해 저장된 라벨이 localStorage에 있는지
 */
function hasLocalLabels(filename) {
  try {
    const raw = localStorage.getItem('spine-annotator:' + filename)
    if (!raw) return false
    const data = JSON.parse(raw)
    return Array.isArray(data.polygons) && data.polygons.length > 0
  } catch {
    return false
  }
}

/**
 * 해당 파일의 라벨 메타 (있는 경우): { count, labelerId, savedAt }
 * 없으면 null
 */
function getLocalLabelInfo(filename) {
  try {
    const raw = localStorage.getItem('spine-annotator:' + filename)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!Array.isArray(data.polygons) || data.polygons.length === 0) return null
    return {
      count: data.polygons.length,
      labelerId: data.labelerId || null,
      savedAt: data.savedAt || null,
    }
  } catch {
    return null
  }
}

/**
 * 파일에 저장된 라벨 복원 (서버 우선, 실패 시 로컬 캐시)
 * 자동저장이 빈 상태로 덮어쓰지 않도록 일시 차단
 */
function restoreVisibleLandmarksAfterLoad(landmarks, source = '') {
  const items = Array.isArray(landmarks) ? landmarks : []
  if (!state.annotator) return
  const apply = () => {
    if (!state.annotator?.loadLandmarks) {
      console.warn('[Landmark] loadLandmarks API missing during restore', source)
      return
    }
    state.annotator.loadLandmarks(items)
    state.annotator.landmarkLayer?.show?.()
    state.annotator.landmarkLayer?.moveToTop?.()
    state.annotator.renderLandmarks?.()
    state.annotator.stage?.batchDraw?.()
    state.landmarkApi?.refresh?.()
    console.log('[Landmark] restored visible landmarks', source, items.length, state.annotator.getLandmarks?.().length)
  }
  apply()
  requestAnimationFrame(apply)
  setTimeout(apply, 120)
}

function normalizeLoadedLabelPayload(data) {
  const rawPolygons = data?.polygons
  const objectPayload = rawPolygons && !Array.isArray(rawPolygons) && typeof rawPolygons === 'object'
    ? rawPolygons
    : null
  return {
    polygons: Array.isArray(rawPolygons)
      ? rawPolygons
      : (Array.isArray(objectPayload?.polygons) ? objectPayload.polygons : []),
    landmarks: Array.isArray(data?.landmarks)
      ? data.landmarks
      : (Array.isArray(objectPayload?.landmarks) ? objectPayload.landmarks : []),
  }
}

async function loadLabelsFromStorage(filename) {
  state._suspendAutoSave = true
  try {
    const data = await loadLabel(filename)
    if (!data.exists) {
      state.labelVersion = null
      state.annotator.loadPolygons([])
      state.annotator.loadLandmarks?.([])
      state.landmarkApi?.refresh?.()
      state.lastSeenRemoteUpdate = null
      state.lastSeenRemoteUpdateInitialized = true
      return
    }

    if (data.start_label) {
      state.annotator.setStartLabel(data.start_label)
      const sel = document.getElementById('startVertebra')
      if (sel) sel.value = data.start_label
    }

    state.labelVersion = data.version ?? null
    if (data.image_width) state.imageWidth = data.image_width
    if (data.image_height) state.imageHeight = data.image_height

    const rawPolygons = data.polygons
    const nested = rawPolygons && !Array.isArray(rawPolygons) && typeof rawPolygons === 'object'
      ? rawPolygons
      : null
    const polygons = Array.isArray(rawPolygons)
      ? rawPolygons
      : (Array.isArray(nested?.polygons) ? nested.polygons : [])
    const landmarks = Array.isArray(data.landmarks)
      ? data.landmarks
      : (Array.isArray(nested?.landmarks) ? nested.landmarks : [])

    console.log('[Landmark] loadLabelsFromStorage', filename, 'polygons=', polygons.length, 'landmarks=', landmarks.length)

    state.annotator.loadPolygons(polygons)
    state.annotator.loadLandmarks?.(landmarks)
    state.annotator.landmarkLayer?.show?.()
    state.annotator.landmarkLayer?.moveToTop?.()
    state.annotator.renderLandmarks?.()
    state.annotator.stage?.batchDraw?.()
    state.landmarkApi?.refresh?.()

    const redrawLandmarks = () => {
      state.annotator.loadLandmarks?.(landmarks)
      state.annotator.landmarkLayer?.show?.()
      state.annotator.landmarkLayer?.moveToTop?.()
      state.annotator.renderLandmarks?.()
      state.annotator.stage?.batchDraw?.()
      state.landmarkApi?.refresh?.()
      console.log('[Landmark] redraw after load', filename, state.annotator.getLandmarks?.().length ?? 'no-api')
    }
    requestAnimationFrame(redrawLandmarks)
    setTimeout(redrawLandmarks, 150)
    setTimeout(redrawLandmarks, 400)

    state.lastSeenRemoteUpdate = data.updated_at
    state.lastSeenRemoteUpdateInitialized = true
  } catch (err) {
    console.warn('Label restore failed:', err)
    if (err.status === 401) openAuthModal()
    state.labelVersion = null
    state.annotator.loadPolygons([])
    state.annotator.loadLandmarks?.([])
    state.landmarkApi?.refresh?.()
  } finally {
    setTimeout(() => { state._suspendAutoSave = false }, 500)
  }
}

// ================================================================
// 전체 일괄 내보내기
// ================================================================
async function openExportAllModal() {
  const modal = document.getElementById('exportAllModal')
  modal.classList.remove('hidden')
  await refreshExportStats()
}

function closeExportAllModal() {
  document.getElementById('exportAllModal').classList.add('hidden')
}

async function refreshExportStats() {
  const summary = document.getElementById('exportSummary')
  summary.innerHTML = '<div class="export-summary-loading">통계 로딩 중...</div>'
  try {
    const stats = await getStats()
    const byLabeler = (stats.by_labeler || []).reduce((acc, r) => {
      acc[r.labeler_id || 'unknown'] = r.cnt
      return acc
    }, {})
    const byView = (stats.by_view || []).reduce((acc, r) => {
      acc[r.view_type || 'unknown'] = r.cnt
      return acc
    }, {})

    summary.innerHTML = `
      <div class="export-stat-row">
        <span class="export-stat-label">전체 파일:</span>
        <strong>${stats.total}개</strong>
      </div>
      <div class="export-stat-row">
        <span class="export-stat-label">라벨러별:</span>
        <span>
          <span class="stat-chip" style="--c:#f0b35e">박성배 ${byLabeler.park || 0}</span>
          <span class="stat-chip" style="--c:#4f9ef8">김태준 ${byLabeler.kim || 0}</span>
          <span class="stat-chip" style="--c:#d18ce8">황회진 ${byLabeler.hwang || 0}</span>
        </span>
      </div>
      <div class="export-stat-row">
        <span class="export-stat-label">뷰별:</span>
        <span>
          <span class="stat-chip" style="--c:#4f9ef8">AP ${byView.AP || 0}</span>
          <span class="stat-chip" style="--c:#b46df0">LAT ${byView.LAT || 0}</span>
        </span>
      </div>
    `
  } catch (err) {
    summary.innerHTML = `<div class="export-summary-error">통계 로드 실패: ${escapeHtml(err.message)}</div>`
  }
}

async function handleExportAllDownload() {
  const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'coco'
  const view = document.querySelector('input[name="exportView"]:checked')?.value || ''
  const labeler = document.querySelector('input[name="exportLabeler"]:checked')?.value || ''
  const minPolys = parseInt(document.querySelector('input[name="exportMinPolys"]:checked')?.value || '0', 10)

  const btn = document.getElementById('exportDownloadBtn')
  const orig = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...'

  try {
    const data = await exportAll({ format, view, labeler, min_polygons: minPolys })

    // 통계 확인
    let count = 0
    if (format === 'coco') {
      count = (data.images || []).length
    } else {
      count = (data.items || []).length
    }
    if (count === 0) {
      alert('조건에 맞는 라벨이 없습니다.')
      return
    }

    // 파일명 구성
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const filterTag = [view, labeler ? labeler : '', minPolys === 25 ? 'complete' : '']
      .filter(Boolean).join('-')
    const filename = `spine-annotations${filterTag ? '-' + filterTag : ''}-${ts}.json`

    // 다운로드 트리거
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    btn.innerHTML = '<i class="fas fa-check"></i> 다운로드 완료'
    setTimeout(() => { btn.innerHTML = orig; btn.disabled = false }, 2000)
  } catch (err) {
    alert('내보내기 실패: ' + err.message)
    btn.innerHTML = orig
    btn.disabled = false
  }
}

/** HTML 이스케이프 */
function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ================================================================
// 인증 성공 후 안전 초기화
// ================================================================
async function continueAfterAuthSuccess() {
  try {
    await postAuthInit()
  } catch (err) {
    console.error('[Auth] post-auth initialization failed:', err)
    if (err && err.status === 401) {
      openAuthModal()
      return
    }
    showStartupError(err)
  }
}

function showStartupError(err) {
  let box = document.getElementById('startupErrorBox')
  if (!box) {
    box = document.createElement('div')
    box.id = 'startupErrorBox'
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;background:#3b1111;color:#fff;border:1px solid #ff7b72;border-radius:10px;padding:12px 14px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.35)'
    document.body.appendChild(box)
  }
  box.innerHTML = '<strong>초기화 오류</strong><br>' + escapeHtml(err?.message || String(err || 'unknown error')) + '<br><span style="opacity:.8">새로고침(Ctrl+F5) 후에도 반복되면 콘솔 오류를 보내주세요.</span>'
}

// ================================================================
// 인증 (비밀번호) 관리
// ================================================================
function initAuthUI() {
  const form = document.getElementById('authForm')
  if (!form) return

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = document.getElementById('authPasswordInput')
    const errEl = document.getElementById('authError')
    const password = input.value.trim()
    if (!password) return

    errEl.classList.add('hidden')
    try {
      await verifyPassword(password)
    } catch (err) {
      errEl.textContent = err.message || '인증 실패'
      errEl.classList.remove('hidden')
      input.select()
      return
    }
    closeAuthModal()
    // 비밀번호 검증 성공. 이후 초기화 실패는 비밀번호 오류로 표시하지 않는다.
    await continueAfterAuthSuccess()
  })
}

function openAuthModal() {
  const modal = document.getElementById('authModal')
  modal.classList.remove('hidden')
  setTimeout(() => {
    const input = document.getElementById('authPasswordInput')
    if (input) input.focus()
  }, 100)
}

function closeAuthModal() {
  const modal = document.getElementById('authModal')
  modal.classList.add('hidden')
  const input = document.getElementById('authPasswordInput')
  if (input) input.value = ''
  const err = document.getElementById('authError')
  if (err) err.classList.add('hidden')
}

// ================================================================
// 라벨러 (작업자) 관리
// ================================================================
function initLabelerUI() {
  const btn = document.getElementById('labelerBtn')
  const modal = document.getElementById('labelerModal')
  const closeBtn = document.getElementById('closeLabelerBtn')

  // 헤더 버튼 클릭 → 모달 열기
  btn.addEventListener('click', () => openLabelerModal())
  closeBtn.addEventListener('click', () => closeLabelerModal())
  // 배경 클릭으로 닫기 (단, 라벨러 미설정 상태에선 닫지 않음 - 강제 선택)
  modal.addEventListener('click', (e) => {
    if (e.target.id !== 'labelerModal') return
    if (getCurrentLabelerId()) closeLabelerModal()
  })

  // 초기 표시 갱신
  updateLabelerButton()
}

function openLabelerModal() {
  const modal = document.getElementById('labelerModal')
  const list = document.getElementById('labelerList')
  const currentId = getCurrentLabelerId()

  list.innerHTML = ''
  for (const labeler of LABELERS) {
    const item = document.createElement('button')
    item.className = 'labeler-card' + (labeler.id === currentId ? ' active' : '')
    item.style.setProperty('--labeler-color', labeler.color)
    item.style.setProperty('--labeler-color-dim', labeler.colorDim)
    item.innerHTML = `
      <span class="labeler-card-dot"></span>
      <span class="labeler-card-info">
        <span class="labeler-card-name">${escapeHtml(labeler.name)}</span>
        ${labeler.title ? `<span class="labeler-card-title">${escapeHtml(labeler.title)}</span>` : ''}
      </span>
      ${labeler.id === currentId ? '<i class="fas fa-check labeler-card-check"></i>' : ''}
    `
    item.addEventListener('click', () => {
      // 이전 라벨러 presence 정리 (사람 바꿀 때)
      const prevId = getCurrentLabelerId()
      if (prevId && prevId !== labeler.id) {
        clearPresence(prevId).catch(() => {})
      }
      setCurrentLabeler(labeler.id)
      // 새 라벨러로 즉시 presence 전송 (현재 파일이 있다면)
      if (state.filename && !state.filename.startsWith('sample')) {
        sendPresence(labeler.id, state.filename).catch(() => {})
      }
      updateLabelerButton()
      closeLabelerModal()
      // 파일 목록 색상 갱신은 안 필요 (저장된 데이터의 색상은 변함 없음)
    })
    list.appendChild(item)
  }

  modal.classList.remove('hidden')

  // 닫기 버튼은 라벨러 선택된 경우에만 표시
  const closeBtn = document.getElementById('closeLabelerBtn')
  closeBtn.style.display = currentId ? '' : 'none'
}

function closeLabelerModal() {
  document.getElementById('labelerModal').classList.add('hidden')
}

function updateLabelerButton() {
  const btn = document.getElementById('labelerBtn')
  const dot = document.getElementById('labelerDot')
  const label = document.getElementById('labelerLabel')
  const labeler = getCurrentLabeler()

  if (labeler) {
    dot.style.background = labeler.color
    dot.style.boxShadow = `0 0 0 2px ${labeler.colorDim}`
    label.textContent = labeler.name
    btn.classList.add('labeler-set')
    btn.style.setProperty('--labeler-color', labeler.color)
  } else {
    dot.style.background = '#5a6675'
    dot.style.boxShadow = 'none'
    label.textContent = '라벨러 선택'
    btn.classList.remove('labeler-set')
    btn.style.removeProperty('--labeler-color')
  }
}


// ================================================================
// 골반/고관절 빠른 라벨
// ================================================================

function clearPelvisLabelActiveButtons() {
  document.querySelectorAll('.pelvis-label-btn.active').forEach(btn => btn.classList.remove('active'))
}

function initPelvisLabelControls() {
  const sidebar = document.getElementById('sidebarRight')
  const scroll = sidebar?.querySelector('.sidebar-scroll')
  if (!scroll || document.getElementById('pelvisLabelPanel')) return

  const panel = document.createElement('div')
  panel.className = 'panel pelvis-label-panel'
  panel.id = 'pelvisLabelPanel'
  panel.innerHTML = `
    <h3 class="panel-title"><i class="fas fa-location-dot"></i> 골반 라벨</h3>
    <div class="pelvis-label-grid">
      <button type="button" class="pelvis-label-btn" data-label="FH_L" data-mode="circle">FH_L</button>
      <button type="button" class="pelvis-label-btn" data-label="FH_R" data-mode="circle">FH_R</button>
      <button type="button" class="pelvis-label-btn" data-label="HC_L" data-mode="point">HC_L 점</button>
      <button type="button" class="pelvis-label-btn" data-label="HC_R" data-mode="point">HC_R 점</button>
      <button type="button" class="pelvis-label-btn pelvis-label-btn-lat" data-label="FH_LAT" data-mode="circle">FH_LAT</button>
      <button type="button" class="pelvis-label-btn pelvis-label-btn-lat" data-label="HC_LAT" data-mode="point">HC_LAT 점</button>
    </div>
    <p class="pelvis-label-help">AP는 L/R 버튼을 쓰고, LAT는 FH_LAT/HC_LAT를 씁니다. FH는 가장자리 점 → 중심 순으로 두 번 클릭(반경=두 점 거리), HC는 점 클릭입니다.</p>
  `

  const labelPanel = document.getElementById('labelList')?.closest('.panel')
  if (labelPanel) scroll.insertBefore(panel, labelPanel)
  else scroll.appendChild(panel)

  if (typeof initRightSidebarCompactUI === 'function') initRightSidebarCompactUI() // refresh collapsible for pelvis panel

  panel.querySelectorAll('.pelvis-label-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // 그리던 원이 있으면 먼저 취소
      state.annotator._clearCirclePreview && state.annotator._clearCirclePreview()
      const wasActive = btn.classList.contains('active')
      panel.querySelectorAll('.pelvis-label-btn').forEach(b => b.classList.remove('active'))
      if (wasActive) {
        // 같은 버튼 재클릭 → 모드 취소, 기본 폴리곤 모드로
        state.annotator.setPendingLabel(null, 'polygon')
        return
      }
      btn.classList.add('active')
      state.annotator.setTool && state.annotator.setTool('draw')
      state.annotator.setPendingLabel(btn.dataset.label, btn.dataset.mode)
    })
  })
  // 원(FH) 완성 시 → 버튼 활성 해제 (annotator가 이벤트 발생)
  if (!window.__spineCircleCommitBound) {
    window.__spineCircleCommitBound = true
    window.addEventListener('spine:circle-committed', () => clearPelvisLabelActiveButtonsFinal())
  }
}


// Standalone LAT landmark list panel. This intentionally lives in app.js so it
// does not depend on landmark-tools.js panel internals.
function renderStandaloneLandmarkListPanel(force = false) {
  const annotator = state.annotator
  const isLat = String(state.viewType || '').toUpperCase() === 'LAT'
  const sidebar = document.getElementById('sidebarRight')
  const scroll = sidebar?.querySelector('.sidebar-scroll') || sidebar
  if (!scroll) return
  let panel = document.getElementById('standaloneLandmarkListPanel')
  if (!panel) {
    panel = document.createElement('div')
    panel.id = 'standaloneLandmarkListPanel'
    panel.className = 'panel standalone-landmark-list-panel'
    const lmPanel = document.getElementById('latLandmarkPanel')
    if (lmPanel?.parentNode) lmPanel.insertAdjacentElement('afterend', panel)
    else scroll.appendChild(panel)
  }

  const esc = x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  if (!annotator || !isLat) {
    const empty = '<h3 class="panel-title"><i class="fas fa-list"></i> LAT landmark 목록</h3><p class="landmark-empty">LAT 파일에서 landmark 목록이 표시됩니다.</p>'
    if (panel.dataset.lmHtml !== empty) { panel.innerHTML = empty; panel.dataset.lmHtml = empty }
    return
  }

  const spineTargets = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
  const allTargets = [...spineTargets, 'HC_LAT']
  const point5 = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT','CENTER']
  const targetOf = label => {
    const text = String(label || '').toUpperCase()
    if (text === 'HC_LAT' || text === 'FH_LAT') return 'HC_LAT'
    return text.split('_')[0]
  }
  const suffixOf = label => {
    const text = String(label || '').toUpperCase()
    const target = targetOf(text)
    return target === 'HC_LAT' ? 'HC_LAT' : text.slice(target.length + 1)
  }
  const labelsFor = target => target === 'HC_LAT'
    ? ['HC_LAT']
    : target === 'S1'
      ? ['S1_SUP_ANT','S1_SUP_POST','S1_CENTER']
      : point5.map(p => target + '_' + p)
  const expectedCount = target => labelsFor(target).length
  const options = selected => allTargets.map(t => '<option value="' + esc(t) + '"' + (t === selected ? ' selected' : '') + '>' + esc(t) + '</option>').join('')

  // Use the actual mutable array. getLandmarks() returns copies in some rewrites,
  // so relabeling those copies never updates saved landmark labels.
  const landmarks = Array.isArray(annotator.landmarks) ? annotator.landmarks : (annotator.getLandmarks?.() || [])

  function splitTargetIntoYGroups(target, items) {
    if (target === 'HC_LAT') return items.map((lm, idx) => ({ target, items: [lm], y: Number(lm.y || 0), key: target + ':' + idx }))
    const counts = new Map()
    for (const lm of items) counts.set(suffixOf(lm.label), (counts.get(suffixOf(lm.label)) || 0) + 1)
    const anchorSuffix = ['CENTER','SUP_ANT','SUP_POST','INF_ANT','INF_POST'].find(s => (counts.get(s) || 0) > 1)
    if (!anchorSuffix) return [{ target, items, y: items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, items.length), key: target + ':0' }]
    const anchors = items.filter(lm => suffixOf(lm.label) === anchorSuffix).sort((a, b) => Number(a.y || 0) - Number(b.y || 0))
    const groups = anchors.map((a, idx) => ({ target, items: [], y: Number(a.y || 0), key: target + ':' + idx }))
    for (const lm of items) {
      let best = 0, bestDist = Infinity
      for (let i = 0; i < anchors.length; i++) {
        const d = Math.abs(Number(lm.y || 0) - Number(anchors[i].y || 0))
        if (d < bestDist) { bestDist = d; best = i }
      }
      groups[best].items.push(lm)
    }
    for (const g of groups) g.y = g.items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, g.items.length)
    return groups
  }

  const byTarget = new Map()
  for (const lm of landmarks) {
    const target = targetOf(lm.label)
    if (!allTargets.includes(target)) continue
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target).push(lm)
  }
  const groups = []
  for (const [target, items] of byTarget.entries()) groups.push(...splitTargetIntoYGroups(target, items))
  groups.sort((a, b) => a.y - b.y)
  panel.__landmarkYGroups = groups

  const active = document.activeElement
  const freeze = Date.now() < (window.__standaloneLmFreezeUntil || 0)
  if (!force && (freeze || panel.matches(':hover') || panel.contains(active))) return

  const signature = JSON.stringify({
    file: state.filename,
    pending: annotator.pendingLandmark || '',
    groups: groups.map(g => ({ t: g.target, n: g.items.length, y: Math.round(g.y), labels: g.items.map(l => l.label).sort() })),
  })
  if (!force && panel.dataset.lmSignature === signature) return

  const prevList = panel.querySelector('.standalone-lm-list')
  const prevScrollTop = prevList?.scrollTop || 0
  const pendingTarget = targetOf(annotator.pendingLandmark || '') || (groups[0]?.target || 'C2')
  const rows = groups.length ? groups.map((g, idx) => {
    const n = g.items.length
    const exp = expectedCount(g.target)
    return '<div class="standalone-lm-row' + (g.target === pendingTarget ? ' active' : '') + (n ? ' has-points' : '') + '" data-slm-row-idx="' + idx + '">' +
      '<span class="standalone-lm-order">' + (idx + 1) + '</span>' +
      '<select data-slm-y-shift="' + idx + '">' + options(g.target) + '</select>' +
      '<span class="standalone-lm-count">' + n + '/' + exp + '</span>' +
      '<button type="button" data-slm-jump="' + idx + '">찍기</button>' +
      '<button type="button" data-slm-delete="' + idx + '">삭제</button>' +
    '</div>'
  }).join('') : '<p class="landmark-empty">아직 찍힌 landmark가 없습니다.</p>'

  const html = '<h3 class="panel-title"><i class="fas fa-list"></i> LAT landmark 목록</h3>' +
    '<div class="landmark-region-color-note">실제 y축 위치 순서 기준. row dropdown을 바꾸면 그 row부터 아래 landmark가 순서대로 재라벨링됩니다.</div>' +
    '<div class="standalone-lm-current"><span>다음 찍기</span><select data-slm-current>' + options(pendingTarget) + '</select></div>' +
    '<div class="standalone-lm-list">' + rows + '</div>'

  panel.innerHTML = html
  panel.dataset.lmHtml = html
  panel.dataset.lmSignature = signature
  const list = panel.querySelector('.standalone-lm-list')
  if (list) {
    list.scrollTop = prevScrollTop
    list.addEventListener('scroll', () => { window.__standaloneLmFreezeUntil = Date.now() + 12000 }, { passive: true })
  }

  const firstMissing = target => {
    const used = new Set((Array.isArray(annotator.landmarks) ? annotator.landmarks : []).map(l => l.label))
    const labels = labelsFor(target)
    return labels.find(label => !used.has(label)) || labels[0]
  }
  const setPending = label => {
    if (!label) return
    window.__standaloneLmFreezeUntil = Date.now() + 800
    annotator.setPendingLandmark?.(label)
    renderStandaloneLandmarkListPanel(true)
  }
  const relabelFromYIndex = (anchorIdx, toTarget) => {
    window.__standaloneLmFreezeUntil = Date.now() + 800
    window.__suppressRemoteLabelPromptUntil = Date.now() + 20000
    const freshGroups = panel.__landmarkYGroups || groups
    const startIdx = spineTargets.indexOf(String(toTarget || '').toUpperCase())
    if (!Number.isFinite(anchorIdx) || anchorIdx < 0 || anchorIdx >= freshGroups.length || startIdx < 0) return
    const editableGroups = freshGroups.filter(g => spineTargets.includes(g.target))
    const anchorGroup = freshGroups[anchorIdx]
    const editableAnchorIdx = editableGroups.indexOf(anchorGroup)
    if (editableAnchorIdx < 0) return

    for (let i = editableAnchorIdx; i < editableGroups.length; i++) {
      const nextTarget = spineTargets[startIdx + (i - editableAnchorIdx)]
      if (!nextTarget) break
      for (const lm of editableGroups[i].items) {
        const oldTarget = targetOf(lm.label)
        const suffix = suffixOf(lm.label)
        lm.label = suffix ? nextTarget + '_' + suffix : nextTarget
        lm.target = nextTarget
      }
      editableGroups[i].target = nextTarget
    }

    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
    renderStandaloneLandmarkListPanel(true)
  }

  panel.querySelector('[data-slm-current]')?.addEventListener('change', e => setPending(firstMissing(e.target.value)))
  panel.querySelectorAll('[data-slm-jump]').forEach(btn => btn.addEventListener('click', () => {
    const g = groups[Number(btn.dataset.slmJump)]
    if (g) setPending(firstMissing(g.target))
  }))
  panel.querySelectorAll('[data-slm-delete]').forEach(btn => btn.addEventListener('click', () => {
    window.__suppressRemoteLabelPromptUntil = Date.now() + 20000
    const g = groups[Number(btn.dataset.slmDelete)]
    if (!g) return
    const kill = new Set(g.items)
    annotator.landmarks = (annotator.landmarks || []).filter(l => !kill.has(l))
    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
    renderStandaloneLandmarkListPanel(true)
  }))
  panel.querySelectorAll('[data-slm-y-shift]').forEach(sel => {
    sel.addEventListener('pointerdown', () => { window.__standaloneLmFreezeUntil = Date.now() + 15000 })
    sel.addEventListener('focus', () => { window.__standaloneLmFreezeUntil = Date.now() + 15000 })
    sel.addEventListener('change', e => relabelFromYIndex(Number(e.target.dataset.slmYShift), e.target.value))
  })
}

if (!window.__standaloneLandmarkListTimer) {
  window.__standaloneLandmarkListTimer = setInterval(() => {
    try {
      const panel = document.getElementById('standaloneLandmarkListPanel')
      const active = document.activeElement
      if (panel && ((active && panel.contains(active)) || Date.now() < (window.__standaloneLmFreezeUntil || 0))) return
      renderStandaloneLandmarkListPanel()
    } catch (err) { console.warn('[LandmarkList] render failed', err) }
  }, 1200)
}
if (!window.__standaloneLandmarkListFreezeEvents) {
  window.__standaloneLandmarkListFreezeEvents = true
  const freezeLmPanel = (ms = 4000) => { window.__standaloneLmFreezeUntil = Date.now() + ms }
  document.addEventListener('pointerdown', (e) => { if (e.target?.closest?.('#standaloneLandmarkListPanel')) freezeLmPanel(5000) }, true)
  document.addEventListener('focusin', (e) => { if (e.target?.closest?.('#standaloneLandmarkListPanel')) freezeLmPanel(15000) }, true)
  document.addEventListener('change', (e) => { if (e.target?.closest?.('#standaloneLandmarkListPanel')) freezeLmPanel(300) }, true)
}


// Landmark edit-mode single point deletion: O/edit mode + hover landmark + R.
if (!window.__landmarkSinglePointRDeleteInstalled) {
  window.__landmarkSinglePointRDeleteInstalled = true
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    const isR = e.code === 'KeyR' || String(e.key || '').toLowerCase() === 'r'
    if (!isR) return
    const annotator = window.state?.annotator || state?.annotator
    if (!annotator || annotator.tool !== 'edit') return
    if (!annotator.deleteHoveredLandmarkPoint?.()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
  }, true)
}


// Replace older auto-refresh timer with a stable one that does not redraw while the list is hovered, focused, or scrolling.
if (window.__standaloneLandmarkListTimer) {
  clearInterval(window.__standaloneLandmarkListTimer)
  window.__standaloneLandmarkListTimer = null
}
if (!window.__standaloneLandmarkListStableTimerV2) {
  window.__standaloneLandmarkListStableTimerV2 = setInterval(() => {
    try {
      const panel = document.getElementById('standaloneLandmarkListPanel')
      if (panel && (panel.matches(':hover') || panel.contains(document.activeElement) || Date.now() < (window.__standaloneLmFreezeUntil || 0))) return
      renderStandaloneLandmarkListPanel(false)
    } catch (err) { console.warn('[LandmarkList] stable render failed', err) }
  }, 2500)
}


// Final Y-axis landmark relabel handler.
// This runs before older dropdown listeners and mutates annotator.landmarks directly.
if (!window.__landmarkYShiftCaptureFinal) {
  window.__landmarkYShiftCaptureFinal = true
  document.addEventListener('change', (e) => {
    const sel = e.target?.closest?.('[data-slm-y-shift]')
    if (!sel) return
    const annotator = state?.annotator
    const panel = document.getElementById('standaloneLandmarkListPanel')
    const groups = panel?.__landmarkYGroups || []
    const row = Number(sel.dataset.slmYShift)
    const toTarget = String(sel.value || '').toUpperCase()
    const seq = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
    const start = seq.indexOf(toTarget)
    if (!annotator || !Array.isArray(annotator.landmarks) || row < 0 || start < 0 || row >= groups.length) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const targetOf = (label) => {
      const t = String(label || '').toUpperCase()
      return t === 'HC_LAT' ? 'HC_LAT' : t.split('_')[0]
    }
    const suffixOf = (label) => {
      const t = String(label || '').toUpperCase()
      const base = targetOf(t)
      return base === 'HC_LAT' ? '' : t.slice(base.length + 1)
    }
    const editable = groups.filter(g => seq.includes(g.target))
    const anchor = groups[row]
    const anchorIdx = editable.indexOf(anchor)
    if (anchorIdx < 0) return
    for (let i = anchorIdx; i < editable.length; i++) {
      const next = seq[start + i - anchorIdx]
      if (!next) break
      for (const lm of editable[i].items || []) {
        const suffix = suffixOf(lm.label)
        lm.label = suffix ? next + '_' + suffix : next
        lm.target = next
      }
      editable[i].target = next
    }
    window.__standaloneLmFreezeUntil = Date.now() + 1200
    window.__suppressRemoteLabelPromptUntil = Date.now() + 20000
    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
    if (typeof renderStandaloneLandmarkListPanel === 'function') renderStandaloneLandmarkListPanel(true)
  }, true)
}
