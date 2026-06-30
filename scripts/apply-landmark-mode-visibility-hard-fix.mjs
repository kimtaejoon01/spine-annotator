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

const file = 'public/static/landmark-tools.js'
const before = read(file)
let s = before

if (!s.includes('annotator.__activeAnnotationMode = annotator.__activeAnnotationMode ||')) {
  s = s.replace(
    `  annotator.__lat5PointLandmarksInstalled = true\n`,
    `  annotator.__lat5PointLandmarksInstalled = true\n  annotator.__activeAnnotationMode = annotator.__activeAnnotationMode || 'polygon'\n`
  )
}

s = replaceFunction(s, 'getDisplayMode', `  function getDisplayMode() {
    return annotator.__activeAnnotationMode || 'polygon'
  }`)

s = replaceFunction(s, 'updateModeVisibility', `  function updateModeVisibility() {
    const displayMode = getDisplayMode()
    if (displayMode === 'polygon') {
      annotator.polyLayer?.show?.()
      annotator.polyLayer?.visible?.(true)
      annotator.landmarkLayer?.hide?.()
      annotator.landmarkLayer?.visible?.(false)
    } else {
      annotator.polyLayer?.hide?.()
      annotator.polyLayer?.visible?.(false)
      annotator.landmarkLayer?.show?.()
      annotator.landmarkLayer?.visible?.(true)
      annotator.landmarkLayer?.moveToTop?.()
    }
    annotator.polyLayer?.batchDraw?.()
    annotator.landmarkLayer?.batchDraw?.()
    annotator.stage?.batchDraw?.()
  }`)

s = replaceFunction(s, 'activateToolbarMode', `  function activateToolbarMode(nextMode) {
    if (nextMode === 'polygon') {
      annotator.__activeAnnotationMode = 'polygon'
      annotator.setPendingLandmark(null)
      renderModeToolbar()
      updateModeVisibility()
      return
    }
    mode = nextMode === 'centroid' ? 'centroid' : 'corner'
    annotator.__activeAnnotationMode = mode
    sequenceIndex = findNextMissingIndex(annotator.landmarks, 0, getActiveSequence())
    annotator.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)
    renderModeToolbar()
    updateModeVisibility()
    annotator.renderLandmarks?.()
  }`)

s = replaceFunction(s, 'renderModeToolbar', `  function renderModeToolbar() {
    const el = ensureModeToolbar()
    if (!el) return
    const isLat = String(getViewType?.() || '').toUpperCase() === 'LAT'
    el.classList.toggle('hidden', !isLat)
    const active = getDisplayMode()
    el.querySelectorAll('[data-landmark-toolbar-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.landmarkToolbarMode === active)
    })
  }`)

// setLandmarkMode is used by side-panel buttons; keep it isolated too.
s = replaceFunction(s, 'setLandmarkMode', `  annotator.setLandmarkMode = function setLandmarkMode(nextMode) {
    mode = nextMode === 'centroid' ? 'centroid' : 'corner'
    annotator.__activeAnnotationMode = mode
    sequenceIndex = findNextMissingIndex(this.landmarks, 0, getActiveSequence())
    this.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)
    updateModeVisibility()
    this.renderLandmarks?.()
  }`)

save(file, before, s, 'hard annotation mode layer visibility')
console.log('OK hard annotation mode layer visibility fix installed')
