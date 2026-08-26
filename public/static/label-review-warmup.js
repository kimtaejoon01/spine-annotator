import { restoreFolderAs, listImageFiles } from './fs.js'

const FOLDER_KEY = 'lr:imagesFolder'
const CONCURRENCY = 2

let warmEpoch = 0
let lastSignature = ''
let running = false
let pollTimer = null

function statusEl() {
  return document.getElementById('lrPreload')
}

function setStatus(text) {
  const el = statusEl()
  if (el) el.textContent = text
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function signatureFor(handle, files) {
  let h = 2166136261
  for (const f of files) {
    const name = String(f?.name || '')
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return `${handle?.name || ''}:${files.length}:${h >>> 0}`
}

async function fullyReadFile(file) {
  // Google Drive Desktop의 스트리밍 파일은 getFile()만으로 실제 바이트가
  // 모두 내려오지 않을 수 있다. 파일 끝까지 읽고 버려서 Drive 로컬 캐시를 데운다.
  if (file?.stream) {
    const reader = file.stream().getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
      }
    } finally {
      try { reader.releaseLock() } catch {}
    }
    return
  }
  await file.arrayBuffer()
}

async function warmFiles(files, epoch) {
  if (!files.length) {
    setStatus('이미지 없음')
    return
  }

  let cursor = 0
  let done = 0
  let failed = 0
  let bytes = 0

  setStatus(`전체 이미지 로컬 준비 0/${files.length}`)

  const worker = async () => {
    while (epoch === warmEpoch) {
      const i = cursor++
      if (i >= files.length) return
      const entry = files[i]
      try {
        const handle = entry?.handle || entry
        const file = await handle.getFile()
        await fullyReadFile(file)
        bytes += Number(file.size) || 0
      } catch (err) {
        failed++
        console.warn('[label-review warmup] file read failed', entry?.name, err)
      } finally {
        done++
        if (epoch === warmEpoch) {
          const failText = failed ? ` · 실패 ${failed}` : ''
          setStatus(`전체 이미지 로컬 준비 ${done}/${files.length} · ${formatBytes(bytes)}${failText}`)
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker())
  await Promise.all(workers)

  if (epoch !== warmEpoch) return
  const failText = failed ? ` · 실패 ${failed}` : ''
  setStatus(`전체 이미지 로컬 준비 완료 · ${done}장 · ${formatBytes(bytes)}${failText}`)
}

async function maybeWarm(force = false) {
  if (!document.getElementById('lrStage')) return
  if (running && !force) return

  let restored
  try {
    restored = await restoreFolderAs(FOLDER_KEY)
  } catch {
    return
  }
  if (!restored) return
  if (restored.needsPermission) return

  const handle = restored.handle || restored
  let files
  try {
    files = await listImageFiles(handle)
  } catch {
    return
  }

  const signature = signatureFor(handle, files)
  if (!force && signature === lastSignature) return

  lastSignature = signature
  const epoch = ++warmEpoch
  running = true
  try {
    await warmFiles(files, epoch)
  } finally {
    if (epoch === warmEpoch) running = false
  }
}

function init() {
  if (!document.getElementById('lrStage')) return

  // 저장된 폴더 권한이 살아 있으면 페이지 진입 즉시 전체 파일을 읽는다.
  maybeWarm().catch(() => {})

  // 새 폴더를 고른 직후에도 자동으로 전체 워밍업한다.
  document.getElementById('lrConnectFolder')?.addEventListener('click', () => {
    ++warmEpoch
    running = false
    lastSignature = ''
    setTimeout(() => maybeWarm(true).catch(() => {}), 1200)
  })

  // 폴더 선택/권한 허용 완료 시점을 놓치지 않기 위한 가벼운 확인.
  pollTimer = setInterval(() => maybeWarm().catch(() => {}), 4000)
}

window.addEventListener('beforeunload', () => {
  ++warmEpoch
  if (pollTimer) clearInterval(pollTimer)
})

document.addEventListener('DOMContentLoaded', init)
