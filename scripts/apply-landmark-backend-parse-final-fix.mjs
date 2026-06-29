#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

const file = 'src/api.ts'
const before = read(file)
let s = before

if (!s.includes('function parseStoredLabelData')) {
  s = s.replace(
    `const api = new Hono<{ Bindings: Bindings }>()\n`,
    `const api = new Hono<{ Bindings: Bindings }>()\n\nfunction parseStoredLabelData(raw: string | null | undefined) {\n  let parsed: any = []\n  try { parsed = JSON.parse(raw || '[]') } catch {}\n  if (Array.isArray(parsed)) return { polygons: parsed, landmarks: [] }\n  return {\n    polygons: Array.isArray(parsed?.polygons) ? parsed.polygons : [],\n    landmarks: Array.isArray(parsed?.landmarks) ? parsed.landmarks : [],\n  }\n}\n`
  )
}

// GET single label must unpack {polygons, landmarks}; otherwise the frontend sees
// data.landmarks as undefined and reloads an empty landmark layer.
if (!s.includes('const parsed = parseStoredLabelData(row.polygons_json)')) {
  s = s.replace(
    `    let polygons: any[] = []\n    try {\n      polygons = JSON.parse(row.polygons_json || '[]')\n    } catch {}\n`,
    `    const parsed = parseStoredLabelData(row.polygons_json)\n    const polygons = parsed.polygons\n    const landmarks = parsed.landmarks\n`
  )
}
if (!s.includes('      landmarks,\n      labeler_id: row.labeler_id,')) {
  s = s.replace(
    `      polygons,\n      labeler_id: row.labeler_id,`,
    `      polygons,\n      landmarks,\n      labeler_id: row.labeler_id,`
  )
}

// PUT must store landmarks together with polygons, and allow landmark-only rows.
if (!s.includes('const landmarks = Array.isArray(body.landmarks) ? body.landmarks : []')) {
  s = s.replace(
    `  const polygons = Array.isArray(body.polygons) ? body.polygons : []\n  const polygonsJson = JSON.stringify(polygons)`,
    `  const polygons = Array.isArray(body.polygons) ? body.polygons : []\n  const landmarks = Array.isArray(body.landmarks) ? body.landmarks : []\n  const polygonsJson = landmarks.length > 0 ? JSON.stringify({ polygons, landmarks }) : JSON.stringify(polygons)`
  )
}
s = s.replace(
  `    if (polyCount === 0 && !existing) {`,
  `    if (polyCount === 0 && landmarks.length === 0 && !existing) {`
)

// Raw export should expose parsed landmarks too.
if (!s.includes('items: rows.map(row =>')) {
  s = s.replace(
    `    if (format === 'raw') {\n      return c.json({ ok: true, items: rows })\n    }`,
    `    if (format === 'raw') {\n      return c.json({ ok: true, items: rows.map((row: any) => {\n        const parsed = parseStoredLabelData(row.polygons_json)\n        return { ...row, polygons: parsed.polygons, landmarks: parsed.landmarks }\n      }) })\n    }`
  )
}

save(file, before, s, 'backend landmark JSON parse/load/save')
console.log('OK backend landmark JSON parse/load/save fix installed')
