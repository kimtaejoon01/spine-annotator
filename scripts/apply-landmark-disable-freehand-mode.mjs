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

const file = 'public/static/app.js'
const before = read(file)
let s = before

s = replaceTopLevelFunction(s, 'runAction', `function runAction(actionId) {
  const landmarkMode = state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon'
  switch (actionId) {
    case 'finishPolygon': state.annotator.finishDrawing(); return true
    case 'finishPolygonFree': state.annotator.finishDrawing({ angularSort: true }); return true
    case 'cancelDrawing': state.annotator.cancelDrawing(); return true
    case 'removeLastPoint': if (landmarkMode && state.annotator.deleteLastLandmarkPoint?.()) return true; if (!state.annotator.removeLastPoint()) state.annotator.deleteSelected(); return true
    case 'deleteSelected': if (landmarkMode && state.annotator.deleteLastLandmarkPoint?.()) return true; state.annotator.deleteSelected(); return true
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

// When switching into landmark/centroid mode, kill any freehand/drawing state that
// may have been started while S was held.
s = s.replace(
  `function setTool(tool) {\n  state.annotator.setTool(tool)`,
  `function setTool(tool) {\n  const landmarkMode = state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon'\n  if (landmarkMode) {\n    state.annotator.setFreehandMode?.(false)\n    state.annotator.cancelDrawing?.()\n  }\n  state.annotator.setTool(tool)`
)

save(file, before, s, 'disable freehand in landmark modes')
console.log('OK landmark freehand guard installed')
