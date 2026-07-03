#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}
function replaceBlock(source, start, open, replacement) {
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
function replaceFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  return replaceBlock(source, start, open, replacement)
}
function replaceMethod(source, name, replacement) {
  const start = source.indexOf('  ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  return replaceBlock(source, start, open, replacement)
}

// -----------------------------------------------------------------------------
// measurements.js: let landmark 4-corner/centroid points feed the same sagittal
// angle engine and debug guide overlay used by polygon labels.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/measurements.js'
  const before = read(file)
  let s = before

  s = s.replace('export function calculateSagittalMeasurements(polygons = []) {', 'export function calculateSagittalMeasurements(polygons = [], landmarks = []) {')
  s = s.replace('  const items = Array.isArray(polygons) ? polygons : []', '  const items = mergeLandmarksIntoMeasurementPolygons(polygons, landmarks)')
  s = s.replace('  const result = calculateSagittalMeasurements(polygons)', '  const result = calculateSagittalMeasurements(polygons, context.landmarks || [])')

  // Prefer landmark-derived pseudo polygons over older segmentation polygons when
  // both are present for the same vertebra.
  if (!s.includes('landmarkPreferred')) {
    s = replaceFunction(s, 'chooseLargestPolygon', `function chooseLargestPolygon(polys) {
  if (!Array.isArray(polys) || polys.length === 0) return null
  const landmarkPreferred = polys.find(p => p && p.source === 'landmark')
  if (landmarkPreferred) return landmarkPreferred
  let best = null
  let bestArea = -Infinity
  for (const p of polys) {
    const area = Math.abs(polygonArea(p.points || []))
    if (area > bestArea) {
      best = p
      bestArea = area
    }
  }
  return best
}`)
  }

  if (!s.includes('function mergeLandmarksIntoMeasurementPolygons')) {
    const helper = `function mergeLandmarksIntoMeasurementPolygons(polygons = [], landmarks = []) {
  const items = Array.isArray(polygons) ? polygons.slice() : []
  const by = new Map()
  for (const lm of Array.isArray(landmarks) ? landmarks : []) {
    const label = String(lm?.label || '').trim().toUpperCase()
    const x = Number(lm?.x)
    const y = Number(lm?.y)
    if (!label || !Number.isFinite(x) || !Number.isFinite(y)) continue
    by.set(label, { x, y, label })
  }

  const vertebrae = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
  const corners = ['SUP_ANT', 'SUP_POST', 'INF_POST', 'INF_ANT']
  for (const v of vertebrae) {
    const pts = corners.map(p => by.get(v + '_' + p))
    if (pts.every(Boolean)) {
      const ordered = sortLandmarkPolygonPoints(pts)
      items.unshift({ label: v, points: ordered.flatMap(p => [p.x, p.y]), source: 'landmark' })
    }
  }

  const hc = by.get('HC_LAT') || by.get('FH_LAT')
  if (hc) {
    // Tiny pseudo polygon lets existing labelPoint()/centroid() logic reuse HC_LAT.
    items.unshift({
      label: 'HC_LAT',
      points: [hc.x - 2, hc.y - 2, hc.x + 2, hc.y - 2, hc.x + 2, hc.y + 2, hc.x - 2, hc.y + 2],
      source: 'landmark',
    })
  }
  return items
}

function sortLandmarkPolygonPoints(points) {
  const pts = points.filter(Boolean)
  const cx = pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1)
  const cy = pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1)
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
}

`
    s = s.replace('function measurement(key, name, value, note) {', helper + 'function measurement(key, name, value, note) {')
  }

  // Make guides visible by default for the measurement panel. User can still turn
  // them off with the existing 측정선 보기 checkbox.
  s = s.replace("enabled: getLocalBool('measurementGuidesEnabled', false)", "enabled: getLocalBool('measurementGuidesEnabled', true)")

  save(file, before, s, 'landmark-driven sagittal measurements')
}

// -----------------------------------------------------------------------------
// app.js: update measurement panel/guide overlay when landmarks change, not only
// when polygon labels change.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (!s.includes("from './measurements.js'")) {
    s = s.replace("import { exportToCOCO } from './coco.js'\n", "import { exportToCOCO } from './coco.js'\nimport { renderSagittalMeasurementPanel } from './measurements.js'\n")
  }

  if (!s.includes('function refreshSagittalMeasurements()')) {
    s = s.replace(
      `// ================================================================\n// 폴리곤 변경 → 우측 라벨 목록 업데이트`,
      `function refreshSagittalMeasurements() {
  if (!state.annotator || typeof renderSagittalMeasurementPanel !== 'function') return
  renderSagittalMeasurementPanel(state.annotator.getPolygons?.() || [], {
    filename: state.filename,
    viewType: state.viewType,
    landmarks: state.annotator.getLandmarks?.() || [],
  })
  state.annotator.renderMeasurementDebugOverlay?.()
}

// ================================================================
// 폴리곤 변경 → 우측 라벨 목록 업데이트`
    )
  }

  if (!s.includes('refreshSagittalMeasurements()\n  // 자동 저장')) {
    s = s.replace(
      `  // 자동 저장 (LocalStorage)\n  autoSave()`,
      `  refreshSagittalMeasurements()

  // 자동 저장 (LocalStorage)
  autoSave()`
    )
  }

  s = s.replace(
    `    onChange: () => autoSave(),`,
    `    onChange: () => {
      refreshSagittalMeasurements()
      autoSave()
    },`
  )

  s = s.replaceAll(
    `    viewType: state.viewType,
  })`,
    `    viewType: state.viewType,
    landmarks: state.annotator?.getLandmarks?.() || [],
  })`
  )

  save(file, before, s, 'app refreshes measurements from landmarks')
}

// -----------------------------------------------------------------------------
// landmark-tools.js: in landmark/centroid modes, keep segmentation hidden but
// allow measurement guide layer to show when guide toggle is enabled.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  const oldInline = `hideLayer(annotator.polyLayer); hideLayer(annotator.previewLayer); hideLayer(annotator.measurementLayer); showLayer(annotator.landmarkLayer); annotator.landmarkLayer?.moveToTop?.()`
  const newInline = `hideLayer(annotator.polyLayer); hideLayer(annotator.previewLayer); annotator.renderMeasurementDebugOverlay?.(); if (annotator.measurementDebug?.enabled && annotator.measurementDebug?.result?.debug) showLayer(annotator.measurementLayer); else hideLayer(annotator.measurementLayer); showLayer(annotator.landmarkLayer); annotator.landmarkLayer?.moveToTop?.()`
  s = s.replace(oldInline, newInline)

  const oldMultiline = `      hideLayer(annotator.polyLayer)
      hideLayer(annotator.previewLayer)
      hideLayer(annotator.measurementLayer)
      showLayer(annotator.landmarkLayer)
      annotator.landmarkLayer?.moveToTop?.()`
  const newMultiline = `      hideLayer(annotator.polyLayer)
      hideLayer(annotator.previewLayer)
      annotator.renderMeasurementDebugOverlay?.()
      if (annotator.measurementDebug?.enabled && annotator.measurementDebug?.result?.debug) showLayer(annotator.measurementLayer)
      else hideLayer(annotator.measurementLayer)
      showLayer(annotator.landmarkLayer)
      annotator.landmarkLayer?.moveToTop?.()`
  s = s.replace(oldMultiline, newMultiline)

  save(file, before, s, 'measurement guides visible in landmark mode when enabled')
}

// -----------------------------------------------------------------------------
// annotator.js: do not suppress measurement overlay just because active mode is
// landmark. Polygon/preview stay hidden; the measurement layer is allowed.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before

  s = s.replace(
    `    // measurement overlay suppressed outside polygon mode
    if (!this.isPolygonAnnotationMode?.()) {
      this.measurementLayer.hide?.()
      this.measurementLayer.visible?.(false)
      this.measurementLayer.batchDraw()
      return
    }
`,
    ``
  )

  s = replaceMethod(s, 'enforceAnnotationModeVisibility', `  enforceAnnotationModeVisibility() {
    const polygonMode = this.isPolygonAnnotationMode?.() !== false
    const hideLayer = (layer) => { layer?.hide?.(); layer?.visible?.(false); layer?.batchDraw?.() }
    const showLayer = (layer) => { layer?.show?.(); layer?.visible?.(true); layer?.batchDraw?.() }
    const showMeasurements = !!(this.measurementDebug?.enabled && this.measurementDebug?.result?.debug)
    if (polygonMode) {
      showLayer(this.polyLayer)
      showLayer(this.previewLayer)
      if (showMeasurements) showLayer(this.measurementLayer)
      else hideLayer(this.measurementLayer)
      hideLayer(this.landmarkLayer)
    } else {
      hideLayer(this.polyLayer)
      hideLayer(this.previewLayer)
      if (showMeasurements) showLayer(this.measurementLayer)
      else hideLayer(this.measurementLayer)
      showLayer(this.landmarkLayer)
      this.landmarkLayer?.moveToTop?.()
    }
    this.renderMeasurementDebugOverlay?.()
    this.stage?.batchDraw?.()
  }`)

  save(file, before, s, 'measurement overlay allowed in landmark mode')
}

console.log('OK landmark-driven measurement and guide overlay fix installed')
