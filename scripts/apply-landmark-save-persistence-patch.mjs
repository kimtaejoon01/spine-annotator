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

// Landmark-only edits must be part of the normal autosave payload.
if (!s.includes('const landmarks = state.annotator.getLandmarks?.() || []')) {
  s = s.replace(
    `    const polygons = state.annotator.getPolygons()\n\n    const payload = {`,
    `    const polygons = state.annotator.getPolygons()\n    const landmarks = state.annotator.getLandmarks?.() || []\n\n    const payload = {`
  )
}
if (!s.includes('      landmarks,\n      labeler_id: labelerId,')) {
  s = s.replace(
    `      polygons,\n      labeler_id: labelerId,`,
    `      polygons,\n      landmarks,\n      labeler_id: labelerId,`
  )
}

// If the user clicks another file immediately after placing a landmark, the
// 300ms debounce may not have fired yet. Wait once before clearing the old
// file state so A's landmark is cached/saved before opening B.
if (!s.includes('function waitForPendingAutoSaveBeforeFileSwitch()')) {
  s = s.replace(
    `async function loadFileFromFolder(fileEntry) {`,
    `function waitForPendingAutoSaveBeforeFileSwitch() {\n  if (!saveTimer || state._suspendAutoSave) return Promise.resolve()\n  return new Promise(resolve => setTimeout(resolve, 360))\n}\n\nasync function loadFileFromFolder(fileEntry) {`
  )
}
if (!s.includes('await waitForPendingAutoSaveBeforeFileSwitch()\n    // 이전 ObjectURL 해제')) {
  s = s.replace(
    `  try {\n    // 이전 ObjectURL 해제`,
    `  try {\n    await waitForPendingAutoSaveBeforeFileSwitch()\n    // 이전 ObjectURL 해제`
  )
}

// Local fallback needs to restore landmarks too when D1/local API is failing.
if (!s.includes('state.annotator.loadLandmarks?.(Array.isArray(data.landmarks) ? data.landmarks : [])')) {
  s = s.replace(
    `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])\n    // 방금 본 서버 버전 기준점 저장`,
    `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])\n    state.annotator.loadLandmarks?.(Array.isArray(data.landmarks) ? data.landmarks : [])\n    // 방금 본 서버 버전 기준점 저장`
  )
}

save(file, before, s, 'landmark save persistence')
console.log('OK landmark save persistence patch installed')
