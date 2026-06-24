#!/usr/bin/env node

import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n') }
function write(path, content) { fs.writeFileSync(path, content) }
function saveIfChanged(path, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(path, after); console.log('PATCH ' + label) }
}
function insertBefore(s, needle, insert, already) {
  if (already && s.includes(already)) return s
  if (!s.includes(needle)) throw new Error('Patch needle not found')
  return s.replace(needle, insert + needle)
}
function insertAfter(s, needle, insert, already) {
  if (already && s.includes(already)) return s
  if (!s.includes(needle)) throw new Error('Patch needle not found')
  return s.replace(needle, needle + insert)
}

// Backend notes API.
{
  const path = 'src/api.ts'
  const before = read(path)
  let s = before
  const apiPatch = `// ----------------------------------------------------------------
// File notes / memo API - COCO 라벨과 분리 저장
// ----------------------------------------------------------------
async function ensureNotesTable(c: any) {
  await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS notes (filename TEXT PRIMARY KEY, note_text TEXT NOT NULL DEFAULT \'\', labeler_id TEXT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL)').run()
  await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC)').run()
  await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notes_labeler ON notes(labeler_id)').run()
}

api.get('/notes/export', async (c) => {
  try {
    await ensureNotesTable(c)
    const result = await c.env.DB.prepare('SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE note_text <> \'\' ORDER BY filename').all<any>()
    return c.json({ ok: true, exported_at: new Date().toISOString(), items: result.results || [] })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

api.get('/notes/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  try {
    await ensureNotesTable(c)
    const row = await c.env.DB.prepare('SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE filename = ?').bind(filename).first<any>()
    if (!row) return c.json({ ok: true, exists: false, filename, note_text: '' })
    return c.json({ ok: true, exists: true, ...row })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

api.put('/notes/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid json' }, 400) }
  const noteText = String(body?.note_text ?? '').slice(0, 20000)
  const labelerId = body?.labeler_id || null
  const now = new Date().toISOString()
  try {
    await ensureNotesTable(c)
    if (noteText.trim() === '') {
      await c.env.DB.prepare('DELETE FROM notes WHERE filename = ?').bind(filename).run()
      return c.json({ ok: true, saved: true, deleted: true, filename, note_text: '', updated_at: now })
    }
    await c.env.DB.prepare('INSERT INTO notes (filename, note_text, labeler_id, updated_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(filename) DO UPDATE SET note_text=excluded.note_text, labeler_id=excluded.labeler_id, updated_at=excluded.updated_at').bind(filename, noteText, labelerId, now, now).run()
    return c.json({ ok: true, saved: true, filename, note_text: noteText, updated_at: now })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

`
  if (!s.includes("api.get('/notes/export'")) {
    s = insertBefore(s, '// ----------------------------------------------------------------\n// GET /api/export - 모든 라벨 내보내기', apiPatch)
  }
  saveIfChanged(path, before, s, 'notes API endpoints')
}

// Frontend API client.
{
  const path = 'public/static/api.js'
  const before = read(path)
  let s = before
  const clientFns = `
/** 파일별 메모 로드 */
export async function loadNote(filename) {
  return apiFetch('/api/notes/' + encodeURIComponent(filename))
}

/** 파일별 메모 저장 */
export async function saveNote(filename, payload) {
  return apiFetch('/api/notes/' + encodeURIComponent(filename), {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** 전체 메모 별도 내보내기 */
export async function exportNotes() {
  return apiFetch('/api/notes/export')
}
`
  if (!s.includes('export async function loadNote')) {
    if (s.includes('\n/**\n * 일괄 내보내기')) s = insertBefore(s, '\n/**\n * 일괄 내보내기', clientFns)
    else s += clientFns
  }
  saveIfChanged(path, before, s, 'notes API client')
}

// Notes panel in right sidebar.
{
  const path = 'src/index.tsx'
  const before = read(path)
  let s = before
  const notePanel = `          <div class="panel" id="notePanel">
            <h3 class="panel-title">
              <i class="fas fa-sticky-note"></i> 파일 메모
            </h3>
            <textarea id="fileNoteInput" class="note-textarea" placeholder="이 이미지에 대한 메모를 적으세요. 예: AI mask 밀림, 판독 주의점, 나중에 재확인 등"></textarea>
            <div class="note-footer">
              <span id="noteStatus" class="note-status">메모 없음</span>
              <button class="btn-secondary btn-small" id="exportNotesBtn" title="메모만 별도 JSON으로 내보내기">
                <i class="fas fa-download"></i> 메모 내보내기
              </button>
            </div>
            <p class="note-hint">메모는 COCO/라벨 JSON에 포함되지 않고 별도로 저장됩니다.</p>
          </div>
`
  if (!s.includes('id="fileNoteInput"')) {
    s = insertBefore(s, '          <div class="panel">\n            <h3 class="panel-title">\n              <i class="fas fa-save"></i> 저장', notePanel)
  }
  saveIfChanged(path, before, s, 'notes UI panel')
}

// app.js note logic.
{
  const path = 'public/static/app.js'
  const before = read(path)
  let s = before
  if (!s.includes('loadNote,\n  saveNote,\n  exportNotes,')) {
    s = s.replace('  deleteLabel,\n  exportAll,', '  deleteLabel,\n  loadNote,\n  saveNote,\n  exportNotes,\n  exportAll,')
  }
  if (!s.includes('noteLoading: false')) {
    s = s.replace('  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용)', `  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용),

  // 파일별 메모장 (라벨/COCO와 분리)
  noteLoading: false,
  noteSaveTimer: null,
  noteLastSavedAt: null`)
  }
  if (!s.includes('bindNoteControls()')) {
    if (s.includes('  // 파일 업로드\n  document.getElementById(\'fileUpload\').addEventListener(\'change\', handleFileUpload)')) {
      s = s.replace('  // 파일 업로드\n  document.getElementById(\'fileUpload\').addEventListener(\'change\', handleFileUpload)', '  // 파일별 메모장\n  bindNoteControls()\n\n  // 파일 업로드\n  document.getElementById(\'fileUpload\').addEventListener(\'change\', handleFileUpload)')
    } else if (s.includes('function bindUIEvents() {')) {
      s = s.replace('function bindUIEvents() {', 'function bindUIEvents() {\n  bindNoteControls()')
    }
  }
  if (!s.includes('function bindNoteControls()')) {
    const noteFunctions = `// ================================================================
// 파일별 메모장 - 라벨/COCO와 분리 저장
// ================================================================
function bindNoteControls() {
  const input = document.getElementById('fileNoteInput')
  if (input && !input.dataset.bound) {
    input.dataset.bound = '1'
    input.addEventListener('input', () => {
      if (state.noteLoading) return
      setNoteStatus('저장 대기...', false)
      scheduleNoteSave()
    })
  }
  const exportBtn = document.getElementById('exportNotesBtn')
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = '1'
    exportBtn.addEventListener('click', downloadAllNotes)
  }
}
function setNoteStatus(text, isError = false) {
  const el = document.getElementById('noteStatus')
  if (!el) return
  el.textContent = text
  el.classList.toggle('save-error', !!isError)
}
async function loadNoteForCurrentFile() {
  const input = document.getElementById('fileNoteInput')
  if (!input || !state.filename) return
  state.noteLoading = true
  input.disabled = true
  input.value = ''
  setNoteStatus('메모 불러오는 중...', false)
  try {
    const data = await loadNote(state.filename)
    input.value = data.note_text || ''
    input.disabled = false
    if (data.exists && data.updated_at) setNoteStatus('메모 저장됨 ' + new Date(data.updated_at).toLocaleTimeString(), false)
    else setNoteStatus('메모 없음', false)
  } catch (err) {
    input.disabled = false
    if (err.status === 401) openAuthModal()
    setNoteStatus('메모 로드 실패', true)
  } finally {
    state.noteLoading = false
  }
}
function scheduleNoteSave() {
  if (state.noteSaveTimer) clearTimeout(state.noteSaveTimer)
  state.noteSaveTimer = setTimeout(() => saveCurrentNoteNow().catch(err => {
    console.error('Note save failed:', err)
    if (err.status === 401) openAuthModal()
    setNoteStatus('메모 저장 실패', true)
  }), 700)
}
async function saveCurrentNoteNow() {
  const input = document.getElementById('fileNoteInput')
  if (!input || !state.filename || state.noteLoading) return
  const labelerId = getCurrentLabelerId()
  setNoteStatus('메모 저장 중...', false)
  const result = await saveNote(state.filename, { note_text: input.value, labeler_id: labelerId })
  state.noteLastSavedAt = result.updated_at || new Date().toISOString()
  setNoteStatus(input.value.trim() ? '메모 저장됨 ' + new Date(state.noteLastSavedAt).toLocaleTimeString() : '메모 없음', false)
}
async function downloadAllNotes() {
  try {
    if (state.noteSaveTimer) { clearTimeout(state.noteSaveTimer); state.noteSaveTimer = null; await saveCurrentNoteNow() }
    const data = await exportNotes()
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const payload = { type: 'spine-annotator-file-notes', exported_at: data.exported_at || new Date().toISOString(), count: (data.items || []).length, items: data.items || [] }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'spine-file-notes-' + ts + '.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    alert('메모 내보내기 실패: ' + err.message)
  }
}

`
    s = insertBefore(s, '// ================================================================\n// COCO Export', noteFunctions)
  }
  // Ensure note loading is inside updateFileInfo, but do not fail when other patches changed formatting.
  if (!s.includes("loadNoteForCurrentFile().catch(err => console.warn('Note load failed:', err))")) {
    const needle = '  state.imageHeight = state.annotator.imageHeight\n}'
    if (s.includes(needle)) {
      s = s.replace(needle, "  state.imageHeight = state.annotator.imageHeight\n  loadNoteForCurrentFile().catch(err => console.warn('Note load failed:', err))\n}")
    } else {
      console.log('WARN updateFileInfo insert point not found; note load will still work on manual edits')
    }
  }
  saveIfChanged(path, before, s, 'notes app logic')
}

// Styles.
{
  const path = 'public/static/style.css'
  const before = read(path)
  let s = before
  if (!s.includes('.note-textarea')) {
    s += `

/* File notes panel */
.note-textarea { width: 100%; min-height: 110px; resize: vertical; border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; background: var(--bg-secondary); color: var(--text-primary); font-size: 13px; line-height: 1.45; outline: none; }
.note-textarea:focus { border-color: var(--accent-color); box-shadow: 0 0 0 2px rgba(79, 158, 248, 0.15); }
.note-textarea:disabled { opacity: 0.65; }
.note-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.note-status { font-size: 12px; color: var(--text-secondary); min-width: 0; }
.note-status.save-error { color: #ff7b72; }
.note-hint { margin: 8px 0 0; color: var(--text-secondary); font-size: 11px; line-height: 1.35; }
.btn-small { padding: 5px 8px; font-size: 12px; white-space: nowrap; }
`
  }
  saveIfChanged(path, before, s, 'notes styles')
}

console.log('OK safe file notes patch installed')
