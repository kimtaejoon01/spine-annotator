#!/usr/bin/env node

import fs from 'node:fs'

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}
function writeIfChanged(file, before, after, label) {
  if (before === after) console.log('OK ' + label)
  else { fs.writeFileSync(file, after); console.log('PATCH ' + label) }
}

// In landmark mode, the existing "사람 라벨 보기" switch should control the
// landmark layer only. It must never re-show polygon labels while landmark mode
// is active.
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (!s.includes('function isLandmarkDisplayMode()')) {
    s = s.replace(
      `function setHumanLabelVisible(visible) {
  state.humanLabelVisible = visible !== false
  try { localStorage.setItem(HUMAN_LABEL_VISIBLE_KEY, String(state.humanLabelVisible)) } catch {}
  if (state.annotator && typeof state.annotator.setHumanLabelVisible === 'function') {
    state.annotator.setHumanLabelVisible(state.humanLabelVisible)
  }
}
`,
      `function isLandmarkDisplayMode() {
  return !!(state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon')
}

function applyLandmarkLayerToggle(visible) {
  if (!state.annotator || !isLandmarkDisplayMode()) return false
  const shouldShow = visible !== false
  state.annotator.__landmarkLayerVisible = shouldShow

  // Landmark mode owns the visible annotation layer. Polygon layers must stay
  // hidden even when the old "human label" switch is turned back on.
  state.annotator.polyLayer?.hide?.()
  state.annotator.polyLayer?.visible?.(false)
  state.annotator.previewLayer?.hide?.()
  state.annotator.previewLayer?.visible?.(false)

  if (shouldShow) {
    state.annotator.landmarkLayer?.show?.()
    state.annotator.landmarkLayer?.visible?.(true)
    state.annotator.landmarkLayer?.moveToTop?.()
    state.annotator.renderLandmarks?.()
  } else {
    state.annotator.landmarkLayer?.hide?.()
    state.annotator.landmarkLayer?.visible?.(false)
    state.annotator.landmarkLayer?.batchDraw?.()
  }
  state.annotator.stage?.batchDraw?.()
  return true
}

function setHumanLabelVisible(visible) {
  state.humanLabelVisible = visible !== false
  try { localStorage.setItem(HUMAN_LABEL_VISIBLE_KEY, String(state.humanLabelVisible)) } catch {}
  if (applyLandmarkLayerToggle(state.humanLabelVisible)) return
  if (state.annotator && typeof state.annotator.setHumanLabelVisible === 'function') {
    state.annotator.setHumanLabelVisible(state.humanLabelVisible)
  }
}
`
    )
  }

  writeIfChanged(file, before, s, 'landmark human-label toggle routes to landmark layer')
}

// Make the landmark renderer itself respect the toggle so later refreshes do not
// bring landmarks back after the switch is off, and do not bring polygons back
// after the switch is on.
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  s = s.replace(
    `    } else {
      hideLayer(annotator.polyLayer); hideLayer(annotator.previewLayer); annotator.renderMeasurementDebugOverlay?.(); if (annotator.measurementDebug?.enabled && annotator.measurementDebug?.result?.debug) showLayer(annotator.measurementLayer); else hideLayer(annotator.measurementLayer); showLayer(annotator.landmarkLayer); annotator.landmarkLayer?.moveToTop?.()
    }`,
    `    } else {
      hideLayer(annotator.polyLayer); hideLayer(annotator.previewLayer); annotator.renderMeasurementDebugOverlay?.(); if (annotator.measurementDebug?.enabled && annotator.measurementDebug?.result?.debug) showLayer(annotator.measurementLayer); else hideLayer(annotator.measurementLayer); if (annotator.__landmarkLayerVisible === false) hideLayer(annotator.landmarkLayer); else { showLayer(annotator.landmarkLayer); annotator.landmarkLayer?.moveToTop?.() }
    }`
  )

  s = s.replace(
    `    this.landmarkLayer.visible(true); this.landmarkLayer.moveToTop?.()`,
    `    if (this.__landmarkLayerVisible === false) { this.landmarkLayer.visible(false); this.landmarkLayer.batchDraw(); return }
    this.landmarkLayer.visible(true); this.landmarkLayer.moveToTop?.()`
  )

  writeIfChanged(file, before, s, 'landmark renderer respects human-label toggle')
}
