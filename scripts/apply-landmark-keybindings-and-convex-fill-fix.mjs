#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

function replaceAssignmentFunction(source, lhs, replacement) {
  const start = source.indexOf(lhs)
  if (start < 0) return source
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
        return source.slice(0, start) + replacement + source.slice(end)
      }
    }
  }
  return source
}

// -----------------------------------------------------------------------------
// landmark-tools.js
// - I/O/P should mean draw/edit/delete for landmark work too.
// - E should delete the last/current landmark point in landmark modes.
// - 4-corner display must not use a self-intersecting label order; use angular
//   ordering for visualization while preserving semantic labels in storage.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  s = replaceAssignmentFunction(s, '  annotator.onMouseDown = function patchedLandmarkMouseDown(e) {', `  annotator.onMouseDown = function patchedLandmarkMouseDown(e) {
    const isLat = String(getViewType?.() || '').toUpperCase() === 'LAT'
    const activeMode = this.__activeAnnotationMode || 'polygon'
    if (isLat && activeMode !== 'polygon') {
      if (e.evt?.button != null && e.evt.button !== 0) return
      const pos = this.getImagePos()
      if (!pos) return
      e.cancelBubble = true

      if (this.tool === 'delete') {
        const hit = nearestLandmark(pos, 14 / Math.max(0.001, this.stage.scaleX() || 1))
        if (hit) {
          this.deleteLandmark(hit.label)
          return
        }
        return
      }

      if (this.tool === 'edit') {
        return
      }

      if (this.pendingLandmark) {
        this.setLandmark(this.pendingLandmark, pos.x, pos.y)
        const seq = getActiveSequence()
        const current = seq.indexOf(this.pendingLandmark)
        sequenceIndex = findNextMissingIndex(this.landmarks, current + 1, seq)
        this.setPendingLandmark(seq[sequenceIndex] || null)
        renderModeToolbar?.()
        updateModeVisibility?.()
        renderPanel()
        onChange?.()
      }
      return
    }
    return originalOnMouseDown(e)
  }`)

  if (!s.includes('function nearestLandmark(pos')) {
    s = s.replace(
      `  annotator.setPendingLandmark = function setPendingLandmark(label) {`,
      `  function nearestLandmark(pos, maxDist = 14) {
    let best = null
    let bestD = Infinity
    for (const lm of annotator.landmarks || []) {
      const d = Math.hypot(Number(lm.x) - pos.x, Number(lm.y) - pos.y)
      if (d < bestD) { best = lm; bestD = d }
    }
    return best && bestD <= maxDist ? best : null
  }

  function deleteLandmarkLabels(labels) {
    const remove = new Set((labels || []).map(x => String(x || '').toUpperCase()))
    if (remove.size === 0) return false
    const beforeCount = annotator.landmarks.length
    annotator.landmarks = annotator.landmarks.filter(l => !remove.has(String(l.label || '').toUpperCase()))
    if (annotator.landmarks.length === beforeCount) return false
    const seq = getActiveSequence()
    sequenceIndex = findNextMissingIndex(annotator.landmarks, 0, seq)
    annotator.setPendingLandmark(seq[sequenceIndex] || null)
    annotator.renderLandmarks()
    renderPanel()
    onChange?.()
    return true
  }

  function sortPolygonPointsForDisplay(points) {
    const pts = (points || []).filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    if (pts.length <= 2) return pts
    const cx = pts.reduce((s, p) => s + Number(p.x), 0) / pts.length
    const cy = pts.reduce((s, p) => s + Number(p.y), 0) / pts.length
    return [...pts].sort((a, b) => Math.atan2(Number(a.y) - cy, Number(a.x) - cx) - Math.atan2(Number(b.y) - cy, Number(b.x) - cx))
  }

  annotator.deleteLastLandmarkPoint = function deleteLastLandmarkPoint() {
    const activeMode = this.__activeAnnotationMode || 'polygon'
    if (activeMode === 'polygon') return false
    const seq = getActiveSequence()
    let start = this.pendingLandmark ? seq.indexOf(this.pendingLandmark) - 1 : sequenceIndex
    if (start < 0) start = seq.length - 1
    for (let i = Math.min(start, seq.length - 1); i >= 0; i--) {
      const label = seq[i]
      if (this.landmarks.some(l => l.label === label)) {
        const ok = deleteLandmarkLabels([label])
        if (ok) {
          sequenceIndex = i
          this.setPendingLandmark(label)
        }
        return ok
      }
    }
    return false
  }

  annotator.setPendingLandmark = function setPendingLandmark(label) {`
    )
  }

  s = replaceAssignmentFunction(s, '  annotator.renderLandmarks = function renderLandmarks() {', `  annotator.renderLandmarks = function renderLandmarks() {
    if (!this.landmarkLayer) return
    this.landmarkLayer.destroyChildren()
    const displayMode = (this.__activeAnnotationMode || 'polygon')
    if (displayMode === 'polygon') {
      this.landmarkLayer.visible(false)
      this.landmarkLayer.batchDraw()
      return
    }
    this.landmarkLayer.visible(true)
    this.landmarkLayer.moveToTop?.()
    const scale = Math.max(0.001, this.stage.scaleX() || 1)
    const byLabel = new Map((this.landmarks || []).map(l => [String(l.label || '').toUpperCase(), l]))

    if (displayMode === 'corner') {
      for (const v of VERTEBRAE_FULL) {
        const labels = [\`\${v}_SUP_ANT\`, \`\${v}_SUP_POST\`, \`\${v}_INF_POST\`, \`\${v}_INF_ANT\`]
        const ptsRaw = labels.map(label => byLabel.get(label)).filter(Boolean)
        if (ptsRaw.length === 4) {
          const pts = sortPolygonPointsForDisplay(ptsRaw)
          const flat = pts.flatMap(p => [Number(p.x), Number(p.y)])
          const color = landmarkColor(labels[0])
          const poly = new Konva.Line({
            points: flat,
            closed: true,
            fill: color + '42',
            stroke: color,
            strokeWidth: 1.2 / scale,
            opacity: 0.95,
            listening: true,
          })
          poly.on('click tap', (e) => {
            e.cancelBubble = true
            if (annotator.tool === 'delete') deleteLandmarkLabels(labels)
          })
          this.landmarkLayer.add(poly)

          const cx = pts.reduce((sum, p) => sum + Number(p.x), 0) / pts.length
          const cy = pts.reduce((sum, p) => sum + Number(p.y), 0) / pts.length
          const text = new Konva.Text({
            x: cx,
            y: cy,
            text: v,
            fontSize: 6 / scale,
            fontStyle: 'bold',
            fill: '#ffffff',
            stroke: '#0f172a',
            strokeWidth: 0.8 / scale,
            listening: false,
          })
          text.offsetX(text.width() / 2)
          text.offsetY(text.height() / 2)
          this.landmarkLayer.add(text)

          if (this.tool === 'edit' || this.tool === 'delete') {
            for (const p of ptsRaw) addTinyLandmarkPoint(this.landmarkLayer, p, scale)
          }
        } else {
          for (const p of ptsRaw) addTinyLandmarkPoint(this.landmarkLayer, p, scale)
        }
      }
    } else if (displayMode === 'centroid') {
      for (const lm of this.landmarks || []) {
        const label = String(lm.label || '').toUpperCase()
        if (!label.includes('CENTER') && label !== 'HC_LAT') continue
        addTinyLandmarkPoint(this.landmarkLayer, lm, scale, displayLandmarkLabel(label, true))
      }
    }
    this.landmarkLayer.batchDraw()
  }

  function addTinyLandmarkPoint(layer, lm, scale, labelText = '') {
    if (!lm || !Number.isFinite(Number(lm.x)) || !Number.isFinite(Number(lm.y))) return
    const label = String(lm.label || '').toUpperCase()
    const r = (annotator.tool === 'edit' || annotator.tool === 'delete' ? 3.0 : 1.8) / scale
    const group = new Konva.Group({ x: Number(lm.x), y: Number(lm.y), draggable: annotator.tool !== 'delete', landmarkLabel: label })
    group.add(new Konva.Circle({
      radius: r,
      fill: landmarkColor(label),
      stroke: '#0f172a',
      strokeWidth: 0.55 / scale,
    }))
    if (labelText) {
      const text = new Konva.Text({
        x: 3 / scale,
        y: -3 / scale,
        text: labelText,
        fontSize: 4.5 / scale,
        fontStyle: 'bold',
        fill: '#ffffff',
        stroke: '#0f172a',
        strokeWidth: 0.6 / scale,
      })
      group.add(text)
    }
    group.on('dragmove', () => {
      if (annotator.tool === 'delete') return
      const pos = group.position()
      lm.x = pos.x
      lm.y = pos.y
      layer.batchDraw()
    })
    group.on('dragend', () => {
      if (annotator.tool === 'delete') return
      annotator.renderLandmarks()
      annotator.__lat5PointLandmarkOnChange?.()
    })
    group.on('click tap', (e) => {
      if (annotator.tool !== 'delete') return
      e.evt?.preventDefault?.()
      e.cancelBubble = true
      annotator.deleteLandmark(label)
    })
    group.on('dblclick contextmenu', (e) => {
      e.evt?.preventDefault?.()
      e.cancelBubble = true
      annotator.deleteLandmark(label)
    })
    layer.add(group)
  }
`)

  save(file, before, s, 'landmark shortcuts and non-crossing polygon fill')
}

// -----------------------------------------------------------------------------
// app.js: route E/Delete through landmark deletion while in landmark modes.
// I/O/P still use the normal tool actions, and landmark render now respects those
// tool values for draw/edit/delete.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  s = s.replace(
    `function runAction(actionId) {\n  switch (actionId) {`,
    `function runAction(actionId) {\n  const landmarkMode = state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon'\n  switch (actionId) {`
  )
  s = s.replace(
    `    case 'removeLastPoint':\n      // 그리는 중엔 마지막 점만 취소, 아니면 선택된 폴리곤 삭제\n      if (!state.annotator.removeLastPoint()) {`,
    `    case 'removeLastPoint':\n      if (landmarkMode && state.annotator.deleteLastLandmarkPoint?.()) return true\n      // 그리는 중엔 마지막 점만 취소, 아니면 선택된 폴리곤 삭제\n      if (!state.annotator.removeLastPoint()) {`
  )
  s = s.replace(
    `    case 'deleteSelected':\n      state.annotator.deleteSelected()\n      return true`,
    `    case 'deleteSelected':\n      if (landmarkMode && state.annotator.deleteLastLandmarkPoint?.()) return true\n      state.annotator.deleteSelected()\n      return true`
  )
  s = s.replace(
    `function setTool(tool) {\n  state.annotator.setTool(tool)`,
    `function setTool(tool) {\n  state.annotator.setTool(tool)\n  state.annotator.renderLandmarks?.()\n  state.annotator.enforceAnnotationModeVisibility?.()`
  )

  save(file, before, s, 'app landmark shortcut routing')
}

console.log('OK landmark keybindings and convex fill fix installed')
