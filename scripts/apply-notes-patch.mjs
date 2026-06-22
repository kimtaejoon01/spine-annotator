#!/usr/bin/env node

import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n') }
function write(path, content) { fs.writeFileSync(path, content) }
function patchReplace(label, file, from, to) {
  let s = read(file)
  if (s.includes(to)) { console.log('OK ' + label + ' already patched'); return }
  if (!s.includes(from)) throw new Error('Patch failed: ' + label)
  s = s.replace(from, to)
  write(file, s)
  console.log('PATCH ' + label)
}
function patchInsertBefore(label, file, needle, insert, already) {
  let s = read(file)
  if (already && s.includes(already)) { console.log('OK ' + label + ' already patched'); return }
  if (!s.includes(needle)) throw new Error('Patch failed: ' + label)
  s = s.replace(needle, insert + needle)
  write(file, s)
  console.log('PATCH ' + label)
}
function patchInsertAfter(label, file, needle, insert, already) {
  let s = read(file)
  if (already && s.includes(already)) { console.log('OK ' + label + ' already patched'); return }
  if (!s.includes(needle)) throw new Error('Patch failed: ' + label)
  s = s.replace(needle, needle + insert)
  write(file, s)
  console.log('PATCH ' + label)
}

// -----------------------------------------------------------------------------
// Backend API: notes table + endpoints, separate from labels/COCO export.
// -----------------------------------------------------------------------------
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
patchInsertBefore('src/api.ts notes endpoints', 'src/api.ts', '// ----------------------------------------------------------------\n// GET /api/export - 모든 라벨 내보내기', apiPatch, "api.get('/notes/export'")

// -----------------------------------------------------------------------------
// Frontend API client.
// -----------------------------------------------------------------------------
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
patchInsertBefore('public/static/api.js notes client', 'public/static/api.js', '\n/**\n * 일괄 내보내기', clientFns, 'export async function loadNote')

// -----------------------------------------------------------------------------
// Index UI panel.
// -----------------------------------------------------------------------------
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
patchInsertBefore('src/index.tsx note panel', 'src/index.tsx', '          <div class="panel">\n            <h3 class="panel-title">\n              <i class="fas fa-save"></i> 저장', notePanel, 'id="fileNoteInput"')

// -----------------------------------------------------------------------------
// App import/state/bind/load/save/export logic.
// -----------------------------------------------------------------------------
patchReplace('app.js import note API', 'public/static/app.js', '  deleteLabel,\n  exportAll,', '  deleteLabel,\n  loadNote,\n  saveNote,\n  exportNotes,\n  exportAll,')

patchInsertAfter('app.js note state', 'public/static/app.js', '  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용)', `,

  // 파일별 메모장 (라벨/COCO와 분리)
  noteLoading: false,
  noteSaveTimer: null,
  noteLastSavedAt: null`, 'noteLoading: false')

patchInsertBefore('app.js bind note controls', 'public/static/app.js', '  // 파일 업로드\n  document.getElementById(\'fileUpload\').addEventListener(\'change\', handleFileUpload)', `  // 파일별 메모장
  bindNoteControls()

`, 'bindNoteControls()')

patchInsertAfter('app.js load note on file info update', 'public/static/app.js', '  state.imageHeight = state.annotator.imageHeight\n}', `
  loadNoteForCurrentFile().catch(err => console.warn('Note load failed:', err))`, 'loadNoteForCurrentFile().catch')

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
  const result = await saveNote(state.filename, {
    note_text: input.value,
    labeler_id: labelerId,
  })
  state.noteLastSavedAt = result.updated_at || new Date().toISOString()
  setNoteStatus(input.value.trim() ? '메모 저장됨 ' + new Date(state.noteLastSavedAt).toLocaleTimeString() : '메모 없음', false)
}

async function downloadAllNotes() {
  try {
    if (state.noteSaveTimer) {
      clearTimeout(state.noteSaveTimer)
      state.noteSaveTimer = null
      await saveCurrentNoteNow()
    }
    const data = await exportNotes()
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
  } catch (err) {
    alert('메모 내보내기 실패: ' + err.message)
  }
}

`
patchInsertBefore('app.js note functions', 'public/static/app.js', '// ================================================================\n// COCO Export', noteFunctions, 'function bindNoteControls()')

// -----------------------------------------------------------------------------
// Styles.
// -----------------------------------------------------------------------------
const css = `

/* File notes panel */
.note-textarea {
  width: 100%;
  min-height: 110px;
  resize: vertical;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.45;
  outline: none;
}
.note-textarea:focus {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px rgba(79, 158, 248, 0.15);
}
.note-textarea:disabled {
  opacity: 0.65;
}
.note-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.note-status {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 0;
}
.note-status.save-error {
  color: #ff7b72;
}
.note-hint {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.35;
}
.btn-small {
  padding: 5px 8px;
  font-size: 12px;
  white-space: nowrap;
}
`
let style = read('public/static/style.css')
if (!style.includes('.note-textarea')) {
  style += css
  write('public/static/style.css', style)
  console.log('PATCH note styles')
} else {
  console.log('OK note styles already patched')
}

console.log('OK file notes patch installed')
