#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

const file = 'public/static/app.js'
const before = read(file)
let s = before

const start = s.indexOf('async function loadLabelsFromStorage(filename) {')
const endMarker = '// ================================================================\n// 전체 일괄 내보내기'
const end = s.indexOf(endMarker, start)

if (start >= 0 && end > start) {
  const block = `async function loadLabelsFromStorage(filename) {
  state._suspendAutoSave = true
  try {
    const data = await loadLabel(filename)
    if (!data.exists) {
      state.labelVersion = null
      state.annotator.loadPolygons([])
      state.annotator.loadLandmarks?.([])
      state.landmarkApi?.refresh?.()
      state.lastSeenRemoteUpdate = null
      state.lastSeenRemoteUpdateInitialized = true
      return
    }

    if (data.start_label) {
      state.annotator.setStartLabel(data.start_label)
      const sel = document.getElementById('startVertebra')
      if (sel) sel.value = data.start_label
    }

    state.labelVersion = data.version ?? null
    if (data.image_width) state.imageWidth = data.image_width
    if (data.image_height) state.imageHeight = data.image_height

    const rawPolygons = data.polygons
    const nested = rawPolygons && !Array.isArray(rawPolygons) && typeof rawPolygons === 'object'
      ? rawPolygons
      : null
    const polygons = Array.isArray(rawPolygons)
      ? rawPolygons
      : (Array.isArray(nested?.polygons) ? nested.polygons : [])
    const landmarks = Array.isArray(data.landmarks)
      ? data.landmarks
      : (Array.isArray(nested?.landmarks) ? nested.landmarks : [])

    console.log('[Landmark] loadLabelsFromStorage', filename, 'polygons=', polygons.length, 'landmarks=', landmarks.length)

    state.annotator.loadPolygons(polygons)
    state.annotator.loadLandmarks?.(landmarks)
    state.annotator.landmarkLayer?.show?.()
    state.annotator.landmarkLayer?.moveToTop?.()
    state.annotator.renderLandmarks?.()
    state.annotator.stage?.batchDraw?.()
    state.landmarkApi?.refresh?.()

    const redrawLandmarks = () => {
      state.annotator.loadLandmarks?.(landmarks)
      state.annotator.landmarkLayer?.show?.()
      state.annotator.landmarkLayer?.moveToTop?.()
      state.annotator.renderLandmarks?.()
      state.annotator.stage?.batchDraw?.()
      state.landmarkApi?.refresh?.()
      console.log('[Landmark] redraw after load', filename, state.annotator.getLandmarks?.().length ?? 'no-api')
    }
    requestAnimationFrame(redrawLandmarks)
    setTimeout(redrawLandmarks, 150)
    setTimeout(redrawLandmarks, 400)

    state.lastSeenRemoteUpdate = data.updated_at
    state.lastSeenRemoteUpdateInitialized = true
  } catch (err) {
    console.warn('Label restore failed:', err)
    if (err.status === 401) openAuthModal()
    state.labelVersion = null
    state.annotator.loadPolygons([])
    state.annotator.loadLandmarks?.([])
    state.landmarkApi?.refresh?.()
  } finally {
    setTimeout(() => { state._suspendAutoSave = false }, 500)
  }
}

`
  s = s.slice(0, start) + block + s.slice(end)
}

// Landmark-only files must still show as labelled in the current session.
s = s.replace(
  `const hasLabels = !!(meta && meta.polygon_count > 0)`,
  `const hasLabels = !!(meta && ((meta.polygon_count || 0) > 0 || (meta.landmark_count || 0) > 0))`
)
s = s.replace(
  `polygon_count: polygons.length,\n        updated_at: result.updated_at || new Date().toISOString(),`,
  `polygon_count: polygons.length,\n        landmark_count: landmarks.length,\n        updated_at: result.updated_at || new Date().toISOString(),`
)

save(file, before, s, 'hard replace label loader with landmark restore')
console.log('OK hard landmark label loader installed')
