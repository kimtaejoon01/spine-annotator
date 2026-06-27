#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/annotator.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

function findMethodBlock(source, methodName) {
  const re = new RegExp('\\n  ' + methodName + '\\s*\\([^)]*\\)\\s*\\{')
  const m = source.match(re)
  if (!m || m.index == null) return null
  const start = m.index + 1
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
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

const cascadeMethods = `  setLabelForPolygon(id, newLabel, opts = {}) {
    const cascade = opts.cascade !== false
    if (cascade) {
      this.relabelFromPolygon(id, newLabel)
      return
    }

    const poly = this.polygons.find(p => p.id === id)
    if (!poly) return
    poly.label = newLabel
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }

  relabelFromPolygon(id, startLabel) {
    if (!Array.isArray(this.polygons)) return
    const idxInLabelSet = LABELS.indexOf(startLabel)
    if (idxInLabelSet === -1) return

    // Always work from top to bottom by centroid. This makes the cascade match
    // anatomical order even if the array order changed through import/history.
    this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    this.polygons.sort((a, b) => a._centroidY - b._centroidY)

    const startIdx = this.polygons.findIndex(p => p.id === id)
    if (startIdx === -1) return

    const labels = generateLabels(startLabel, this.polygons.length - startIdx)
    for (let i = startIdx; i < this.polygons.length; i++) {
      this.polygons[i].label = labels[i - startIdx]
    }

    if (startIdx === 0) this.startLabel = startLabel

    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }
`

// Replace whatever current setLabelForPolygon implementation exists, plus an old
// relabelFromPolygon if present. This avoids relying on exact older source text.
if (!s.includes('relabelFromPolygon(id, startLabel)')) {
  const block = findMethodBlock(s, 'setLabelForPolygon')
  if (!block) throw new Error('setLabelForPolygon block not found')
  s = s.slice(0, block.start) + cascadeMethods + s.slice(block.end)
} else {
  const setBlock = findMethodBlock(s, 'setLabelForPolygon')
  const relabelBlock = findMethodBlock(s, 'relabelFromPolygon')
  if (setBlock && relabelBlock) {
    const start = Math.min(setBlock.start, relabelBlock.start)
    const end = Math.max(setBlock.end, relabelBlock.end)
    s = s.slice(0, start) + cascadeMethods + s.slice(end)
  }
}

// Keep saved/manual labels on reload. If a previous patch already changed
// loadPolygons, do not fail the build; patch only the dangerous relabelAll call.
const loadBlock = findMethodBlock(s, 'loadPolygons')
if (loadBlock) {
  let blockText = s.slice(loadBlock.start, loadBlock.end)
  if (!blockText.includes('Keep manually saved labels if they exist')) {
    blockText = blockText.replace(
      '    this.relabelAll()\n',
      `    // Keep manually saved labels if they exist. Only auto-label imported/legacy
    // polygons that do not have labels yet.
    const hasMissingLabel = this.polygons.some(p => !p.label || p.label === '?')
    if (hasMissingLabel) {
      this.relabelAll()
    } else {
      this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
      this.polygons.sort((a, b) => a._centroidY - b._centroidY)
    }
`
    )
    s = s.slice(0, loadBlock.start) + blockText + s.slice(loadBlock.end)
  }
} else {
  console.log('WARN loadPolygons block not found; cascade relabel still installed')
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH cascading vertebra label reassignment')
} else {
  console.log('OK cascading vertebra label reassignment already patched')
}
