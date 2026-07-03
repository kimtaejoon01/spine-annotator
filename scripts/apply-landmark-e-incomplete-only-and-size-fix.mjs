#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}
function replaceTopLevelFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  let depth = 0, quote = null, escape = false
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
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(i + 1)
    }
  }
  return source
}
function replaceAssignmentFunction(source, lhs, replacement) {
  const start = source.indexOf(lhs)
  if (start < 0) return source
  const open = source.indexOf('{', start)
  let depth = 0, quote = null, escape = false
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
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(i + 1)
    }
  }
  return source
}

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  s = replaceAssignmentFunction(s, '  annotator.deleteLastLandmarkPoint = function deleteLastLandmarkPoint() {', `  annotator.deleteLastLandmarkPoint = function deleteLastLandmarkPoint() {
    const displayMode = getDisplayMode()
    if (displayMode === 'polygon') return false

    // E only cancels an unfinished landmark group. It must not delete an already
    // completed 4-corner fill polygon or a completed centroid point.
    if (displayMode === 'centroid') return false

    const seq = getActiveSequence()
    const currentLabel = this.pendingLandmark || seq[sequenceIndex]
    if (!currentLabel) return false
    const target = String(currentLabel).split('_')[0]
    if (!target) return false

    const targetLabels = CORNER_POINTS_4.map(p => target + '_' + p)
    const existing = targetLabels.filter(label => this.landmarks.some(l => l.label === label))
    if (existing.length === 0 || existing.length >= CORNER_POINTS_4.length) return false

    const labelToRemove = existing[existing.length - 1]
    const ok = deleteLabels([labelToRemove])
    if (ok) {
      const idx = seq.indexOf(labelToRemove)
      if (idx >= 0) sequenceIndex = idx
      this.setPendingLandmark(labelToRemove)
    }
    return ok
  }`)

  s = s.replaceAll(`? 3.0 : 1.8) / scale`, `? 4.8 : 3.2) / scale`)
  s = s.replaceAll(`fontSize: 6 / scale`, `fontSize: 9 / scale`)
  s = s.replaceAll(`fontSize: 4.5 / scale`, `fontSize: 7 / scale`)
  s = s.replaceAll(`x: 3 / scale, y: -3 / scale`, `x: 5 / scale, y: -5 / scale`)
  s = s.replaceAll(`strokeWidth: 0.55 / scale`, `strokeWidth: 0.8 / scale`)
  s = s.replaceAll(`strokeWidth: 0.6 / scale`, `strokeWidth: 0.9 / scale`)
  s = s.replaceAll(`strokeWidth: 0.8 / scale, listening: false`, `strokeWidth: 1.0 / scale, listening: false`)

  save(file, before, s, 'landmark E incomplete-only and larger visual handles')
}

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  s = replaceTopLevelFunction(s, 'runAction', `function runAction(actionId) {
  const landmarkMode = state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon'
  switch (actionId) {
    case 'finishPolygon': state.annotator.finishDrawing(); return true
    case 'finishPolygonFree': state.annotator.finishDrawing({ angularSort: true }); return true
    case 'cancelDrawing': state.annotator.cancelDrawing(); return true
    case 'removeLastPoint':
      if (landmarkMode) return !!state.annotator.deleteLastLandmarkPoint?.()
      state.annotator.removeLastPoint()
      return true
    case 'deleteSelected':
      state.annotator.deleteSelected()
      return true
    case 'removeHoveredVertex': return state.annotator.removeHoveredVertex()
    case 'toolDraw': setTool('draw'); return true
    case 'toolEdit': setTool('edit'); return true
    case 'toolDelete': setTool('delete'); return true
    case 'undo': state.annotator.undo(); return true
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
}`)
  save(file, before, s, 'E no longer deletes completed polygons')
}

console.log('OK landmark E incomplete-only and size fix installed')
