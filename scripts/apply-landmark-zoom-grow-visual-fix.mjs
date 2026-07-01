#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}
function replaceMethod(source, name, replacement) {
  const start = source.indexOf('  ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  let depth = 0, quote = null, escape = false
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

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  // Previous patches used size / zoomScale. That keeps absolute screen size fixed,
  // so relative to the zoomed image the text looks smaller. Use sqrt(zoomScale)
  // instead: landmark text/handles still do not explode, but they grow when zooming in.
  s = s.replace(
    `    const scale = Math.max(0.001, this.stage.scaleX() || 1)`,
    `    const zoomScale = Math.max(0.001, this.stage.scaleX() || 1)\n    const scale = Math.max(0.001, Math.sqrt(zoomScale))`
  )
  s = s.replace(
    `    const zoomScale = Math.max(0.001, this.stage.scaleX() || 1)\n    const scale = Math.max(0.001, Math.sqrt(zoomScale))`,
    `    const zoomScale = Math.max(0.001, this.stage.scaleX() || 1)\n    const scale = Math.max(0.001, Math.sqrt(zoomScale))`
  )

  // Bigger baseline sizes.
  s = s.replaceAll(`? 8.0 : 5.2) / scale`, `? 11.0 : 7.5) / scale`)
  s = s.replaceAll(`? 4.8 : 3.2) / scale`, `? 11.0 : 7.5) / scale`)
  s = s.replaceAll(`? 3.0 : 1.8) / scale`, `? 11.0 : 7.5) / scale`)
  s = s.replaceAll(`fontSize: 13 / scale`, `fontSize: 17 / scale`)
  s = s.replaceAll(`fontSize: 9 / scale`, `fontSize: 17 / scale`)
  s = s.replaceAll(`fontSize: 10 / scale`, `fontSize: 14 / scale`)
  s = s.replaceAll(`fontSize: 7 / scale`, `fontSize: 14 / scale`)
  s = s.replaceAll(`fontSize: 4.5 / scale`, `fontSize: 14 / scale`)
  s = s.replaceAll(`x: 8 / scale, y: -8 / scale`, `x: 10 / scale, y: -10 / scale`)
  s = s.replaceAll(`x: 5 / scale, y: -5 / scale`, `x: 10 / scale, y: -10 / scale`)
  s = s.replaceAll(`x: 3 / scale, y: -3 / scale`, `x: 10 / scale, y: -10 / scale`)

  save(file, before, s, 'landmark visuals grow with zoom')
}

{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before
  s = replaceMethod(s, 'notifyZoom', `  notifyZoom() {
    this.renderLandmarks?.()
    if (this.opts.onZoomChange) this.opts.onZoomChange(this.stage.scaleX())
  }`)
  save(file, before, s, 'landmarks rerender on zoom')
}

console.log('OK landmark zoom-grow visual fix installed')
