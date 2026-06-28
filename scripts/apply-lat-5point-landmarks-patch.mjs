#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// app.js: install the LAT 5-point landmark panel and save/load landmarks.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (!s.includes("from './landmark-tools.js'")) {
    s = s.replace(
      "import { exportToCOCO } from './coco.js'\n",
      "import { exportToCOCO } from './coco.js'\nimport { installLat5PointLandmarks } from './landmark-tools.js'\n"
    )
  }

  if (!s.includes('landmarkApi: null')) {
    s = s.replace(
      `  labelVersion: null,\n`,
      `  labelVersion: null,\n  landmarkApi: null,\n`
    )
  }

  if (!s.includes('installLat5PointLandmarks({')) {
    s = s.replace(
      `  state.annotator = new SpineAnnotator({\n    container: 'canvasStage',\n    onPolygonsChange: handlePolygonsChange,\n    onZoomChange: handleZoomChange,\n    onStatusChange: handleStatusChange,\n  })`,
      `  state.annotator = new SpineAnnotator({\n    container: 'canvasStage',\n    onPolygonsChange: handlePolygonsChange,\n    onZoomChange: handleZoomChange,\n    onStatusChange: handleStatusChange,\n  })\n  state.landmarkApi = installLat5PointLandmarks({\n    annotator: state.annotator,\n    getViewType: () => state.viewType,\n    onChange: () => autoSave(),\n  })`
    )
  }

  if (!s.includes('const landmarks = state.annotator.getLandmarks')) {
    s = s.replace(
      `    const polygons = state.annotator.getPolygons()\n`,
      `    const polygons = state.annotator.getPolygons()\n    const landmarks = state.annotator.getLandmarks?.() || []\n`
    )
    s = s.replace(
      `      polygons,\n      labeler_id: labelerId,`,
      `      polygons,\n      landmarks,\n      labeler_id: labelerId,`
    )
  }

  if (!s.includes('state.annotator.loadLandmarks?.(Array.isArray(data.landmarks)')) {
    s = s.replace(
      `      state.annotator.loadPolygons([])\n      // 이 시점 이후 다른 사람이 수정하면 알림`,
      `      state.annotator.loadPolygons([])\n      state.annotator.loadLandmarks?.([])\n      // 이 시점 이후 다른 사람이 수정하면 알림`
    )
    s = s.replace(
      `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])\n    // 방금 본 서버 버전 기준점 저장`,
      `    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])\n    state.annotator.loadLandmarks?.(Array.isArray(data.landmarks) ? data.landmarks : [])\n    // 방금 본 서버 버전 기준점 저장`
    )
    s = s.replace(
      `    state.annotator.loadPolygons([])\n  } finally {`,
      `    state.annotator.loadPolygons([])\n    state.annotator.loadLandmarks?.([])\n  } finally {`
    )
  }

  if (!s.includes('state.landmarkApi?.refresh?.()')) {
    s = s.replace(
      `  state.imageHeight = state.annotator.imageHeight\n}`,
      `  state.imageHeight = state.annotator.imageHeight\n  state.landmarkApi?.refresh?.()\n}`
    )
  }

  // Sagittal measurement panel should use landmarks when available.
  if (!s.includes('landmarks: state.annotator?.getLandmarks?.() || []')) {
    s = s.replaceAll(
      `    viewType: state.viewType,\n  })`,
      `    viewType: state.viewType,\n    landmarks: state.annotator?.getLandmarks?.() || [],\n  })`
    )
  }

  save(file, before, s, 'app LAT 5-point landmarks')
}

// -----------------------------------------------------------------------------
// measurements.js: prefer explicit landmark endplate lines over polygon guessing.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/measurements.js'
  const before = read(file)
  let s = before

  s = s.replace(
    `export function calculateSagittalMeasurements(polygons = []) {`,
    `export function calculateSagittalMeasurements(polygons = [], landmarks = []) {`
  )

  if (!s.includes('const byLandmark = buildLandmarkMap(landmarks)')) {
    s = s.replace(
      `  const getPoly = (label) => chooseLargestPolygon(byLabel.get(label) || [])\n`,
      `  const byLandmark = buildLandmarkMap(landmarks)\n  const getPoly = (label) => chooseLargestPolygon(byLabel.get(label) || [])\n`
    )
  }

  s = s.replace(
    `  if (s1) lines.S1_sup = estimateEndplateLine(s1.points, 'superior')`,
    `  lines.S1_sup = landmarkLine(byLandmark, 'S1_SUP_POST', 'S1_SUP_ANT') || (s1 ? estimateEndplateLine(s1.points, 'superior') : null)`
  )
  s = s.replace(
    `  if (l1) lines.L1_sup = estimateEndplateLine(l1.points, 'superior')`,
    `  lines.L1_sup = landmarkLine(byLandmark, 'L1_SUP_POST', 'L1_SUP_ANT') || (l1 ? estimateEndplateLine(l1.points, 'superior') : null)`
  )
  s = s.replace(
    `  if (l4) lines.L4_sup = estimateEndplateLine(l4.points, 'superior')`,
    `  lines.L4_sup = landmarkLine(byLandmark, 'L4_SUP_POST', 'L4_SUP_ANT') || (l4 ? estimateEndplateLine(l4.points, 'superior') : null)`
  )
  s = s.replace(
    `  if (c2) lines.C2_inf = estimateEndplateLine(c2.points, 'inferior')`,
    `  lines.C2_inf = landmarkLine(byLandmark, 'C2_INF_POST', 'C2_INF_ANT') || (c2 ? estimateEndplateLine(c2.points, 'inferior') : null)`
  )
  s = s.replace(
    `  if (c7) lines.C7_inf = estimateEndplateLine(c7.points, 'inferior')`,
    `  lines.C7_inf = landmarkLine(byLandmark, 'C7_INF_POST', 'C7_INF_ANT') || (c7 ? estimateEndplateLine(c7.points, 'inferior') : null)`
  )
  s = s.replace(
    `  if (t1) lines.T1_sup = estimateEndplateLine(t1.points, 'superior')`,
    `  lines.T1_sup = landmarkLine(byLandmark, 'T1_SUP_POST', 'T1_SUP_ANT') || (t1 ? estimateEndplateLine(t1.points, 'superior') : null)`
  )
  s = s.replace(
    `  if (t12) lines.T12_inf = estimateEndplateLine(t12.points, 'inferior')`,
    `  lines.T12_inf = landmarkLine(byLandmark, 'T12_INF_POST', 'T12_INF_ANT') || (t12 ? estimateEndplateLine(t12.points, 'inferior') : null)`
  )

  s = s.replace(
    `  const hip = estimateHipCenter(byLabel)`,
    `  const hip = landmarkPoint(byLandmark, 'HC_LAT') || estimateHipCenter(byLabel)`
  )

  s = s.replace(
    `  const result = calculateSagittalMeasurements(polygons)`,
    `  const result = calculateSagittalMeasurements(polygons, context.landmarks || [])`
  )

  if (!s.includes('function buildLandmarkMap(landmarks)')) {
    s = s.replace(
      `function measurement(key, name, value, note) {`,
      `function buildLandmarkMap(landmarks) {\n  const map = new Map()\n  for (const lm of Array.isArray(landmarks) ? landmarks : []) {\n    const label = String(lm?.label || '').trim().toUpperCase()\n    const x = Number(lm?.x)\n    const y = Number(lm?.y)\n    if (!label || !Number.isFinite(x) || !Number.isFinite(y)) continue\n    map.set(label, { x, y, label })\n  }\n  return map\n}\n\nfunction landmarkPoint(byLandmark, label) {\n  return byLandmark?.get?.(String(label || '').toUpperCase()) || null\n}\n\nfunction landmarkLine(byLandmark, aLabel, bLabel) {\n  const a = landmarkPoint(byLandmark, aLabel)\n  const b = landmarkPoint(byLandmark, bLabel)\n  if (!a || !b) return null\n  return a.x <= b.x ? [a, b] : [b, a]\n}\n\nfunction measurement(key, name, value, note) {`
    )
  }

  save(file, before, s, 'measurements use LAT 5-point landmarks')
}

// -----------------------------------------------------------------------------
// src/api.ts: store landmarks next to polygons while reading legacy arrays.
// -----------------------------------------------------------------------------
{
  const file = 'src/api.ts'
  const before = read(file)
  let s = before

  if (!s.includes('function parseStoredLabelData')) {
    s = s.replace(
      `function generateCocoCategories() {`,
      `function parseStoredLabelData(raw: string | null | undefined) {\n  let parsed: any = []\n  try { parsed = JSON.parse(raw || '[]') } catch {}\n  if (Array.isArray(parsed)) return { polygons: parsed, landmarks: [] }\n  return {\n    polygons: Array.isArray(parsed?.polygons) ? parsed.polygons : [],\n    landmarks: Array.isArray(parsed?.landmarks) ? parsed.landmarks : [],\n  }\n}\n\nfunction generateCocoCategories() {`
    )
  }

  if (!s.includes('const landmarks = Array.isArray(body.landmarks)')) {
    s = s.replace(
      `  const polygons = Array.isArray(body.polygons) ? body.polygons : []\n  const polygonsJson = JSON.stringify(polygons)`,
      `  const polygons = Array.isArray(body.polygons) ? body.polygons : []\n  const landmarks = Array.isArray(body.landmarks) ? body.landmarks : []\n  const polygonsJson = landmarks.length > 0 ? JSON.stringify({ polygons, landmarks }) : JSON.stringify(polygons)`
    )
    s = s.replace(
      `    if (polyCount === 0 && !existing) {`,
      `    if (polyCount === 0 && landmarks.length === 0 && !existing) {`
    )
  }

  if (!s.includes('let landmarks: any[] = []')) {
    s = s.replace(
      `    let polygons: any[] = []\n    try {\n      polygons = JSON.parse(row.polygons_json || '[]')\n    } catch {}`,
      `    let polygons: any[] = []\n    let landmarks: any[] = []\n    const parsed = parseStoredLabelData(row.polygons_json)\n    polygons = parsed.polygons\n    landmarks = parsed.landmarks`
    )
    s = s.replace(
      `      polygons,\n      labeler_id: row.labeler_id,`,
      `      polygons,\n      landmarks,\n      labeler_id: row.labeler_id,`
    )
  }

  if (!s.includes('items: rows.map(row =>')) {
    s = s.replace(
      `    if (format === 'raw') {\n      return c.json({ ok: true, items: rows })\n    }`,
      `    if (format === 'raw') {\n      return c.json({ ok: true, items: rows.map(row => {\n        const parsed = parseStoredLabelData(row.polygons_json)\n        return { ...row, polygons: parsed.polygons, landmarks: parsed.landmarks }\n      }) })\n    }`
    )
  }

  s = s.replace(
    `      const polygons = JSON.parse(row.polygons_json || '[]')`,
    `      const polygons = parseStoredLabelData(row.polygons_json).polygons`
  )

  save(file, before, s, 'api polygons plus landmarks storage')
}

// -----------------------------------------------------------------------------
// style.css: right-panel controls for the 5-point landmark workflow.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* LAT 5-point landmark panel */
.landmark-panel .landmark-progress {
  margin: -3px 0 8px;
  color: var(--text-muted);
  font-size: 11px;
}
.landmark-current {
  display: grid;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
  margin-bottom: 8px;
}
.landmark-current span {
  color: var(--text-muted);
  font-size: 10px;
}
.landmark-current strong {
  color: var(--text-primary);
  font-size: 12px;
  word-break: break-all;
}
.landmark-current.active {
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 1px rgba(88,166,255,.25) inset;
}
.landmark-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 6px;
}
.landmark-actions button {
  min-height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
}
.landmark-actions button:hover {
  border-color: var(--accent-blue);
  background: rgba(88,166,255,.14);
}
.landmark-actions-danger button {
  grid-column: 1 / -1;
  color: var(--danger-color, #ff7b72);
}
.landmark-help,
.landmark-empty {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
}
.sidebar-right.right-sidebar-compact .landmark-panel .landmark-progress,
.sidebar-right.right-sidebar-compact .landmark-panel .landmark-current,
.sidebar-right.right-sidebar-compact .landmark-panel .landmark-actions,
.sidebar-right.right-sidebar-compact .landmark-panel .landmark-help,
.sidebar-right.right-sidebar-compact .landmark-panel .landmark-empty {
  display: none;
}
`
  if (!s.includes('LAT 5-point landmark panel')) s += css
  save(file, before, s, 'LAT 5-point landmark styles')
}

console.log('OK LAT 5-point landmark patch installed')
