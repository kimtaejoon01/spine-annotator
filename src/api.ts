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

// 운영 비밀번호는 반드시 Cloudflare Pages secret(AUTH_PASSWORD) 또는 로컬 .dev.vars로 주입합니다.
function getAuthPassword(c: any) {
  const password = c.env.AUTH_PASSWORD
  if (typeof password !== 'string' || password.trim() === '') return ''
  return password
}

// ----------------------------------------------------------------
// 인증 미들웨어
// ----------------------------------------------------------------
api.use('*', async (c, next) => {
  // /api/auth/check 는 인증 없이 호출 가능 (비밀번호 검증 자체용)
  if (c.req.path === '/api/auth/check') {
    return next()
  }

  const expected = getAuthPassword(c)
  if (!expected) {
    return c.json({ error: 'server_misconfigured', message: 'AUTH_PASSWORD가 설정되지 않았습니다' }, 500)
  }
  const header = c.req.header('X-Auth-Token') || ''
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  const token = header || bearer

  if (!token || token !== expected) {
    return c.json({ error: 'unauthorized', message: '인증이 필요합니다' }, 401)
  }
  return next()
})

// ----------------------------------------------------------------
// POST /api/auth/check - 비밀번호 검증
// ----------------------------------------------------------------
api.post('/auth/check', async (c) => {
  const expected = getAuthPassword(c)
  if (!expected) {
    return c.json({ ok: false, error: 'AUTH_PASSWORD가 설정되지 않았습니다' }, 500)
  }
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {}
  const password = body?.password || ''
  if (password === expected) {
    return c.json({ ok: true, token: password })
  }
  return c.json({ ok: false, error: '비밀번호가 틀렸습니다' }, 401)
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

    let polygons: any[] = []
    try {
      polygons = JSON.parse(row.polygons_json || '[]')
    } catch {}

    return c.json({
      ok: true,
      exists: true,
      filename: row.filename,
      view_type: row.view_type,
      start_label: row.start_label,
      image_width: row.image_width ?? null,
      image_height: row.image_height ?? null,
      polygons,
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

  const polygons = Array.isArray(body.polygons) ? body.polygons : []
  const polygonsJson = JSON.stringify(polygons)
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
    if (polyCount === 0 && !existing) {
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

    return c.json({
      ok: true,
      filename,
      polygon_count: polyCount,
      updated_at: saved?.updated_at || now,
      version: saved?.version || null,
    })
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
    return c.json({ ok: true, filename })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// GET /api/export - 전체 라벨 일괄 내보내기 (COCO 또는 raw)
// 쿼리: ?format=coco|raw&view=AP|LAT&labeler=park|kim|hwang&min_polygons=N
// ----------------------------------------------------------------
api.get('/export', async (c) => {
  const format = c.req.query('format') || 'raw'
  const view = c.req.query('view') || ''
  const labeler = c.req.query('labeler') || ''
  const minPolys = parseInt(c.req.query('min_polygons') || '0', 10)

  try {
    let sql = `SELECT * FROM labels WHERE polygon_count >= ?`
    const params: any[] = [minPolys]
    if (view) {
      sql += ` AND view_type = ?`
      params.push(view)
    }
    if (labeler) {
      sql += ` AND labeler_id = ?`
      params.push(labeler)
    }
    sql += ` ORDER BY filename`

    const result = await c.env.DB.prepare(sql).bind(...params).all<any>()
    const rows = result.results || []

    if (format === 'raw') {
      // 그대로 JSON 배열로 (백업/복원용)
      const items = rows.map((r: any) => {
        let polygons: any[] = []
        try {
          polygons = JSON.parse(r.polygons_json || '[]')
        } catch {}
        return {
          filename: r.filename,
          view_type: r.view_type,
          start_label: r.start_label,
          image_width: r.image_width ?? null,
          image_height: r.image_height ?? null,
          polygons,
          labeler_id: r.labeler_id,
          polygon_count: r.polygon_count,
          updated_at: r.updated_at,
          created_at: r.created_at,
        }
      })
      return c.json({
        ok: true,
        format: 'raw',
        count: items.length,
        exported_at: new Date().toISOString(),
        filters: { view, labeler, min_polygons: minPolys },
        items,
      })
    }

    // COCO 통합 형식
    // categories: C1~S1 25개 고정 (labels.js와 일치)
    const LABEL_SEQ = [
      'C1','C2','C3','C4','C5','C6','C7',
      'T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12',
      'L1','L2','L3','L4','L5','S1',
    ]
    const categories = LABEL_SEQ.map((name, i) => ({ id: i + 1, name, supercategory: 'vertebra' }))
    const labelToId = new Map(LABEL_SEQ.map((l, i) => [l, i + 1]))

    const images: any[] = []
    const annotations: any[] = []
    let nextImageId = 1
    let nextAnnId = 1

    for (const r of rows) {
      let polygons: any[] = []
      try {
        polygons = JSON.parse(r.polygons_json || '[]')
      } catch {}
      if (polygons.length === 0) continue

      const imgId = nextImageId++
      images.push({
        id: imgId,
        file_name: r.filename,
        width: r.image_width ?? null,
        height: r.image_height ?? null,
        view_type: r.view_type,
        labeler_id: r.labeler_id,
        updated_at: r.updated_at,
      })

      for (const poly of polygons) {
        const catId = labelToId.get(poly.label) || 0
        const pts = poly.points || []
        if (pts.length < 6) continue

        // bbox 계산
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (let i = 0; i < pts.length; i += 2) {
          if (pts[i] < minX) minX = pts[i]
          if (pts[i] > maxX) maxX = pts[i]
          if (pts[i + 1] < minY) minY = pts[i + 1]
          if (pts[i + 1] > maxY) maxY = pts[i + 1]
        }
        // Shoelace area
        let area = 0
        for (let i = 0; i < pts.length; i += 2) {
          const j = (i + 2) % pts.length
          area += pts[i] * pts[j + 1] - pts[j] * pts[i + 1]
        }
        area = Math.abs(area) / 2

        annotations.push({
          id: nextAnnId++,
          image_id: imgId,
          category_id: catId,
          segmentation: [pts],
          bbox: [minX, minY, maxX - minX, maxY - minY],
          area,
          iscrowd: 0,
          label: poly.label,
        })
      }
    }

    return c.json({
      info: {
        description: 'Spine Annotator COCO Export',
        version: '1.0',
        date_created: new Date().toISOString(),
        filters: { view, labeler, min_polygons: minPolys },
      },
      categories,
      images,
      annotations,
    })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// Presence (실시간 작업 중 표시)
// - POST /api/presence  body: { labeler_id, filename }
//   호출할 때마다 last_seen 갱신. 클라이언트는 5초마다 보냄.
//   filename === '' 이면 해당 라벨러의 모든 presence 제거 (창 닫기 / 다른 라벨러로 전환)
// - GET  /api/presence  → { active: [{ labeler_id, filename, last_seen, seconds_ago }] }
//   stale cutoff: 30초 이상 안 본 row 는 제외
// ----------------------------------------------------------------
const PRESENCE_TTL_SECONDS = 30  // 30초 동안 heartbeat 없으면 offline

api.post('/presence', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid json' }, 400)
  }
  const labelerId = (body?.labeler_id || '').toString().trim()
  const filename = (body?.filename || '').toString().trim()

  if (!labelerId) {
    return c.json({ ok: false, error: 'labeler_id required' }, 400)
  }

  const now = new Date().toISOString()
  try {
    if (!filename) {
      // 라벨러가 작업 중단 / 창 닫음 → 해당 라벨러의 모든 presence 제거
      await c.env.DB.prepare(`DELETE FROM presence WHERE labeler_id = ?`).bind(labelerId).run()
      return c.json({ ok: true, cleared: true })
    }

    // upsert: 한 라벨러는 한 번에 하나의 파일만 작업 중인 것으로 본다
    // → 같은 labeler_id 의 다른 filename 행은 정리
    await c.env.DB.prepare(`DELETE FROM presence WHERE labeler_id = ? AND filename != ?`)
      .bind(labelerId, filename).run()

    await c.env.DB.prepare(`
      INSERT INTO presence (labeler_id, filename, last_seen)
      VALUES (?, ?, ?)
      ON CONFLICT(labeler_id, filename) DO UPDATE SET last_seen = excluded.last_seen
    `).bind(labelerId, filename, now).run()

    return c.json({ ok: true, labeler_id: labelerId, filename, last_seen: now })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// PRESENCE: 현재 누가 어느 파일을 작업 중인지
// - POST/PUT /api/presence: heartbeat
// - DELETE /api/presence: 작업 종료
// - GET /api/presence: 활성 작업자 목록
// ----------------------------------------------------------------
// PUT /api/presence - heartbeat (현재 보고 있는 파일 기록)
// body: { labeler_id, filename }
api.put('/presence', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const labelerId = body.labeler_id || ''
  const filename = body.filename || ''
  if (!labelerId) {
    return c.json({ ok: false, error: 'labeler_id required' }, 400)
  }
  const now = new Date().toISOString()

  try {
    if (filename) {
      // 이 라벨러의 다른 파일 presence는 제거 (한 명은 한 파일만 작업)
      await c.env.DB.prepare(`
        DELETE FROM presence WHERE labeler_id = ? AND filename != ?
      `).bind(labelerId, filename).run()

      await c.env.DB.prepare(`
        INSERT INTO presence (labeler_id, filename, last_seen)
        VALUES (?, ?, ?)
        ON CONFLICT(labeler_id, filename) DO UPDATE SET last_seen = excluded.last_seen
      `).bind(labelerId, filename, now).run()
    } else {
      // 파일 없이 heartbeat = 모든 presence 정리 (아이들 상태)
      await c.env.DB.prepare(`
        DELETE FROM presence WHERE labeler_id = ?
      `).bind(labelerId).run()
    }
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// DELETE /api/presence - 작업 종료 (탭 닫기 등)
// body: { labeler_id }
api.delete('/presence', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const labelerId = body.labeler_id || ''
  if (!labelerId) {
    return c.json({ ok: false, error: 'labeler_id required' }, 400)
  }
  try {
    await c.env.DB.prepare(`DELETE FROM presence WHERE labeler_id = ?`).bind(labelerId).run()
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// GET /api/presence - 활성 작업자 목록
// 응답: { active: [{ labeler_id, filename, last_seen }] }
api.get('/presence', async (c) => {
  try {
    // TTL 초과 항목 정리 (옵션 — 어차피 쿼리에서 필터)
    const cutoff = new Date(Date.now() - PRESENCE_TTL_SECONDS * 1000).toISOString()
    await c.env.DB.prepare(`DELETE FROM presence WHERE last_seen < ?`).bind(cutoff).run()

    const result = await c.env.DB.prepare(`
      SELECT labeler_id, filename, last_seen FROM presence
      WHERE last_seen >= ?
      ORDER BY last_seen DESC
    `).bind(cutoff).all<any>()

    return c.json({ ok: true, active: result.results || [] })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// GET /api/sync - 통합 폴링 엔드포인트
// 한 번에 라벨 목록 + presence 받기 (요청 절약)
// 옵션: ?since=<ISO> 로 변경분만 받기
// ----------------------------------------------------------------
api.get('/sync', async (c) => {
  const since = c.req.query('since') || ''

  try {
    // 라벨 목록 (since 이후 변경분만 또는 전체)
    let labelsSql = `SELECT filename, view_type, labeler_id, polygon_count, updated_at, version, image_width, image_height FROM labels`
    const labelsParams: any[] = []
    if (since) {
      labelsSql += ` WHERE updated_at > ?`
      labelsParams.push(since)
    }
    labelsSql += ` ORDER BY updated_at DESC`
    const labelsRes = await c.env.DB.prepare(labelsSql).bind(...labelsParams).all<any>()

    // 활성 presence
    const cutoff = new Date(Date.now() - PRESENCE_TTL_SECONDS * 1000).toISOString()
    const presenceRes = await c.env.DB.prepare(`
      SELECT labeler_id, filename, last_seen FROM presence WHERE last_seen >= ?
    `).bind(cutoff).all<any>()

    return c.json({
      ok: true,
      server_time: new Date().toISOString(),
      labels: labelsRes.results || [],
      presence: presenceRes.results || [],
      incremental: !!since,
    })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ----------------------------------------------------------------
// GET /api/stats - 통계 (라벨러별, 뷰별 카운트)
// ----------------------------------------------------------------
api.get('/stats', async (c) => {
  try {
    const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM labels`).first<any>()
    const byLabeler = await c.env.DB.prepare(`
      SELECT labeler_id, COUNT(*) as cnt FROM labels GROUP BY labeler_id
    `).all<any>()
    const byView = await c.env.DB.prepare(`
      SELECT view_type, COUNT(*) as cnt FROM labels GROUP BY view_type
    `).all<any>()
    return c.json({
      ok: true,
      total: total?.cnt || 0,
      by_labeler: byLabeler.results || [],
      by_view: byView.results || [],
    })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

export { api as apiRoutes }
