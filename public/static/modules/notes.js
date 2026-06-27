/* ================================================================
   File notes module
   - 메모는 COCO/라벨과 분리 저장
   - app.js의 긴 notes 로직을 단계적으로 대체하기 위한 모듈
   ================================================================ */

let deps = null
let saveTimer = null
let loading = false

function getInput() {
  return document.getElementById('fileNoteInput')
}

function getStatus() {
  return document.getElementById('noteStatus')
}

function setStatus(text, isError = false) {
  const el = getStatus()
  if (!el) return
  el.textContent = text
  el.classList.toggle('save-error', !!isError)
}

function currentFilename() {
  return deps?.state?.filename || ''
}

export function initNotesModule(options) {
  deps = options
  const input = getInput()
  const exportBtn = document.getElementById('exportNotesBtn')

  if (input && !input.dataset.notesModuleBound) {
    input.dataset.notesModuleBound = '1'
    input.addEventListener('input', () => {
      if (loading) return
      setStatus('저장 대기...', false)
      scheduleSave()
    })
  }

  if (exportBtn && !exportBtn.dataset.notesModuleBound) {
    exportBtn.dataset.notesModuleBound = '1'
    exportBtn.addEventListener('click', () => downloadAllNotes().catch(err => {
      alert('메모 내보내기 실패: ' + (err.message || err))
    }))
  }
}

export async function loadCurrentNote() {
  const input = getInput()
  const filename = currentFilename()
  if (!deps || !input || !filename) return

  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  loading = true
  input.disabled = true
  input.value = ''
  setStatus('메모 불러오는 중...', false)

  try {
    const data = await deps.loadNote(filename)
    input.value = data.note_text || ''
    if (data.exists && data.updated_at) {
      setStatus('메모 저장됨 ' + new Date(data.updated_at).toLocaleTimeString(), false)
    } else {
      setStatus('메모 없음', false)
    }
  } catch (err) {
    if (err?.status === 401 && typeof deps.openAuthModal === 'function') deps.openAuthModal()
    setStatus('메모 로드 실패', true)
    console.warn('[notes] load failed:', err)
  } finally {
    loading = false
    input.disabled = false
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveCurrentNote().catch(err => {
      if (err?.status === 401 && typeof deps.openAuthModal === 'function') deps.openAuthModal()
      setStatus('메모 저장 실패', true)
      console.error('[notes] save failed:', err)
    })
  }, 700)
}

export async function saveCurrentNote() {
  const input = getInput()
  const filename = currentFilename()
  if (!deps || !input || !filename || loading) return

  setStatus('메모 저장 중...', false)
  const labelerId = typeof deps.getCurrentLabelerId === 'function' ? deps.getCurrentLabelerId() : null
  const result = await deps.saveNote(filename, {
    note_text: input.value,
    labeler_id: labelerId,
  })
  const updatedAt = result.updated_at || new Date().toISOString()
  setStatus(input.value.trim() ? '메모 저장됨 ' + new Date(updatedAt).toLocaleTimeString() : '메모 없음', false)
}

export async function downloadAllNotes() {
  if (!deps) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    await saveCurrentNote()
  }

  const data = await deps.exportNotes()
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const payload = {
    type: 'spine-annotator-file-notes',
    exported_at: data.exported_at || new Date().toISOString(),
    count: (data.items || []).length,
    items: data.items || [],
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'spine-file-notes-' + ts + '.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
