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
    'async function handlePresenceUpsert(c: any) {',
    '  let body: any',
    "  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid json' }, 400) }",
    "  const labelerId = body.labeler_id || ''",
    "  const filename = body.filename || ''",
    "  if (!labelerId) return c.json({ ok: false, error: 'labeler_id required' }, 400)",
    '  const now = new Date().toISOString()',
    '  try {',
    "    await c.env.DB.prepare(",
    "      'INSERT INTO presence (labeler_id, filename, last_seen) ' +",
    "      'VALUES (?, ?, ?) ' +",
    "      'ON CONFLICT(labeler_id) DO UPDATE SET filename=excluded.filename, last_seen=excluded.last_seen'",
    '    ).bind(labelerId, filename, now).run()',
    '    return c.json({ ok: true })',
    '  } catch (err: any) { return c.json({ ok: false, error: err.message }, 500) }',
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
    "    await c.env.DB.prepare('DELETE FROM presence WHERE labeler_id = ?').bind(labelerId).run()",
    '    return c.json({ ok: true })',
    '  } catch (err: any) { return c.json({ ok: false, error: err.message }, 500) }',
    '}',
    '',
    "api.delete('/presence', handlePresenceDelete)",
    "api.delete('/presence/:labeler_id', handlePresenceDelete)",
    '',
  ].join('\n')
}

if (!s.includes('async function handlePresenceUpsert')) {
  const start = s.indexOf('// ----------------------------------------------------------------\n// POST /api/presence - 현재 작업 중인 파일 알림')
  const endMarker = '// ----------------------------------------------------------------\n// GET /api/sync - 라벨 메타 + presence 한번에 동기화'
  const end = s.indexOf(endMarker, start)
  if (start < 0 || end < 0) {
    throw new Error('presence API block not found')
  }
  s = s.slice(0, start) + makePresenceBlock() + s.slice(end)
}

if (s !== before) {
  fs.writeFileSync(apiFile, s)
  console.log('PATCH presence API method compatibility')
} else {
  console.log('OK presence API compatibility already patched')
}
