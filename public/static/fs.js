/* ================================================================
   로컬 폴더 연결 모듈
   - File System Access API로 사용자가 선택한 폴더 접근
   - IndexedDB에 폴더 핸들 저장 (다음 방문 시 권한 재요청만 하면 됨)
   - 폴더 내 이미지 파일 목록 스캔
   - 파일을 ObjectURL로 변환해 캔버스에 로드
   ================================================================ */

const DB_NAME = 'spine-annotator-fs'
const DB_VERSION = 1
const STORE_NAME = 'handles'
const HANDLE_KEY = 'imageFolder'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp'])

/** File System Access API 사용 가능 여부 */
export function isSupported() {
  return typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function'
}

/* ----------------------------------------------------------------
   IndexedDB: 폴더 핸들 영구 저장
   ---------------------------------------------------------------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key, value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/* ----------------------------------------------------------------
   폴더 권한 관리
   ---------------------------------------------------------------- */

/**
 * 핸들의 현재 권한 상태 조회
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function queryPermission(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'denied'
  return await handle.queryPermission({ mode: 'read' })
}

/**
 * 권한이 'prompt' 또는 'denied'면 사용자에게 다시 요청
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<boolean>} true면 권한 OK
 */
export async function ensurePermission(handle) {
  if (!handle) return false
  try {
    const cur = await handle.queryPermission({ mode: 'read' })
    if (cur === 'granted') return true
    const req = await handle.requestPermission({ mode: 'read' })
    return req === 'granted'
  } catch (err) {
    console.warn('[fs] permission request failed:', err)
    return false
  }
}

/* ----------------------------------------------------------------
   폴더 선택 / 복원
   ---------------------------------------------------------------- */

/**
 * 폴더 선택 다이얼로그 열고 핸들 저장
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function pickFolder() {
  if (!isSupported()) {
    throw new Error('이 브라우저는 폴더 연결을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.')
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: 'spine-annotator-images',
      mode: 'read',
      startIn: 'pictures',
    })
    await idbSet(HANDLE_KEY, handle)
    return handle
  } catch (err) {
    // 사용자가 다이얼로그 취소
    if (err.name === 'AbortError') return null
    throw err
  }
}

/**
 * 이전에 저장한 폴더 핸들 복원
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function restoreFolder() {
  try {
    const handle = await idbGet(HANDLE_KEY)
    return handle || null
  } catch (err) {
    console.warn('[fs] restore failed:', err)
    return null
  }
}

/**
 * 저장된 폴더 연결 해제
 */
export async function forgetFolder() {
  try {
    await idbDelete(HANDLE_KEY)
  } catch (err) {
    console.warn('[fs] forget failed:', err)
  }
}

/* ----------------------------------------------------------------
   폴더 스캔
   ---------------------------------------------------------------- */

/**
 * 폴더 내 이미지 파일 목록 추출 (1단계 깊이만, 비재귀)
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<Array<{name:string, handle:FileSystemFileHandle}>>}
 */
export async function listImageFiles(handle) {
  if (!handle) return []
  const items = []
  // for await 이터레이션
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file') continue
    const ext = name.split('.').pop()?.toLowerCase()
    if (!ext || !IMAGE_EXTS.has(ext)) continue
    items.push({ name, handle: entry })
  }
  // 파일명 정렬
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return items
}

/**
 * 파일 핸들 → Blob ObjectURL
 * 호출자는 사용 후 URL.revokeObjectURL()로 해제할 것
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<{url:string, blob:Blob, size:number}>}
 */
export async function fileHandleToUrl(fileHandle) {
  const file = await fileHandle.getFile()
  const url = URL.createObjectURL(file)
  return { url, blob: file, size: file.size }
}

/**
 * 특정 파일명으로 폴더 안에서 파일 찾기
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} name
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export async function findFileByName(dirHandle, name) {
  try {
    const fh = await dirHandle.getFileHandle(name)
    return fh
  } catch (err) {
    // NotFoundError 등
    return null
  }
}


// ---- 임의 키로 폴더 핸들 저장/복원 (검수 페이지처럼 폴더를 여러 개 쓸 때) ----
export async function pickFolderAs(key, opts = {}) {
  if (!isSupported()) throw new Error('이 브라우저는 폴더 연결을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.')
  try {
    const handle = await window.showDirectoryPicker({ id: opts.id || key, mode: 'read', startIn: opts.startIn || 'pictures' })
    await idbSet(key, handle)
    return handle
  } catch (err) {
    if (err.name === 'AbortError') return null
    throw err
  }
}

export async function restoreFolderAs(key) {
  try {
    const handle = await idbGet(key)
    if (!handle) return null
    const perm = await queryPermission(handle)
    if (perm === 'granted') return handle
    return { handle, needsPermission: true }
  } catch (e) { return null }
}

export async function forgetFolderAs(key) {
  try { await idbSet(key, null) } catch (e) {}
}
