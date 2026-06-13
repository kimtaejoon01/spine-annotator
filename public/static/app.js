/* ================================================================
   Spine Annotator - 메인 진입점
   ================================================================ */

import { SpineAnnotator } from './annotator.js'
import { LABELS, parseFilename, getRegionColor } from './labels.js'
import { exportToCOCO } from './coco.js'
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
  shortcuts: loadShortcuts(), // 사용자 단축키 매핑

  // 로컬 폴더 연결
  folderHandle: null,        // FileSystemDirectoryHandle
  folderName: '',            // 표시용
  files: [],                 // [{name, handle}] 정렬된 이미지 파일 목록
  fileFilter: 'all',         // 'all' | 'AP' | 'LAT'
  fileSearch: '',            // 검색어 (lowercase)
  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용)
}

// ================================================================
// 초기화
// ================================================================
window.addEventListener('DOMContentLoaded', async () => {
  console.log('[App] Initializing Spine Annotator...')

  // Annotator 인스턴스 생성
  state.annotator = new SpineAnnotator({
    container: 'canvasStage',
    onPolygonsChange: handlePolygonsChange,
    onZoomChange: handleZoomChange,
    onStatusChange: handleStatusChange,
  })

  // UI 이벤트 바인딩
  bindUIEvents()
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
  await postAuthInit()
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

  console.log('[App] Ready.')
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

  // 파일 업로드
  document.getElementById('fileUpload').addEventListener('change', handleFileUpload)
  document.getElementById('loadSampleBtn').addEventListener('click', loadSampleImage)

  // 폴더 연결
  document.getElementById('connectFolderBtn').addEventListener('click', handleConnectFolder)

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
  state.annotator.setTool(tool)
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tool' + tool[0].toUpperCase() + tool.slice(1)).classList.add('active')
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
  switch (actionId) {
    case 'finishPolygon':
      state.annotator.finishDrawing()
      return true
    case 'finishPolygonFree':
      state.annotator.finishDrawing({ angularSort: true })
      return true
    case 'cancelDrawing':
      state.annotator.cancelDrawing()
      return true
    case 'removeLastPoint':
      // 그리는 중엔 마지막 점만 취소, 아니면 선택된 폴리곤 삭제
      if (!state.annotator.removeLastPoint()) {
        state.annotator.deleteSelected()
      }
      return true
    case 'deleteSelected':
      state.annotator.deleteSelected()
      return true
    case 'removeHoveredVertex':
      // 점 위에 마우스가 있으면 그 점 삭제, 아니면 무시 (false 반환해 preventDefault 안 함)
      return state.annotator.removeHoveredVertex()
    case 'toolDraw':
      setTool('draw')
      return true
    case 'toolEdit':
      setTool('edit')
      return true
    case 'toolDelete':
      setTool('delete')
      return true
    case 'undo':
      state.annotator.undo()
      return true
    case 'redo':
      state.annotator.redo()
      return true
    case 'panMode':
      state.annotator.setPanMode(true)
      return true
    case 'freehandMode':
      state.annotator.setFreehandMode(true)
      return true
    case 'zoomIn':
      state.annotator.zoomBy(1.2)
      return true
    case 'zoomOut':
      state.annotator.zoomBy(1 / 1.2)
      return true
    case 'zoomFit':
      state.annotator.zoomToFit()
      return true
    case 'openShortcuts':
      openShortcutsModal()
      return true
  }
  return false
}

// ================================================================
// 이미지 로드
// ================================================================
async function loadSampleImage() {
  // 샘플 X-ray 이미지를 로드 (외부 의료 영상 샘플)
  const sampleUrl = '/static/sample-spine.png'
  state.filename = 'sample_00000000_AP.png'
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
  const parsed = parseFilename(file.name)
  state.patientId = parsed.patientId
  state.studyDate = parsed.studyDate
  state.viewType = parsed.viewType || 'AP'

  const url = URL.createObjectURL(file)
  state.annotator.loadImage(url).then(() => {
    updateFileInfo()
    document.getElementById('canvasPlaceholder').classList.add('hidden')
  })
}

function updateFileInfo() {
  document.getElementById('fileName').textContent = state.filename
  const badge = document.getElementById('viewBadge')
  badge.textContent = state.viewType
  badge.setAttribute('data-view', state.viewType)
  state.imageWidth = state.annotator.imageWidth
  state.imageHeight = state.annotator.imageHeight
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
  LABELS.forEach((lbl) => {
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
function autoSave() {
  // 파일 전환 중엔 저장 보류 (빈 상태로 덮어쓰지 않기)
  if (state._suspendAutoSave) return

  if (saveTimer) clearTimeout(saveTimer)
  document.getElementById('saveStatus').textContent = '저장 중...'

  saveTimer = setTimeout(async () => {
    if (state._suspendAutoSave) return
    const labelerId = getCurrentLabelerId()
    const polygons = state.annotator.getPolygons()

    const payload = {
      view_type: state.viewType,
      start_label: state.annotator.startLabel,
      polygons,
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
// COCO Export
// ================================================================
function showCocoPreview() {
  const polygons = state.annotator.getPolygons()
  if (polygons.length === 0) {
    alert('라벨이 없습니다. 폴리곤을 먼저 그려주세요.')
    return
  }

  const coco = exportToCOCO({
    filename: state.filename,
    width: state.imageWidth,
    height: state.imageHeight,
    polygons,
  })

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
    const files = await listImageFiles(state.folderHandle)
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
    const hasLabels = !!(meta && meta.polygon_count > 0)
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
async function loadFileFromFolder(fileEntry) {
  try {
    // 이전 ObjectURL 해제
    if (state.currentObjectUrl) {
      URL.revokeObjectURL(state.currentObjectUrl)
      state.currentObjectUrl = null
    }

    const { url } = await fileHandleToUrl(fileEntry.handle)
    state.currentObjectUrl = url
    state.filename = fileEntry.name
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
async function loadLabelsFromStorage(filename) {
  // 자동저장 차단 플래그
  state._suspendAutoSave = true
  try {
    const data = await loadLabel(filename)
    if (!data.exists) {
      state.labelVersion = null
      // 저장된 라벨 없음 → 빈 상태로 시작
      state.annotator.loadPolygons([])
      // 이 시점 이후 다른 사람이 수정하면 알림
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
    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])
    // 방금 본 서버 버전 기준점 저장 → 다음 polling부터 변경 감지
    state.lastSeenRemoteUpdate = data.updated_at
    state.lastSeenRemoteUpdateInitialized = true
  } catch (err) {
    console.warn('Label restore failed:', err)
    if (err.status === 401) {
      openAuthModal()
    }
    state.labelVersion = null
    state.annotator.loadPolygons([])
  } finally {
    // 다음 tick 이후 자동저장 재개 (loadPolygons의 notifyPolygons가 끝난 다음)
    setTimeout(() => { state._suspendAutoSave = false }, 100)
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
      closeAuthModal()
      // 인증 성공 후 나머지 초기화 진행 (postAuthInit이 아직 안 돌았다면)
      await postAuthInit()
    } catch (err) {
      errEl.textContent = err.message || '인증 실패'
      errEl.classList.remove('hidden')
      input.select()
    }
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

