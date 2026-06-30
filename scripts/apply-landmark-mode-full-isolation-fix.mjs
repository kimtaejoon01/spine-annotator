#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

function replaceFunction(source, name, replacement) {
  const start = source.indexOf(`  function ${name}(`)
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
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(i + 1)
    }
  }
  return source
}

function replaceMethod(source, name, replacement) {
  const start = source.indexOf(`  ${name}(`)
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
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(i + 1)
    }
  }
  return source
}

// -----------------------------------------------------------------------------
// landmark-tools.js: mode switch should hide all non-active overlays, not just
// the raw polygon layer. Measurement debug and preview layers can otherwise
// reappear when human-label/measurement toggles re-render.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  s = replaceFunction(s, 'updateModeVisibility', `  function updateModeVisibility() {
    const displayMode = getDisplayMode()
    const polygonMode = displayMode === 'polygon'
    const hideLayer = (layer) => { layer?.hide?.(); layer?.visible?.(false); layer?.batchDraw?.() }
    const showLayer = (layer) => { layer?.show?.(); layer?.visible?.(true); layer?.batchDraw?.() }

    if (polygonMode) {
      showLayer(annotator.polyLayer)
      showLayer(annotator.previewLayer)
      showLayer(annotator.measurementLayer)
      hideLayer(annotator.landmarkLayer)
    } else {
      hideLayer(annotator.polyLayer)
      hideLayer(annotator.previewLayer)
      hideLayer(annotator.measurementLayer)
      showLayer(annotator.landmarkLayer)
      annotator.landmarkLayer?.moveToTop?.()
    }
    annotator.stage?.batchDraw?.()
  }`)

  save(file, before, s, 'landmark mode hides polygon/measurement/preview layers')
}

// -----------------------------------------------------------------------------
// annotator.js: make renderers mode-aware so later toggles cannot resurrect the
// polygon labels or computer-calculated measurement guides while in landmark mode.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before

  if (!s.includes('isPolygonAnnotationMode()')) {
    s = s.replace(
      `  // ============================================================\n  // 폴리곤 렌더링`,
      `  isPolygonAnnotationMode() {\n    return (this.__activeAnnotationMode || 'polygon') === 'polygon'\n  }\n\n  enforceAnnotationModeVisibility() {\n    const polygonMode = this.isPolygonAnnotationMode()\n    const hideLayer = (layer) => { layer?.hide?.(); layer?.visible?.(false); layer?.batchDraw?.() }\n    const showLayer = (layer) => { layer?.show?.(); layer?.visible?.(true); layer?.batchDraw?.() }\n    if (polygonMode) {\n      showLayer(this.polyLayer)\n      showLayer(this.previewLayer)\n      showLayer(this.measurementLayer)\n      hideLayer(this.landmarkLayer)\n    } else {\n      hideLayer(this.polyLayer)\n      hideLayer(this.previewLayer)\n      hideLayer(this.measurementLayer)\n      showLayer(this.landmarkLayer)\n      this.landmarkLayer?.moveToTop?.()\n    }\n    this.stage?.batchDraw?.()\n  }\n\n  // ============================================================\n  // 폴리곤 렌더링`
    )
  }

  // If renderPolygons is called by the human label toggle while landmark/centroid
  // mode is active, rebuild internally but keep the layer hidden at the end.
  s = s.replace(
    `    this.polyLayer.batchDraw()\n  }\n\n  /**\n   * 현재 마우스가 올라간 점을 삭제`,
    `    this.polyLayer.batchDraw()\n    this.enforceAnnotationModeVisibility?.()\n  }\n\n  /**\n   * 현재 마우스가 올라간 점을 삭제`
  )

  // If measurement controls call the overlay renderer, clear and keep it hidden
  // in landmark/centroid modes.
  if (s.includes('renderMeasurementDebugOverlay() {') && !s.includes('measurement overlay suppressed outside polygon mode')) {
    s = s.replace(
      `  renderMeasurementDebugOverlay() {\n    if (!this.measurementLayer) return\n    this.measurementLayer.destroyChildren()`,
      `  renderMeasurementDebugOverlay() {\n    if (!this.measurementLayer) return\n    this.measurementLayer.destroyChildren()\n    // measurement overlay suppressed outside polygon mode\n    if (!this.isPolygonAnnotationMode?.()) {\n      this.measurementLayer.hide?.()\n      this.measurementLayer.visible?.(false)\n      this.measurementLayer.batchDraw()\n      return\n    }`
    )
  }

  // ClearAll/loadImage paths should also enforce the current mode.
  s = s.replace(
    `    if (this.measurementLayer) this.measurementLayer.batchDraw()\n    if (pushHistory) {`,
    `    if (this.measurementLayer) this.measurementLayer.batchDraw()\n    this.enforceAnnotationModeVisibility?.()\n    if (pushHistory) {`
  )

  save(file, before, s, 'annotator renderers obey active annotation mode')
}

console.log('OK full annotation mode isolation fix installed')
