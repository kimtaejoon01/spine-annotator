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

const helper = `async function persistCurrentLabelsNow(filenameOverride = state.filename) {
  if (!state.annotator || !filenameOverride) return
  const labelerId = getCurrentLabelerId()
  const polygons = state.annotator.getPolygons?.() || []
  const landmarks = state.annotator.getLandmarks?.() || []
  const payload = {
    view_type: state.viewType,
    start_label: state.annotator.startLabel,
    polygons,
    landmarks,
    labeler_id: labelerId,
    image_width: state.imageWidth || null,
    image_height: state.imageHeight || null,
    version: state.labelVersion,
  }

  const saveStatus = document.getElementById('saveStatus')
  try {
    const result = await saveLabel(filenameOverride, payload)
    const labeler = getCurrentLabeler()
    const labelerSuffix = labeler ? \` · \${labeler.name}\` : ''
    if (filenameOverride === state.filename && result.version != null) state.labelVersion = result.version
    if (saveStatus && filenameOverride === state.filename) {
      saveStatus.textContent = '서버 저장됨 (' + new Date().toLocaleTimeString() + labelerSuffix + ')'
      saveStatus.classList.remove('save-error')
    }
    serverLabelMetaMap.set(filenameOverride, {
      filename: filenameOverride,
      view_type: state.viewType,
      labeler_id: labelerId,
      polygon_count: polygons.length,
      landmark_count: landmarks.length,
      updated_at: result.updated_at || new Date().toISOString(),
      version: result.version ?? state.labelVersion,
      image_width: state.imageWidth || null,
      image_height: state.imageHeight || null,
    })
    if (state.files.length > 0) renderFileList()
  } catch (err) {
    console.error('Immediate save failed:', err)
    if (saveStatus && filenameOverride === state.filename) {
      if (err.status === 401) {
        saveStatus.textContent = '⚠️ 인증 만료 - 비밀번호 재입력 필요'
        saveStatus.classList.add('save-error')
        openAuthModal()
      } else if (err.status === 409) {
        saveStatus.textContent = '⚠️ 다른 사용자가 먼저 저장함 - 최신 불러오기 필요'
        saveStatus.classList.add('save-error')
        showConflictNotice(err)
      } else {
        saveStatus.textContent = '⚠️ 서버 저장 실패 (로컬 백업됨, 자동 재시도)'
        saveStatus.classList.add('save-error')
      }
    }
  }
}

`

if (!s.includes('async function persistCurrentLabelsNow(')) {
  s = s.replace(
    `let saveTimer = null\nfunction autoSave() {`,
    `let saveTimer = null\n${helper}function autoSave() {`
  )
}

if (!s.includes('await persistCurrentLabelsNow()\n    saveTimer = null\n    return')) {
  s = s.replace(
    `  saveTimer = setTimeout(async () => {\n    if (state._suspendAutoSave) return`,
    `  saveTimer = setTimeout(async () => {\n    if (state._suspendAutoSave) return\n    await persistCurrentLabelsNow()\n    saveTimer = null\n    return`
  )
}

const oldWait = `function waitForPendingAutoSaveBeforeFileSwitch() {
  if (!saveTimer || state._suspendAutoSave) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, 360))
}`
const newWait = `async function waitForPendingAutoSaveBeforeFileSwitch() {
  if (!saveTimer || state._suspendAutoSave) return
  clearTimeout(saveTimer)
  saveTimer = null
  await persistCurrentLabelsNow()
}`
if (s.includes(oldWait)) {
  s = s.replace(oldWait, newWait)
} else if (!s.includes('async function waitForPendingAutoSaveBeforeFileSwitch()')) {
  s = s.replace(
    `async function loadFileFromFolder(fileEntry) {`,
    `${newWait}\n\nasync function loadFileFromFolder(fileEntry) {`
  )
}

save(file, before, s, 'immediate landmark save before file switch')
console.log('OK immediate landmark save patch installed')
