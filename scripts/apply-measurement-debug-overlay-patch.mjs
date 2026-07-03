#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// measurements.js: expose the exact lines and points used for the numbers.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/measurements.js'
  const before = read(file)
  let s = before

  // Prefer LAT pelvis labels for sagittal PT/PI, with AP L/R labels as fallback.
  s = s.replace(
    "if (!hip) missing.push('PT/PI: HC_L/HC_R 또는 FH_L/FH_R')",
    "if (!hip) missing.push('PT/PI: LAT은 HC_LAT 또는 FH_LAT')"
  )
  s = s.replace(
    `function estimateHipCenter(byLabel) {\n  const hcL = labelPoint(byLabel, 'HC_L')`,
    `function estimateHipCenter(byLabel) {\n  const hcLat = labelPoint(byLabel, 'HC_LAT')\n  if (hcLat) return hcLat\n\n  const fhLat = labelPoint(byLabel, 'FH_LAT')\n  if (fhLat) return fhLat\n\n  const hcL = labelPoint(byLabel, 'HC_L')`
  )

  if (!s.includes('debug: buildMeasurementDebug')) {
    s = s.replace(
      `    lines,\n    missing: dedupe(missing),\n  }`,
      `    lines,\n    missing: dedupe(missing),\n    debug: buildMeasurementDebug(lines, hip),\n  }`
    )
  }

  if (!s.includes('data-toggle-measure-guides')) {
    s = s.replace(
      `    ${'${missingHtml(result.missing)}'}\n    <div class="measurement-actions">`,
      `    ${'${missingHtml(result.missing)}'}\n    <div class="measurement-toggle-row">\n      <label class="measurement-toggle"><input type="checkbox" data-toggle-measure-guides ${'${getMeasurementGuideOptions().enabled ? \'checked\' : \'\'}'} /> 측정선 보기</label>\n      <label class="measurement-toggle"><input type="checkbox" data-toggle-measure-labels ${'${getMeasurementGuideOptions().showLabels ? \'checked\' : \'\'}'} /> 선 이름 보기</label>\n      <label class="measurement-toggle"><input type="checkbox" data-toggle-measure-points ${'${getMeasurementGuideOptions().showPoints ? \'checked\' : \'\'}'} /> 기준점 보기</label>\n    </div>\n    <div class="measurement-actions">`
    )
  }

  if (!s.includes('bindMeasurementDebugControls(body, result)')) {
    s = s.replace(
      `  \`\n\n  const exportPayload = {`,
      `  \`\n\n  bindMeasurementDebugControls(body, result)\n  syncMeasurementDebugOverlay(result)\n\n  const exportPayload = {`
    )
  }

  if (!s.includes('syncMeasurementDebugOverlay(null)')) {
    s = s.replace(
      `    body.innerHTML = '<p class="measurement-empty">Sagittal alignment는 LAT 영상에서 계산합니다.</p>'\n    return`,
      `    body.innerHTML = '<p class="measurement-empty">Sagittal alignment는 LAT 영상에서 계산합니다.</p>'\n    syncMeasurementDebugOverlay(null)\n    return`
    )
    s = s.replace(
      `    body.innerHTML = \`<p class="measurement-empty">계산 가능한 라벨이 아직 없습니다.</p>${'${missingHtml(result.missing)}'}\`\n    return`,
      `    body.innerHTML = \`<p class="measurement-empty">계산 가능한 라벨이 아직 없습니다.</p>${'${missingHtml(result.missing)}'}\`\n    syncMeasurementDebugOverlay(result)\n    return`
    )
  }

  if (!s.includes('function buildMeasurementDebug')) {
    s = s.replace(
      `function measurement(key, name, value, note) {`,
      `function buildMeasurementDebug(lines, hip) {\n  const debug = { lineSegments: [], points: [] }\n  const addLine = (id, line, label, color, dashed = false, extend = 60) => {\n    if (!line || !line[0] || !line[1]) return\n    debug.lineSegments.push({ id, a: line[0], b: line[1], label, color, dashed, extend })\n  }\n  const addPoint = (id, p, label, color) => {\n    if (!p) return\n    debug.points.push({ id, p, label, color })\n  }\n\n  addLine('L1_sup', lines.L1_sup, 'L1 superior', '#60a5fa')\n  addLine('L4_sup', lines.L4_sup, 'L4 superior', '#34d399')\n  addLine('S1_sup', lines.S1_sup, 'S1 superior', '#f59e0b')\n  addLine('C2_inf', lines.C2_inf, 'C2 inferior', '#a78bfa')\n  addLine('C7_inf', lines.C7_inf, 'C7 inferior', '#c084fc')\n  addLine('T1_sup', lines.T1_sup, 'T1 superior', '#38bdf8')\n  addLine('T12_inf', lines.T12_inf, 'T12 inferior', '#22d3ee')\n\n  if (lines.S1_sup) {\n    const sacralMid = midpoint(lines.S1_sup)\n    addPoint('S1_mid', sacralMid, 'S1 mid', '#fbbf24')\n\n    const s1Vec = lineVectorMath(lines.S1_sup)\n    const normal = { x: -s1Vec.y, y: s1Vec.x }\n    const normalLen = Math.hypot(normal.x, normal.y) || 1\n    const len = 140\n    const normalEnd = {\n      x: sacralMid.x + (normal.x / normalLen) * len,\n      y: sacralMid.y - (normal.y / normalLen) * len,\n    }\n    debug.lineSegments.push({\n      id: 'S1_normal',\n      a: sacralMid,\n      b: normalEnd,\n      label: 'S1 normal',\n      color: '#ef4444',\n      dashed: true,\n      extend: 0,\n    })\n\n    if (hip) {\n      debug.lineSegments.push({\n        id: 'HIP_TO_S1',\n        a: hip,\n        b: sacralMid,\n        label: 'HC to S1 mid',\n        color: '#22c55e',\n        dashed: true,\n        extend: 0,\n      })\n    }\n  }\n\n  if (hip) addPoint('HIP', hip, 'HC', '#22c55e')\n  return debug\n}\n\nfunction getMeasurementGuideOptions() {\n  return {\n    enabled: getLocalBool('measurementGuidesEnabled', false),\n    showLabels: getLocalBool('measurementGuideLabels', true),\n    showPoints: getLocalBool('measurementGuidePoints', true),\n  }\n}\n\nfunction getLocalBool(key, fallback) {\n  try {\n    const v = localStorage.getItem(key)\n    if (v == null) return fallback\n    return v === '1'\n  } catch {\n    return fallback\n  }\n}\n\nfunction setLocalBool(key, value) {\n  try { localStorage.setItem(key, value ? '1' : '0') } catch {}\n}\n\nfunction bindMeasurementDebugControls(body, result) {\n  const guide = body.querySelector('[data-toggle-measure-guides]')\n  const labels = body.querySelector('[data-toggle-measure-labels]')\n  const points = body.querySelector('[data-toggle-measure-points]')\n  const bind = (el, key) => {\n    if (!el) return\n    el.addEventListener('change', () => {\n      setLocalBool(key, el.checked)\n      syncMeasurementDebugOverlay(result)\n    })\n  }\n  bind(guide, 'measurementGuidesEnabled')\n  bind(labels, 'measurementGuideLabels')\n  bind(points, 'measurementGuidePoints')\n}\n\nfunction syncMeasurementDebugOverlay(result) {\n  const annotator = window.__spineAnnotator\n  if (annotator && typeof annotator.setMeasurementDebugOverlay === 'function') {\n    annotator.setMeasurementDebugOverlay(result, getMeasurementGuideOptions())\n  }\n}\n\nfunction measurement(key, name, value, note) {`
    )
  }

  save(file, before, s, 'measurement debug geometry and controls')
}

// -----------------------------------------------------------------------------
// app.js: expose annotator instance so measurements.js can update the overlay.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (!s.includes('window.__spineAnnotator = state.annotator')) {
    s = s.replace(
      `  state.annotator = new SpineAnnotator({\n    container: 'canvasStage',\n    onPolygonsChange: handlePolygonsChange,\n    onZoomChange: handleZoomChange,\n    onStatusChange: handleStatusChange,\n  })`,
      `  state.annotator = new SpineAnnotator({\n    container: 'canvasStage',\n    onPolygonsChange: handlePolygonsChange,\n    onZoomChange: handleZoomChange,\n    onStatusChange: handleStatusChange,\n  })\n  window.__spineAnnotator = state.annotator`
    )
  }

  save(file, before, s, 'app measurement overlay bridge')
}

// -----------------------------------------------------------------------------
// annotator.js: draw measurement debug lines on a non-interactive Konva layer.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before

  if (!s.includes('this.measurementDebug =')) {
    s = s.replace(
      `    this.imageFilters = { brightness: 0, contrast: 0, invert: false }`,
      `    this.imageFilters = { brightness: 0, contrast: 0, invert: false }\n    this.measurementDebug = { enabled: false, showLabels: true, showPoints: true, result: null }`
    )
  }

  if (!s.includes('this.measurementLayer = new Konva.Layer')) {
    s = s.replace(
      `    this.previewLayer = new Konva.Layer()`,
      `    this.previewLayer = new Konva.Layer()\n    this.measurementLayer = new Konva.Layer({ listening: false })`
    )
    s = s.replace(
      `    this.stage.add(this.previewLayer)`,
      `    this.stage.add(this.previewLayer)\n    this.stage.add(this.measurementLayer)`
    )
  }

  if (!s.includes('this.renderMeasurementDebugOverlay?.()')) {
    s = s.replaceAll(
      `    this.stage.batchDraw()\n    this.notifyZoom()`,
      `    this.stage.batchDraw()\n    this.renderMeasurementDebugOverlay?.()\n    this.notifyZoom()`
    )
  }

  if (!s.includes('setMeasurementDebugOverlay(result')) {
    s = s.replace(
      `  // ============================================================\n  // 외부 접근용`,
      `  // ============================================================\n  // Measurement debug overlay\n  // ============================================================\n  setMeasurementDebugOverlay(result = null, options = {}) {\n    this.measurementDebug = {\n      ...(this.measurementDebug || {}),\n      ...(options || {}),\n      result: result || null,\n    }\n    this.renderMeasurementDebugOverlay()\n  }\n\n  renderMeasurementDebugOverlay() {\n    if (!this.measurementLayer) return\n    this.measurementLayer.destroyChildren()\n\n    const cfg = this.measurementDebug || {}\n    const debug = cfg.result?.debug\n    if (!cfg.enabled || !debug) {\n      this.measurementLayer.batchDraw()\n      return\n    }\n\n    const scale = Math.max(0.001, this.stage?.scaleX?.() || 1)\n\n    for (const seg of debug.lineSegments || []) {\n      const pts = measurementOverlaySegmentPoints(seg.a, seg.b, seg.extend || 0)\n      if (!pts) continue\n      this.measurementLayer.add(new Konva.Line({\n        points: pts,\n        stroke: seg.color || '#fbbf24',\n        strokeWidth: 2.5 / scale,\n        dash: seg.dashed ? [8 / scale, 5 / scale] : undefined,\n        opacity: 0.95,\n        listening: false,\n      }))\n      if (cfg.showLabels !== false && seg.label) {\n        this.addMeasurementDebugLabel(seg.label, {\n          x: (pts[0] + pts[2]) / 2,\n          y: (pts[1] + pts[3]) / 2,\n        }, seg.color || '#fbbf24', scale)\n      }\n    }\n\n    if (cfg.showPoints !== false) {\n      for (const pt of debug.points || []) {\n        if (!measurementOverlayValidPoint(pt.p)) continue\n        this.measurementLayer.add(new Konva.Circle({\n          x: pt.p.x,\n          y: pt.p.y,\n          radius: 5 / scale,\n          fill: pt.color || '#ffffff',\n          stroke: '#0f172a',\n          strokeWidth: 1.5 / scale,\n          opacity: 0.98,\n          listening: false,\n        }))\n        if (cfg.showLabels !== false && pt.label) {\n          this.addMeasurementDebugLabel(pt.label, { x: pt.p.x + 8 / scale, y: pt.p.y - 8 / scale }, pt.color || '#ffffff', scale)\n        }\n      }\n    }\n\n    this.measurementLayer.batchDraw()\n  }\n\n  addMeasurementDebugLabel(text, point, color, scale) {\n    const label = new Konva.Label({ x: point.x, y: point.y, listening: false })\n    label.add(new Konva.Tag({\n      fill: 'rgba(15, 23, 42, 0.86)',\n      stroke: color,\n      strokeWidth: 1 / scale,\n      cornerRadius: 4 / scale,\n      listening: false,\n    }))\n    label.add(new Konva.Text({\n      text,\n      fontSize: 12 / scale,\n      fontStyle: 'bold',\n      fill: '#ffffff',\n      padding: 4 / scale,\n      listening: false,\n    }))\n    this.measurementLayer.add(label)\n  }\n\n  // ============================================================\n  // 외부 접근용`
    )
  }

  if (!s.includes('measurementLayer.destroyChildren()')) {
    s = s.replace(
      `    this.polyLayer.destroyChildren()\n    this.polyLayer.batchDraw()`,
      `    this.polyLayer.destroyChildren()\n    if (this.measurementLayer) this.measurementLayer.destroyChildren()\n    this.polyLayer.batchDraw()\n    if (this.measurementLayer) this.measurementLayer.batchDraw()`
    )
  }

  if (!s.includes('function measurementOverlayValidPoint')) {
    s = s.replace(
      `// ================================================================\n// 기하학 유틸`,
      `function measurementOverlayValidPoint(p) {\n  return p && Number.isFinite(p.x) && Number.isFinite(p.y)\n}\n\nfunction measurementOverlaySegmentPoints(a, b, extend = 0) {\n  if (!measurementOverlayValidPoint(a) || !measurementOverlayValidPoint(b)) return null\n  const dx = b.x - a.x\n  const dy = b.y - a.y\n  const len = Math.hypot(dx, dy)\n  if (!len) return null\n  const ex = extend ? (dx / len) * extend : 0\n  const ey = extend ? (dy / len) * extend : 0\n  return [a.x - ex, a.y - ey, b.x + ex, b.y + ey]\n}\n\n// ================================================================\n// 기하학 유틸`
    )
  }

  save(file, before, s, 'annotator measurement debug overlay')
}

// -----------------------------------------------------------------------------
// style.css: compact controls for the guide-line toggles.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* Measurement debug overlay controls */
.measurement-toggle-row {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}
.measurement-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  user-select: none;
}
.measurement-toggle input {
  margin: 0;
}
.sidebar-right.right-sidebar-compact .measurement-toggle-row {
  display: none;
}
`
  if (!s.includes('Measurement debug overlay controls')) s += css
  save(file, before, s, 'measurement debug overlay styles')
}

console.log('OK measurement debug overlay patch installed')
