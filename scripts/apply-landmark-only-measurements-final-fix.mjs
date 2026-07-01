#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}
function replaceBlock(source, start, open, replacement) {
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
function replaceFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  return replaceBlock(source, start, open, replacement)
}

{
  const file = 'public/static/measurements.js'
  const before = read(file)
  let s = before

  // All sagittal measurements must use landmark pseudo-polygons only. The old
  // segmentation polygons are ignored in every mode.
  s = s.replace('export function calculateSagittalMeasurements(polygons = []) {', 'export function calculateSagittalMeasurements(_polygons = [], landmarks = []) {')
  s = s.replace('export function calculateSagittalMeasurements(polygons = [], landmarks = []) {', 'export function calculateSagittalMeasurements(_polygons = [], landmarks = []) {')
  s = s.replace('  const items = Array.isArray(polygons) ? polygons : []', '  const items = mergeLandmarksIntoMeasurementPolygons([], landmarks)')
  s = s.replace('  const items = mergeLandmarksIntoMeasurementPolygons(polygons, landmarks)', '  const items = mergeLandmarksIntoMeasurementPolygons([], landmarks)')

  // renderSagittalMeasurementPanel should never pass polygons to calculation.
  s = s.replace(/  const annotationMode = String\(context\.annotationMode \|\| context\.activeAnnotationMode \|\| 'polygon'\)\.toLowerCase\(\)\n  const landmarksOnly = annotationMode !== 'polygon'\n  const result = calculateSagittalMeasurements\(landmarksOnly \? \[\] : polygons, context\.landmarks \|\| \[\]\)/g,
    '  const result = calculateSagittalMeasurements([], context.landmarks || [])')
  s = s.replace(/  const result = calculateSagittalMeasurements\(polygons, context\.landmarks \|\| \[\]\)/g,
    '  const result = calculateSagittalMeasurements([], context.landmarks || [])')
  s = s.replace(/  const result = calculateSagittalMeasurements\(polygons\)/g,
    '  const result = calculateSagittalMeasurements([], context.landmarks || [])')

  // The helper is installed by apply-landmark-driven-measurements-fix.mjs earlier
  // in the chain. Force it to start empty instead of copying polygon data.
  s = s.replace('function mergeLandmarksIntoMeasurementPolygons(polygons = [], landmarks = []) {', 'function mergeLandmarksIntoMeasurementPolygons(_polygons = [], landmarks = []) {')
  s = s.replace('function mergeLandmarksIntoMeasurementPolygons(_polygons = [], landmarks = []) {\n  const items = Array.isArray(polygons) ? polygons.slice() : []', 'function mergeLandmarksIntoMeasurementPolygons(_polygons = [], landmarks = []) {\n  const items = []')
  s = s.replace('  const items = Array.isArray(polygons) ? polygons.slice() : []', '  const items = []')

  s = replaceFunction(s, 'chooseLargestPolygon', `function chooseLargestPolygon(polys) {
  if (!Array.isArray(polys) || polys.length === 0) return null
  return polys[0] || null
}`)

  s = s.replaceAll("landmarksOnly ? '랜드마크 기준 측정' : '폴리곤 기준 측정'", "'랜드마크 기준 측정'")
  s = s.replace("enabled: getLocalBool('measurementGuidesEnabled', false)", "enabled: getLocalBool('measurementGuidesEnabled', true)")

  save(file, before, s, 'landmark-only sagittal measurements')
}

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  s = s.replaceAll('renderSagittalMeasurementPanel(state.annotator.getPolygons?.() || [], {', 'renderSagittalMeasurementPanel([], {')
  s = s.replaceAll('renderSagittalMeasurementPanel(state.annotator?.getPolygons?.() || [], {', 'renderSagittalMeasurementPanel([], {')
  s = s.replaceAll('renderSagittalMeasurementPanel(polygons, {', 'renderSagittalMeasurementPanel([], {')
  save(file, before, s, 'app passes landmark-only measurements')
}

console.log('OK landmark-only measurement source installed')
