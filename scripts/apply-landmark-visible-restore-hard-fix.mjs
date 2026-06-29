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

if (!s.includes('function restoreVisibleLandmarksAfterLoad')) {
  s = s.replace(
    `function normalizeLoadedLabelPayload(data) {`,
    `function restoreVisibleLandmarksAfterLoad(landmarks, source = '') {
  const items = Array.isArray(landmarks) ? landmarks : []
  if (!state.annotator) return
  const apply = () => {
    if (!state.annotator?.loadLandmarks) {
      console.warn('[Landmark] loadLandmarks API missing during restore', source)
      return
    }
    state.annotator.loadLandmarks(items)
    state.annotator.landmarkLayer?.show?.()
    state.annotator.landmarkLayer?.moveToTop?.()
    state.annotator.renderLandmarks?.()
    state.annotator.stage?.batchDraw?.()
    state.landmarkApi?.refresh?.()
    console.log('[Landmark] restored visible landmarks', source, items.length, state.annotator.getLandmarks?.().length)
  }
  apply()
  requestAnimationFrame(apply)
  setTimeout(apply, 120)
}

function normalizeLoadedLabelPayload(data) {`
  )
}

s = s.replace(
  `    state.annotator.loadPolygons(normalizedLabels.polygons)
    state.annotator.loadLandmarks?.(normalizedLabels.landmarks)
    // 방금 본 서버 버전 기준점 저장`,
  `    state.annotator.loadPolygons(normalizedLabels.polygons)
    restoreVisibleLandmarksAfterLoad(normalizedLabels.landmarks, filename)
    // 방금 본 서버 버전 기준점 저장`
)
s = s.replace(
  `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])
    state.annotator.loadLandmarks?.(Array.isArray(data.landmarks) ? data.landmarks : [])
    // 방금 본 서버 버전 기준점 저장`,
  `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])
    restoreVisibleLandmarksAfterLoad(Array.isArray(data.landmarks) ? data.landmarks : [], filename)
    // 방금 본 서버 버전 기준점 저장`
)

save(file, before, s, 'visible landmark restore after load')
console.log('OK visible landmark restore patch installed')
