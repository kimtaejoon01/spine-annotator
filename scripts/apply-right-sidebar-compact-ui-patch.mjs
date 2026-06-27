#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// app.js: runtime right sidebar compact/collapsible behavior.
// This is DOM-based so it keeps working even if previous build patches inject panels.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (!s.includes('initRightSidebarCompactUI()')) {
    s = s.replace(
      '  // UI 이벤트 바인딩\n  bindUIEvents()\n  bindKeyboardEvents()',
      '  // UI 이벤트 바인딩\n  bindUIEvents()\n  initRightSidebarCompactUI()\n  bindKeyboardEvents()'
    )
  }

  if (!s.includes('function initRightSidebarCompactUI()')) {
    const helper = `
// ================================================================
// 우측 사이드바 간단 보기 / 접이식 패널
// ================================================================
function initRightSidebarCompactUI() {
  const sidebar = document.getElementById('sidebarRight')
  if (!sidebar || sidebar.dataset.compactUiReady === '1') return
  sidebar.dataset.compactUiReady = '1'

  const COMPACT_KEY = 'spine-annotator:right-sidebar-compact'
  const PANEL_PREFIX = 'spine-annotator:right-panel-collapsed:'

  const header = sidebar.querySelector('.sidebar-header')
  if (header && !header.querySelector('.sidebar-header-actions')) {
    const actions = document.createElement('div')
    actions.className = 'sidebar-header-actions'

    const compactBtn = document.createElement('button')
    compactBtn.type = 'button'
    compactBtn.className = 'sidebar-compact-toggle'
    compactBtn.title = '우측 패널 간단 보기 전환'
    compactBtn.innerHTML = '<i class="fas fa-compress-alt"></i><span>간단</span>'
    actions.appendChild(compactBtn)
    header.appendChild(actions)

    const applyCompact = (enabled) => {
      sidebar.classList.toggle('right-sidebar-compact', !!enabled)
      compactBtn.classList.toggle('active', !!enabled)
      try { localStorage.setItem(COMPACT_KEY, String(!!enabled)) } catch {}
    }

    let initialCompact = false
    try { initialCompact = localStorage.getItem(COMPACT_KEY) === 'true' } catch {}
    applyCompact(initialCompact)

    compactBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      applyCompact(!sidebar.classList.contains('right-sidebar-compact'))
    })
  }

  const panels = [...sidebar.querySelectorAll('.panel')]
  panels.forEach((panel, index) => {
    const title = panel.querySelector(':scope > .panel-title')
    if (!title || panel.dataset.collapsibleReady === '1') return
    panel.dataset.collapsibleReady = '1'

    const titleText = title.textContent.replace(/\s+/g, ' ').trim()
    const key = PANEL_PREFIX + titleText

    let body = panel.querySelector(':scope > .panel-body')
    if (!body) {
      body = document.createElement('div')
      body.className = 'panel-body'
      const move = []
      for (const child of [...panel.children]) {
        if (child !== title) move.push(child)
      }
      move.forEach(child => body.appendChild(child))
      panel.appendChild(body)
    }

    if (!title.querySelector('.panel-collapse-toggle')) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'panel-collapse-toggle'
      btn.title = '섹션 접기/펼치기'
      btn.innerHTML = '<i class="fas fa-chevron-up"></i>'
      title.appendChild(btn)
    }

    const shouldDefaultCollapse = /파일 메모|저장/.test(titleText)
    let collapsed = shouldDefaultCollapse
    try {
      const stored = localStorage.getItem(key)
      if (stored != null) collapsed = stored === 'true'
    } catch {}

    const applyCollapsed = (value) => {
      panel.classList.toggle('panel-collapsed', !!value)
      const icon = title.querySelector('.panel-collapse-toggle i')
      if (icon) {
        icon.classList.toggle('fa-chevron-up', !value)
        icon.classList.toggle('fa-chevron-down', !!value)
      }
      try { localStorage.setItem(key, String(!!value)) } catch {}
    }
    applyCollapsed(collapsed)

    title.addEventListener('click', (e) => {
      if (e.target.closest('input, select, textarea, button:not(.panel-collapse-toggle), a')) return
      applyCollapsed(!panel.classList.contains('panel-collapsed'))
    })
  })
}
`

    const needle = '// ================================================================\n// 키보드 단축키\n// ================================================================'
    if (!s.includes(needle)) throw new Error('keyboard section needle not found')
    s = s.replace(needle, helper + '\n' + needle)
  }

  save(file, before, s, 'right sidebar compact UI app behavior')
}

// -----------------------------------------------------------------------------
// CSS: make the right sidebar less dense and support collapsible panels.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before

  const css = `

/* ================================================================
   Right sidebar compact/collapsible UI
   ================================================================ */
.sidebar-right .sidebar-header {
  gap: 8px;
}
.sidebar-right .sidebar-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sidebar-compact-toggle {
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sidebar-compact-toggle:hover,
.sidebar-compact-toggle.active {
  color: var(--text-primary);
  border-color: var(--accent-blue);
  background: rgba(88,166,255,.12);
}
.sidebar-right .panel {
  padding: 10px 12px;
}
.sidebar-right .panel-title {
  min-height: 24px;
  margin-bottom: 8px;
  cursor: pointer;
}
.sidebar-right .panel-body {
  min-height: 0;
}
.sidebar-right .panel-collapsed .panel-body {
  display: none !important;
}
.sidebar-right .panel-collapsed .panel-title {
  margin-bottom: 0;
}
.panel-collapse-toggle {
  margin-left: auto;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}
.panel-collapse-toggle:hover {
  color: var(--accent-blue);
  background: var(--bg-tertiary);
  border-color: var(--border-color);
}
.sidebar-right.right-sidebar-compact {
  --sidebar-compact-gap: 6px;
}
.sidebar-right.right-sidebar-compact .panel {
  padding: 7px 10px;
}
.sidebar-right.right-sidebar-compact .panel-title {
  font-size: 11px;
  min-height: 20px;
  margin-bottom: 5px;
}
.sidebar-right.right-sidebar-compact .btn-primary,
.sidebar-right.right-sidebar-compact .btn-secondary,
.sidebar-right.right-sidebar-compact .btn-full {
  min-height: 30px;
  padding: 5px 9px;
  font-size: 12px;
}
.sidebar-right.right-sidebar-compact .btn-icon {
  width: 28px;
  height: 28px;
}
.sidebar-right.right-sidebar-compact .control-group {
  margin-bottom: 6px;
}
.sidebar-right.right-sidebar-compact .checkbox-label {
  min-height: 24px;
  gap: 6px;
  font-size: 12px;
}
.sidebar-right.right-sidebar-compact .panel-desc,
.sidebar-right.right-sidebar-compact .ai-file-rule,
.sidebar-right.right-sidebar-compact .ai-folder-hint,
.sidebar-right.right-sidebar-compact .ai-folder-status,
.sidebar-right.right-sidebar-compact .autosave-info {
  font-size: 11px;
  line-height: 1.25;
  margin: 4px 0;
}
.sidebar-right.right-sidebar-compact .label-list {
  gap: 3px;
}
.sidebar-right.right-sidebar-compact .label-item {
  min-height: 30px;
  padding: 5px 7px;
  gap: 6px;
  border-radius: 6px;
}
.sidebar-right.right-sidebar-compact .label-color {
  width: 10px;
  height: 10px;
}
.sidebar-right.right-sidebar-compact .label-name-select {
  font-size: 12px;
  padding: 1px 2px;
}
.sidebar-right.right-sidebar-compact .label-points {
  display: none;
}
.sidebar-right.right-sidebar-compact .label-action-btn {
  width: 20px;
  height: 20px;
}
.sidebar-right.right-sidebar-compact #fileNoteInput {
  min-height: 72px !important;
  height: 86px;
  font-size: 12px;
  line-height: 1.35;
}
.sidebar-right.right-sidebar-compact input[type="range"] {
  height: 3px;
}
`

  if (!s.includes('Right sidebar compact/collapsible UI')) s += css
  save(file, before, s, 'right sidebar compact UI styles')
}

console.log('OK right sidebar compact UI patch installed')
