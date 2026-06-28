#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

const helper = `
// ================================================================
// Hard fix: collapsible pelvis label panel
// ================================================================
function ensurePelvisPanelCollapseHardFix() {
  const attach = () => {
    const panel = document.getElementById('pelvisLabelPanel')
    if (!panel) return false

    const title = panel.querySelector(':scope > .panel-title') || panel.querySelector('.panel-title')
    if (!title) return false

    let body = panel.querySelector(':scope > .panel-body')
    if (!body) {
      body = document.createElement('div')
      body.className = 'panel-body pelvis-label-body'
      for (const child of [...panel.children]) {
        if (child !== title) body.appendChild(child)
      }
      panel.appendChild(body)
    }

    let btn = title.querySelector('.panel-collapse-toggle')
    if (!btn) {
      btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'panel-collapse-toggle'
      btn.title = '섹션 접기/펼치기'
      btn.innerHTML = '<i class="fas fa-chevron-up"></i>'
      title.appendChild(btn)
    }

    const applyCollapsed = (collapsed) => {
      panel.classList.toggle('panel-collapsed', !!collapsed)
      const icon = btn.querySelector('i')
      if (icon) {
        icon.classList.toggle('fa-chevron-up', !collapsed)
        icon.classList.toggle('fa-chevron-down', !!collapsed)
      }
      try { localStorage.setItem('spine-annotator:pelvis-panel-collapsed', String(!!collapsed)) } catch {}
    }

    if (panel.dataset.pelvisCollapseHardReady !== '1') {
      panel.dataset.pelvisCollapseHardReady = '1'
      let initial = false
      try { initial = localStorage.getItem('spine-annotator:pelvis-panel-collapsed') === 'true' } catch {}
      applyCollapsed(initial)

      title.addEventListener('click', (e) => {
        if (e.target.closest('button:not(.panel-collapse-toggle), input, select, textarea, a')) return
        applyCollapsed(!panel.classList.contains('panel-collapsed'))
      })
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        applyCollapsed(!panel.classList.contains('panel-collapsed'))
      })
    }

    return true
  }

  if (attach()) return
  setTimeout(attach, 0)
  setTimeout(attach, 100)
  setTimeout(attach, 300)
  setTimeout(attach, 800)
}
`

if (!s.includes('Hard fix: collapsible pelvis label panel')) {
  const needle = '// ================================================================\n// 키보드 단축키'
  if (s.includes(needle)) s = s.replace(needle, helper + '\n' + needle)
  else s += helper
}

function addAfterOnce(search, insert, label) {
  if (s.includes(insert.trim())) return
  if (!s.includes(search)) {
    console.log('WARN call point not found: ' + label)
    return
  }
  s = s.replace(search, search + insert)
  console.log('PATCH ' + label)
}

addAfterOnce(
  '  bindUIEvents()\n',
  '  setTimeout(ensurePelvisPanelCollapseHardFix, 0) // PELVIS_PANEL_COLLAPSE_HARD_CALL_BIND\n',
  'pelvis collapse call after bindUIEvents'
)

addAfterOnce(
  '  initPelvisLabelControls()\n',
  '  ensurePelvisPanelCollapseHardFix() // PELVIS_PANEL_COLLAPSE_HARD_CALL_AFTER_INIT\n',
  'pelvis collapse call after initPelvisLabelControls'
)

addAfterOnce(
  "  console.log('[App] Ready.')\n",
  '  ensurePelvisPanelCollapseHardFix() // PELVIS_PANEL_COLLAPSE_HARD_CALL_READY\n',
  'pelvis collapse call before ready log'
)

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH hard collapsible pelvis label panel')
} else {
  console.log('OK hard collapsible pelvis label panel already patched')
}
