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

// Some local/dev API states can return the raw stored object as data.polygons:
//   { polygons: [...], landmarks: [...] }
// rather than separate data.polygons and data.landmarks fields. The frontend
// must accept both shapes, otherwise saved landmarks exist in D1 but reload as empty.
if (!s.includes('function normalizeLoadedLabelPayload(data)')) {
  s = s.replace(
    `async function loadLabelsFromStorage(filename) {`,
    `function normalizeLoadedLabelPayload(data) {
  const rawPolygons = data?.polygons
  const objectPayload = rawPolygons && !Array.isArray(rawPolygons) && typeof rawPolygons === 'object'
    ? rawPolygons
    : null
  return {
    polygons: Array.isArray(rawPolygons)
      ? rawPolygons
      : (Array.isArray(objectPayload?.polygons) ? objectPayload.polygons : []),
    landmarks: Array.isArray(data?.landmarks)
      ? data.landmarks
      : (Array.isArray(objectPayload?.landmarks) ? objectPayload.landmarks : []),
  }
}

async function loadLabelsFromStorage(filename) {`
  )
}

if (!s.includes('const normalizedLabels = normalizeLoadedLabelPayload(data)')) {
  s = s.replace(
    `    state.labelVersion = data.version ?? null
    if (data.image_width) state.imageWidth = data.image_width
    if (data.image_height) state.imageHeight = data.image_height
    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])
    state.annotator.loadLandmarks?.(Array.isArray(data.landmarks) ? data.landmarks : [])
    // 방금 본 서버 버전 기준점 저장`,
    `    state.labelVersion = data.version ?? null
    if (data.image_width) state.imageWidth = data.image_width
    if (data.image_height) state.imageHeight = data.image_height
    const normalizedLabels = normalizeLoadedLabelPayload(data)
    state.annotator.loadPolygons(normalizedLabels.polygons)
    state.annotator.loadLandmarks?.(normalizedLabels.landmarks)
    // 방금 본 서버 버전 기준점 저장`
  )
}

save(file, before, s, 'frontend object-shaped landmark load')
console.log('OK frontend object-shaped landmark load fix installed')
