/* ================================================================
   Visibility controls
   - 사람 라벨 보기: human annotation layer 전체 ON/OFF
   - 선/이름표 보기: 마스크 fill은 유지하고 outline + C2/C3 label만 ON/OFF
   ================================================================ */

const HUMAN_LABEL_VISIBLE_KEY = 'spine-annotator:human-label-visible'
const LINE_NAME_VISIBLE_KEY = 'spine-annotator:label-overlay-visible'

function loadBoolean(key, fallback = true) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : raw !== 'false'
  } catch {
    return fallback
  }
}

function saveBoolean(key, value) {
  try {
    localStorage.setItem(key, String(value !== false))
  } catch {}
}

export function loadVisibilityState() {
  return {
    humanLabelVisible: loadBoolean(HUMAN_LABEL_VISIBLE_KEY, true),
    lineNameVisible: loadBoolean(LINE_NAME_VISIBLE_KEY, true),
  }
}

export function applyVisibilityState(annotator, state) {
  if (!annotator || !state) return

  if (typeof annotator.setHumanLabelVisible === 'function') {
    annotator.setHumanLabelVisible(state.humanLabelVisible !== false)
  } else {
    annotator.humanLabelVisible = state.humanLabelVisible !== false
  }

  if (typeof annotator.setLabelOverlayVisible === 'function') {
    annotator.setLabelOverlayVisible(state.lineNameVisible !== false)
  } else {
    annotator.labelOverlayVisible = state.lineNameVisible !== false
  }

  annotator.renderPolygons?.()
  if (annotator.polyLayer) {
    // 랜드마크/종판 모드에서는 renderPolygons() 가 폴리곤 레이어를 숨기므로 그 결정을 덮어쓰지 않는다.
    // (덮어쓰면 랜드마크 모드에서 파일 로드·토글 시 폴리곤 레이어가 다시 위로 떠버림)
    const mode = annotator.__activeAnnotationMode || 'polygon'
    if (mode === 'polygon') {
      annotator.polyLayer.visible(state.humanLabelVisible !== false)
    }
    annotator.polyLayer.batchDraw?.()
  }
}

function syncCheckbox(checkbox, value) {
  if (!checkbox) return
  checkbox.checked = value !== false
}

function setLabelText(checkbox, text) {
  const span = checkbox?.closest('label')?.querySelector('span')
  if (span) span.textContent = text
}

export function initVisibilityControls({ state, annotator }) {
  if (!state) return

  const saved = loadVisibilityState()
  state.humanLabelVisible = saved.humanLabelVisible
  state.labelOverlayVisible = saved.lineNameVisible
  state.lineNameVisible = saved.lineNameVisible

  const humanCheckbox = document.getElementById('toggleLabelOverlay')
  const lineNameCheckbox = document.getElementById('humanLabelOverlayToggle')

  setLabelText(humanCheckbox, '사람 라벨 보기')
  setLabelText(lineNameCheckbox, '선/이름표 보기')

  syncCheckbox(humanCheckbox, state.humanLabelVisible)
  syncCheckbox(lineNameCheckbox, state.lineNameVisible)

  const applyAll = () => {
    saveBoolean(HUMAN_LABEL_VISIBLE_KEY, state.humanLabelVisible)
    saveBoolean(LINE_NAME_VISIBLE_KEY, state.lineNameVisible)
    syncCheckbox(humanCheckbox, state.humanLabelVisible)
    syncCheckbox(lineNameCheckbox, state.lineNameVisible)
    applyVisibilityState(annotator || state.annotator, state)
  }

  if (humanCheckbox && !humanCheckbox.dataset.visibilityModuleBound) {
    humanCheckbox.dataset.visibilityModuleBound = '1'
    humanCheckbox.addEventListener('change', (event) => {
      event.stopImmediatePropagation()
      state.humanLabelVisible = humanCheckbox.checked
      applyAll()
    }, true)
  }

  if (lineNameCheckbox && !lineNameCheckbox.dataset.visibilityModuleBound) {
    lineNameCheckbox.dataset.visibilityModuleBound = '1'
    lineNameCheckbox.addEventListener('change', (event) => {
      event.stopImmediatePropagation()
      state.lineNameVisible = lineNameCheckbox.checked
      state.labelOverlayVisible = state.lineNameVisible
      applyAll()
    }, true)
  }

  applyAll()
}

export function refreshVisibilityControls({ state, annotator }) {
  applyVisibilityState(annotator || state?.annotator, state)
}
