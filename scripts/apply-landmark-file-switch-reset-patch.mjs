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

if (!s.includes('function resetLandmarksForFileSwitch()')) {
  s = s.replace(
    `async function loadFileFromFolder(fileEntry) {`,
    `function resetLandmarksForFileSwitch() {
  if (!state.annotator) return
  state.annotator.loadLandmarks?.([])
  state.annotator.setPendingLandmark?.(null)
  state.landmarkApi?.refresh?.()
}

async function loadFileFromFolder(fileEntry) {`
  )
}

if (!s.includes('resetLandmarksForFileSwitch()\n    // 새 파일 열림')) {
  s = s.replace(
    `    state.filename = fileEntry.name
    // 새 파일 열림`,
    `    state.filename = fileEntry.name
    resetLandmarksForFileSwitch()
    // 새 파일 열림`
  )
}

if (!s.includes('resetLandmarksForFileSwitch()\n  const parsed = parseFilename(file.name)')) {
  s = s.replace(
    `  state.filename = file.name
  const parsed = parseFilename(file.name)`,
    `  state.filename = file.name
  resetLandmarksForFileSwitch()
  const parsed = parseFilename(file.name)`
  )
}

if (!s.includes('resetLandmarksForFileSwitch()\n  state.viewType = \'AP\'')) {
  s = s.replace(
    `  state.filename = 'sample_00000000_AP.png'
  state.viewType = 'AP'`,
    `  state.filename = 'sample_00000000_AP.png'
  resetLandmarksForFileSwitch()
  state.viewType = 'AP'`
  )
}

if (!s.includes('resetLandmarksForFileSwitch()\n  try {\n    const data = await loadLabel(filename)')) {
  s = s.replace(
    `  // 자동저장 차단 플래그
  state._suspendAutoSave = true
  try {
    const data = await loadLabel(filename)`,
    `  // 자동저장 차단 플래그
  state._suspendAutoSave = true
  resetLandmarksForFileSwitch()
  try {
    const data = await loadLabel(filename)`
  )
}

if (!s.includes('state.annotator.loadLandmarks?.(Array.isArray(data.landmarks) ? data.landmarks : [])')) {
  s = s.replace(
    `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])
    // 방금 본 서버 버전 기준점 저장`,
    `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])
    state.annotator.loadLandmarks?.(Array.isArray(data.landmarks) ? data.landmarks : [])
    // 방금 본 서버 버전 기준점 저장`
  )
}

// Hard safety: any no-data/error path must keep landmarks empty.
if (!s.includes('state.annotator.loadPolygons([])\n      state.annotator.loadLandmarks?.([])\n      // 이 시점 이후')) {
  s = s.replace(
    `      state.annotator.loadPolygons([])
      // 이 시점 이후`,
    `      state.annotator.loadPolygons([])
      state.annotator.loadLandmarks?.([])
      // 이 시점 이후`
  )
}
if (!s.includes('state.annotator.loadPolygons([])\n    state.annotator.loadLandmarks?.([])\n  } finally')) {
  s = s.replace(
    `    state.annotator.loadPolygons([])
  } finally`,
    `    state.annotator.loadPolygons([])
    state.annotator.loadLandmarks?.([])
  } finally`
  )
}

save(file, before, s, 'landmarks reset on file switch/load')
console.log('OK landmark file-switch reset patch installed')
