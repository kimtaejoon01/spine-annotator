/* ================================================================
   LAT five-point landmark tools
   - Keeps polygon segmentation labels intact
   - Adds measurement/keypoint landmarks for heatmap training
   ================================================================ */

const VERTEBRAE_FULL = [
  'C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
  'L1', 'L2', 'L3', 'L4', 'L5',
]
const POINTS_5 = ['SUP_POST', 'SUP_ANT', 'INF_ANT', 'INF_POST', 'CENTER']

export const LAT_5POINT_SEQUENCE = [
  ...VERTEBRAE_FULL.flatMap(v => POINTS_5.map(p => `${v}_${p}`)),
  'S1_SUP_POST',
  'S1_SUP_ANT',
  'S1_CENTER',
  'HC_LAT',
]

export function installLat5PointLandmarks({ annotator, getViewType, onChange } = {}) {
  if (!annotator) return null
  if (annotator.__lat5PointLandmarksInstalled) return annotator.__lat5PointLandmarkApi
  annotator.__lat5PointLandmarksInstalled = true

  annotator.landmarks = []
  annotator.pendingLandmark = null
  annotator.landmarkLayer = new Konva.Layer()
  annotator.stage.add(annotator.landmarkLayer)

  let sequenceIndex = 0
  let panel = null
  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)

  annotator.onMouseDown = function patchedLandmarkMouseDown(e) {
    if (this.pendingLandmark && String(getViewType?.() || '').toUpperCase() === 'LAT') {
      if (e.evt?.button != null && e.evt.button !== 0) return
      const pos = this.getImagePos()
      if (!pos) return
      e.cancelBubble = true
      this.setLandmark(this.pendingLandmark, pos.x, pos.y)
      const current = LAT_5POINT_SEQUENCE.indexOf(this.pendingLandmark)
      sequenceIndex = findNextMissingIndex(this.landmarks, current + 1)
      this.setPendingLandmark(LAT_5POINT_SEQUENCE[sequenceIndex] || null)
      renderPanel()
      onChange?.()
      return
    }
    return originalOnMouseDown(e)
  }

  annotator.setPendingLandmark = function setPendingLandmark(label) {
    this.pendingLandmark = label || null
    this.updateStatus?.()
    renderPanel()
  }

  annotator.setLandmark = function setLandmark(label, x, y, visibility = 'visible') {
    const clean = String(label || '').trim().toUpperCase()
    if (!clean) return
    const existing = this.landmarks.find(l => l.label === clean)
    const item = {
      id: existing?.id || `lm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: clean,
      target: landmarkTarget(clean),
      kind: 'point',
      x: Number(x),
      y: Number(y),
      visibility,
    }
    if (existing) Object.assign(existing, item)
    else this.landmarks.push(item)
    this.renderLandmarks()
  }

  annotator.deleteLandmark = function deleteLandmark(label) {
    const clean = String(label || '').trim().toUpperCase()
    const before = this.landmarks.length
    this.landmarks = this.landmarks.filter(l => l.label !== clean)
    if (this.landmarks.length !== before) {
      this.renderLandmarks()
      renderPanel()
      onChange?.()
    }
  }

  annotator.clearLandmarks = function clearLandmarks() {
    this.landmarks = []
    this.pendingLandmark = null
    this.renderLandmarks()
    renderPanel()
    onChange?.()
  }

  annotator.getLandmarks = function getLandmarks() {
    return (this.landmarks || []).map(l => ({
      id: l.id,
      label: l.label,
      target: l.target || landmarkTarget(l.label),
      kind: l.kind || 'point',
      x: Number(l.x),
      y: Number(l.y),
      visibility: l.visibility || 'visible',
    })).filter(l => Number.isFinite(l.x) && Number.isFinite(l.y))
  }

  annotator.loadLandmarks = function loadLandmarks(landmarks) {
    this.landmarks = Array.isArray(landmarks)
      ? landmarks.map((l, i) => ({
          id: l.id || `lm_loaded_${i}`,
          label: String(l.label || '').trim().toUpperCase(),
          target: l.target || landmarkTarget(l.label),
          kind: l.kind || 'point',
          x: Number(l.x),
          y: Number(l.y),
          visibility: l.visibility || 'visible',
        })).filter(l => l.label && Number.isFinite(l.x) && Number.isFinite(l.y))
      : []
    sequenceIndex = findNextMissingIndex(this.landmarks, 0)
    this.renderLandmarks()
    renderPanel()
  }

  annotator.renderLandmarks = function renderLandmarks() {
    if (!this.landmarkLayer) return
    this.landmarkLayer.destroyChildren()
    const scale = Math.max(0.001, this.stage.scaleX() || 1)
    const byLabel = new Map((this.landmarks || []).map(l => [l.label, l]))

    for (const v of VERTEBRAE_FULL) {
      addLandmarkLine(this.landmarkLayer, byLabel.get(`${v}_SUP_POST`), byLabel.get(`${v}_SUP_ANT`), '#f59e0b', scale)
      addLandmarkLine(this.landmarkLayer, byLabel.get(`${v}_INF_POST`), byLabel.get(`${v}_INF_ANT`), '#38bdf8', scale)
    }
    addLandmarkLine(this.landmarkLayer, byLabel.get('S1_SUP_POST'), byLabel.get('S1_SUP_ANT'), '#f97316', scale)

    for (const lm of this.landmarks || []) {
      const group = new Konva.Group({ x: lm.x, y: lm.y, draggable: true, landmarkLabel: lm.label })
      const isPending = lm.label === this.pendingLandmark
      group.add(new Konva.Circle({
        radius: (isPending ? 6 : 5) / scale,
        fill: landmarkColor(lm.label),
        stroke: '#0f172a',
        strokeWidth: 1.5 / scale,
      }))
      group.add(new Konva.Text({
        x: 7 / scale,
        y: -7 / scale,
        text: lm.label,
        fontSize: 10 / scale,
        fontStyle: 'bold',
        fill: '#ffffff',
        stroke: '#0f172a',
        strokeWidth: 2 / scale,
      }))
      group.on('dragmove', () => {
        const pos = group.position()
        lm.x = pos.x
        lm.y = pos.y
        this.renderLandmarks()
      })
      group.on('dragend', () => {
        onChange?.()
        renderPanel()
      })
      group.on('dblclick contextmenu', (e) => {
        e.evt?.preventDefault?.()
        e.cancelBubble = true
        this.deleteLandmark(lm.label)
      })
      this.landmarkLayer.add(group)
    }
    this.landmarkLayer.batchDraw()
  }

  function ensurePanel() {
    if (panel) return panel
    const sidebar = document.getElementById('sidebarRight')
    const scroll = sidebar?.querySelector('.sidebar-scroll') || sidebar
    if (!scroll) return null
    panel = document.createElement('div')
    panel.className = 'panel landmark-panel'
    panel.id = 'latLandmarkPanel'
    const measurePanel = document.getElementById('sagittalMeasurementPanel')
    const pelvisPanel = document.getElementById('pelvisLabelPanel')
    if (measurePanel?.parentNode === scroll) measurePanel.insertAdjacentElement('afterend', panel)
    else if (pelvisPanel?.parentNode === scroll) pelvisPanel.insertAdjacentElement('afterend', panel)
    else scroll.appendChild(panel)
    return panel
  }

  function renderPanel() {
    const el = ensurePanel()
    if (!el) return
    const isLat = String(getViewType?.() || '').toUpperCase() === 'LAT'
    const landmarks = annotator.getLandmarks()
    const done = new Set(landmarks.map(l => l.label))
    const current = LAT_5POINT_SEQUENCE[sequenceIndex] || LAT_5POINT_SEQUENCE[0]
    const completed = LAT_5POINT_SEQUENCE.filter(label => done.has(label)).length

    if (!isLat) {
      el.innerHTML = `
        <h3 class="panel-title"><i class="fas fa-map-pin"></i> LAT 5점 랜드마크</h3>
        <p class="landmark-empty">LAT 영상에서 5-point landmark를 찍습니다.</p>
      `
      return
    }

    el.innerHTML = `
      <h3 class="panel-title"><i class="fas fa-map-pin"></i> LAT 5점 랜드마크</h3>
      <div class="landmark-progress"><strong>${completed}</strong> / ${LAT_5POINT_SEQUENCE.length} points</div>
      <div class="landmark-current ${annotator.pendingLandmark ? 'active' : ''}">
        <span>현재 점</span>
        <strong>${escapeHtml(annotator.pendingLandmark || current)}</strong>
      </div>
      <div class="landmark-actions">
        <button type="button" data-lm-start>${annotator.pendingLandmark ? '찍기 중' : '전체 시작'}</button>
        <button type="button" data-lm-prev>이전</button>
        <button type="button" data-lm-skip>건너뛰기</button>
        <button type="button" data-lm-delete>현재 삭제</button>
      </div>
      <div class="landmark-actions landmark-actions-danger">
        <button type="button" data-lm-clear>랜드마크 전체 삭제</button>
      </div>
      <p class="landmark-help">순서: 각 척추 SUP_POST → SUP_ANT → INF_ANT → INF_POST → CENTER, 마지막 S1/HC_LAT. 점은 드래그로 수정, 더블클릭/우클릭으로 삭제.</p>
    `

    el.querySelector('[data-lm-start]')?.addEventListener('click', () => {
      sequenceIndex = findNextMissingIndex(annotator.landmarks, sequenceIndex)
      annotator.setPendingLandmark(LAT_5POINT_SEQUENCE[sequenceIndex] || LAT_5POINT_SEQUENCE[0])
    })
    el.querySelector('[data-lm-prev]')?.addEventListener('click', () => {
      sequenceIndex = Math.max(0, sequenceIndex - 1)
      annotator.setPendingLandmark(LAT_5POINT_SEQUENCE[sequenceIndex])
    })
    el.querySelector('[data-lm-skip]')?.addEventListener('click', () => {
      sequenceIndex = Math.min(LAT_5POINT_SEQUENCE.length - 1, sequenceIndex + 1)
      annotator.setPendingLandmark(LAT_5POINT_SEQUENCE[sequenceIndex])
    })
    el.querySelector('[data-lm-delete]')?.addEventListener('click', () => {
      annotator.deleteLandmark(annotator.pendingLandmark || LAT_5POINT_SEQUENCE[sequenceIndex])
    })
    el.querySelector('[data-lm-clear]')?.addEventListener('click', () => {
      if (confirm('현재 파일의 landmark를 모두 삭제할까요? polygon 라벨은 유지됩니다.')) annotator.clearLandmarks()
    })
  }

  const api = { refresh: renderPanel }
  annotator.__lat5PointLandmarkApi = api
  renderPanel()
  return api
}

function findNextMissingIndex(landmarks, start) {
  const done = new Set((landmarks || []).map(l => l.label))
  for (let i = Math.max(0, start || 0); i < LAT_5POINT_SEQUENCE.length; i++) {
    if (!done.has(LAT_5POINT_SEQUENCE[i])) return i
  }
  return Math.min(Math.max(0, start || 0), LAT_5POINT_SEQUENCE.length - 1)
}

function addLandmarkLine(layer, a, b, color, scale) {
  if (!a || !b) return
  layer.add(new Konva.Line({
    points: [a.x, a.y, b.x, b.y],
    stroke: color,
    strokeWidth: 2 / scale,
    opacity: 0.9,
    listening: false,
  }))
}

function landmarkTarget(label) {
  const text = String(label || '').toUpperCase()
  if (text === 'HC_LAT') return 'pelvis'
  return text.split('_')[0] || ''
}

function landmarkColor(label) {
  const text = String(label || '').toUpperCase()
  if (text.includes('CENTER')) return '#22c55e'
  if (text.includes('SUP')) return '#f59e0b'
  if (text.includes('INF')) return '#38bdf8'
  if (text === 'HC_LAT') return '#ec4899'
  return '#ffffff'
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
