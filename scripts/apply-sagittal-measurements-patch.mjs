#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// app.js: wire sagittal measurement panel into polygon updates.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (!s.includes("from './measurements.js'")) {
    s = s.replace(
      "import { exportToCOCO } from './coco.js'\n",
      "import { exportToCOCO } from './coco.js'\nimport { renderSagittalMeasurementPanel } from './measurements.js'\n"
    )
  }

  if (!s.includes('renderSagittalMeasurementPanel(polygons')) {
    const needle = `\n  // 자동 저장 (LocalStorage)\n  autoSave()\n`
    const insert = `\n  renderSagittalMeasurementPanel(polygons, {\n    filename: state.filename,\n    viewType: state.viewType,\n  })\n`
    if (!s.includes(needle)) throw new Error('handlePolygonsChange autosave needle not found')
    s = s.replace(needle, insert + needle)
  }

  if (s.includes("  console.log('[App] Ready.')\n") && !s.includes("renderSagittalMeasurementPanel(state.annotator?.getPolygons?.()")) {
    s = s.replace(
      "  console.log('[App] Ready.')\n",
      "  renderSagittalMeasurementPanel(state.annotator?.getPolygons?.() || [], {\n    filename: state.filename,\n    viewType: state.viewType,\n  })\n  console.log('[App] Ready.')\n"
    )
  }

  save(file, before, s, 'app sagittal measurement panel')
}

// -----------------------------------------------------------------------------
// CSS: sagittal measurement panel.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* Sagittal measurement panel */
.sagittal-measurement-panel .measurement-subtitle {
  margin: -4px 0 8px;
  color: var(--text-muted);
  font-size: 11px;
  word-break: break-all;
}
.measurement-grid {
  display: grid;
  gap: 5px;
}
.measurement-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-tertiary);
}
.measurement-key {
  font-weight: 800;
  font-size: 12px;
  color: var(--accent-blue);
}
.measurement-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 11px;
}
.measurement-value {
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  color: var(--text-primary);
  font-size: 12px;
}
.measurement-empty,
.measurement-missing,
.measurement-help {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
}
.measurement-missing {
  color: var(--warning-color, #fbbf24);
}
.measurement-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.measurement-btn {
  flex: 1;
  min-height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
}
.measurement-btn:hover {
  border-color: var(--accent-blue);
  background: rgba(88,166,255,.14);
}
.sidebar-right.right-sidebar-compact .sagittal-measurement-panel .measurement-subtitle,
.sidebar-right.right-sidebar-compact .sagittal-measurement-panel .measurement-name,
.sidebar-right.right-sidebar-compact .sagittal-measurement-panel .measurement-help,
.sidebar-right.right-sidebar-compact .sagittal-measurement-panel .measurement-missing,
.sidebar-right.right-sidebar-compact .sagittal-measurement-panel .measurement-actions {
  display: none;
}
.sidebar-right.right-sidebar-compact .sagittal-measurement-panel .measurement-row {
  grid-template-columns: 1fr;
  justify-items: center;
  gap: 2px;
}
`

  if (!s.includes('Sagittal measurement panel')) s += css
  save(file, before, s, 'sagittal measurement styles')
}

console.log('OK sagittal measurements patch installed')
