#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/landmark-tools.js'
const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

if (before.includes("const LANDMARK_UI_VERSION = 'lat-corner-centroid-v3'")) {
  console.log('OK LAT 4-corner/centroid mode already patched')
  process.exit(0)
}

const content = `/* ================================================================
   LAT landmark tools
   - Corner mode: 4 corners per vertebra, auto-advances after each body.
   - Centroid mode: separate center/point labels.
   - Assumes left-facing LAT images: image-left = anterior, image-right = posterior.
   ================================================================ */

const LANDMARK_UI_VERSION = 'lat-corner-centroid-v3'

const VERTEBRAE_FULL = [
  'C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
  'L1', 'L2', 'L3', 'L4', 'L5', 'S1',
]

// Left-facing LAT screen order: 1 upper-left, 2 upper-right, 3 lower-right, 4 lower-left.
// Internally these are anatomical labels: ANT/POST are still stored for training/export.
const CORNER_POINTS_4 = ['SUP_ANT', 'SUP_POST', 'INF_POST', 'INF_ANT']

export const LAT_4CORNER_SEQUENCE = VERTEBRAE_FULL.flatMap(v => CORNER_POINTS_4.map(p => \`\${v}_\${p}\`))
export const LAT_CENTROID_SEQUENCE = [
  ...VERTEBRAE_FULL.map(v => \`\${v}_CENTER\`),
  'HC_LAT',
]

// Compatibility export: older app code imports this name.
export const LAT_5POINT_SEQUENCE = LAT_4CORNER_SEQUENCE

export function installLat5PointLandmarks({ annotator, getViewType, onChange } = {}) {
  if (!annotator) return null
  if (annotator.__lat5PointLandmarksInstalled) return annotator.__lat5PointLandmarkApi
  annotator.__lat5PointLandmarksInstalled = true

  annotator.landmarks = []
  annotator.pendingLandmark = null
  annotator.landmarkLayer = new Konva.Layer()
  annotator.stage.add(annotator.landmarkLayer)

  let mode = 'corner'
  let sequenceIndex = 0
  let panel = null
  let ignoredLegacyCount = 0
  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)

  annotator.onMouseDown = function patchedLandmarkMouseDown(e) {
    if (this.pendingLandmark && String(getViewType?.() || '').toUpperCase() === 'LAT') {
      if (e.evt?.button != null && e.evt.button !== 0) return
      const pos = this.getImagePos()
      if (!pos) return
      e.cancelBubble = true
      this.setLandmark(this.pendingLandmark, pos.x, pos.y)
      const sequence = getActiveSequence()
      const current = sequence.indexOf(this.pendingLandmark)
      sequenceIndex = findNextMissingIndex(this.landmarks, current + 1, sequence)
      this.setPendingLandmark(sequence[sequenceIndex] || null)
      renderPanel()
      onChange?.()
      return
    }
    return originalOnMouseDown(e)
  }

  const keyHandler = (e) => {
    if (window._capturingShortcut) return
    if (!annotator.pendingLandmark) return
    if (String(getViewType?.() || '').toUpperCase() !== 'LAT') return
    const tag = String(document.activeElement?.tagName || '').toUpperCase()
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (String(e.key || '').toLowerCase() !== 'q') return
    e.preventDefault()
    e.stopPropagation()
    jumpToNextTarget()
  }
  window.addEventListener('keydown', keyHandler, true)

  annotator.setPendingLandmark = function setPendingLandmark(label) {
    this.pendingLandmark = label || null
    this.updateStatus?.()
    renderPanel()
  }

  annotator.setLandmarkMode = function setLandmarkMode(nextMode) {
    mode = nextMode === 'centroid' ? 'centroid' : 'corner'
    sequenceIndex = findNextMissingIndex(this.landmarks, 0, getActiveSequence())
    this.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)
  }

  annotator.setLandmark = function setLandmark(label, x, y, visibility = 'visible') {
    const clean = String(label || '').trim().toUpperCase()
    if (!clean) return
    ignoredLegacyCount = 0
    const existing = this.landmarks.find(l => l.label === clean)
    const item = {
      id: existing?.id || \`lm_\${Date.now()}_\${Math.random().toString(36).slice(2, 7)}\`,
      label: clean,
      target: landmarkTarget(clean),
      kind: 'point',
      x: Number(x),
      y: Number(y),
      visibility,
      order_version: LANDMARK_UI_VERSION,
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
    ignoredLegacyCount = 0
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
      order_version: l.order_version || LANDMARK_UI_VERSION,
    })).filter(l => Number.isFinite(l.x) && Number.isFinite(l.y))
  }

  annotator.loadLandmarks = function loadLandmarks(landmarks) {
    ignoredLegacyCount = 0
    const loaded = []
    for (const [i, l] of (Array.isArray(landmarks) ? landmarks : []).entries()) {
      const orderVersion = String(l?.order_version || '')
      if (orderVersion !== LANDMARK_UI_VERSION) {
        ignoredLegacyCount++
        continue
      }
      const item = {
        id: l.id || \`lm_loaded_\${i}\`,
        label: String(l.label || '').trim().toUpperCase(),
        target: l.target || landmarkTarget(l.label),
        kind: l.kind || 'point',
        x: Number(l.x),
        y: Number(l.y),
        visibility: l.visibility || 'visible',
        order_version: LANDMARK_UI_VERSION,
      }
      if (item.label && Number.isFinite(item.x) && Number.isFinite(item.y)) loaded.push(item)
    }
    this.landmarks = loaded
    sequenceIndex = findNextMissingIndex(this.landmarks, 0, getActiveSequence())
    this.renderLandmarks()
    renderPanel()
  }

  annotator.renderLandmarks = function renderLandmarks() {
    if (!this.landmarkLayer) return
    this.landmarkLayer.destroyChildren()
    const scale = Math.max(0.001, this.stage.scaleX() || 1)
    const byLabel = new Map((this.landmarks || []).map(l => [l.label, l]))

    for (const v of VERTEBRAE_FULL) {
      addLandmarkLine(this.landmarkLayer, byLabel.get(\`\${v}_SUP_POST\`), byLabel.get(\`\${v}_SUP_ANT\`), '#f59e0b', scale)
      addLandmarkLine(this.landmarkLayer, byLabel.get(\`\${v}_INF_POST\`), byLabel.get(\`\${v}_INF_ANT\`), '#38bdf8', scale)
      addLandmarkLine(this.landmarkLayer, byLabel.get(\`\${v}_SUP_ANT\`), byLabel.get(\`\${v}_INF_ANT\`), '#94a3b8', scale, 0.45)
      addLandmarkLine(this.landmarkLayer, byLabel.get(\`\${v}_SUP_POST\`), byLabel.get(\`\${v}_INF_POST\`), '#94a3b8', scale, 0.45)
    }

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
        text: displayLandmarkLabel(lm.label, true),
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
        this.landmarkLayer.batchDraw()
      })
      group.on('dragend', () => {
        this.renderLandmarks()
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

  function getActiveSequence() {
    return mode === 'centroid' ? LAT_CENTROID_SEQUENCE : LAT_4CORNER_SEQUENCE
  }

  function jumpToNextTarget() {
    const sequence = getActiveSequence()
    const currentLabel = annotator.pendingLandmark || sequence[sequenceIndex]
    sequenceIndex = findNextTargetStartIndex(annotator.landmarks, currentLabel, sequence)
    annotator.setPendingLandmark(sequence[sequenceIndex] || null)
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
    const sequence = getActiveSequence()
    const landmarks = annotator.getLandmarks()
    const done = new Set(landmarks.map(l => l.label))
    const current = sequence[sequenceIndex] || sequence[0]
    const completed = sequence.filter(label => done.has(label)).length
    const target = landmarkTarget(annotator.pendingLandmark || current)
    const targetDone = sequence.filter(label => landmarkTarget(label) === target && done.has(label)).length
    const targetTotal = sequence.filter(label => landmarkTarget(label) === target).length
    const legacyWarning = ignoredLegacyCount > 0
      ? \`<p class="landmark-warning">이전 버전 landmark \${ignoredLegacyCount}개는 방향 매핑이 달라 자동으로 숨겼습니다. 이 파일은 새 순서로 다시 찍어주세요.</p>\`
      : ''

    if (!isLat) {
      el.innerHTML = \`
        <h3 class="panel-title"><i class="fas fa-map-pin"></i> LAT 랜드마크</h3>
        <p class="landmark-empty">LAT 영상에서 corner/centroid landmark를 찍습니다.</p>
      \`
      return
    }

    el.innerHTML = \`
      <h3 class="panel-title"><i class="fas fa-map-pin"></i> LAT 랜드마크</h3>
      <div class="landmark-mode-tabs">
        <button type="button" data-lm-mode="corner" class="\${mode === 'corner' ? 'active' : ''}">꼭지점 4개</button>
        <button type="button" data-lm-mode="centroid" class="\${mode === 'centroid' ? 'active' : ''}">Centroid</button>
      </div>
      <div class="landmark-progress"><strong>전체 \${completed}</strong> / \${sequence.length} · 현재 \${escapeHtml(target)} \${targetDone}/\${targetTotal}</div>
      \${legacyWarning}
      <div class="landmark-current \${annotator.pendingLandmark ? 'active' : ''}">
        <span>현재 점</span>
        <strong>\${escapeHtml(displayLandmarkLabel(annotator.pendingLandmark || current))}</strong>
      </div>
      <div class="landmark-actions">
        <button type="button" data-lm-start>시작/재개</button>
        <button type="button" data-lm-next-target>다음 척추(Q)</button>
        <button type="button" data-lm-skip>점 건너뛰기</button>
        <button type="button" data-lm-delete>현재 삭제</button>
      </div>
      <div class="landmark-actions landmark-actions-danger">
        <button type="button" data-lm-clear>랜드마크 전체 삭제</button>
      </div>
      <p class="landmark-help">꼭지점 모드: 1 위-왼쪽 → 2 위-오른쪽 → 3 아래-오른쪽 → 4 아래-왼쪽. 4개를 찍으면 자동으로 다음 척추로 넘어갑니다. Q는 현재 척추를 끝내고 다음 척추로 이동합니다. 중심점은 Centroid 모드에서 따로 찍습니다.</p>
    \`

    el.querySelectorAll('[data-lm-mode]')?.forEach(btn => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.lmMode === 'centroid' ? 'centroid' : 'corner'
        sequenceIndex = findNextMissingIndex(annotator.landmarks, 0, getActiveSequence())
        annotator.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)
      })
    })
    el.querySelector('[data-lm-start]')?.addEventListener('click', () => {
      sequenceIndex = findNextMissingIndex(annotator.landmarks, sequenceIndex, getActiveSequence())
      annotator.setPendingLandmark(getActiveSequence()[sequenceIndex] || getActiveSequence()[0])
    })
    el.querySelector('[data-lm-next-target]')?.addEventListener('click', jumpToNextTarget)
    el.querySelector('[data-lm-skip]')?.addEventListener('click', () => {
      sequenceIndex = Math.min(getActiveSequence().length - 1, sequenceIndex + 1)
      annotator.setPendingLandmark(getActiveSequence()[sequenceIndex])
    })
    el.querySelector('[data-lm-delete]')?.addEventListener('click', () => {
      annotator.deleteLandmark(annotator.pendingLandmark || getActiveSequence()[sequenceIndex])
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

function findNextMissingIndex(landmarks, start, sequence = LAT_4CORNER_SEQUENCE) {
  const done = new Set((landmarks || []).map(l => l.label))
  for (let i = Math.max(0, start || 0); i < sequence.length; i++) {
    if (!done.has(sequence[i])) return i
  }
  return Math.min(Math.max(0, start || 0), Math.max(0, sequence.length - 1))
}

function findNextTargetStartIndex(landmarks, currentLabel, sequence) {
  const currentTarget = landmarkTarget(currentLabel)
  const start = Math.max(0, sequence.indexOf(currentLabel) + 1)
  for (let i = start; i < sequence.length; i++) {
    if (landmarkTarget(sequence[i]) !== currentTarget) return findNextMissingIndex(landmarks, i, sequence)
  }
  return findNextMissingIndex(landmarks, start, sequence)
}

function addLandmarkLine(layer, a, b, color, scale, opacity = 0.9) {
  if (!a || !b) return
  layer.add(new Konva.Line({
    points: [a.x, a.y, b.x, b.y],
    stroke: color,
    strokeWidth: 2 / scale,
    opacity,
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

function displayLandmarkLabel(label, compact = false) {
  const text = String(label || '').toUpperCase()
  if (!text) return ''
  if (text === 'HC_LAT') return compact ? 'HC' : 'HC_LAT / 고관절 중심'
  const parts = text.split('_')
  const target = parts[0] || ''
  const suffix = parts.slice(1).join('_')
  const compactMap = {
    SUP_ANT: '1',
    SUP_POST: '2',
    INF_POST: '3',
    INF_ANT: '4',
    CENTER: 'C',
  }
  const fullMap = {
    SUP_ANT: '1 위-왼쪽',
    SUP_POST: '2 위-오른쪽',
    INF_POST: '3 아래-오른쪽',
    INF_ANT: '4 아래-왼쪽',
    CENTER: 'Centroid',
  }
  if (compact) return \`\${target} \${compactMap[suffix] || suffix}\`
  return \`\${target} \${fullMap[suffix] || suffix}\`
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
`

fs.writeFileSync(file, content)
console.log('PATCH LAT 4-corner/centroid landmark modes')
