#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
let changed = false

function patch(label, from, to) {
  if (s.includes(to)) {
    console.log('OK ' + label + ' already patched')
    return
  }
  if (!s.includes(from)) throw new Error('Patch failed: ' + label)
  s = s.replace(from, to)
  console.log('PATCH ' + label)
  changed = true
}

// After the normal image folder restore, try restoring the AI result folder too.
patch(
  'restore AI folder during postAuthInit',
  '  // 로컬 폴더 자동 복원 시도 (실패해도 무시)\n  await tryRestoreFolder()\n',
  '  // 로컬 폴더 자동 복원 시도 (실패해도 무시)\n  await tryRestoreFolder()\n  await tryRestoreAiFolder()\n'
)

// Store AI folder handle after user selects it.
patch(
  'save AI folder handle after picker',
  "    state.aiFolderHandle = handle\n    state.aiFolderName = handle.name\n    await scanAiFolder()",
  "    state.aiFolderHandle = handle\n    state.aiFolderName = handle.name\n    await saveAiFolderHandle(handle)\n    await scanAiFolder()"
)

// Add helper functions before handleConnectAiFolder.
const needle = 'async function handleConnectAiFolder() {'
const helpers = `const AI_FOLDER_DB_NAME = 'spine-annotator-fs'
const AI_FOLDER_STORE_NAME = 'handles'
const AI_FOLDER_HANDLE_KEY = 'aiMaskFolder'

function openAiFolderDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AI_FOLDER_DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(AI_FOLDER_STORE_NAME)) db.createObjectStore(AI_FOLDER_STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveAiFolderHandle(handle) {
  try {
    const db = await openAiFolderDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AI_FOLDER_STORE_NAME, 'readwrite')
      tx.objectStore(AI_FOLDER_STORE_NAME).put(handle, AI_FOLDER_HANDLE_KEY)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[AI folder] save failed:', err)
  }
}

async function loadAiFolderHandle() {
  try {
    const db = await openAiFolderDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(AI_FOLDER_STORE_NAME, 'readonly')
      const req = tx.objectStore(AI_FOLDER_STORE_NAME).get(AI_FOLDER_HANDLE_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[AI folder] restore failed:', err)
    return null
  }
}

async function tryRestoreAiFolder() {
  const handle = await loadAiFolderHandle()
  if (!handle) return false
  state.aiFolderHandle = handle
  state.aiFolderName = handle.name || '이전 AI 폴더'
  updateAiFolderStatus('이전 AI 폴더를 다시 연결할 수 있습니다: ' + state.aiFolderName, 'connected')
  renderAiRegionControls()
  try {
    let perm = 'prompt'
    if (typeof handle.queryPermission === 'function') perm = await handle.queryPermission({ mode: 'read' })
    if (perm !== 'granted' && typeof handle.requestPermission === 'function') {
      perm = await handle.requestPermission({ mode: 'read' })
    }
    if (perm === 'granted') {
      await scanAiFolder()
      return true
    }
    updateAiFolderStatus('AI 폴더 권한이 필요합니다. AI 폴더 다시 연결을 눌러주세요: ' + state.aiFolderName, 'empty')
  } catch (err) {
    updateAiFolderStatus('AI 폴더 다시 연결 필요: ' + state.aiFolderName, 'empty')
  }
  return false
}

`
if (!s.includes('function tryRestoreAiFolder()')) {
  if (!s.includes(needle)) throw new Error('Patch failed: AI folder reconnect helpers')
  s = s.replace(needle, helpers + needle)
  console.log('PATCH AI folder reconnect helpers')
  changed = true
} else {
  console.log('OK AI folder reconnect helpers already patched')
}

if (changed) fs.writeFileSync(file, s)
console.log(changed ? 'OK AI folder reconnect patch installed' : 'OK AI folder reconnect already installed')
