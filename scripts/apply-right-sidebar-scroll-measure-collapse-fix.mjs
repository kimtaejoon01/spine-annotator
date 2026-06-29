#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// measurements.js: make the angle panel collapsible again.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/measurements.js'
  const before = read(file)
  let s = before

  if (!s.includes('data-toggle-measure-panel')) {
    const oldHtml = `  panel.innerHTML = \`\n    <h3 class="panel-title"><i class="fas fa-ruler-combined"></i> 각도 계산</h3>\n    <div class="measurement-subtitle" data-measure-subtitle></div>\n    <div data-measure-body><p class="measurement-empty">라벨을 그리면 자동 계산합니다.</p></div>\n  \``
    const newHtml = `  panel.innerHTML = \`\n    <h3 class="panel-title measurement-title">\n      <span class="measurement-title-label"><i class="fas fa-ruler-combined"></i> 각도 계산</span>\n      <button type="button" class="panel-action-btn" data-toggle-measure-panel title="각도 계산 접기/펼치기">\n        <i class="fas fa-chevron-up"></i>\n      </button>\n    </h3>\n    <div class="measurement-content" data-measure-content>\n      <div class="measurement-subtitle" data-measure-subtitle></div>\n      <div data-measure-body><p class="measurement-empty">라벨을 그리면 자동 계산합니다.</p></div>\n    </div>\n  \``
    if (!s.includes(oldHtml)) throw new Error('measurement panel html block not found')
    s = s.replace(oldHtml, newHtml)
  }

  if (!s.includes('const MEASURE_PANEL_COLLAPSE_KEY')) {
    s = s.replace(
      `const DEFAULT_DECIMALS = 1\n`,
      `const DEFAULT_DECIMALS = 1\nconst MEASURE_PANEL_COLLAPSE_KEY = 'spine-annotator:measure-panel-collapsed'\n`
    )
  }

  if (!s.includes('bindMeasurementPanelCollapse(panel)')) {
    s = s.replace(
      `  panel.innerHTML =`,
      `  panel.innerHTML =`
    )
    s = s.replace(
      `  const pelvisPanel = document.getElementById('pelvisLabelPanel')`,
      `  bindMeasurementPanelCollapse(panel)\n\n  const pelvisPanel = document.getElementById('pelvisLabelPanel')`
    )
  }

  if (!s.includes('function bindMeasurementPanelCollapse(panel)')) {
    s = s.replace(
      `function missingHtml(missing) {`,
      `function bindMeasurementPanelCollapse(panel) {\n  const btn = panel.querySelector('[data-toggle-measure-panel]')\n  const icon = btn?.querySelector('i')\n  if (!btn || btn.dataset.bound === '1') return\n  btn.dataset.bound = '1'\n\n  const apply = (collapsed) => {\n    panel.classList.toggle('measurement-collapsed', collapsed)\n    if (icon) {\n      icon.classList.toggle('fa-chevron-up', !collapsed)\n      icon.classList.toggle('fa-chevron-down', collapsed)\n    }\n    btn.title = collapsed ? '각도 계산 펼치기' : '각도 계산 접기'\n  }\n\n  let collapsed = false\n  try { collapsed = localStorage.getItem(MEASURE_PANEL_COLLAPSE_KEY) === '1' } catch {}\n  apply(collapsed)\n\n  btn.addEventListener('click', (e) => {\n    e.preventDefault()\n    e.stopPropagation()\n    const next = !panel.classList.contains('measurement-collapsed')\n    apply(next)\n    try { localStorage.setItem(MEASURE_PANEL_COLLAPSE_KEY, next ? '1' : '0') } catch {}\n  })\n}\n\nfunction missingHtml(missing) {`
    )
  }

  save(file, before, s, 'measurement panel collapse restore')
}

// -----------------------------------------------------------------------------
// style.css: the previous right-sidebar layout repair used overflow:hidden, which
// was fine for two panels but breaks once measurement + landmark panels are added.
// Restore sidebar-level scrolling and keep long label lists internally bounded.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* Right sidebar scroll and measurement collapse fix */
.sidebar-right .sidebar-scroll {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  min-height: 0 !important;
  overscroll-behavior: contain;
}
.sidebar-right .panel-full {
  flex: 0 0 auto !important;
  min-height: 0 !important;
  overflow: visible !important;
}
.sidebar-right .panel-full .label-list {
  max-height: 32vh;
  overflow-y: auto !important;
  min-height: 80px;
}
.sagittal-measurement-panel .measurement-title {
  align-items: center;
  margin-bottom: 8px;
}
.sagittal-measurement-panel .measurement-title-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.sagittal-measurement-panel.measurement-collapsed .measurement-content {
  display: none !important;
}
.sagittal-measurement-panel.measurement-collapsed {
  padding-bottom: 10px;
}
`
  if (!s.includes('Right sidebar scroll and measurement collapse fix')) s += css
  save(file, before, s, 'right sidebar scroll restore')
}

console.log('OK right sidebar scroll + measurement collapse fix installed')
