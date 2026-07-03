#!/usr/bin/env node

import fs from 'node:fs'
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const write = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { write(f, b); console.log('PATCH ' + label) } }

function replaceFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  if (open < 0) return source
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

function replaceConstArrowFunction(source, name, replacement) {
  const start = source.indexOf('  const ' + name + ' = (')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  if (open < 0) return source
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

const yRelabelStandalone = `  const relabelShift = (fromTarget, toTarget) => {
    fromTarget = String(fromTarget || '').toUpperCase()
    toTarget = String(toTarget || '').toUpperCase()
    const startLabelIdx = vertebrae.indexOf(toTarget)
    if (!fromTarget || startLabelIdx < 0) return

    const groupsByTarget = new Map()
    for (const lm of annotator.landmarks || []) {
      const t = targetOf(lm.label)
      if (!vertebrae.includes(t)) continue
      if (!groupsByTarget.has(t)) groupsByTarget.set(t, [])
      groupsByTarget.get(t).push(lm)
    }
    const groups = [...groupsByTarget.entries()].map(([target, items]) => ({
      target,
      items,
      y: items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, items.length),
    })).sort((a, b) => a.y - b.y)

    const anchorIdx = groups.findIndex(g => g.target === fromTarget)
    if (anchorIdx < 0) return

    for (let i = anchorIdx; i < groups.length; i++) {
      const nextTarget = vertebrae[startLabelIdx + (i - anchorIdx)]
      if (!nextTarget) break
      for (const lm of groups[i].items) {
        const oldTarget = targetOf(lm.label)
        const suffix = String(lm.label || '').startsWith(oldTarget + '_')
          ? String(lm.label).slice(oldTarget.length + 1)
          : ''
        lm.label = suffix ? nextTarget + '_' + suffix : nextTarget
        lm.target = nextTarget
      }
      groups[i].target = nextTarget
    }

    const pending = annotator.pendingLandmark || ''
    const pt = targetOf(pending)
    const pendingGroup = groups.find(g => g.target === pt)
    if (pendingGroup) {
      const suffix = String(pending || '').startsWith(pt + '_') ? String(pending).slice(pt.length + 1) : ''
      if (suffix) annotator.pendingLandmark = pendingGroup.target + '_' + suffix
    }

    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    if (typeof refreshSagittalMeasurements === 'function') refreshSagittalMeasurements()
    if (typeof autoSave === 'function') autoSave()
    renderStandaloneLandmarkListPanel()
  }`

const yRelabelTools = `function shiftTargetV2(fromTarget, toTarget) {
    fromTarget = String(fromTarget || '').toUpperCase()
    toTarget = String(toTarget || '').toUpperCase()
    const spineTargets = VERTEBRAE_FULL.filter(v => v !== 'C1')
    const startIdx = spineTargets.indexOf(toTarget)
    if (!fromTarget || startIdx < 0) return

    const groupsByTarget = new Map()
    for (const lm of annotator.landmarks || []) {
      const target = landmarkTarget(lm.label)
      if (!spineTargets.includes(target)) continue
      if (!groupsByTarget.has(target)) groupsByTarget.set(target, [])
      groupsByTarget.get(target).push(lm)
    }
    const groups = [...groupsByTarget.entries()].map(([target, items]) => ({
      target,
      items,
      y: items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, items.length),
    })).sort((a, b) => a.y - b.y)

    const anchorIdx = groups.findIndex(g => g.target === fromTarget)
    if (anchorIdx < 0) return

    for (let i = anchorIdx; i < groups.length; i++) {
      const nextTarget = spineTargets[startIdx + (i - anchorIdx)]
      if (!nextTarget) break
      for (const lm of groups[i].items) {
        const oldTarget = landmarkTarget(lm.label)
        const suffix = String(lm.label || '').startsWith(oldTarget + '_')
          ? String(lm.label).slice(oldTarget.length + 1)
          : ''
        lm.label = suffix ? nextTarget + '_' + suffix : nextTarget
        lm.target = nextTarget
      }
      groups[i].target = nextTarget
    }

    const pending = annotator.pendingLandmark || LAT_5POINT_SEQUENCE[sequenceIndex]
    const pt = landmarkTarget(pending)
    const pg = groups.find(g => g.target === pt)
    if (pg) {
      const suffix = String(pending || '').startsWith(pt + '_') ? String(pending).slice(pt.length + 1) : ''
      if (suffix) {
        const nl = pg.target + '_' + suffix
        const ni = LAT_5POINT_SEQUENCE.indexOf(nl)
        if (ni >= 0) sequenceIndex = ni
        annotator.pendingLandmark = nl
      }
    }

    annotator.renderLandmarks()
    renderPanel()
    window.__refreshSagittalMeasurements?.()
    onChange?.()
  }`

const yRelabelToolsLegacy = `function shiftLandmarkTarget(fromTarget, toTarget) {
    fromTarget = String(fromTarget || '').toUpperCase()
    toTarget = String(toTarget || '').toUpperCase()
    const spineTargets = VERTEBRAE_FULL.filter(v => v !== 'C1')
    const startIdx = spineTargets.indexOf(toTarget)
    if (!fromTarget || startIdx < 0) return

    const groupsByTarget = new Map()
    for (const lm of annotator.landmarks || []) {
      const target = landmarkTarget(lm.label)
      if (!spineTargets.includes(target)) continue
      if (!groupsByTarget.has(target)) groupsByTarget.set(target, [])
      groupsByTarget.get(target).push(lm)
    }
    const groups = [...groupsByTarget.entries()].map(([target, items]) => ({
      target,
      items,
      y: items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, items.length),
    })).sort((a, b) => a.y - b.y)

    const anchorIdx = groups.findIndex(g => g.target === fromTarget)
    if (anchorIdx < 0) return

    for (let i = anchorIdx; i < groups.length; i++) {
      const nextTarget = spineTargets[startIdx + (i - anchorIdx)]
      if (!nextTarget) break
      for (const lm of groups[i].items) {
        const oldTarget = landmarkTarget(lm.label)
        const suffix = String(lm.label || '').startsWith(oldTarget + '_')
          ? String(lm.label).slice(oldTarget.length + 1)
          : ''
        lm.label = suffix ? nextTarget + '_' + suffix : nextTarget
        lm.target = nextTarget
      }
      groups[i].target = nextTarget
    }

    annotator.renderLandmarks()
    renderPanel()
    window.__refreshSagittalMeasurements?.()
    onChange?.()
  }`

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  s = replaceConstArrowFunction(s, 'relabelShift', yRelabelStandalone)
  save(file, before, s, 'standalone landmark Y-axis relabel')
}

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before
  s = replaceFunction(s, 'shiftTargetV2', yRelabelTools)
  s = replaceFunction(s, 'shiftLandmarkTarget', yRelabelToolsLegacy)
  save(file, before, s, 'landmark-tools Y-axis relabel')
}

console.log('OK landmark Y-axis relabel installed')
