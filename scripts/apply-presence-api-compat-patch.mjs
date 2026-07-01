#!/usr/bin/env node

import fs from 'node:fs'

const apiFile = 'src/api.ts'
let s = fs.readFileSync(apiFile, 'utf8').replace(/\r\n/g, '\n')
const before = s

function makePresenceBlock() {
  return [
    '// ----------------------------------------------------------------',
    '// POST/PUT /api/presence - 현재 작업 중인 파일 알림',
    '// ----------------------------------------------------------------',
    'async function ensurePresenceTable(c: any) {',
    '  await c.env.DB.prepare(',
    "    'CREATE TABLE IF NOT EXISTS presence (' +",
    "    'labeler_id TEXT PRIMARY KEY, ' +",
    "    'filename TEXT, ' +",
    "    'last_seen TEXT' +",
    "    ')'",
    '  ).run()',
    '}',
    '',
    'async function handlePresenceUpsert(c: any) {',
    '  let body: any',
    "  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid json' }, 400) }",
    "  const labelerId = body.labeler_id || ''",
    "  const filename = body.filename || ''",
    "  if (!labelerId) return c.json({ ok: false, error: 'labeler_id required' }, 400)",
    '  const now = new Date().toISOString()',
    '  try {',
    '    await ensurePresenceTable(c)',
    "    await c.env.DB.prepare(",
    "      'INSERT INTO presence (labeler_id, filename, last_seen) ' +",
    "      'VALUES (?, ?, ?) ' +",
    "      'ON CONFLICT(labeler_id) DO UPDATE SET filename=excluded.filename, last_seen=excluded.last_seen'",
    '    ).bind(labelerId, filename, now).run()',
    '    return c.json({ ok: true })',
    "  } catch (err: any) { return c.json({ ok: true, warning: 'presence_unavailable', detail: err.message }) }",
    '}',
    '',
    "api.post('/presence', handlePresenceUpsert)",
    "api.put('/presence', handlePresenceUpsert)",
    '',
    'async function handlePresenceDelete(c: any) {',
    "  let labelerId = c.req.param('labeler_id') ? decodeURIComponent(c.req.param('labeler_id')) : ''",
    '  if (!labelerId) {',
    '    try {',
    '      const body = await c.req.json()',
    "      labelerId = body?.labeler_id || ''",
    '    } catch {}',
    '  }',
    "  if (!labelerId) return c.json({ ok: false, error: 'labeler_id required' }, 400)",
    '  try {',
    '    await ensurePresenceTable(c)',
    "    await c.env.DB.prepare('DELETE FROM presence WHERE labeler_id = ?').bind(labelerId).run()",
    '    return c.json({ ok: true })',
    "  } catch (err: any) { return c.json({ ok: true, warning: 'presence_unavailable', detail: err.message }) }",
    '}',
    '',
    "api.delete('/presence', handlePresenceDelete)",
    "api.delete('/presence/:labeler_id', handlePresenceDelete)",
    '',
  ].join('\n')
}

const oldStart = s.indexOf('// ----------------------------------------------------------------\n// POST /api/presence - 현재 작업 중인 파일 알림')
const compatStart = s.indexOf('// ----------------------------------------------------------------\n// POST/PUT /api/presence - 현재 작업 중인 파일 알림')
const start = compatStart >= 0 ? compatStart : oldStart
const endMarker = '// ----------------------------------------------------------------\n// GET /api/sync - 라벨 메타 + presence 한번에 동기화'
const end = s.indexOf(endMarker, start)
if (start < 0 || end < 0) {
  throw new Error('presence API block not found')
}
s = s.slice(0, start) + makePresenceBlock() + s.slice(end)

if (s.includes("api.get('/sync', async (c) => {\n  try {") && !s.includes("api.get('/sync', async (c) => {\n  try {\n    await ensurePresenceTable(c)")) {
  s = s.replace("api.get('/sync', async (c) => {\n  try {", "api.get('/sync', async (c) => {\n  try {\n    await ensurePresenceTable(c)")
}

if (s !== before) {
  fs.writeFileSync(apiFile, s)
  console.log('PATCH robust presence API compatibility')
} else {
  console.log('OK robust presence API compatibility already patched')
}
