#!/usr/bin/env node

import fs from 'node:fs'
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const write = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { write(f, b); console.log('PATCH ' + label) } }

{
  const file = 'public/static/measurements.js'
  const before = read(file)
  let s = before

  s = s.split('export function calculateSagittalMeasurements(polygons = []) {').join('export function calculateSagittalMeasurements(_polygons = [], landmarks = []) {')
  s = s.split('export function calculateSagittalMeasurements(polygons = [], landmarks = []) {').join('export function calculateSagittalMeasurements(_polygons = [], landmarks = []) {')
  s = s.split('  const items = Array.isArray(polygons) ? polygons : []').join('  const items = mergeLandmarksIntoMeasurementPolygons([], landmarks)')
  s = s.split('  const items = mergeLandmarksIntoMeasurementPolygons(polygons, landmarks)').join('  const items = mergeLandmarksIntoMeasurementPolygons([], landmarks)')
  s = s.split('  const items = Array.isArray(polygons) ? polygons.slice() : []').join('  const items = []')
  s = s.split('function mergeLandmarksIntoMeasurementPolygons(polygons = [], landmarks = []) {').join('function mergeLandmarksIntoMeasurementPolygons(_polygons = [], landmarks = []) {')

  const oldBlock = `  const annotationMode = String(context.annotationMode || context.activeAnnotationMode || 'polygon').toLowerCase()
  const landmarksOnly = annotationMode !== 'polygon'
  const result = calculateSagittalMeasurements(landmarksOnly ? [] : polygons, context.landmarks || [])`
  s = s.split(oldBlock).join('  const result = calculateSagittalMeasurements([], context.landmarks || [])')
  s = s.split('  const result = calculateSagittalMeasurements(polygons, context.landmarks || [])').join('  const result = calculateSagittalMeasurements([], context.landmarks || [])')
  s = s.split('  const result = calculateSagittalMeasurements(polygons)').join('  const result = calculateSagittalMeasurements([], context.landmarks || [])')
  s = s.split("landmarksOnly ? '랜드마크 기준 측정' : '폴리곤 기준 측정'").join("'랜드마크 기준 측정'")
  s = s.split("enabled: getLocalBool('measurementGuidesEnabled', false)").join("enabled: getLocalBool('measurementGuidesEnabled', true)")

  save(file, before, s, 'landmark-only measurements')
}

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  s = s.split('renderSagittalMeasurementPanel(state.annotator.getPolygons?.() || [], {').join('renderSagittalMeasurementPanel([], {')
  s = s.split('renderSagittalMeasurementPanel(state.annotator?.getPolygons?.() || [], {').join('renderSagittalMeasurementPanel([], {')
  s = s.split('renderSagittalMeasurementPanel(polygons, {').join('renderSagittalMeasurementPanel([], {')
  save(file, before, s, 'app landmark-only measurement calls')
}

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before
  s = s.split('renderModeToolbar(); updateModeVisibility(); return').join('renderModeToolbar(); updateModeVisibility(); window.__refreshSagittalMeasurements?.(); return')
  s = s.split('renderModeToolbar(); updateModeVisibility(); annotator.renderLandmarks?.()').join('renderModeToolbar(); updateModeVisibility(); annotator.renderLandmarks?.(); window.__refreshSagittalMeasurements?.()')
  save(file, before, s, 'measurement refresh on landmark mode switch')
}

await import('./apply-landmark-geometric-lines-and-pan-fix.mjs')

console.log('OK landmark-only measurement source installed')
