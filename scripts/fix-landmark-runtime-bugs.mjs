#!/usr/bin/env node

import fs from 'node:fs'

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}
function writeIfChanged(file, before, after, label) {
  if (before === after) console.log('OK ' + label)
  else { fs.writeFileSync(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// Landmark labels must follow anatomy on screen, not click order.
// Reassign C2/C3/... by Y-position after every add/drag/load.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  const helper = `
  function relabelLandmarksByY() {
    const landmarks = annotator.landmarks || []
    if (!landmarks.length) return

    const groups = []
    const byKey = new Map()
    const add = (kind, target, lm, suffix) => {
      if (!target || !Number.isFinite(Number(lm.x)) || !Number.isFinite(Number(lm.y))) return
      const key = kind + ':' + target
      let g = byKey.get(key)
      if (!g) {
        g = { kind, target, items: [] }
        byKey.set(key, g)
        groups.push(g)
      }
      g.items.push({ lm, suffix })
    }

    for (const lm of landmarks) {
      const label = String(lm.label || '').toUpperCase()
      if (!label || label === 'HC_LAT' || label === 'FH_LAT') continue
      if (label.endsWith('_CENTER')) {
        add('centroid', label.replace(/_CENTER$/, ''), lm, 'CENTER')
        continue
      }
      const suffix = CORNER_POINTS_4.find(p => label.endsWith('_' + p))
      if (!suffix) continue
      add('corner', label.slice(0, -suffix.length - 1), lm, suffix)
    }

    for (const kind of ['corner', 'centroid']) {
      const subset = groups
        .filter(g => g.kind === kind)
        .map(g => ({
          ...g,
          cy: g.items.reduce((sum, item) => sum + Number(item.lm.y), 0) / Math.max(1, g.items.length),
        }))
        .sort((a, b) => a.cy - b.cy)

      subset.forEach((g, index) => {
        const nextTarget = VERTEBRAE_FULL[index]
        if (!nextTarget) return
        for (const item of g.items) {
          item.lm.target = nextTarget
          item.lm.order_version = ORDER_VERSION
          item.lm.label = kind === 'centroid' ? nextTarget + '_CENTER' : nextTarget + '_' + item.suffix
        }
      })
    }
  }
`

  if (!s.includes('function relabelLandmarksByY()')) {
    s = s.replace(
      '  annotator.setPendingLandmark = function setPendingLandmark(label) { this.pendingLandmark = label || null; this.updateStatus?.(); renderModeToolbar(); updateModeVisibility(); renderPanel() }',
      helper + "\n  annotator.setPendingLandmark = function setPendingLandmark(label) { this.pendingLandmark = label || null; this.updateStatus?.(); renderModeToolbar(); updateModeVisibility(); renderPanel() }"
    )
  }

  s = s.replace(
    '        this.setLandmark(this.pendingLandmark, pos.x, pos.y)\n        setPendingToNext(current + 1); renderPanel(); onChange?.()',
    '        this.setLandmark(this.pendingLandmark, pos.x, pos.y)\n        setPendingToNext(0); renderPanel(); onChange?.()'
  )

  s = s.replace(
    "    if (existing) Object.assign(existing, item); else this.landmarks.push(item)\n    this.renderLandmarks()",
    "    if (existing) Object.assign(existing, item); else this.landmarks.push(item)\n    relabelLandmarksByY()\n    setPendingToNext(0)\n    this.renderLandmarks()"
  )

  s = s.replace(
    "  annotator.loadLandmarks = function loadLandmarks(landmarks) { this.landmarks = Array.isArray(landmarks) ? landmarks.map((l,i) => ({ id: l.id || 'lm_loaded_' + i, label: String(l.label || '').trim().toUpperCase(), target: l.target || landmarkTarget(l.label), kind: l.kind || 'point', x: Number(l.x), y: Number(l.y), visibility: l.visibility || 'visible', order_version: l.order_version || ORDER_VERSION })).filter(l => l.label && Number.isFinite(l.x) && Number.isFinite(l.y)) : []; setPendingToNext(0); this.renderLandmarks(); renderPanel() }",
    "  annotator.loadLandmarks = function loadLandmarks(landmarks) { this.landmarks = Array.isArray(landmarks) ? landmarks.map((l,i) => ({ id: l.id || 'lm_loaded_' + i, label: String(l.label || '').trim().toUpperCase(), target: l.target || landmarkTarget(l.label), kind: l.kind || 'point', x: Number(l.x), y: Number(l.y), visibility: l.visibility || 'visible', order_version: l.order_version || ORDER_VERSION })).filter(l => l.label && Number.isFinite(l.x) && Number.isFinite(l.y)) : []; relabelLandmarksByY(); setPendingToNext(0); this.renderLandmarks(); renderPanel() }"
  )

  s = s.replace(
    "    group.on('dragend', () => { if (annotator.tool !== 'edit') return; annotator.renderLandmarks(); onChange?.(); renderPanel() })",
    "    group.on('dragend', () => { if (annotator.tool !== 'edit') return; relabelLandmarksByY(); setPendingToNext(0); annotator.renderLandmarks(); onChange?.(); renderPanel() })"
  )

  writeIfChanged(file, before, s, 'landmark Y-order relabel fix')
}

// -----------------------------------------------------------------------------
// File switching must not be blocked by a failed pending autosave. Also leave
// landmark mode when switching files so the file list click never feels stuck.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  s = s.replace(
    "function resetLandmarksForFileSwitch() {\n  if (!state.annotator) return\n  state.annotator.loadLandmarks?.([])",
    "function resetLandmarksForFileSwitch() {\n  if (!state.annotator) return\n  state.annotator.cancelDrawing?.()\n  state.annotator.setFreehandMode?.(false)\n  state.annotator.__activeAnnotationMode = 'polygon'\n  state.annotator.loadLandmarks?.([])"
  )

  s = s.replace(
    "async function waitForPendingAutoSaveBeforeFileSwitch() {\n  if (!saveTimer || state._suspendAutoSave) return\n  clearTimeout(saveTimer)\n  saveTimer = null\n  await persistCurrentLabelsNow()\n}",
    "async function waitForPendingAutoSaveBeforeFileSwitch() {\n  if (!saveTimer || state._suspendAutoSave) return\n  clearTimeout(saveTimer)\n  saveTimer = null\n  try {\n    await persistCurrentLabelsNow()\n  } catch (err) {\n    console.warn('[File switch] pending autosave failed; continuing switch with local pending backup:', err)\n  }\n}"
  )

  writeIfChanged(file, before, s, 'landmark file-switch fix')
}
