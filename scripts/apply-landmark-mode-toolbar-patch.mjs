#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// landmark-tools.js: put Polygon / Corner landmark / Centroid mode controls in
// the main canvas toolbar instead of the right sidebar panel.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  if (!s.includes('let modeToolbar = null')) {
    s = s.replace(
      `  let panel = null\n`,
      `  let panel = null\n  let modeToolbar = null\n`
    )
  }

  if (!s.includes('function activateToolbarMode(nextMode)')) {
    s = s.replace(
      `  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)\n`,
      `  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)\n\n  function activateToolbarMode(nextMode) {\n    if (nextMode === 'polygon') {\n      annotator.setPendingLandmark(null)\n      renderModeToolbar()\n      return\n    }\n    mode = nextMode === 'centroid' ? 'centroid' : 'corner'\n    sequenceIndex = findNextMissingIndex(annotator.landmarks, 0, getActiveSequence())\n    annotator.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)\n    renderModeToolbar()\n  }\n\n  function ensureModeToolbar() {\n    if (modeToolbar?.isConnected) return modeToolbar\n    const toolbar = document.querySelector('.canvas-toolbar')\n    if (!toolbar) return null\n    modeToolbar = document.getElementById('landmarkModeToolbar')\n    if (!modeToolbar) {\n      modeToolbar = document.createElement('div')\n      modeToolbar.id = 'landmarkModeToolbar'\n      modeToolbar.className = 'tool-group landmark-mode-toolbar'\n      modeToolbar.innerHTML = \`\n        <button type=\"button\" class=\"tool-btn landmark-mode-btn\" data-landmark-toolbar-mode=\"polygon\" title=\"일반 폴리곤 라벨링\">\n          <i class=\"fas fa-draw-polygon\"></i> 폴리곤\n        </button>\n        <button type=\"button\" class=\"tool-btn landmark-mode-btn\" data-landmark-toolbar-mode=\"corner\" title=\"LAT 꼭지점 4개 라벨링\">\n          <i class=\"fas fa-vector-square\"></i> 랜드마크\n        </button>\n        <button type=\"button\" class=\"tool-btn landmark-mode-btn\" data-landmark-toolbar-mode=\"centroid\" title=\"LAT 중심점 라벨링\">\n          <i class=\"fas fa-crosshairs\"></i> Centroid\n        </button>\n      \`\n      modeToolbar.addEventListener('click', (e) => {\n        const btn = e.target?.closest?.('[data-landmark-toolbar-mode]')\n        if (!btn) return\n        activateToolbarMode(btn.dataset.landmarkToolbarMode)\n      })\n      const statusGroup = toolbar.querySelector('.tool-info')\n      if (statusGroup?.nextSibling) toolbar.insertBefore(modeToolbar, statusGroup.nextSibling)\n      else toolbar.appendChild(modeToolbar)\n    }\n    return modeToolbar\n  }\n\n  function renderModeToolbar() {\n    const el = ensureModeToolbar()\n    if (!el) return\n    const isLat = String(getViewType?.() || '').toUpperCase() === 'LAT'\n    el.classList.toggle('hidden', !isLat)\n    const active = annotator.pendingLandmark ? mode : 'polygon'\n    el.querySelectorAll('[data-landmark-toolbar-mode]').forEach(btn => {\n      btn.classList.toggle('active', btn.dataset.landmarkToolbarMode === active)\n    })\n  }\n`
    )
  }

  if (!s.includes('renderModeToolbar()\n    renderPanel()')) {
    s = s.replace(
      `    this.updateStatus?.()\n    renderPanel()`,
      `    this.updateStatus?.()\n    renderModeToolbar()\n    renderPanel()`
    )
  }

  if (!s.includes('renderModeToolbar()\n  renderPanel()\n  return api')) {
    s = s.replace(
      `  const api = { refresh: renderPanel }\n  annotator.__lat5PointLandmarkApi = api\n  renderPanel()\n  return api`,
      `  const api = { refresh: () => { renderModeToolbar(); renderPanel() } }\n  annotator.__lat5PointLandmarkApi = api\n  renderModeToolbar()\n  renderPanel()\n  return api`
    )
  }

  save(file, before, s, 'canvas toolbar landmark modes')
}

// -----------------------------------------------------------------------------
// style.css: position the three mode buttons in the blank canvas toolbar area and
// hide the duplicate mode tabs from the right landmark panel.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* Canvas toolbar landmark mode switcher */
.canvas-toolbar .landmark-mode-toolbar {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.canvas-toolbar .landmark-mode-toolbar.hidden {
  display: none !important;
}
.canvas-toolbar .landmark-mode-btn {
  min-width: 84px;
  justify-content: center;
  border-color: var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
.canvas-toolbar .landmark-mode-btn.active {
  color: #fff;
  border-color: var(--accent-blue);
  background: var(--accent-blue);
}
.canvas-toolbar .landmark-mode-btn i {
  margin-right: 5px;
}
.landmark-panel .landmark-mode-tabs {
  display: none !important;
}
`
  if (!s.includes('Canvas toolbar landmark mode switcher')) s += css
  save(file, before, s, 'canvas toolbar landmark mode styles')
}

console.log('OK landmark mode toolbar patch installed')
