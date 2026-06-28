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
// annotator.js: make FH/FH_LAT labels one-shot and never auto-relabel them.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before

  // Guarantee pending label state in constructor.
  if (!s.includes('this.pendingLabel = null')) {
    s = s.replace(
      `    this.startLabel = 'C2'\n`,
      `    this.startLabel = 'C2'\n    this.pendingLabel = null\n    this.pendingLabelMode = 'polygon'\n`
    )
  }

  // Guarantee setPendingLabel exists.
  if (!s.includes('setPendingLabel(label, mode =')) {
    const addPointBlock = findMethodBlock(s, 'addPoint')
    if (!addPointBlock) throw new Error('addPoint block not found')
    const methods = `  setPendingLabel(label, mode = '') {
    this.pendingLabel = label || null
    this.pendingLabelMode = mode || (isPelvisPointLabel(label) ? 'point' : 'polygon')
    this.updateStatus()
  }

`
    s = s.slice(0, addPointBlock.start) + methods + s.slice(addPointBlock.start)
  }

  // Point labels: one click creates marker and clears selection.
  const addPointBlock = findMethodBlock(s, 'addPoint')
  if (addPointBlock) {
    let text = s.slice(addPointBlock.start, addPointBlock.end)
    if (!text.includes('PELVIS_POINT_LABEL_ONE_SHOT')) {
      text = text.replace(
        `  addPoint(x, y) {\n`,
        `  addPoint(x, y) {\n    // PELVIS_POINT_LABEL_ONE_SHOT\n    if (!this.drawing && this.pendingLabel && this.pendingLabelMode === 'point') {\n      this.addLandmarkPoint(x, y, this.pendingLabel)\n      return\n    }\n`
      )
      s = s.slice(0, addPointBlock.start) + text + s.slice(addPointBlock.end)
    }
  }

  if (!s.includes('addLandmarkPoint(x, y, label)')) {
    const addPointBlock2 = findMethodBlock(s, 'addPoint')
    if (!addPointBlock2) throw new Error('addPoint block not found for landmark')
    const method = `  addLandmarkPoint(x, y, label) {
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
    s = s.slice(0, addPointBlock2.start) + method + s.slice(addPointBlock2.start)
  }

  // Strongly replace finishDrawing so pending FH/FH_LAT survives and clears after use.
  const finishBlock = findMethodBlock(s, 'finishDrawing')
  if (!finishBlock) throw new Error('finishDrawing block not found')
  let finishText = s.slice(finishBlock.start, finishBlock.end)
  if (!finishText.includes('PELVIS_PENDING_POLYGON_ONE_SHOT')) {
    finishText = finishText.replace(
      `    // 폴리곤 추가\n    const newPoly = {\n      id: polyIdCounter++,\n      label: null, // 나중에 정렬해서 자동 할당\n      points,\n    }`,
      `    // 폴리곤 추가\n    // PELVIS_PENDING_POLYGON_ONE_SHOT\n    const pendingLabel = this.pendingLabel\n    const newPoly = {\n      id: polyIdCounter++,\n      label: pendingLabel || null,\n      points,\n      manualLabel: !!pendingLabel,\n      landmark: false,\n    }`
    )
    finishText = finishText.replace(
      `    // 라벨 자동 할당 (Y좌표 정렬)\n    this.relabelAll()`,
      `    // 라벨 자동 할당 (Y좌표 정렬). 골반/고관절 수동 라벨은 유지.\n    if (pendingLabel) {\n      this.pendingLabel = null\n      this.pendingLabelMode = 'polygon'\n    } else {\n      this.relabelAll()\n    }`
    )
    s = s.slice(0, finishBlock.start) + finishText + s.slice(finishBlock.end)
  }

  // If an earlier pelvis patch partially changed finishDrawing, repair the common bad case.
  s = s.replace(
    `      label: null, // 나중에 정렬해서 자동 할당\n      points,`,
    `      label: this.pendingLabel || null,\n      points,\n      manualLabel: !!this.pendingLabel,\n      landmark: false,`
  )

  // Relabel only spine auto polygons, never extra labels.
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

  save(file, before, s, 'pelvis label one-shot annotator behavior')
}

// -----------------------------------------------------------------------------
// app.js: clear active button after label is consumed and make pelvis panel collapsible.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  // Make panel title/body structure so the existing collapsible UI can handle it.
  if (s.includes('id="pelvisLabelPanel"') && !s.includes('pelvis-label-body')) {
    s = s.replace(
      `<h3 class="panel-title"><i class="fas fa-location-dot"></i> 골반 라벨</h3>
    <div class="pelvis-label-grid">`,
      `<h3 class="panel-title"><i class="fas fa-location-dot"></i> 골반 라벨</h3>
    <div class="panel-body pelvis-label-body">
    <div class="pelvis-label-grid">`
    )
    s = s.replace(
      `<p class="pelvis-label-help">AP는 L/R 버튼을 쓰고, LAT는 FH_LAT/HC_LAT를 씁니다. FH는 폴리곤, HC는 점 클릭입니다.</p>`,
      `<p class="pelvis-label-help">AP는 L/R 버튼을 쓰고, LAT는 FH_LAT/HC_LAT를 씁니다. FH는 폴리곤, HC는 점 클릭입니다.</p>
    </div>`
    )
  }

  // Re-run collapsible initializer after pelvis panel is inserted.
  if (s.includes('function initPelvisLabelControls()') && !s.includes('initRightSidebarCompactUI() // refresh collapsible for pelvis panel')) {
    s = s.replace(
      `  panel.querySelectorAll('.pelvis-label-btn').forEach(btn => {`,
      `  if (typeof initRightSidebarCompactUI === 'function') initRightSidebarCompactUI() // refresh collapsible for pelvis panel\n\n  panel.querySelectorAll('.pelvis-label-btn').forEach(btn => {`
    )
  }

  // Clear active pelvis button when annotator reports a changed polygon list and no pending label remains.
  if (!s.includes('clearPelvisLabelActiveButtons()')) {
    const helper = `
function clearPelvisLabelActiveButtons() {
  document.querySelectorAll('.pelvis-label-btn.active').forEach(btn => btn.classList.remove('active'))
}

`
    const needle = 'function initPelvisLabelControls() {'
    if (!s.includes(needle)) throw new Error('initPelvisLabelControls function not found')
    s = s.replace(needle, helper + needle)
  }

  // Wrap handlePolygonsChange to clear buttons after one-shot FH/HC completion.
  const hpBlock = findMethodBlock(s, 'handlePolygonsChange')
  if (hpBlock) {
    let text = s.slice(hpBlock.start, hpBlock.end)
    if (!text.includes('clearPelvisLabelActiveButtons()')) {
      text = text.replace(
        `function handlePolygonsChange(polygons) {\n`,
        `function handlePolygonsChange(polygons) {\n  if (state.annotator && !state.annotator.pendingLabel) clearPelvisLabelActiveButtons()\n`
      )
      s = s.slice(0, hpBlock.start) + text + s.slice(hpBlock.end)
    }
  } else {
    console.log('WARN handlePolygonsChange not found; active button clear relies on click flow only')
  }

  save(file, before, s, 'pelvis label active clear and collapsible panel')
}

console.log('OK pelvis label behavior fix installed')
