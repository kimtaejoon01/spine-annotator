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

// Force-replace the whole GET endpoint. Earlier versions checked for
// parseStoredLabelData anywhere in the file, so the raw-export parse could make
// this patch think the single-file GET route was fixed when it was not.
const getStart = s.indexOf("api.get('/labels/:filename'")
const putMarker = `\n// ----------------------------------------------------------------\n// PUT /api/labels/:filename`
const putIndex = s.indexOf(putMarker)
if (getStart !== -1 && putIndex !== -1 && putIndex > getStart) {
  const getBlock = `api.get('/labels/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  try {
    const row = await c.env.DB.prepare(\`
      SELECT * FROM labels WHERE filename = ?
    \`).bind(filename).first<any>()

    if (!row) {
      return c.json({ ok: true, exists: false })
    }

    const parsed = parseStoredLabelData(row.polygons_json)
    const polygons = parsed.polygons
    const landmarks = parsed.landmarks

    return c.json({
      ok: true,
      exists: true,
      filename: row.filename,
      view_type: row.view_type,
      start_label: row.start_label,
      image_width: row.image_width ?? null,
      image_height: row.image_height ?? null,
      polygons,
      landmarks,
      labeler_id: row.labeler_id,
      polygon_count: row.polygon_count,
      updated_at: row.updated_at,
      created_at: row.created_at,
      version: row.version,
    })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})
`
  const current = s.slice(getStart, putIndex)
  if (current !== getBlock) {
    s = s.slice(0, getStart) + getBlock + s.slice(putIndex)
  }
}

// Force PUT to store {polygons, landmarks} and allow landmark-only rows.
s = s.replace(
  /  const polygons = Array\.isArray\(body\.polygons\) \? body\.polygons : \[\][\s\S]*?  const now = new Date\(\)\.toISOString\(\)/,
  `  const polygons = Array.isArray(body.polygons) ? body.polygons : []
  const landmarks = Array.isArray(body.landmarks) ? body.landmarks : []
  const polygonsJson = landmarks.length > 0 ? JSON.stringify({ polygons, landmarks }) : JSON.stringify(polygons)
  const now = new Date().toISOString()`
)
s = s.replace(
  `    if (polyCount === 0 && !existing) {`,
  `    if (polyCount === 0 && landmarks.length === 0 && !existing) {`
)

// Raw export should expose parsed landmarks too.
if (!s.includes('items: rows.map((row: any) =>')) {
  s = s.replace(
    `    if (format === 'raw') {
      return c.json({ ok: true, items: rows })
    }`,
    `    if (format === 'raw') {
      return c.json({ ok: true, items: rows.map((row: any) => {
        const parsed = parseStoredLabelData(row.polygons_json)
        return { ...row, polygons: parsed.polygons, landmarks: parsed.landmarks }
      }) })
    }`
  )
}

save(file, before, s, 'backend landmark JSON parse/load/save')
console.log('OK backend landmark JSON parse/load/save fix installed')
