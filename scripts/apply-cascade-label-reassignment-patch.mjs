#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/annotator.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

// -----------------------------------------------------------------------------
// Manual relabel behavior for obscured upper vertebrae:
// If a polygon currently auto-labeled T1 is actually T3, selecting T3 should make
// that polygon T3 and all lower polygons T4, T5, ... while keeping polygons above
// it unchanged.
// -----------------------------------------------------------------------------
const oldSetLabel = `  setLabelForPolygon(id, newLabel) {
    const poly = this.polygons.find(p => p.id === id)
    if (!poly) return
    poly.label = newLabel
    // 수동 변경 시 자동 정렬은 안 함 (사용자 의도 존중)
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }
`

const newSetLabel = `  setLabelForPolygon(id, newLabel, opts = {}) {
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
    const idxInLabelSet = LABELS.indexOf(startLabel)
    if (idxInLabelSet === -1) return

    // Always work from top to bottom by centroid. This makes the cascade match
    // the anatomical order even if the array order was changed by import/history.
    this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    this.polygons.sort((a, b) => a._centroidY - b._centroidY)

    const startIdx = this.polygons.findIndex(p => p.id === id)
    if (startIdx === -1) return

    const labels = generateLabels(startLabel, this.polygons.length - startIdx)
    for (let i = startIdx; i < this.polygons.length; i++) {
      this.polygons[i].label = labels[i - startIdx]
    }

    // If the first visible polygon is manually shifted, update startLabel too so
    // subsequent auto-labeling continues from the corrected anatomical label.
    if (startIdx === 0) this.startLabel = startLabel

    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }
`

if (s.includes(oldSetLabel)) {
  s = s.replace(oldSetLabel, newSetLabel)
} else if (!s.includes('relabelFromPolygon(id, startLabel)')) {
  throw new Error('setLabelForPolygon block not found')
}

// Keep saved/manual labels on reload. The old loadPolygons always called relabelAll(),
// which would erase a manually corrected T3/T4/T5 sequence after refresh.
const oldLoad = `  loadPolygons(polygons) {
    if (!Array.isArray(polygons)) return
    this.polygons = polygons.map((p, i) => ({
      id: p.id != null ? p.id : (Date.now() + i),
      label: p.label || '',
      points: Array.isArray(p.points) ? p.points.slice() : [],
    }))
    this.selectedId = null
    this.relabelAll()
    this.renderPolygons()
    // 새 이미지에 대한 히스토리는 깨끗하게 시작
    this.history = [this.snapshot()]
    this.historyIdx = 0
    this.notifyPolygons()
  }
`

const newLoad = `  loadPolygons(polygons) {
    if (!Array.isArray(polygons)) return
    this.polygons = polygons.map((p, i) => ({
      id: p.id != null ? p.id : (Date.now() + i),
      label: p.label || '',
      points: Array.isArray(p.points) ? p.points.slice() : [],
    }))
    this.selectedId = null

    // Keep manually saved labels if they exist. Only auto-label imported/legacy
    // polygons that do not have labels yet.
    const hasMissingLabel = this.polygons.some(p => !p.label || p.label === '?')
    if (hasMissingLabel) {
      this.relabelAll()
    } else {
      this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
      this.polygons.sort((a, b) => a._centroidY - b._centroidY)
    }

    this.renderPolygons()
    // 새 이미지에 대한 히스토리는 깨끗하게 시작
    this.history = [this.snapshot()]
    this.historyIdx = 0
    this.notifyPolygons()
  }
`

if (s.includes(oldLoad)) {
  s = s.replace(oldLoad, newLoad)
} else if (!s.includes('Keep manually saved labels if they exist')) {
  throw new Error('loadPolygons block not found')
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH cascading vertebra label reassignment')
} else {
  console.log('OK cascading vertebra label reassignment already patched')
}
