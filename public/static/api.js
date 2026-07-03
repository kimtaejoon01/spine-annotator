/* ================================================================
   서버 API 클라이언트
   - sagittal-measurements preview: 인증 비활성화
   - LocalStorage 폴백 (네트워크 실패 시)
   ================================================================ */

const TOKEN_KEY = 'spine-annotator:authToken'
const CACHE_PREFIX = 'spine-annotator-cache:'
const PUBLIC_TOKEN = 'public-access'

// ----------------------------------------------------------------
// 인증 토큰 관리 - 이 브랜치에서는 로그인 없이 통과
// ----------------------------------------------------------------
export function getAuthToken() {
  return PUBLIC_TOKEN
}

export function setAuthToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token || PUBLIC_TOKEN)
  } catch (e) {
    console.warn('Token save failed:', e)
  }
}

export function hasAuthToken() {
  return true
}

// ----------------------------------------------------------------
// 비밀번호 검증 - 로그인 제거: 항상 성공
// ----------------------------------------------------------------
export async function verifyPassword(_password) {
  setAuthToken(PUBLIC_TOKEN)
  return { ok: true, token: PUBLIC_TOKEN, auth_disabled: true }
}

// ----------------------------------------------------------------
// 공통 fetch 래퍼
// ----------------------------------------------------------------
async function apiFetch(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  }
  headers['X-Auth-Token'] = PUBLIC_TOKEN

  const res = await fetch(path, { ...opts, headers })

  if (res.status === 401) {
    const err = new Error('인증이 비활성화된 브랜치인데 서버가 401을 반환했습니다. 최신 preview 배포인지 확인해주세요.')
    err.status = 401
    throw err
  }

  if (!res.ok) {
    let msg = `서버 오류 (${res.status})`
    try {
      const data = await res.json()
      msg = data.error || data.message || msg
    } catch {}
    const err = new Error(msg)
    err.status = res.status
    throw err
  }

  return res.json()
}

// ----------------------------------------------------------------
// 라벨 API
// ----------------------------------------------------------------

/**
 * 모든 파일의 라벨 메타 (목록용 - 점 색깔/카운트 표시)
 * @returns Promise<{items: Array<{filename, view_type, labeler_id, polygon_count, updated_at}>}>
 */
export async function listLabelMeta() {
  const data = await apiFetch('/api/labels')
  // 캐시 갱신
  try {
    sessionStorage.setItem('spine-annotator:labelMeta', JSON.stringify(data.items || []))
  } catch {}
  return data.items || []
}

/**
 * 메타 캐시 즉시 조회 (오프라인/빠른 렌더용)
 */
export function getCachedLabelMeta() {
  try {
    const raw = sessionStorage.getItem('spine-annotator:labelMeta')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * 단일 파일의 라벨 로드
 * @returns {exists, polygons, start_label, labeler_id, ...} 또는 {exists:false}
 */
export async function loadLabel(filename) {
  try {
    const data = await apiFetch(`/api/labels/${encodeURIComponent(filename)}`)
    // 로컬 캐시 백업 (서버 응답 성공 시)
    if (data.exists) {
      cacheLabelLocal(filename, data)
    }
    return data
  } catch (err) {
    // 네트워크 오류 시 로컬 캐시 폴백
    if (err.status === 401) throw err
    const cached = loadLabelFromCache(filename)
    if (cached) {
      console.warn('[API] Network failed, using local cache for', filename)
      return cached
    }
    throw err
  }
}

/**
 * 라벨 저장 (debounce는 호출 측에서)
 */
export async function saveLabel(filename, payload) {
  // 로컬 캐시도 동시에 갱신 (네트워크 실패 대비)
  cacheLabelLocal(filename, {
    exists: true,
    filename,
    ...payload,
  })

  try {
    return await apiFetch(`/api/labels/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  } catch (err) {
    if (err.status === 401) throw err
    // 네트워크 실패 - 로컬 캐시에 보류 표시
    markPendingSave(filename, payload)
    throw err
  }
}

/**
 * 라벨 삭제
 */
export async function deleteLabel(filename) {
  removeLabelLocal(filename)
  return apiFetch(`/api/labels/${encodeURIComponent(filename)}`, { method: 'DELETE' })
}

/** 파일별 메모 로드 */
export async function loadNote(filename) {
  return apiFetch('/api/notes/' + encodeURIComponent(filename))
}

/** 파일별 메모 저장 */
export async function saveNote(filename, payload) {
  return apiFetch('/api/notes/' + encodeURIComponent(filename), {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** 전체 메모 별도 내보내기 */
export async function exportNotes() {
  return apiFetch('/api/notes/export')
}

/**
 * 일괄 내보내기
 * @param {Object} filters - {format, view, labeler, min_polygons}
 */
export async function exportAll(filters = {}) {
  const qs = new URLSearchParams()
  if (filters.format) qs.set('format', filters.format)
  if (filters.view) qs.set('view', filters.view)
  if (filters.labeler) qs.set('labeler', filters.labeler)
  if (filters.min_polygons != null) qs.set('min_polygons', String(filters.min_polygons))
  return apiFetch(`/api/export?${qs.toString()}`)
}

/**
 * 통계
 */
export async function getStats() {
  return apiFetch('/api/stats')
}

// ----------------------------------------------------------------
// Presence (현재 작업 중 표시) + Sync (실시간 동기화)
// ----------------------------------------------------------------

/**
 * Heartbeat: 내가 어느 파일을 보고 있는지 서버에 알림
 * - labelerId 없으면 무시 (라벨러 선택 안 한 상태)
 * - filename 없으면 = 아이들 상태(파일 미선택)
 */
export async function sendPresence(labelerId, filename) {
  if (!labelerId) return null
  try {
    return await apiFetch('/api/presence', {
      method: 'PUT',
      body: JSON.stringify({ labeler_id: labelerId, filename: filename || '' }),
    })
  } catch (e) {
    return null
  }
}

/**
 * 작업 종료 (탭 닫기/언로드 시)
 */
export async function clearPresence(labelerId) {
  if (!labelerId) return null
  try {
    return await apiFetch('/api/presence', {
      method: 'DELETE',
      body: JSON.stringify({ labeler_id: labelerId }),
    })
  } catch {
    return null
  }
}

/**
 * sendBeacon으로 페이지 종료 시에도 안전하게 presence 제거
 */
export function clearPresenceBeacon(labelerId) {
  if (!labelerId) return
  try {
    fetch('/api/presence', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': PUBLIC_TOKEN,
      },
      body: JSON.stringify({ labeler_id: labelerId }),
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

/**
 * 통합 동기화: 라벨 메타 목록 + 활성 presence 한 번에
 * @param {string} since - ISO timestamp (이 시각 이후 변경분만, 옵션)
 */
export async function syncState(since = '') {
  const qs = since ? `?since=${encodeURIComponent(since)}` : ''
  try {
    return await apiFetch(`/api/sync${qs}`)
  } catch (err) {
    if (err.status === 401) throw err
    return { ok: false, labels: [], presence: [] }
  }
}

// ----------------------------------------------------------------
// 로컬 캐시 (오프라인 백업)
// ----------------------------------------------------------------
function cacheLabelLocal(filename, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + filename, JSON.stringify({
      ...data,
      _cached_at: new Date().toISOString(),
    }))
  } catch {}
}

function loadLabelFromCache(filename) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + filename)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function removeLabelLocal(filename) {
  try {
    localStorage.removeItem(CACHE_PREFIX + filename)
    localStorage.removeItem(PENDING_PREFIX + filename)
  } catch {}
}

const PENDING_PREFIX = 'spine-annotator-pending:'

function markPendingSave(filename, payload) {
  try {
    localStorage.setItem(PENDING_PREFIX + filename, JSON.stringify({
      payload,
      pending_at: new Date().toISOString(),
    }))
  } catch {}
}

/**
 * 보류 중인 저장 항목 (네트워크 복구 시 재시도)
 */
export function getPendingSaves() {
  const items = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(PENDING_PREFIX)) {
        const filename = key.slice(PENDING_PREFIX.length)
        try {
          const data = JSON.parse(localStorage.getItem(key))
          items.push({ filename, ...data })
        } catch {}
      }
    }
  } catch {}
  return items
}

/**
 * 보류 중인 저장들을 서버로 재전송
 */
export async function flushPendingSaves() {
  const pending = getPendingSaves()
  const results = []
  for (const item of pending) {
    try {
      await apiFetch(`/api/labels/${encodeURIComponent(item.filename)}`, {
        method: 'PUT',
        body: JSON.stringify(item.payload),
      })
      try { localStorage.removeItem(PENDING_PREFIX + item.filename) } catch {}
      results.push({ filename: item.filename, ok: true })
    } catch (err) {
      results.push({ filename: item.filename, ok: false, error: err.message })
    }
  }
  return results
}

// ----------------------------------------------------------------
// LocalStorage 마이그레이션 (옛 데이터 → 서버 일괄 업로드)
// ----------------------------------------------------------------

/**
 * 옛 LocalStorage(`spine-annotator:파일명`)에 남아있는 라벨들을 찾아냄
 */
export function findLegacyLabels() {
  const items = []
  const LEGACY_PREFIX = 'spine-annotator:'
  const RESERVED = new Set([
    'spine-annotator:shortcuts',
    'spine-annotator:shortcuts:version',
    'spine-annotator:sidebar',
    'spine-annotator:currentLabeler',
    'spine-annotator:authToken',
    'spine-annotator:labelMeta',
  ])
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(LEGACY_PREFIX)) continue
      if (RESERVED.has(key)) continue
      if (key.startsWith(CACHE_PREFIX)) continue
      if (key.startsWith(PENDING_PREFIX)) continue
      const filename = key.slice(LEGACY_PREFIX.length)
      try {
        const data = JSON.parse(localStorage.getItem(key))
        if (Array.isArray(data?.polygons) && data.polygons.length > 0) {
          items.push({ filename, data })
        }
      } catch {}
    }
  } catch {}
  return items
}

/**
 * 옛 LocalStorage 라벨들을 서버로 일괄 마이그레이션
 * @param {boolean} deleteAfter - 성공하면 LocalStorage에서 삭제
 */
export async function migrateLegacyLabels({ deleteAfter = false } = {}) {
  const items = findLegacyLabels()
  const results = []
  for (const item of items) {
    try {
      await apiFetch(`/api/labels/${encodeURIComponent(item.filename)}`, {
        method: 'PUT',
        body: JSON.stringify({
          view_type: item.data.viewType || null,
          start_label: item.data.startLabel || null,
          polygons: item.data.polygons || [],
          labeler_id: item.data.labelerId || null,
        }),
      })
      if (deleteAfter) {
        try { localStorage.removeItem('spine-annotator:' + item.filename) } catch {}
      }
      results.push({ filename: item.filename, ok: true })
    } catch (err) {
      results.push({ filename: item.filename, ok: false, error: err.message })
    }
  }
  return results
}
