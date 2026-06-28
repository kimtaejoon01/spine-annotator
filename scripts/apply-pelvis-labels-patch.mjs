#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

function findMethodBlock(source, methodName) {
  const re = new RegExp('\\n  ' + methodName + '\\s*\\([^)]*\\)\\s*\\{')
  const m = source.match(re)
  if (!m || m.index == null) return null
  const start = m.index + 1
  const open = source.indexOf('{', start)
  let depth = 0
  let quote = null
  let escape = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        let end = i + 1
        while (source[end] === '\n' || source[end] === '\r') end++
        return { start, end }
      }
    }
  }
  return null
}

// -----------------------------------------------------------------------------
// labels.js: keep spine auto-label sequence separate from extra pelvis labels.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/labels.js'
  const before = read(file)
  let s = before

  if (!s.includes('EXTRA_LABELS')) {
    s = s.replace(
      `export const LABELS = [\n  // 경추 Cervical (7)\n  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7',\n  // 흉추 Thoracic (12)\n  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',\n  // 요추 Lumbar (5)\n  'L1', 'L2', 'L3', 'L4', 'L5',\n  // 천추 Sacrum (1)\n  'S1',\n]\n`,
      `export const LABELS = [\n  // 경추 Cervical (7)\n  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7',\n  // 흉추 Thoracic (12)\n  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',\n  // 요추 Lumbar (5)\n  'L1', 'L2', 'L3', 'L4', 'L5',\n  // 천추 Sacrum (1)\n  'S1',\n]\n\n// 추가 골반/고관절 라벨: 자동 척추 라벨링 순서에는 포함하지 않음\nexport const EXTRA_LABELS = ['FH_L', 'FH_R', 'HC_L', 'HC_R']\nexport const ALL_LABELS = [...LABELS, ...EXTRA_LABELS]\n`
    )
  }

  if (!s.includes('const COLOR_FEMORAL_HEAD')) {
    s = s.replace(
      `const COLOR_SACRAL = '#c084fc'   // 보라\n`,
      `const COLOR_SACRAL = '#c084fc'   // 보라\nconst COLOR_FEMORAL_HEAD = '#34d399'\nconst COLOR_HIP_CENTER = '#fb7185'\n`
    )
  }

  if (!s.includes('export function isSpineLabel')) {
    s = s.replace(
      `export function getRegionColor(label) {\n  if (!label) return '#888888'\n`,
      `export function isSpineLabel(label) {\n  return LABELS.includes(label)\n}\n\nexport function isExtraLabel(label) {\n  return EXTRA_LABELS.includes(label)\n}\n\nexport function isPelvisPointLabel(label) {\n  return label === 'HC_L' || label === 'HC_R'\n}\n\nexport function getRegionColor(label) {\n  if (!label) return '#888888'\n  if (label === 'FH_L' || label === 'FH_R') return COLOR_FEMORAL_HEAD\n  if (label === 'HC_L' || label === 'HC_R') return COLOR_HIP_CENTER\n`
    )
  }

  if (!s.includes("if (label === 'FH_L' || label === 'FH_R') return 'femoral_head'")) {
    s = s.replace(
      `  if (c === 'S') return 'sacrum'\n  return 'unknown'\n`,
      `  if (c === 'S') return 'sacrum'\n  if (label === 'FH_L' || label === 'FH_R') return 'femoral_head'\n  if (label === 'HC_L' || label === 'HC_R') return 'hip_center'\n  return 'unknown'\n`
    )
  }

  save(file, before, s, 'pelvis labels')
}

// -----------------------------------------------------------------------------
// coco.js: include extra labels in category list and export tiny landmark polygons.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/coco.js'
  const before = read(file)
  let s = before
  s = s.replace("import { LABELS, getSupercategory } from './labels.js'", "import { ALL_LABELS, getSupercategory } from './labels.js'")
  s = s.replaceAll('LABELS\n    .filter', 'ALL_LABELS\n    .filter')
  s = s.replaceAll('LABELS.indexOf(lbl) + 1', 'ALL_LABELS.indexOf(lbl) + 1')
  s = s.replaceAll('LABELS.indexOf(poly.label) + 1', 'ALL_LABELS.indexOf(poly.label) + 1')
  save(file, before, s, 'COCO extra pelvis labels')
}

// -----------------------------------------------------------------------------
// annotator.js: pending label tool + point-like hip center diamond + preserve manual labels.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before

  s = s.replace(
    "import { LABELS, getRegionColor, generateLabels } from './labels.js'",
    "import { LABELS, getRegionColor, generateLabels, isSpineLabel, isExtraLabel, isPelvisPointLabel } from './labels.js'"
  )

  if (!s.includes('this.pendingLabel = null')) {
    s = s.replace(
      `    this.startLabel = 'C2'\n`,
      `    this.startLabel = 'C2'\n    this.pendingLabel = null\n    this.pendingLabelMode = 'polygon'\n`
    )
  }

  if (!s.includes('addLandmarkPoint(x, y, label)')) {
    const addPointBlock = findMethodBlock(s, 'addPoint')
    if (!addPointBlock) throw new Error('addPoint block not found')
    let text = s.slice(addPointBlock.start, addPointBlock.end)
    if (!text.includes('this.addLandmarkPoint(x, y, this.pendingLabel)')) {
      text = text.replace(
        `  addPoint(x, y) {\n`,
        `  addPoint(x, y) {\n    if (!this.drawing && this.pendingLabel && this.pendingLabelMode === 'point') {\n      this.addLandmarkPoint(x, y, this.pendingLabel)\n      return\n    }\n`
      )
      s = s.slice(0, addPointBlock.start) + text + s.slice(addPointBlock.end)
    }

    const methods = `  setPendingLabel(label, mode = '') {
    this.pendingLabel = label || null
    this.pendingLabelMode = mode || (isPelvisPointLabel(label) ? 'point' : 'polygon')
    this.updateStatus()
  }

  addLandmarkPoint(x, y, label) {
    if (!label) return
    const r = 5 / Math.max(0.1, this.stage.scaleX())
    const points = [x, y - r, x + r, y, x, y + r, x - r, y]
    const newPoly = {
      id: polyIdCounter++,
      label,
      points,
      manualLabel: true,
      landmark: true,
    }
    this.polygons.push(newPoly)
    this.pendingLabel = null
    this.pendingLabelMode = 'polygon'
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
    this.updateStatus()
  }

`
    s = s.slice(0, addPointBlock.start) + methods + s.slice(addPointBlock.start)
  }

  // Pending polygon labels should not be overwritten by auto spine relabeling.
  const finishBlock = findMethodBlock(s, 'finishDrawing')
  if (finishBlock) {
    let text = s.slice(finishBlock.start, finishBlock.end)
    if (!text.includes('const pendingLabel = this.pendingLabel')) {
      text = text.replace(
        `    // 폴리곤 추가\n    const newPoly = {\n      id: polyIdCounter++,\n      label: null, // 나중에 정렬해서 자동 할당\n      points,\n    }`,
        `    // 폴리곤 추가\n    const pendingLabel = this.pendingLabel\n    const newPoly = {\n      id: polyIdCounter++,\n      label: pendingLabel || null,\n      points,\n      manualLabel: !!pendingLabel,\n      landmark: false,\n    }`
      )
      text = text.replace(
        `    // 라벨 자동 할당 (Y좌표 정렬)\n    this.relabelAll()`,
        `    // 라벨 자동 할당 (Y좌표 정렬). 골반/고관절 수동 라벨은 유지.\n    if (pendingLabel) {\n      this.pendingLabel = null\n      this.pendingLabelMode = 'polygon'\n    } else {\n      this.relabelAll()\n    }`
      )
      s = s.slice(0, finishBlock.start) + text + s.slice(finishBlock.end)
    }
  }

  const relabelBlock = findMethodBlock(s, 'relabelAll')
  if (relabelBlock) {
    const relabel = `  relabelAll() {
    const autoPolygons = this.polygons.filter(p => !p.manualLabel && (!p.label || isSpineLabel(p.label) || String(p.label).startsWith('?')))
    autoPolygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    autoPolygons.sort((a, b) => a._centroidY - b._centroidY)
    const labels = generateLabels(this.startLabel, autoPolygons.length)
    autoPolygons.forEach((p, i) => { p.label = labels[i] })

    this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    this.polygons.sort((a, b) => a._centroidY - b._centroidY)
  }
`
    s = s.slice(0, relabelBlock.start) + relabel + s.slice(relabelBlock.end)
  }

  // Extra labels should change only that item; spine labels keep cascade behavior.
  const setBlock = findMethodBlock(s, 'setLabelForPolygon')
  const relabelFromBlock = findMethodBlock(s, 'relabelFromPolygon')
  if (setBlock && relabelFromBlock) {
    const start = Math.min(setBlock.start, relabelFromBlock.start)
    const end = Math.max(setBlock.end, relabelFromBlock.end)
    const methods = `  setLabelForPolygon(id, newLabel, opts = {}) {
    const poly = this.polygons.find(p => p.id === id)
    if (!poly) return

    if (isExtraLabel(newLabel)) {
      poly.label = newLabel
      poly.manualLabel = true
      poly.landmark = isPelvisPointLabel(newLabel) || poly.landmark === true
      this.renderPolygons()
      this.pushHistory()
      this.notifyPolygons()
      return
    }

    const cascade = opts.cascade !== false
    if (cascade) {
      this.relabelFromPolygon(id, newLabel)
      return
    }

    poly.label = newLabel
    poly.manualLabel = true
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }

  relabelFromPolygon(id, startLabel) {
    const idxInLabelSet = LABELS.indexOf(startLabel)
    if (idxInLabelSet === -1) return
    this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    this.polygons.sort((a, b) => a._centroidY - b._centroidY)
    const startIdx = this.polygons.findIndex(p => p.id === id)
    if (startIdx === -1) return
    const editable = this.polygons.slice(startIdx).filter(p => !isExtraLabel(p.label))
    const labels = generateLabels(startLabel, editable.length)
    editable.forEach((p, i) => {
      p.label = labels[i]
      p.manualLabel = true
    })
    if (startIdx === 0) this.startLabel = startLabel
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }
`
    s = s.slice(0, start) + methods + s.slice(end)
  }

  // Preserve manual/landmark metadata in save/load/history.
  s = s.replace(
    `      points: p.points.slice(),\n      selected: p.id === this.selectedId,`,
    `      points: p.points.slice(),\n      manualLabel: p.manualLabel === true,\n      landmark: p.landmark === true,\n      selected: p.id === this.selectedId,`
  )
  s = s.replace(
    `      points: Array.isArray(p.points) ? p.points.slice() : [],\n    }))`,
    `      points: Array.isArray(p.points) ? p.points.slice() : [],\n      manualLabel: p.manualLabel === true || isExtraLabel(p.label),\n      landmark: p.landmark === true || isPelvisPointLabel(p.label),\n    }))`
  )
  s = s.replace(
    `      points: p.points.slice(),\n    })))`,
    `      points: p.points.slice(),\n      manualLabel: p.manualLabel === true,\n      landmark: p.landmark === true,\n    })))`
  )

  save(file, before, s, 'annotator pelvis labels')
}

// -----------------------------------------------------------------------------
// app.js: use ALL_LABELS in dropdown and add quick pelvis label panel.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  s = s.replace(
    "import { LABELS, parseFilename, getRegionColor } from './labels.js'",
    "import { LABELS, ALL_LABELS, parseFilename, getRegionColor } from './labels.js'"
  )
  s = s.replace('  LABELS.forEach((lbl) => {', '  ALL_LABELS.forEach((lbl) => {')

  if (!s.includes('function initPelvisLabelControls()')) {
    const helper = `
// ================================================================
// 골반/고관절 빠른 라벨
// ================================================================
function initPelvisLabelControls() {
  const sidebar = document.getElementById('sidebarRight')
  const scroll = sidebar?.querySelector('.sidebar-scroll')
  if (!scroll || document.getElementById('pelvisLabelPanel')) return

  const panel = document.createElement('div')
  panel.className = 'panel pelvis-label-panel'
  panel.id = 'pelvisLabelPanel'
  panel.innerHTML = ` + '`' + `
    <h3 class="panel-title"><i class="fas fa-location-dot"></i> 골반 라벨</h3>
    <div class="pelvis-label-grid">
      <button type="button" class="pelvis-label-btn" data-label="FH_L" data-mode="polygon">FH_L</button>
      <button type="button" class="pelvis-label-btn" data-label="FH_R" data-mode="polygon">FH_R</button>
      <button type="button" class="pelvis-label-btn" data-label="HC_L" data-mode="point">HC_L 점</button>
      <button type="button" class="pelvis-label-btn" data-label="HC_R" data-mode="point">HC_R 점</button>
    </div>
    <p class="pelvis-label-help">FH는 누른 뒤 폴리곤을 그리고, HC는 누른 뒤 중심을 한 번 클릭합니다.</p>
  ` + '`' + `

  const labelPanel = document.getElementById('labelList')?.closest('.panel')
  if (labelPanel) scroll.insertBefore(panel, labelPanel)
  else scroll.appendChild(panel)

  panel.querySelectorAll('.pelvis-label-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.pelvis-label-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      state.annotator.setPendingLabel(btn.dataset.label, btn.dataset.mode)
    })
  })
}
`
    const needle = '// ================================================================\n// 우측 사이드바 간단 보기 / 접이식 패널\n// ================================================================'
    if (s.includes(needle)) s = s.replace(needle, helper + '\n' + needle)
    else s += helper
  }

  if (!s.includes('initPelvisLabelControls()')) {
    s = s.replace('  bindUIEvents()\n', '  bindUIEvents()\n  setTimeout(initPelvisLabelControls, 0)\n')
  }
  if (s.includes("  console.log('[App] Ready.')\n") && !s.includes("initPelvisLabelControls()\n  console.log('[App] Ready.')")) {
    s = s.replace("  console.log('[App] Ready.')\n", "  initPelvisLabelControls()\n  console.log('[App] Ready.')\n")
  }

  save(file, before, s, 'app pelvis label controls')
}

// -----------------------------------------------------------------------------
// CSS: quick pelvis label controls.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* Pelvis/femoral labels */
.pelvis-label-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.pelvis-label-btn {
  min-height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}
.pelvis-label-btn:hover,
.pelvis-label-btn.active {
  border-color: var(--accent-blue);
  background: rgba(88,166,255,.14);
}
.pelvis-label-help {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
}
.sidebar-right.right-sidebar-compact .pelvis-label-panel {
  padding-top: 7px;
  padding-bottom: 7px;
}
.sidebar-right.right-sidebar-compact .pelvis-label-help {
  display: none;
}
`
  if (!s.includes('Pelvis/femoral labels')) s += css
  save(file, before, s, 'pelvis label styles')
}

console.log('OK pelvis labels patch installed')
