#!/usr/bin/env node

import fs from 'node:fs'
const r = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const w = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { w(f, b); console.log('PATCH ' + label) } }

{
  const f = 'public/static/measurements.js'
  const before = r(f)
  let s = before
  const rep = (a, b) => { s = s.split(a).join(b) }

  rep('  const items = Array.isArray(polygons) ? polygons : []', '  const items = mergeLandmarksIntoMeasurementPolygons([], landmarks)')
  rep('  const items = mergeLandmarksIntoMeasurementPolygons(polygons, landmarks)', '  const items = mergeLandmarksIntoMeasurementPolygons([], landmarks)')
  rep('  const items = Array.isArray(polygons) ? polygons.slice() : []', '  const items = []')
  rep('renderSagittalMeasurementPanel(polygons,', 'renderSagittalMeasurementPanel([],')
  rep('  const result = calculateSagittalMeasurements(polygons, context.landmarks || [])', '  const result = calculateSagittalMeasurements([], context.landmarks || [])')

  if (!s.includes('const byLandmark = buildLandmarkMap(landmarks)')) {
    rep('  const getPoly = (label) => chooseLargestPolygon(byLabel.get(label) || [])', '  const byLandmark = buildLandmarkMap(landmarks)\n  const getPoly = (label) => chooseLargestPolygon(byLabel.get(label) || [])')
  }

  rep("  if (s1) lines.S1_sup = estimateEndplateLine(s1.points, 'superior')", "  lines.S1_sup = landmarkEndplateLine(byLandmark, 'S1', 'superior')")
  rep("  if (l1) lines.L1_sup = estimateEndplateLine(l1.points, 'superior')", "  lines.L1_sup = landmarkEndplateLine(byLandmark, 'L1', 'superior')")
  rep("  if (l4) lines.L4_sup = estimateEndplateLine(l4.points, 'superior')", "  lines.L4_sup = landmarkEndplateLine(byLandmark, 'L4', 'superior')")
  rep("  if (c2) lines.C2_inf = estimateEndplateLine(c2.points, 'inferior')", "  lines.C2_inf = landmarkEndplateLine(byLandmark, 'C2', 'inferior')")
  rep("  if (c7) lines.C7_inf = estimateEndplateLine(c7.points, 'inferior')", "  lines.C7_inf = landmarkEndplateLine(byLandmark, 'C7', 'inferior')")
  rep("  if (t1) lines.T1_sup = estimateEndplateLine(t1.points, 'superior')", "  lines.T1_sup = landmarkEndplateLine(byLandmark, 'T1', 'superior')")
  rep("  if (t12) lines.T12_inf = estimateEndplateLine(t12.points, 'inferior')", "  lines.T12_inf = landmarkEndplateLine(byLandmark, 'T12', 'inferior')")

  rep("  lines.S1_sup = landmarkLine(byLandmark, 'S1_SUP_POST', 'S1_SUP_ANT') || (s1 ? estimateEndplateLine(s1.points, 'superior') : null)", "  lines.S1_sup = landmarkEndplateLine(byLandmark, 'S1', 'superior')")
  rep("  lines.L1_sup = landmarkLine(byLandmark, 'L1_SUP_POST', 'L1_SUP_ANT') || (l1 ? estimateEndplateLine(l1.points, 'superior') : null)", "  lines.L1_sup = landmarkEndplateLine(byLandmark, 'L1', 'superior')")
  rep("  lines.L4_sup = landmarkLine(byLandmark, 'L4_SUP_POST', 'L4_SUP_ANT') || (l4 ? estimateEndplateLine(l4.points, 'superior') : null)", "  lines.L4_sup = landmarkEndplateLine(byLandmark, 'L4', 'superior')")
  rep("  lines.C2_inf = landmarkLine(byLandmark, 'C2_INF_POST', 'C2_INF_ANT') || (c2 ? estimateEndplateLine(c2.points, 'inferior') : null)", "  lines.C2_inf = landmarkEndplateLine(byLandmark, 'C2', 'inferior')")
  rep("  lines.C7_inf = landmarkLine(byLandmark, 'C7_INF_POST', 'C7_INF_ANT') || (c7 ? estimateEndplateLine(c7.points, 'inferior') : null)", "  lines.C7_inf = landmarkEndplateLine(byLandmark, 'C7', 'inferior')")
  rep("  lines.T1_sup = landmarkLine(byLandmark, 'T1_SUP_POST', 'T1_SUP_ANT') || (t1 ? estimateEndplateLine(t1.points, 'superior') : null)", "  lines.T1_sup = landmarkEndplateLine(byLandmark, 'T1', 'superior')")
  rep("  lines.T12_inf = landmarkLine(byLandmark, 'T12_INF_POST', 'T12_INF_ANT') || (t12 ? estimateEndplateLine(t12.points, 'inferior') : null)", "  lines.T12_inf = landmarkEndplateLine(byLandmark, 'T12', 'inferior')")

  if (!s.includes('function buildLandmarkMap(landmarks)')) {
    const h = `function buildLandmarkMap(landmarks) {\n  const map = new Map()\n  for (const lm of Array.isArray(landmarks) ? landmarks : []) {\n    const label = String(lm?.label || '').trim().toUpperCase()\n    const x = Number(lm?.x)\n    const y = Number(lm?.y)\n    if (label && Number.isFinite(x) && Number.isFinite(y)) map.set(label, { x, y, label })\n  }\n  return map\n}\n\n`
    rep('function measurement(key, name, value, note) {', h + 'function measurement(key, name, value, note) {')
  }
  if (!s.includes('function landmarkEndplateLine')) {
    const h = `function landmarkEndplateLine(byLandmark, vertebra, side) {\n  const pts = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT'].map(p => byLandmark?.get?.(vertebra + '_' + p)).filter(Boolean)\n  if (pts.length < 4) return null\n  const pair = [...pts].sort((a, b) => side === 'inferior' ? b.y - a.y : a.y - b.y).slice(0, 2)\n  return pair[0].x <= pair[1].x ? [pair[0], pair[1]] : [pair[1], pair[0]]\n}\n\n`
    rep('function measurement(key, name, value, note) {', h + 'function measurement(key, name, value, note) {')
  }

  save(f, before, s, 'geometric landmark measurement lines')
}

{
  const f = 'public/static/landmark-tools.js'
  const before = r(f)
  let s = before
  s = s.split('annotator.onMouseDown = function patchedLandmarkMouseDown(e) {\n    if (isLat()').join('annotator.onMouseDown = function patchedLandmarkMouseDown(e) {\n    if (this.panMode) return originalOnMouseDown(e)\n    if (isLat()')
  save(f, before, s, 'pan-safe landmark clicks')
}

console.log('OK geometric landmark lines and pan guard installed')
