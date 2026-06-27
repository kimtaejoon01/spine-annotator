#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/annotator.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

function replaceIfFound(label, from, to) {
  if (s.includes(to)) {
    console.log('OK ' + label + ' already patched')
    return
  }
  if (!s.includes(from)) {
    console.log('WARN patch point not found, skipped: ' + label)
    return
  }
  s = s.replace(from, to)
  console.log('PATCH ' + label)
}

function findMethodBlock(source, methodName) {
  const re = new RegExp('\\n  ' + methodName + '\\s*\\([^)]*\\)\\s*\\{')
  const m = source.match(re)
  if (!m || m.index == null) return null
  const start = m.index + 1
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
        return { start, end }
      }
    }
  }
  return null
}

// If canvas size or zoom changes, visual size of strokes/labels must be recalculated.
replaceIfFound(
  'resize rerender polygons',
  `  resize() {
    const rect = this.containerEl.getBoundingClientRect()
    this.stage.width(rect.width)
    this.stage.height(rect.height)
  }`,
  `  resize() {
    const rect = this.containerEl.getBoundingClientRect()
    this.stage.width(rect.width)
    this.stage.height(rect.height)
    this.refreshPolygonVisualScale()
  }`
)

replaceIfFound(
  'zoomToFit rerender polygons',
  `    this.stage.batchDraw()
    this.notifyZoom()
  }`,
  `    this.stage.batchDraw()
    this.notifyZoom()
    this.refreshPolygonVisualScale()
  }`
)

replaceIfFound(
  'zoomAtPoint rerender polygons',
  `    this.stage.batchDraw()
    this.notifyZoom()
  }

  onWheel(e) {`,
  `    this.stage.batchDraw()
    this.notifyZoom()
    this.refreshPolygonVisualScale()
  }

  onWheel(e) {`
)

// Add helper method before notifyPolygons. If not found, skip instead of killing build.
if (!s.includes('refreshPolygonVisualScale(opts = {})')) {
  const notifyBlock = findMethodBlock(s, 'notifyPolygons')
  if (notifyBlock) {
    const helper = `  refreshPolygonVisualScale(opts = {}) {
    if (!this.stage || !Array.isArray(this.polygons) || this.polygons.length === 0) return
    const run = () => {
      if (!this.stage || !this.polyLayer) return
      this.renderPolygons()
      this.polyLayer.batchDraw()
    }
    if (opts.delayed && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        run()
        requestAnimationFrame(run)
      })
    } else {
      run()
    }
  }

`
    s = s.slice(0, notifyBlock.start) + helper + s.slice(notifyBlock.start)
    console.log('PATCH refreshPolygonVisualScale helper')
  } else {
    console.log('WARN notifyPolygons block not found; refresh helper skipped')
  }
} else {
  console.log('OK refreshPolygonVisualScale helper already patched')
}

// Restored labels can render once before the browser finishes layout/fit. Patch the
// current loadPolygons shape by injecting after the first renderPolygons call inside it.
const loadBlock = findMethodBlock(s, 'loadPolygons')
if (loadBlock) {
  let blockText = s.slice(loadBlock.start, loadBlock.end)
  if (!blockText.includes('refreshPolygonVisualScale({ delayed: true })')) {
    const nextBlock = blockText.replace(
      '    this.renderPolygons()\n',
      '    this.renderPolygons()\n    this.refreshPolygonVisualScale({ delayed: true })\n'
    )
    if (nextBlock !== blockText) {
      s = s.slice(0, loadBlock.start) + nextBlock + s.slice(loadBlock.end)
      console.log('PATCH loadPolygons delayed visual refresh')
    } else {
      console.log('WARN renderPolygons call not found inside loadPolygons; delayed refresh skipped')
    }
  } else {
    console.log('OK loadPolygons delayed visual refresh already patched')
  }
} else {
  console.log('WARN loadPolygons block not found; delayed visual refresh skipped')
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('OK restored label scale refresh patch installed')
} else {
  console.log('OK restored label scale refresh patch already installed/skipped')
}
