#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

function replaceFunction(source, name, replacement) {
  const start = source.indexOf(`  function ${name}(`)
  if (start < 0) return source
  const open = source.indexOf('{', start)
  let depth = 0
  let quote = null
  let escape = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(i + 1)
    }
  }
  return source
}

function replaceAssignmentFunction(source, lhs, replacement, nextMarker) {
  const start = source.indexOf(lhs)
  if (start < 0) return source
  const open = source.indexOf('{', start)
  let depth = 0
  let quote = null
  let escape = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        let end = i + 1
        while (source[end] === '\n' || source[end] === '\r') end++
        return source.slice(0, start) + replacement + source.slice(end)
      }
    }
  }
  return source
}

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  if (!s.includes('function getDisplayMode()')) {
    s = s.replace(
      `  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)\n`,
      `  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)\n\n  function getDisplayMode() {\n    return annotator.pendingLandmark ? mode : 'polygon'\n  }\n\n  function updateModeVisibility() {\n    const displayMode = getDisplayMode()\n    annotator.polyLayer?.visible?.(displayMode === 'polygon')\n    annotator.landmarkLayer?.visible?.(displayMode !== 'polygon')\n    if (displayMode !== 'polygon') {\n      annotator.landmarkLayer?.show?.()\n      annotator.landmarkLayer?.moveToTop?.()\n    }\n    annotator.stage?.batchDraw?.()\n  }\n`
    )
  }

  s = replaceFunction(s, 'activateToolbarMode', `  function activateToolbarMode(nextMode) {
    if (nextMode === 'polygon') {
      annotator.setPendingLandmark(null)
      renderModeToolbar()
      updateModeVisibility()
      return
    }
    mode = nextMode === 'centroid' ? 'centroid' : 'corner'
    sequenceIndex = findNextMissingIndex(annotator.landmarks, 0, getActiveSequence())
    annotator.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)
    renderModeToolbar()
    updateModeVisibility()
  }`)

  if (!s.includes('updateModeVisibility()\n  }\n\n  annotator.setLandmarkMode')) {
    s = s.replace(
      `    this.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)\n  }\n\n  annotator.setLandmark`,
      `    this.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)\n    updateModeVisibility()\n  }\n\n  annotator.setLandmark`
    )
  }

  s = replaceAssignmentFunction(s, '  annotator.renderLandmarks = function renderLandmarks() {', `  annotator.renderLandmarks = function renderLandmarks() {
    if (!this.landmarkLayer) return
    this.landmarkLayer.destroyChildren()
    const displayMode = getDisplayMode()
    if (displayMode === 'polygon') {
      this.landmarkLayer.visible(false)
      this.landmarkLayer.batchDraw()
      return
    }
    this.landmarkLayer.visible(true)
    this.landmarkLayer.moveToTop?.()
    const scale = Math.max(0.001, this.stage.scaleX() || 1)
    const byLabel = new Map((this.landmarks || []).map(l => [String(l.label || '').toUpperCase(), l]))

    if (displayMode === 'corner') {
      for (const v of VERTEBRAE_FULL) {
        const labels = [\`\${v}_SUP_ANT\`, \`\${v}_SUP_POST\`, \`\${v}_INF_POST\`, \`\${v}_INF_ANT\`]
        const pts = labels.map(label => byLabel.get(label)).filter(Boolean)
        if (pts.length === 4) {
          const flat = pts.flatMap(p => [p.x, p.y])
          const color = landmarkColor(labels[0])
          this.landmarkLayer.add(new Konva.Line({
            points: flat,
            closed: true,
            fill: color + '42',
            stroke: color,
            strokeWidth: 1.4 / scale,
            opacity: 0.95,
            listening: false,
          }))
          const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length
          const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length
          const text = new Konva.Text({
            x: cx,
            y: cy,
            text: v,
            fontSize: 8 / scale,
            fontStyle: 'bold',
            fill: '#ffffff',
            stroke: '#0f172a',
            strokeWidth: 1.2 / scale,
            listening: false,
          })
          text.offsetX(text.width() / 2)
          text.offsetY(text.height() / 2)
          this.landmarkLayer.add(text)
        } else {
          for (const p of pts) addTinyLandmarkPoint(this.landmarkLayer, p, scale)
        }
      }
    } else if (displayMode === 'centroid') {
      for (const lm of this.landmarks || []) {
        const label = String(lm.label || '').toUpperCase()
        if (!label.includes('CENTER') && label !== 'HC_LAT') continue
        addTinyLandmarkPoint(this.landmarkLayer, lm, scale, displayLandmarkLabel(label, true))
      }
    }
    this.landmarkLayer.batchDraw()
  }

  function addTinyLandmarkPoint(layer, lm, scale, labelText = '') {
    if (!lm || !Number.isFinite(Number(lm.x)) || !Number.isFinite(Number(lm.y))) return
    const label = String(lm.label || '').toUpperCase()
    const r = 2.2 / scale
    const group = new Konva.Group({ x: Number(lm.x), y: Number(lm.y), draggable: true, landmarkLabel: label })
    group.add(new Konva.Circle({
      radius: r,
      fill: landmarkColor(label),
      stroke: '#0f172a',
      strokeWidth: 0.6 / scale,
    }))
    if (labelText) {
      const text = new Konva.Text({
        x: 3 / scale,
        y: -3 / scale,
        text: labelText,
        fontSize: 5 / scale,
        fontStyle: 'bold',
        fill: '#ffffff',
        stroke: '#0f172a',
        strokeWidth: 0.7 / scale,
      })
      group.add(text)
    }
    group.on('dragmove', () => {
      const pos = group.position()
      lm.x = pos.x
      lm.y = pos.y
      layer.batchDraw()
    })
    group.on('dragend', () => {
      annotator.renderLandmarks()
      annotator.__lat5PointLandmarkOnChange?.()
    })
    group.on('dblclick contextmenu', (e) => {
      e.evt?.preventDefault?.()
      e.cancelBubble = true
      annotator.deleteLandmark(label)
    })
    layer.add(group)
  }
`)

  if (!s.includes('annotator.__lat5PointLandmarkOnChange = onChange')) {
    s = s.replace(
      `  annotator.__lat5PointLandmarksInstalled = true\n`,
      `  annotator.__lat5PointLandmarksInstalled = true\n  annotator.__lat5PointLandmarkOnChange = onChange\n`
    )
  }

  if (!s.includes('updateModeVisibility()\n    renderPanel()')) {
    s = s.replace(
      `    renderModeToolbar()\n    renderPanel()`,
      `    renderModeToolbar()\n    updateModeVisibility()\n    renderPanel()`
    )
  }

  if (!s.includes('updateModeVisibility(); renderPanel()')) {
    s = s.replace(
      `  const api = { refresh: () => { renderModeToolbar(); renderPanel() } }`,
      `  const api = { refresh: () => { renderModeToolbar(); updateModeVisibility(); renderPanel() } }`
    )
  }

  save(file, before, s, 'mode-isolated landmark polygon fill renderer')
}

{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* Mode isolation: only show the active annotation family */
.canvas-toolbar .landmark-mode-btn.active {
  color: #fff;
  border-color: var(--accent-blue);
  background: var(--accent-blue);
}
`
  if (!s.includes('Mode isolation: only show the active annotation family')) s += css
  save(file, before, s, 'mode-isolated landmark styles')
}

console.log('OK mode-isolated polygon-fill landmark patch installed')
