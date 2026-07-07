/* ================================================================
   Spine Annotator - Backend API
   - 인증: 공유 비밀번호 1개 (X-Auth-Token 헤더 또는 Bearer)
   - 저장소: D1 (Cloudflare SQLite)
   ================================================================ */

import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  AUTH_PASSWORD?: string
}

const api = new Hono<{ Bindings: Bindings }>()

// ----------------------------------------------------------------
// 입력 검증: 폴리곤 배열을 안전한 형태로 정규화
//  - 개수 / 점 개수 상한, 좌표는 유한한 숫자만 허용, label은 문자열로 강제
//  - 문제가 있으면 { error } 를 반환하고 호출측에서 클라이언트에 메시지를 전달
// ----------------------------------------------------------------
const MAX_POLYGONS = 200          // 이미지당 폴리곤 상한 (척추 25 + 골반 등 여유)
const MAX_POINTS_PER_POLY = 2000  // 폴리곤 1개의 (x,y) 점 상한
const MAX_LABEL_LEN = 40

function sanitizePolygons(raw: any): { polygons?: any[]; error?: string } {
  if (!Array.isArray(raw)) return { error: 'polygons must be an array' }
  if (raw.length > MAX_POLYGONS) return { error: `too many polygons (max ${MAX_POLYGONS})` }
  const out: any[] = []
  for (let i = 0; i < raw.length; i++) {
    const poly = raw[i]
    if (!poly || typeof poly !== 'object') return { error: `polygon[${i}] is not an object` }
    const pts = poly.points
    if (!Array.isArray(pts)) return { error: `polygon[${i}].points must be an array` }
    if (pts.length % 2 !== 0) return { error: `polygon[${i}].points length must be even` }
    if (pts.length < 6) return { error: `polygon[${i}] needs at least 3 points` }
    if (pts.length > MAX_POINTS_PER_POLY * 2) return { error: `polygon[${i}] has too many points (max ${MAX_POINTS_PER_POLY})` }
    const cleanPts: number[] = []
    for (const v of pts) {
      const n = Number(v)
      if (!Number.isFinite(n)) return { error: `polygon[${i}] has a non-numeric coordinate` }
      cleanPts.push(n)
    }
    out.push({ ...poly, points: cleanPts, label: poly.label == null ? '' : String(poly.label).slice(0, MAX_LABEL_LEN) })
  }
  return { polygons: out }
}

// ----------------------------------------------------------------
// 인증 비활성화 - sagittal-measurements preview 전용
// ----------------------------------------------------------------
api.use('*', async (_c, next) => {
  return next()
})

// ----------------------------------------------------------------
// POST /api/auth/check - 로그인 제거: 항상 성공
// ----------------------------------------------------------------
api.post('/auth/check', async (c) => {
  return c.json({ ok: true, token: 'public-access', auth_disabled: true })
})

// ----------------------------------------------------------------
// GET /api/labels - 모든 파일의 라벨 메타 (목록용)
// 반환: [{ filename, view_type, labeler_id, polygon_count, updated_at }]
// ----------------------------------------------------------------
api.get('/labels', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT filename, view_type, labeler_id, polygon_count, updated_at, version, image_width, image_height
      FROM labels
      ORDER BY updated_at DESC
    `).all()
    return c.json({ ok: true, items: result.results || [] })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// GET /api/labels/:filename - 단일 파일의 폴리곤 전체
// ----------------------------------------------------------------
api.get('/labels/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  try {
    const row = await c.env.DB.prepare(`
      SELECT * FROM labels WHERE filename = ?
    `).bind(filename).first<any>()

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

// ----------------------------------------------------------------
// PUT /api/labels/:filename - 저장 (upsert)
// body: { view_type, start_label, polygons, labeler_id }
// ----------------------------------------------------------------
api.put('/labels/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid json' }, 400)
  }

  const sanitized = sanitizePolygons(Array.isArray(body.polygons) ? body.polygons : [])
  if (sanitized.error) {
    return c.json({ ok: false, error: sanitized.error }, 400)
  }
  const polygons = sanitized.polygons!
  const landmarks = Array.isArray(body.landmarks) ? body.landmarks : []
  const polygonsJson = landmarks.length > 0 ? JSON.stringify({ polygons, landmarks }) : JSON.stringify(polygons)
  const now = new Date().toISOString()
  const viewType = body.view_type || null
  const startLabel = body.start_label || null
  const labelerId = body.labeler_id || null
  const polyCount = polygons.length
  const imageWidth = Number.isFinite(Number(body.image_width)) ? Math.round(Number(body.image_width)) : null
  const imageHeight = Number.isFinite(Number(body.image_height)) ? Math.round(Number(body.image_height)) : null
  const clientVersion = Number.isInteger(body.version) ? body.version : null

  try {
    const existing = await c.env.DB.prepare(`
      SELECT filename, version, updated_at, labeler_id, polygon_count
      FROM labels WHERE filename = ?
    `).bind(filename).first<any>()

    // 폴리곤 0개인데 새로 저장 요청 → 빈 데이터는 저장 안 함 (실수 방지)
    // 기존에 있는 데이터를 0개로 만드는 건 명시적 DELETE로
    if (polyCount === 0 && landmarks.length === 0 && !existing) {
      return c.json({ ok: true, skipped: true, reason: '빈 라벨은 저장하지 않음' })
    }

    if (existing) {
      let result: D1Result
      if (clientVersion !== null) {
        result = await c.env.DB.prepare(`
          UPDATE labels SET
            view_type = ?,
            start_label = ?,
            image_width = ?,
            image_height = ?,
            polygons_json = ?,
            labeler_id = ?,
            polygon_count = ?,
            updated_at = ?,
            version = version + 1
          WHERE filename = ? AND version = ?
        `).bind(
          viewType, startLabel, imageWidth, imageHeight, polygonsJson,
          labelerId, polyCount, now, filename, clientVersion
        ).run()

        if ((result.meta?.changes || 0) === 0) {
          const current = await c.env.DB.prepare(`
            SELECT version, updated_at, labeler_id, polygon_count
            FROM labels WHERE filename = ?
          `).bind(filename).first<any>()
          return c.json({
            ok: false,
            error: 'version_conflict',
            message: '다른 사용자가 먼저 저장했습니다. 최신 라벨을 불러온 뒤 다시 저장해주세요.',
            current,
          }, 409)
        }
      } else {
        // 구버전 클라이언트 호환: version이 없는 요청은 기존 방식대로 저장
        await c.env.DB.prepare(`
          UPDATE labels SET
            view_type = ?,
            start_label = ?,
            image_width = ?,
            image_height = ?,
            polygons_json = ?,
            labeler_id = ?,
            polygon_count = ?,
            updated_at = ?,
            version = version + 1
          WHERE filename = ?
        `).bind(
          viewType, startLabel, imageWidth, imageHeight, polygonsJson,
          labelerId, polyCount, now, filename
        ).run()
      }
    } else {
      await c.env.DB.prepare(`
        INSERT INTO labels (
          filename, view_type, start_label, image_width, image_height, polygons_json,
          labeler_id, polygon_count, updated_at, created_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(
        filename, viewType, startLabel, imageWidth, imageHeight, polygonsJson,
        labelerId, polyCount, now, now
      ).run()
    }

    const saved = await c.env.DB.prepare(`
      SELECT version, updated_at FROM labels WHERE filename = ?
    `).bind(filename).first<any>()
    return c.json({ ok: true, saved: true, version: saved?.version ?? null, updated_at: saved?.updated_at ?? now })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// DELETE /api/labels/:filename - 라벨 삭제
// ----------------------------------------------------------------
api.delete('/labels/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  try {
    await c.env.DB.prepare(`DELETE FROM labels WHERE filename = ?`).bind(filename).run()
    return c.json({ ok: true, deleted: true })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// File notes / memo API - COCO 라벨과 분리 저장
// ----------------------------------------------------------------
async function ensureNotesTable(c: any) {
  await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS notes (filename TEXT PRIMARY KEY, note_text TEXT NOT NULL DEFAULT '', labeler_id TEXT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL)`).run()
  await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC)').run()
  await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notes_labeler ON notes(labeler_id)').run()
}

api.get('/notes/export', async (c) => {
  try {
    await ensureNotesTable(c)
    const result = await c.env.DB.prepare(`SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE note_text <> '' ORDER BY filename`).all<any>()
    return c.json({ ok: true, exported_at: new Date().toISOString(), items: result.results || [] })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

api.get('/notes/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  try {
    await ensureNotesTable(c)
    const row = await c.env.DB.prepare('SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE filename = ?').bind(filename).first<any>()
    if (!row) return c.json({ ok: true, exists: false, filename, note_text: '' })
    return c.json({ ok: true, exists: true, ...row })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

api.put('/notes/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'))
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid json' }, 400) }
  const noteText = String(body?.note_text ?? '').slice(0, 20000)
  const labelerId = body?.labeler_id || null
  const now = new Date().toISOString()
  try {
    await ensureNotesTable(c)
    if (noteText.trim() === '') {
      await c.env.DB.prepare('DELETE FROM notes WHERE filename = ?').bind(filename).run()
      return c.json({ ok: true, saved: true, deleted: true, filename, note_text: '', updated_at: now })
    }
    await c.env.DB.prepare('INSERT INTO notes (filename, note_text, labeler_id, updated_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(filename) DO UPDATE SET note_text=excluded.note_text, labeler_id=excluded.labeler_id, updated_at=excluded.updated_at').bind(filename, noteText, labelerId, now, now).run()
    return c.json({ ok: true, saved: true, filename, note_text: noteText, updated_at: now })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// GET /api/export - 모든 라벨 내보내기
// query: format=coco|raw, view=AP|LAT, labeler=park|kim|hwang, min_polygons=25
// ----------------------------------------------------------------
api.get('/export', async (c) => {
  try {
    const format = c.req.query('format') || 'coco'
    const view = c.req.query('view') || ''
    const labeler = c.req.query('labeler') || ''
    const minPolys = Number(c.req.query('min_polygons') || 0)

    const clauses: string[] = []
    const params: any[] = []
    if (view) { clauses.push('view_type = ?'); params.push(view) }
    if (labeler) { clauses.push('labeler_id = ?'); params.push(labeler) }
    if (minPolys > 0) { clauses.push('polygon_count >= ?'); params.push(minPolys) }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''

    const result = await c.env.DB.prepare(`
      SELECT * FROM labels ${where} ORDER BY filename
    `).bind(...params).all<any>()

    const rows = result.results || []
    if (format === 'raw') {
      return c.json({ ok: true, items: rows.map(row => {
        const parsed = parseStoredLabelData(row.polygons_json)
        return { ...row, polygons: parsed.polygons, landmarks: parsed.landmarks }
      }) })
    }

    // COCO 형식 변환
    const images: any[] = []
    const annotations: any[] = []
    const categories = generateCocoCategories()
    let annId = 1
    let imgId = 1

    for (const row of rows) {
      const polygons = parseStoredLabelData(row.polygons_json).polygons
      const width = row.image_width || 0
      const height = row.image_height || 0
      images.push({ id: imgId, file_name: row.filename, width, height })
      for (const poly of polygons) {
        const label = poly.label || ''
        const cat = categories.find(c => c.name === label)
        if (!cat) continue
        // 과거 데이터 방어: 좌표가 짝수 개의 유한한 숫자가 아니면 스킵 (NaN annotation 방지)
        const rawPts = Array.isArray(poly.points) ? poly.points : []
        const pts = rawPts.map(Number)
        if (pts.length < 6 || pts.length % 2 !== 0 || pts.some((n: number) => !Number.isFinite(n))) continue
        annotations.push({
          id: annId++, image_id: imgId, category_id: cat.id,
          segmentation: [pts], bbox: polygonBbox(pts), area: polygonArea(pts),
          iscrowd: 0,
        })
      }
      imgId++
    }

    return c.json({ ok: true, images, annotations, categories })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

function parseStoredLabelData(raw: string | null | undefined) {
  let parsed: any = []
  try { parsed = JSON.parse(raw || '[]') } catch {}
  if (Array.isArray(parsed)) return { polygons: parsed, landmarks: [] }
  return {
    polygons: Array.isArray(parsed?.polygons) ? parsed.polygons : [],
    landmarks: Array.isArray(parsed?.landmarks) ? parsed.landmarks : [],
  }
}

function generateCocoCategories() {
  const cats: any[] = []
  let id = 1
  for (const prefix of ['C', 'T', 'L']) {
    const max = prefix === 'C' ? 7 : prefix === 'T' ? 12 : 5
    for (let i = 1; i <= max; i++) cats.push({ id: id++, name: `${prefix}${i}`, supercategory: 'vertebra' })
  }
  cats.push({ id: id++, name: 'S1', supercategory: 'vertebra' })
  return cats
}

function polygonBbox(pts: number[]) {
  const xs = pts.filter((_, i) => i % 2 === 0)
  const ys = pts.filter((_, i) => i % 2 === 1)
  if (!xs.length) return [0, 0, 0, 0]
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  return [minX, minY, maxX - minX, maxY - minY]
}

function polygonArea(pts: number[]) {
  let area = 0
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length
    area += pts[i] * pts[j + 1] - pts[j] * pts[i + 1]
  }
  return Math.abs(area / 2)
}

// ----------------------------------------------------------------
// GET /api/stats - 통계 요약
// ----------------------------------------------------------------
api.get('/stats', async (c) => {
  try {
    const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM labels`).first<any>()
    const byLabeler = await c.env.DB.prepare(`SELECT labeler_id, COUNT(*) as cnt FROM labels GROUP BY labeler_id`).all()
    const byView = await c.env.DB.prepare(`SELECT view_type, COUNT(*) as cnt FROM labels GROUP BY view_type`).all()
    return c.json({ ok: true, total: total?.cnt || 0, by_labeler: byLabeler.results || [], by_view: byView.results || [] })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// POST /api/migrate - localStorage 백업 업로드
// ----------------------------------------------------------------
api.post('/migrate', async (c) => {
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid json' }, 400) }
  const items = Array.isArray(body.items) ? body.items : []
  const results: any[] = []
  for (const it of items) {
    try {
      const filename = it.filename
      const data = it.data || {}
      const sanitized = sanitizePolygons(Array.isArray(data.polygons) ? data.polygons : [])
      if (sanitized.error) { results.push({ filename: it.filename, ok: false, error: sanitized.error }); continue }
      const polygons = sanitized.polygons!
      if (!filename || polygons.length === 0) { results.push({ filename, ok: false, reason: 'empty' }); continue }
      const polygonsJson = JSON.stringify(polygons)
      const now = new Date().toISOString()
      const viewType = data.view_type || data.viewType || null
      const startLabel = data.start_label || data.startLabel || null
      const labelerId = data.labeler_id || data.labelerId || null
      await c.env.DB.prepare(`
        INSERT INTO labels (filename, view_type, start_label, polygons_json, labeler_id, polygon_count, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(filename) DO UPDATE SET
          view_type=excluded.view_type,
          start_label=excluded.start_label,
          polygons_json=excluded.polygons_json,
          labeler_id=excluded.labeler_id,
          polygon_count=excluded.polygon_count,
          updated_at=excluded.updated_at
      `).bind(filename, viewType, startLabel, polygonsJson, labelerId, polygons.length, now, now).run()
      results.push({ filename, ok: true })
    } catch (e: any) {
      results.push({ filename: it.filename, ok: false, error: e.message })
    }
  }
  return c.json({ ok: true, results })
})

// ----------------------------------------------------------------
// POST/PUT /api/presence - 현재 작업 중인 파일 알림
// ----------------------------------------------------------------
async function ensurePresenceTable(c: any) {
  await c.env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS presence (' +
    'labeler_id TEXT PRIMARY KEY, ' +
    'filename TEXT, ' +
    'last_seen TEXT' +
    ')'
  ).run()
}

async function handlePresenceUpsert(c: any) {
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid json' }, 400) }
  const labelerId = body.labeler_id || ''
  const filename = body.filename || ''
  if (!labelerId) return c.json({ ok: false, error: 'labeler_id required' }, 400)
  const now = new Date().toISOString()
  try {
    await ensurePresenceTable(c)
    await c.env.DB.prepare(
      'INSERT INTO presence (labeler_id, filename, last_seen) ' +
      'VALUES (?, ?, ?) ' +
      'ON CONFLICT(labeler_id) DO UPDATE SET filename=excluded.filename, last_seen=excluded.last_seen'
    ).bind(labelerId, filename, now).run()
    return c.json({ ok: true })
  } catch (err: any) { return c.json({ ok: true, warning: 'presence_unavailable', detail: err.message }) }
}

api.post('/presence', handlePresenceUpsert)
api.put('/presence', handlePresenceUpsert)

async function handlePresenceDelete(c: any) {
  let labelerId = c.req.param('labeler_id') ? decodeURIComponent(c.req.param('labeler_id')) : ''
  if (!labelerId) {
    try {
      const body = await c.req.json()
      labelerId = body?.labeler_id || ''
    } catch {}
  }
  if (!labelerId) return c.json({ ok: false, error: 'labeler_id required' }, 400)
  try {
    await ensurePresenceTable(c)
    await c.env.DB.prepare('DELETE FROM presence WHERE labeler_id = ?').bind(labelerId).run()
    return c.json({ ok: true })
  } catch (err: any) { return c.json({ ok: true, warning: 'presence_unavailable', detail: err.message }) }
}

api.delete('/presence', handlePresenceDelete)
api.delete('/presence/:labeler_id', handlePresenceDelete)
// ----------------------------------------------------------------
// GET /api/sync - 라벨 메타 + presence 한번에 동기화
// ----------------------------------------------------------------
api.get('/sync', async (c) => {
  try {
    await ensurePresenceTable(c)
    const labels = await c.env.DB.prepare(`
      SELECT filename, view_type, labeler_id, polygon_count, updated_at, version, image_width, image_height
      FROM labels
      ORDER BY updated_at DESC
    `).all()
    const presence = await c.env.DB.prepare(`
      SELECT labeler_id, filename, last_seen
      FROM presence
      WHERE datetime(last_seen) >= datetime('now', '-30 seconds')
    `).all()
    return c.json({ ok: true, server_time: new Date().toISOString(), labels: labels.results || [], presence: presence.results || [] })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

export { api as apiRoutes }
