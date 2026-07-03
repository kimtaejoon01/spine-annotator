#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  const start = s.indexOf('function showCocoPreview() {')
  const end = s.indexOf('\n\nasync function copyCocoJson()', start)
  if (start >= 0 && end > start) {
    const block = `function showCocoPreview() {
  const polygons = state.annotator.getPolygons()
  const landmarks = state.annotator.getLandmarks?.() || []
  if (polygons.length === 0 && landmarks.length === 0) {
    alert('라벨/랜드마크가 없습니다. 폴리곤이나 랜드마크를 먼저 그려주세요.')
    return
  }

  const coco = exportToCOCO({
    filename: state.filename,
    width: state.imageWidth,
    height: state.imageHeight,
    polygons,
    landmarks,
  })
  coco.landmarks = landmarks

  const formatted = JSON.stringify(coco, null, 2)
  document.getElementById('cocoOutput').textContent = formatted
  document.getElementById('cocoModal').classList.remove('hidden')
}`
    s = s.slice(0, start) + block + s.slice(end)
  }
  save(file, before, s, 'current export accepts landmark-only labels')
}

{
  const file = 'public/static/coco.js'
  const before = read(file)
  let s = before
  s = s.replace(/ALL_(?:ALL_)+LABELS/g, 'ALL_LABELS')
  s = s.replace('export function exportToCOCO({ filename, width, height, polygons }) {', 'export function exportToCOCO({ filename, width, height, polygons, landmarks = [] }) {')
  if (!s.includes('landmarks: (Array.isArray(landmarks) ? landmarks : []).map')) {
    s = s.replace(
      `    categories,
    annotations,`,
      `    categories,
    annotations,
    landmarks: (Array.isArray(landmarks) ? landmarks : []).map(lm => ({
      id: lm.id,
      label: lm.label,
      target: lm.target,
      kind: lm.kind || 'point',
      x: Math.round(Number(lm.x) * 100) / 100,
      y: Math.round(Number(lm.y) * 100) / 100,
      visibility: lm.visibility || 'visible',
      order_version: lm.order_version || null,
    })),`
    )
  }
  save(file, before, s, 'COCO export includes landmarks')
}

console.log('OK current landmark export fix installed')
