/* ================================================================
   Sagittal spinopelvic measurements from polygon labels
   ================================================================ */

const DEFAULT_DECIMALS = 1
const MEASURE_PANEL_COLLAPSE_KEY = 'spine-annotator:measure-panel-collapsed'

export function calculateSagittalMeasurements(_polygons = [], landmarks = []) {
  const items = mergeLandmarksIntoMeasurementPolygons([], landmarks)
  const byLabel = new Map()
  for (const poly of items) {
    const label = String(poly?.label || '').trim().toUpperCase()
    if (!label || !Array.isArray(poly.points) || poly.points.length < 4) continue
    if (!byLabel.has(label)) byLabel.set(label, [])
    byLabel.get(label).push(poly)
  }

  const byLandmark = buildLandmarkMap(landmarks)
  const getPoly = (label) => chooseLargestPolygon(byLabel.get(label) || [])
  const lines = {}
  const missing = []
  const measurements = {}

  const s1 = getPoly('S1')
  const l1 = getPoly('L1')
  const l4 = getPoly('L4')
  const c2 = getPoly('C2')
  const c7 = getPoly('C7')
  const t1 = getPoly('T1')
  const t12 = getPoly('T12')

  lines.S1_sup = landmarkEndplateLine(byLandmark, 'S1', 'superior')
  lines.L1_sup = landmarkEndplateLine(byLandmark, 'L1', 'superior')
  lines.L4_sup = landmarkEndplateLine(byLandmark, 'L4', 'superior')
  lines.C2_inf = landmarkEndplateLine(byLandmark, 'C2', 'inferior')
  lines.C7_inf = landmarkEndplateLine(byLandmark, 'C7', 'inferior')
  lines.T1_sup = landmarkEndplateLine(byLandmark, 'T1', 'superior')
  lines.T12_inf = landmarkEndplateLine(byLandmark, 'T12', 'inferior')

  const hip = landmarkPoint(byLandmark, 'HC_LAT') || estimateHipCenter(byLabel)
  if (hip) lines.hip_center = hip

  if (lines.L1_sup && lines.S1_sup) {
    measurements.LL = measurement('LL', 'Lumbar lordosis', angleBetweenLines(lines.L1_sup, lines.S1_sup), 'L1 superior - S1 superior Cobb')
  } else {
    missing.push('LL: L1 + S1')
  }

  if (lines.L4_sup && lines.S1_sup) {
    measurements.L4_S1 = measurement('L4-S1', 'L4-S1 lordosis', angleBetweenLines(lines.L4_sup, lines.S1_sup), 'L4 superior - S1 superior Cobb')
  } else {
    missing.push('L4-S1: L4 + S1')
  }

  if (lines.S1_sup) {
    measurements.SS = measurement('SS', 'Sacral slope', slopeAngle(lines.S1_sup), 'S1 superior endplate vs horizontal')
  } else {
    missing.push('SS: S1')
  }

  if (lines.S1_sup && hip) {
    const sacralMid = midpoint(lines.S1_sup)
    const hipToSacrum = imageVectorToMath(hip, sacralMid)
    const vertical = { x: 0, y: 1 }
    const pt = angleBetweenVectors(hipToSacrum, vertical)
    const s1Vec = lineVectorMath(lines.S1_sup)
    const normal = { x: -s1Vec.y, y: s1Vec.x }
    const piDirect = Math.min(angleBetweenVectors(normal, hipToSacrum), angleBetweenVectors({ x: -normal.x, y: -normal.y }, hipToSacrum))
    const ss = measurements.SS?.value

    measurements.PT = measurement('PT', 'Pelvic tilt', pt, 'Hip center to sacral midpoint vs vertical')
    measurements.PI = measurement('PI', 'Pelvic incidence', Number.isFinite(piDirect) ? piDirect : pt + (ss || 0), 'Sacral perpendicular vs hip center line')
    if (Number.isFinite(ss)) {
      measurements.PI_SUM = measurement('PI=SS+PT', 'PI check', ss + pt, 'SS + PT consistency check')
      measurements.PI_ERROR = measurement('PI error', 'PI direct minus sum', Math.abs(piDirect - (ss + pt)), 'Small error means geometry is consistent')
    }
  } else {
    if (!hip) missing.push('PT/PI: LAT은 HC_LAT 또는 FH_LAT')
    if (!lines.S1_sup) missing.push('PT/PI: S1')
  }

  if (lines.C2_inf) measurements.C2S = measurement('C2S', 'C2 slope', slopeAngle(lines.C2_inf), 'C2 inferior endplate slope')
  if (lines.C7_inf) measurements.C7S = measurement('C7S', 'C7 slope', slopeAngle(lines.C7_inf), 'C7 inferior endplate slope')
  if (lines.T1_sup) measurements.T1S = measurement('T1S', 'T1 slope', slopeAngle(lines.T1_sup), 'T1 superior endplate slope')
  if (lines.L1_sup) measurements.L1S = measurement('L1S', 'L1 slope', slopeAngle(lines.L1_sup), 'L1 superior endplate slope')
  if (lines.C2_inf && lines.C7_inf) measurements.C2_C7 = measurement('C2-C7', 'C2-C7 angle', angleBetweenLines(lines.C2_inf, lines.C7_inf), 'C2 inferior - C7 inferior Cobb')
  if (lines.T1_sup && lines.T12_inf) measurements.TK = measurement('TK', 'Thoracic kyphosis', angleBetweenLines(lines.T1_sup, lines.T12_inf), 'T1 superior - T12 inferior Cobb')

  return {
    ok: Object.keys(measurements).length > 0,
    measurements,
    lines,
    missing: dedupe(missing),
    debug: buildMeasurementDebug(lines, hip),
  }
}

export function renderSagittalMeasurementPanel(polygons = [], context = {}) {
  const panel = ensureMeasurementPanel()
  if (!panel) return

  const body = panel.querySelector('[data-measure-body]')
  const subtitle = panel.querySelector('[data-measure-subtitle]')
  if (!body) return

  const result = calculateSagittalMeasurements([], context.landmarks || [])
  const isLat = String(context.viewType || '').toUpperCase() === 'LAT'

  if (subtitle) {
    subtitle.textContent = `${context.filename || ''}${context.viewType ? ' · ' + context.viewType : ''}`.trim()
  }

  if (!isLat) {
    body.innerHTML = '<p class="measurement-empty">Sagittal alignment는 LAT 영상에서 계산합니다.</p>'
    syncMeasurementDebugOverlay(null)
    return
  }

  const mainKeys = ['LL', 'SS', 'PI', 'PT', 'L4_S1']
  const optionalKeys = ['T1S', 'L1S', 'C2S', 'C7S', 'C2_C7', 'TK', 'PI_SUM', 'PI_ERROR']
  const rows = []
  for (const key of mainKeys) {
    if (result.measurements[key]) rows.push(result.measurements[key])
  }
  for (const key of optionalKeys) {
    if (result.measurements[key]) rows.push(result.measurements[key])
  }

  if (rows.length === 0) {
    body.innerHTML = `<p class="measurement-empty">계산 가능한 라벨이 아직 없습니다.</p>${missingHtml(result.missing)}`
    syncMeasurementDebugOverlay(result)
    return
  }

  body.innerHTML = `
    <div class="measurement-grid">
      ${rows.map(row => `
        <div class="measurement-row" title="${escapeHtml(row.note)}">
          <span class="measurement-key">${escapeHtml(row.key)}</span>
          <span class="measurement-name">${escapeHtml(row.name)}</span>
          <span class="measurement-value">${formatAngle(row.value)}</span>
        </div>
      `).join('')}
    </div>
    ${missingHtml(result.missing)}
    <div class="measurement-toggle-row">
      <label class="measurement-toggle"><input type="checkbox" data-toggle-measure-guides ${getMeasurementGuideOptions().enabled ? 'checked' : ''} /> 측정선 보기</label>
      <label class="measurement-toggle"><input type="checkbox" data-toggle-measure-labels ${getMeasurementGuideOptions().showLabels ? 'checked' : ''} /> 선 이름 보기</label>
      <label class="measurement-toggle"><input type="checkbox" data-toggle-measure-points ${getMeasurementGuideOptions().showPoints ? 'checked' : ''} /> 기준점 보기</label>
    </div>
    <div class="measurement-actions">
      <button type="button" class="measurement-btn" data-copy-measurements>JSON 복사</button>
      <button type="button" class="measurement-btn" data-download-measurements>다운로드</button>
    </div>
    <p class="measurement-help">폴리곤 상단/하단 edge를 자동 추정해서 계산합니다. 결과 검수 시 PI ≈ SS + PT인지 확인하세요.</p>
  `

  bindMeasurementDebugControls(body, result)
  syncMeasurementDebugOverlay(result)

  const exportPayload = {
    filename: context.filename || '',
    view_type: context.viewType || '',
    measurements: Object.fromEntries(Object.entries(result.measurements).map(([key, value]) => [key, round(value.value)])),
    missing: result.missing,
    calculated_at: new Date().toISOString(),
  }

  const copyBtn = body.querySelector('[data-copy-measurements]')
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2))
        copyBtn.textContent = '복사됨'
        setTimeout(() => { copyBtn.textContent = 'JSON 복사' }, 1200)
      } catch {
        copyBtn.textContent = '복사 실패'
        setTimeout(() => { copyBtn.textContent = 'JSON 복사' }, 1200)
      }
    })
  }

  const downloadBtn = body.querySelector('[data-download-measurements]')
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stem = String(context.filename || 'measurements').replace(/\.(png|jpg|jpeg)$/i, '')
      a.href = url
      a.download = `${stem}_sagittal_measurements.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    })
  }
}

function buildMeasurementDebug(lines, hip) {
  const debug = { lineSegments: [], points: [] }
  const addLine = (id, line, label, color, dashed = false, extend = 60) => {
    if (!line || !line[0] || !line[1]) return
    debug.lineSegments.push({ id, a: line[0], b: line[1], label, color, dashed, extend })
  }
  const addPoint = (id, p, label, color) => {
    if (!p) return
    debug.points.push({ id, p, label, color })
  }

  addLine('L1_sup', lines.L1_sup, 'L1 superior', '#60a5fa')
  addLine('L4_sup', lines.L4_sup, 'L4 superior', '#34d399')
  addLine('S1_sup', lines.S1_sup, 'S1 superior', '#f59e0b')
  addLine('C2_inf', lines.C2_inf, 'C2 inferior', '#a78bfa')
  addLine('C7_inf', lines.C7_inf, 'C7 inferior', '#c084fc')
  addLine('T1_sup', lines.T1_sup, 'T1 superior', '#38bdf8')
  addLine('T12_inf', lines.T12_inf, 'T12 inferior', '#22d3ee')

  if (lines.S1_sup) {
    const sacralMid = midpoint(lines.S1_sup)
    addPoint('S1_mid', sacralMid, 'S1 mid', '#fbbf24')

    const s1Vec = lineVectorMath(lines.S1_sup)
    const normal = { x: -s1Vec.y, y: s1Vec.x }
    const normalLen = Math.hypot(normal.x, normal.y) || 1
    const len = 140
    const normalEnd = {
      x: sacralMid.x + (normal.x / normalLen) * len,
      y: sacralMid.y - (normal.y / normalLen) * len,
    }
    debug.lineSegments.push({
      id: 'S1_normal',
      a: sacralMid,
      b: normalEnd,
      label: 'S1 normal',
      color: '#ef4444',
      dashed: true,
      extend: 0,
    })

    if (hip) {
      debug.lineSegments.push({
        id: 'HIP_TO_S1',
        a: hip,
        b: sacralMid,
        label: 'HC to S1 mid',
        color: '#22c55e',
        dashed: true,
        extend: 0,
      })
    }
  }

  if (hip) addPoint('HIP', hip, 'HC', '#22c55e')
  return debug
}

function getMeasurementGuideOptions() {
  return {
    enabled: getLocalBool('measurementGuidesEnabled', true),
    showLabels: getLocalBool('measurementGuideLabels', true),
    showPoints: getLocalBool('measurementGuidePoints', true),
  }
}

function getLocalBool(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    if (v == null) return fallback
    return v === '1'
  } catch {
    return fallback
  }
}

function setLocalBool(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0') } catch {}
}

function bindMeasurementDebugControls(body, result) {
  const guide = body.querySelector('[data-toggle-measure-guides]')
  const labels = body.querySelector('[data-toggle-measure-labels]')
  const points = body.querySelector('[data-toggle-measure-points]')
  const bind = (el, key) => {
    if (!el) return
    el.addEventListener('change', () => {
      setLocalBool(key, el.checked)
      syncMeasurementDebugOverlay(result)
    })
  }
  bind(guide, 'measurementGuidesEnabled')
  bind(labels, 'measurementGuideLabels')
  bind(points, 'measurementGuidePoints')
}

function syncMeasurementDebugOverlay(result) {
  const annotator = window.__spineAnnotator
  if (annotator && typeof annotator.setMeasurementDebugOverlay === 'function') {
    annotator.setMeasurementDebugOverlay(result, getMeasurementGuideOptions())
  }
}

function buildLandmarkMap(landmarks) {
  const map = new Map()
  for (const lm of Array.isArray(landmarks) ? landmarks : []) {
    const label = String(lm?.label || '').trim().toUpperCase()
    const x = Number(lm?.x)
    const y = Number(lm?.y)
    if (!label || !Number.isFinite(x) || !Number.isFinite(y)) continue
    map.set(label, { x, y, label })
  }
  return map
}

function landmarkPoint(byLandmark, label) {
  return byLandmark?.get?.(String(label || '').toUpperCase()) || null
}

function landmarkLine(byLandmark, aLabel, bLabel) {
  const a = landmarkPoint(byLandmark, aLabel)
  const b = landmarkPoint(byLandmark, bLabel)
  if (!a || !b) return null
  return a.x <= b.x ? [a, b] : [b, a]
}

function mergeLandmarksIntoMeasurementPolygons(_polygons = [], landmarks = []) {
  const items = []
  const by = new Map()
  for (const lm of Array.isArray(landmarks) ? landmarks : []) {
    const label = String(lm?.label || '').trim().toUpperCase()
    const x = Number(lm?.x)
    const y = Number(lm?.y)
    if (!label || !Number.isFinite(x) || !Number.isFinite(y)) continue
    by.set(label, { x, y, label })
  }

  const vertebrae = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
  const corners = ['SUP_ANT', 'SUP_POST', 'INF_POST', 'INF_ANT']
  for (const v of vertebrae) {
    const pts = corners.map(p => by.get(v + '_' + p))
    if (pts.every(Boolean)) {
      const ordered = sortLandmarkPolygonPoints(pts)
      items.unshift({ label: v, points: ordered.flatMap(p => [p.x, p.y]), source: 'landmark' })
    }
  }

  const hc = by.get('HC_LAT') || by.get('FH_LAT')
  if (hc) {
    // Tiny pseudo polygon lets existing labelPoint()/centroid() logic reuse HC_LAT.
    items.unshift({
      label: 'HC_LAT',
      points: [hc.x - 2, hc.y - 2, hc.x + 2, hc.y - 2, hc.x + 2, hc.y + 2, hc.x - 2, hc.y + 2],
      source: 'landmark',
    })
  }
  return items
}

function sortLandmarkPolygonPoints(points) {
  const pts = points.filter(Boolean)
  const cx = pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1)
  const cy = pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1)
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
}

function landmarkEndplateLine(byLandmark, vertebra, side) {
  const pts = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT'].map(p => byLandmark?.get?.(vertebra + '_' + p)).filter(Boolean)
  if (pts.length < 4) return null
  const pair = [...pts].sort((a, b) => side === 'inferior' ? b.y - a.y : a.y - b.y).slice(0, 2)
  return pair[0].x <= pair[1].x ? [pair[0], pair[1]] : [pair[1], pair[0]]
}

function measurement(key, name, value, note) {
  return { key, name, value: round(value), note }
}

function ensureMeasurementPanel() {
  let panel = document.getElementById('sagittalMeasurementPanel')
  if (panel) return panel

  const sidebar = document.getElementById('sidebarRight')
  const scroll = sidebar?.querySelector('.sidebar-scroll') || sidebar
  if (!scroll) return null

  panel = document.createElement('div')
  panel.className = 'panel sagittal-measurement-panel'
  panel.id = 'sagittalMeasurementPanel'
  panel.innerHTML = `
    <h3 class="panel-title measurement-title">
      <span class="measurement-title-label"><i class="fas fa-ruler-combined"></i> 각도 계산</span>
      <button type="button" class="panel-action-btn" data-toggle-measure-panel title="각도 계산 접기/펼치기">
        <i class="fas fa-chevron-up"></i>
      </button>
    </h3>
    <div class="measurement-content" data-measure-content>
      <div class="measurement-subtitle" data-measure-subtitle></div>
      <div data-measure-body><p class="measurement-empty">라벨을 그리면 자동 계산합니다.</p></div>
    </div>
  `

  bindMeasurementPanelCollapse(panel)

  const pelvisPanel = document.getElementById('pelvisLabelPanel')
  if (pelvisPanel && pelvisPanel.parentNode === scroll) {
    pelvisPanel.insertAdjacentElement('afterend', panel)
  } else {
    const labelPanel = document.getElementById('labelList')?.closest('.panel')
    if (labelPanel) scroll.insertBefore(panel, labelPanel)
    else scroll.appendChild(panel)
  }
  return panel
}

function bindMeasurementPanelCollapse(panel) {
  const btn = panel.querySelector('[data-toggle-measure-panel]')
  const icon = btn?.querySelector('i')
  if (!btn || btn.dataset.bound === '1') return
  btn.dataset.bound = '1'

  const apply = (collapsed) => {
    panel.classList.toggle('measurement-collapsed', collapsed)
    if (icon) {
      icon.classList.toggle('fa-chevron-up', !collapsed)
      icon.classList.toggle('fa-chevron-down', collapsed)
    }
    btn.title = collapsed ? '각도 계산 펼치기' : '각도 계산 접기'
  }

  let collapsed = false
  try { collapsed = localStorage.getItem(MEASURE_PANEL_COLLAPSE_KEY) === '1' } catch {}
  apply(collapsed)

  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const next = !panel.classList.contains('measurement-collapsed')
    apply(next)
    try { localStorage.setItem(MEASURE_PANEL_COLLAPSE_KEY, next ? '1' : '0') } catch {}
  })
}

function missingHtml(missing) {
  if (!missing || missing.length === 0) return ''
  return `<p class="measurement-missing">부족한 라벨: ${escapeHtml(missing.slice(0, 4).join(', '))}${missing.length > 4 ? '…' : ''}</p>`
}

function estimateHipCenter(byLabel) {
  const hcLat = labelPoint(byLabel, 'HC_LAT')
  if (hcLat) return hcLat

  const fhLat = labelPoint(byLabel, 'FH_LAT')
  if (fhLat) return fhLat

  const hcL = labelPoint(byLabel, 'HC_L')
  const hcR = labelPoint(byLabel, 'HC_R')
  if (hcL && hcR) return midpoint([hcL, hcR])
  if (hcL) return hcL
  if (hcR) return hcR

  const fhL = labelPoint(byLabel, 'FH_L')
  const fhR = labelPoint(byLabel, 'FH_R')
  if (fhL && fhR) return midpoint([fhL, fhR])
  return fhL || fhR || null
}

function labelPoint(byLabel, label) {
  const poly = chooseLargestPolygon(byLabel.get(label) || [])
  if (!poly) return null
  return centroid(toPoints(poly.points))
}

function chooseLargestPolygon(polys) {
  if (!Array.isArray(polys) || polys.length === 0) return null
  const landmarkPreferred = polys.find(p => p && p.source === 'landmark')
  if (landmarkPreferred) return landmarkPreferred
  let best = null
  let bestArea = -Infinity
  for (const p of polys) {
    const area = Math.abs(polygonArea(p.points || []))
    if (area > bestArea) {
      best = p
      bestArea = area
    }
  }
  return best
}

function estimateEndplateLine(flatPoints, side) {
  const points = toPoints(flatPoints)
  if (points.length < 2) return null
  if (points.length === 2) return orientLeftRight([points[0], points[1]])

  // The polygon points are ordered along the vertebral contour. Use real boundary
  // edges first. The old version selected any two points in a top/bottom band,
  // which could connect unrelated corners and become almost perfectly horizontal.
  return estimateBoundaryEndplateLine(points, side) || estimateBandRegressionLine(points, side)
}

function estimateBoundaryEndplateLine(points, side) {
  const box = bbox(points)
  const h = Math.max(1, box.maxY - box.minY)
  const w = Math.max(1, box.maxX - box.minX)
  const candidates = []

  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 2) continue

    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const sideDistance = side === 'inferior'
      ? (box.maxY - mid.y) / h
      : (mid.y - box.minY) / h
    const horizontalComponent = Math.abs(dx) / len

    // Endplates may be sloped, but they are contour edges with meaningful lateral
    // span. Filter out mostly vertical side-wall edges and edges far from the
    // requested superior/inferior side.
    if (sideDistance > 0.62 || horizontalComponent < 0.22) continue

    const score =
      len * Math.pow(horizontalComponent, 1.7) +
      Math.max(0, 1 - sideDistance) * w * 0.55 -
      Math.abs(dy) * 0.08

    candidates.push({ a, b, mid, len, dx, dy, angle: Math.atan2(dy, dx), sideDistance, score })
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best) return null

  const pts = gatherSimilarEndplatePoints(candidates, best, w, h)
  const fitted = pts.length >= 3 ? fitImageLineSegment(pts) : null
  return orientLeftRight(fitted || [best.a, best.b])
}

function gatherSimilarEndplatePoints(candidates, best, w, h) {
  const maxMidpointDistance = Math.max(w, h) * 0.85
  const maxSideDistanceGap = 0.28
  const maxAngleGap = Math.PI / 5
  const out = []
  const seen = new Set()

  for (const c of candidates) {
    if (angleDistance(c.angle, best.angle) > maxAngleGap) continue
    if (Math.abs(c.sideDistance - best.sideDistance) > maxSideDistanceGap) continue
    if (Math.hypot(c.mid.x - best.mid.x, c.mid.y - best.mid.y) > maxMidpointDistance) continue
    addUniquePoint(out, seen, c.a)
    addUniquePoint(out, seen, c.b)
  }
  return out
}

function addUniquePoint(out, seen, p) {
  const key = String(Math.round(p.x * 10) / 10) + ',' + String(Math.round(p.y * 10) / 10)
  if (seen.has(key)) return
  seen.add(key)
  out.push(p)
}

function fitImageLineSegment(points) {
  if (!points || points.length < 2) return null
  const mean = centroid(points)
  let sxx = 0
  let sxy = 0
  for (const p of points) {
    const x = p.x - mean.x
    const y = p.y - mean.y
    sxx += x * x
    sxy += x * y
  }
  if (sxx < 1e-6) return null
  const m = sxy / sxx
  const b = mean.y - m * mean.x
  const minX = Math.min(...points.map(p => p.x))
  const maxX = Math.max(...points.map(p => p.x))
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || Math.abs(maxX - minX) < 1) return null
  return [{ x: minX, y: m * minX + b }, { x: maxX, y: m * maxX + b }]
}

function estimateBandRegressionLine(points, side) {
  const box = bbox(points)
  const h = Math.max(1, box.maxY - box.minY)
  const cutoff = side === 'inferior' ? box.maxY - h * 0.28 : box.minY + h * 0.28
  let pool = points.filter(p => side === 'inferior' ? p.y >= cutoff : p.y <= cutoff)
  if (pool.length < 2) {
    pool = points.slice().sort((a, b) => side === 'inferior' ? b.y - a.y : a.y - b.y).slice(0, Math.min(4, points.length))
  }
  return orientLeftRight(fitImageLineSegment(pool))
}

function orientLeftRight(line) {
  if (!line || !line[0] || !line[1]) return null
  return line[0].x <= line[1].x ? line : [line[1], line[0]]
}

function angleDistance(a, b) {
  let d = Math.abs(a - b) % Math.PI
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}

function toPoints(flatPoints) {
  const out = []
  if (!Array.isArray(flatPoints)) return out
  for (let i = 0; i + 1 < flatPoints.length; i += 2) {
    const x = Number(flatPoints[i])
    const y = Number(flatPoints[i + 1])
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y })
  }
  return out
}

function midpoint(line) {
  const a = line[0]
  const b = line[1]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function centroid(points) {
  if (!points.length) return null
  let x = 0
  let y = 0
  for (const p of points) { x += p.x; y += p.y }
  return { x: x / points.length, y: y / points.length }
}

function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

function polygonArea(flatPoints) {
  if (!Array.isArray(flatPoints) || flatPoints.length < 6) return 0
  let area = 0
  for (let i = 0; i < flatPoints.length; i += 2) {
    const j = (i + 2) % flatPoints.length
    area += flatPoints[i] * flatPoints[j + 1] - flatPoints[j] * flatPoints[i + 1]
  }
  return area / 2
}

function slopeAngle(line) {
  return angleBetweenVectors(lineVectorMath(line), { x: 1, y: 0 })
}

function angleBetweenLines(lineA, lineB) {
  return angleBetweenVectors(lineVectorMath(lineA), lineVectorMath(lineB))
}

function lineVectorMath(line) {
  const a = line[0]
  const b = line[1]
  return imageVectorToMath(a, b)
}

function imageVectorToMath(a, b) {
  return { x: b.x - a.x, y: -(b.y - a.y) }
}

function angleBetweenVectors(a, b) {
  const na = Math.hypot(a.x, a.y)
  const nb = Math.hypot(b.x, b.y)
  if (!na || !nb) return NaN
  let cos = (a.x * b.x + a.y * b.y) / (na * nb)
  cos = Math.max(-1, Math.min(1, cos))
  const deg = Math.acos(cos) * 180 / Math.PI
  return deg > 90 ? 180 - deg : deg
}

function round(value, decimals = DEFAULT_DECIMALS) {
  if (!Number.isFinite(value)) return null
  const m = 10 ** decimals
  return Math.round(value * m) / m
}

function formatAngle(value) {
  return Number.isFinite(value) ? `${value.toFixed(DEFAULT_DECIMALS)} deg` : '-'
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))]
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
