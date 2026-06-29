#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// landmark-tools.js: collapsible panel, E delete shortcut, remove Q next-vertebra.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  if (!s.includes("const LANDMARK_PANEL_COLLAPSE_KEY = 'spine-annotator:lat-landmark-panel-collapsed'")) {
    s = s.replace(
      `const LANDMARK_UI_VERSION = 'lat-corner-centroid-v3'`,
      `const LANDMARK_UI_VERSION = 'lat-corner-centroid-v3'\nconst LANDMARK_PANEL_COLLAPSE_KEY = 'spine-annotator:lat-landmark-panel-collapsed'`
    )
  }

  // Remove the Q shortcut block for jumping to the next vertebra.
  if (s.includes("if (String(e.key || '').toLowerCase() !== 'q') return")) {
    const re = /\n  const keyHandler = \(e\) => \{[\s\S]*?\n  window\.addEventListener\('keydown', keyHandler, true\)\n/
    if (!re.test(s)) throw new Error('Q key handler block not found')
    s = s.replace(re, '\n')
  }

  // Add E shortcut for deleting the currently active landmark point.
  if (!s.includes('const deleteKeyHandler = (e) =>')) {
    s = s.replace(
      `  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)\n`,
      `  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)\n\n  const deleteKeyHandler = (e) => {\n    if (window._capturingShortcut) return\n    if (!annotator.pendingLandmark) return\n    if (String(getViewType?.() || '').toUpperCase() !== 'LAT') return\n    const tag = String(document.activeElement?.tagName || '').toUpperCase()\n    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return\n    if (String(e.key || '').toLowerCase() !== 'e') return\n    e.preventDefault()\n    e.stopPropagation()\n    annotator.deleteLandmark(annotator.pendingLandmark)\n  }\n  window.addEventListener('keydown', deleteKeyHandler, true)\n`
    )
  }

  // Make the LAT panel title collapsible and wrap the panel body.
  if (!s.includes('data-toggle-landmark-panel')) {
    s = s.replace(
      `<h3 class="panel-title"><i class="fas fa-map-pin"></i> LAT 랜드마크</h3>\n      <div class="landmark-mode-tabs">`,
      `<h3 class="panel-title landmark-title">\n        <span><i class="fas fa-map-pin"></i> LAT 랜드마크</span>\n        <button type="button" class="panel-action-btn" data-toggle-landmark-panel title="랜드마크 메뉴 접기/펼치기">\n          <i class="fas fa-chevron-up"></i>\n        </button>\n      </h3>\n      <div class="landmark-panel-content" data-landmark-panel-content>\n      <div class="landmark-mode-tabs">`
    )
    s = s.replace(
      `<p class="landmark-help">꼭지점 모드: 1 위-왼쪽 → 2 위-오른쪽 → 3 아래-오른쪽 → 4 아래-왼쪽. 4개를 찍으면 자동으로 다음 척추로 넘어갑니다. Q는 현재 척추를 끝내고 다음 척추로 이동합니다. 중심점은 Centroid 모드에서 따로 찍습니다.</p>\n    \``,
      `<p class="landmark-help">꼭지점 모드: 1 위-왼쪽 → 2 위-오른쪽 → 3 아래-오른쪽 → 4 아래-왼쪽. 4개를 찍으면 자동으로 다음 척추로 넘어갑니다. 중심점은 Centroid 모드에서 따로 찍습니다. 현재 점 삭제 단축키는 E입니다.</p>\n      </div>\n    \``
    )
  }

  // Remove the next vertebra button and handler.
  s = s.replace(
    `        <button type="button" data-lm-next-target>다음 척추(Q)</button>\n`,
    ``
  )
  s = s.replace(
    `    el.querySelector('[data-lm-next-target]')?.addEventListener('click', jumpToNextTarget)\n`,
    ``
  )

  if (!s.includes('bindLatLandmarkPanelCollapse(el)')) {
    s = s.replace(
      `    el.querySelectorAll('[data-lm-mode]')?.forEach(btn => {`,
      `    bindLatLandmarkPanelCollapse(el)\n\n    el.querySelectorAll('[data-lm-mode]')?.forEach(btn => {`
    )
  }

  if (!s.includes('function bindLatLandmarkPanelCollapse(panel)')) {
    s = s.replace(
      `function findNextMissingIndex(landmarks, start, sequence = LAT_4CORNER_SEQUENCE) {`,
      `function bindLatLandmarkPanelCollapse(panel) {\n  const btn = panel.querySelector('[data-toggle-landmark-panel]')\n  const icon = btn?.querySelector('i')\n  if (!btn || btn.dataset.bound === '1') return\n  btn.dataset.bound = '1'\n\n  const apply = (collapsed) => {\n    panel.classList.toggle('landmark-collapsed', collapsed)\n    if (icon) {\n      icon.classList.toggle('fa-chevron-up', !collapsed)\n      icon.classList.toggle('fa-chevron-down', collapsed)\n    }\n    btn.title = collapsed ? '랜드마크 메뉴 펼치기' : '랜드마크 메뉴 접기'\n  }\n\n  let collapsed = false\n  try { collapsed = localStorage.getItem(LANDMARK_PANEL_COLLAPSE_KEY) === '1' } catch {}\n  apply(collapsed)\n\n  btn.addEventListener('click', (e) => {\n    e.preventDefault()\n    e.stopPropagation()\n    const next = !panel.classList.contains('landmark-collapsed')\n    apply(next)\n    try { localStorage.setItem(LANDMARK_PANEL_COLLAPSE_KEY, next ? '1' : '0') } catch {}\n  })\n}\n\nfunction findNextMissingIndex(landmarks, start, sequence = LAT_4CORNER_SEQUENCE) {`
    )
  }

  save(file, before, s, 'LAT landmark collapse + E delete + remove Q')
}

// -----------------------------------------------------------------------------
// style.css: collapsed landmark panel and mode tab polish.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* LAT landmark collapse and shortcut polish */
.landmark-panel .landmark-title {
  align-items: center;
  margin-bottom: 8px;
}
.landmark-panel .landmark-title > span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.landmark-panel.landmark-collapsed .landmark-panel-content {
  display: none !important;
}
.landmark-panel.landmark-collapsed {
  padding-bottom: 10px;
}
.landmark-panel .landmark-mode-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}
.landmark-panel .landmark-mode-tabs button {
  min-height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}
.landmark-panel .landmark-mode-tabs button.active {
  color: var(--text-primary);
  border-color: var(--accent-blue);
  background: rgba(88,166,255,.16);
}
.landmark-panel .landmark-warning {
  margin: 6px 0 8px;
  color: var(--accent-orange);
  font-size: 11px;
  line-height: 1.35;
}
`
  if (!s.includes('LAT landmark collapse and shortcut polish')) s += css
  save(file, before, s, 'LAT landmark collapse styles')
}

console.log('OK LAT landmark collapse/delete-key patch installed')
