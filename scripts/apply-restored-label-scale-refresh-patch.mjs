#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/annotator.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

function replaceOnce(label, from, to) {
  if (s.includes(to)) {
    console.log('OK ' + label + ' already patched')
    return
  }
  if (!s.includes(from)) throw new Error('Patch point not found: ' + label)
  s = s.replace(from, to)
  console.log('PATCH ' + label)
}

// If the canvas size changes or zoom changes, visual size of strokes/labels must be recalculated.
replaceOnce(
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

replaceOnce(
  'zoomToFit rerender polygons',
  `    this.stage.batchDraw()
    this.notifyZoom()
  }`,
  `    this.stage.batchDraw()
    this.notifyZoom()
    this.refreshPolygonVisualScale()
  }`
)

replaceOnce(
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

// Restored labels can render once before the browser finishes layout/fit.
// Render now, then again on the next animation frames so C2/C3 labels and stroke widths use the final scale.
replaceOnce(
  'loadPolygons delayed visual refresh',
  `    this.relabelAll()
    this.renderPolygons()
    // 새 이미지에 대한 히스토리는 깨끗하게 시작`,
  `    this.relabelAll()
    this.renderPolygons()
    this.refreshPolygonVisualScale({ delayed: true })
    // 새 이미지에 대한 히스토리는 깨끗하게 시작`
)

// Add helper method before notifyPolygons.
replaceOnce(
  'refreshPolygonVisualScale helper',
  `  notifyPolygons() {
    if (this.opts.onPolygonsChange) {`,
  `  refreshPolygonVisualScale(opts = {}) {
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

  notifyPolygons() {
    if (this.opts.onPolygonsChange) {`
)

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('OK restored label scale refresh patch installed')
} else {
  console.log('OK restored label scale refresh patch already installed')
}
