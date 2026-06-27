#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, s) { fs.writeFileSync(file, s) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

const file = 'public/static/app.js'
let s = read(file)
const before = s

// -----------------------------------------------------------------------------
// Notes module integration
// -----------------------------------------------------------------------------
if (!s.includes("from './modules/notes.js'")) {
  const needle = "import { exportToCOCO } from './coco.js'\n"
  if (!s.includes(needle)) throw new Error('app import needle for notes module not found')
  s = s.replace(
    needle,
    needle + "import { initNotesModule, loadCurrentNote as loadCurrentNoteFromModule } from './modules/notes.js'\n"
  )
}

const notesInitCall = `initNotesModule({
    state,
    loadNote,
    saveNote,
    exportNotes,
    getCurrentLabelerId,
    openAuthModal,
  })`
if (!s.includes('initNotesModule({')) {
  // Replace old bindNoteControls call if it exists. Otherwise insert after bindUIEvents.
  if (s.includes('  bindNoteControls()')) {
    s = s.replace('  bindNoteControls()', '  ' + notesInitCall)
  } else {
    s = s.replace('  bindUIEvents()\n', '  bindUIEvents()\n  ' + notesInitCall + '\n')
  }
}

// Ensure file changes load notes through the module, not the older inline helper.
s = s.replaceAll(
  "loadNoteForCurrentFile().catch(err => console.warn('Note load failed:', err))",
  "loadCurrentNoteFromModule().catch(err => console.warn('Note load failed:', err))"
)

// If there is no call in updateFileInfo, add it there. This is where filename/image info is finalized.
if (!s.includes("loadCurrentNoteFromModule().catch(err => console.warn('Note load failed:', err))")) {
  const start = s.indexOf('function updateFileInfo() {')
  const end = start >= 0 ? s.indexOf('\n}', start) : -1
  if (start >= 0 && end > start) {
    s = s.slice(0, end) + "\n  loadCurrentNoteFromModule().catch(err => console.warn('Note load failed:', err))" + s.slice(end)
  } else {
    console.log('WARN updateFileInfo not found for notes module load')
  }
}

// Do not let older inline bindNoteControls add duplicate listeners if some patch still calls it.
if (s.includes('function bindNoteControls()')) {
  s = s.replace(
    /function bindNoteControls\(\) \{[\s\S]*?\n\}\n\nfunction setNoteStatus/,
    `function bindNoteControls() {
  // handled by modules/notes.js
}

function setNoteStatus`
  )
}

// -----------------------------------------------------------------------------
// Auth hardening
// Problem: password verification succeeded, but postAuthInit failures were caught
// by the auth catch block, making it look like the password was rejected.
// -----------------------------------------------------------------------------
if (!s.includes('async function continueAfterAuthSuccess()')) {
  const helperNeedle = '// ================================================================\n// 인증 (비밀번호) 관리\n// ================================================================'
  const helper = `// ================================================================
// 인증 성공 후 안전 초기화
// ================================================================
async function continueAfterAuthSuccess() {
  try {
    await postAuthInit()
  } catch (err) {
    console.error('[Auth] post-auth initialization failed:', err)
    if (err && err.status === 401) {
      openAuthModal()
      return
    }
    showStartupError(err)
  }
}

function showStartupError(err) {
  let box = document.getElementById('startupErrorBox')
  if (!box) {
    box = document.createElement('div')
    box.id = 'startupErrorBox'
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;background:#3b1111;color:#fff;border:1px solid #ff7b72;border-radius:10px;padding:12px 14px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.35)'
    document.body.appendChild(box)
  }
  box.innerHTML = '<strong>초기화 오류</strong><br>' + escapeHtml(err?.message || String(err || 'unknown error')) + '<br><span style="opacity:.8">새로고침(Ctrl+F5) 후에도 반복되면 콘솔 오류를 보내주세요.</span>'
}

`
  if (!s.includes(helperNeedle)) throw new Error('auth helper insertion point not found')
  s = s.replace(helperNeedle, helper + helperNeedle)
}

// DOMContentLoaded token path: catch postAuthInit errors.
s = s.replace(
  '  // 토큰 있으면 정상 초기화\n  await postAuthInit()',
  '  // 토큰 있으면 정상 초기화\n  await continueAfterAuthSuccess()'
)

// Form submit: split password verification errors from post-auth initialization errors.
const oldSubmit = `    errEl.classList.add('hidden')
    try {
      await verifyPassword(password)
      closeAuthModal()
      // 인증 성공 후 나머지 초기화 진행 (postAuthInit이 아직 안 돌았다면)
      await postAuthInit()
    } catch (err) {
      errEl.textContent = err.message || '인증 실패'
      errEl.classList.remove('hidden')
      input.select()
    }`
const newSubmit = `    errEl.classList.add('hidden')
    try {
      await verifyPassword(password)
    } catch (err) {
      errEl.textContent = err.message || '인증 실패'
      errEl.classList.remove('hidden')
      input.select()
      return
    }
    closeAuthModal()
    // 비밀번호 검증 성공. 이후 초기화 실패는 비밀번호 오류로 표시하지 않는다.
    await continueAfterAuthSuccess()`
if (s.includes(oldSubmit)) {
  s = s.replace(oldSubmit, newSubmit)
} else if (!s.includes('await continueAfterAuthSuccess()')) {
  console.log('WARN auth submit block not matched')
}

save(file, before, s, 'auth hardening and notes module integration')
