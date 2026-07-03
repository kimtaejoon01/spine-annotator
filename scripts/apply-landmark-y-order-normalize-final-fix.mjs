#!/usr/bin/env node

import fs from 'node:fs'
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const write = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { write(f, b); console.log('PATCH ' + label) } }

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  const helper = `
function landmarkYTarget(label) {
  const text = String(label || '').toUpperCase()
  if (text === 'HC_LAT' || text === 'FH_LAT') return 'HC_LAT'
  return text.split('_')[0] || ''
}

function landmarkYSuffix(label) {
  const text = String(label || '').toUpperCase()
  const target = landmarkYTarget(text)
  if (target === 'HC_LAT') return 'HC_LAT'
  return text.startsWith(target + '_') ? text.slice(target.length + 1) : ''
}

function splitLandmarkGroupsByY(target, items) {
  if (target === 'HC_LAT') return []
  const counts = new Map()
  for (const lm of items) counts.set(landmarkYSuffix(lm.label), (counts.get(landmarkYSuffix(lm.label)) || 0) + 1)
  const anchorSuffix = ['CENTER', 'SUP_ANT', 'SUP_POST', 'INF_ANT', 'INF_POST'].find(s => (counts.get(s) || 0) > 1)
  if (!anchorSuffix) {
    return [{
      target,
      items,
      y: items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, items.length),
    }]
  }
  const anchors = items.filter(lm => landmarkYSuffix(lm.label) === anchorSuffix)
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0))
  const groups = anchors.map(a => ({ target, items: [], y: Number(a.y || 0) }))
  for (const lm of items) {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(Number(lm.y || 0) - Number(anchors[i].y || 0))
      if (d < bestDist) { bestDist = d; best = i }
    }
    groups[best].items.push(lm)
  }
  for (const g of groups) {
    g.y = g.items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, g.items.length)
  }
  return groups
}

function normalizeLandmarkYOrderHard(landmarks, opts = {}) {
  if (!Array.isArray(landmarks) || landmarks.length < 2) return false
  const targets = [...VERTEBRAE_FULL, 'S1']
  const byTarget = new Map()
  for (const lm of landmarks) {
    const target = landmarkYTarget(lm.label)
    if (!targets.includes(target)) continue
    if (!Number.isFinite(Number(lm.y))) continue
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target).push(lm)
  }
  const groups = []
  for (const [target, items] of byTarget.entries()) groups.push(...splitLandmarkGroupsByY(target, items))
  groups.sort((a, b) => a.y - b.y)
  if (groups.length < 2) return false

  let baseIdx = -1
  if (opts.anchorTarget && targets.includes(opts.anchorTarget)) {
    const anchorYIndex = Number.isInteger(opts.anchorYIndex) ? opts.anchorYIndex : groups.findIndex(g => g.target === opts.anchorTarget)
    if (anchorYIndex >= 0) baseIdx = targets.indexOf(opts.anchorTarget) - anchorYIndex
  }

  if (baseIdx < 0) {
    const votes = new Map()
    for (let i = 0; i < groups.length; i++) {
      const idx = targets.indexOf(groups[i].target)
      if (idx < 0) continue
      const candidate = idx - i
      if (candidate < 0 || candidate >= targets.length) continue
      const weight = Math.max(1, groups[i].items.length)
      votes.set(candidate, (votes.get(candidate) || 0) + weight)
    }
    let bestWeight = -1
    for (const [candidate, weight] of votes.entries()) {
      if (weight > bestWeight) { baseIdx = candidate; bestWeight = weight }
    }
  }

  if (baseIdx < 0) return false
  baseIdx = Math.max(0, Math.min(baseIdx, targets.length - 1))

  let changed = false
  for (let i = 0; i < groups.length; i++) {
    const nextTarget = targets[baseIdx + i]
    if (!nextTarget) break
    for (const lm of groups[i].items) {
      const suffix = landmarkYSuffix(lm.label)
      if (!suffix) continue
      const nextLabel = nextTarget + '_' + suffix
      if (lm.label !== nextLabel || lm.target !== nextTarget) {
        lm.label = nextLabel
        lm.target = nextTarget
        changed = true
      }
    }
    groups[i].target = nextTarget
  }
  return changed
}
`

  if (!s.includes('function normalizeLandmarkYOrderHard')) {
    const marker = 'function findNextMissingIndex(landmarks, start) {'
    if (!s.includes(marker)) throw new Error('findNextMissingIndex marker not found')
    s = s.replace(marker, helper + '\n' + marker)
  }

  if (!s.includes('annotator.normalizeLandmarkYOrder = function normalizeLandmarkYOrder')) {
    const marker = '  let sequenceIndex = 0\n  let panel = null'
    if (!s.includes(marker)) throw new Error('sequenceIndex marker not found')
    s = s.replace(marker, `  let sequenceIndex = 0
  let panel = null

  annotator.normalizeLandmarkYOrder = function normalizeLandmarkYOrder(opts = {}) {
    return normalizeLandmarkYOrderHard(this.landmarks || [], opts)
  }`)
  }

  if (!s.includes('this.normalizeLandmarkYOrder?.({ force: false })\n    this.renderLandmarks()')) {
    s = s.replace('    if (existing) Object.assign(existing, item)\n    else this.landmarks.push(item)\n    this.renderLandmarks()', '    if (existing) Object.assign(existing, item)\n    else this.landmarks.push(item)\n    this.normalizeLandmarkYOrder?.({ force: false })\n    this.renderLandmarks()')
  }

  if (!s.includes('this.normalizeLandmarkYOrder?.({ force: true })\n    sequenceIndex = findNextMissingIndex')) {
    s = s.replace('    sequenceIndex = findNextMissingIndex(this.landmarks, 0)\n    this.renderLandmarks()', '    this.normalizeLandmarkYOrder?.({ force: true })\n    sequenceIndex = findNextMissingIndex(this.landmarks, 0)\n    this.renderLandmarks()')
  }

  if (!s.includes('this.normalizeLandmarkYOrder?.({ force: false })\n    return (this.landmarks || []).map')) {
    s = s.replace('  annotator.getLandmarks = function getLandmarks() {\n    return (this.landmarks || []).map', '  annotator.getLandmarks = function getLandmarks() {\n    this.normalizeLandmarkYOrder?.({ force: false })\n    return (this.landmarks || []).map')
  }

  if (!s.includes('this.normalizeLandmarkYOrder?.({ force: false })\n    this.landmarkLayer.destroyChildren()')) {
    s = s.replace('    if (!this.landmarkLayer) return\n    this.landmarkLayer.destroyChildren()', '    if (!this.landmarkLayer) return\n    this.normalizeLandmarkYOrder?.({ force: false })\n    this.landmarkLayer.destroyChildren()')
  }

  if (!s.includes('this.normalizeLandmarkYOrder?.({ force: false })\n        this.renderLandmarks()')) {
    s = s.replace('      group.on(\'dragend\', () => {\n        this.renderLandmarks()', '      group.on(\'dragend\', () => {\n        this.normalizeLandmarkYOrder?.({ force: false })\n        this.renderLandmarks()')
  }

  save(file, before, s, 'landmark Y-order normalization')
}

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  if (!s.includes('annotator.normalizeLandmarkYOrder?.({ force: false })\n  const landmarks = annotator.getLandmarks')) {
    s = s.replace('  const landmarks = annotator.getLandmarks?.() || annotator.landmarks || []', '  annotator.normalizeLandmarkYOrder?.({ force: false })\n  const landmarks = annotator.getLandmarks?.() || annotator.landmarks || []')
    s = s.replace('  const landmarks = Array.isArray(annotator.landmarks) ? annotator.landmarks : (annotator.getLandmarks?.() || [])', '  annotator.normalizeLandmarkYOrder?.({ force: false })\n  const landmarks = Array.isArray(annotator.landmarks) ? annotator.landmarks : (annotator.getLandmarks?.() || [])')
  }
  save(file, before, s, 'standalone landmark list Y-order normalization')
}

console.log('OK landmark Y-order normalization final fix installed')
