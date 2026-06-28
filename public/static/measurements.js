/* ================================================================
   Sagittal spinopelvic measurements from polygon labels
   ================================================================ */

const DEFAULT_DECIMALS = 1

export function calculateSagittalMeasurements(polygons = []) {
  const items = Array.isArray(polygons) ? polygons : []
  const byLabel = new Map()
  for (const poly of items) {
    const label = String(poly?.label || '').trim().toUpperCase()
    if (!label || !Array.isArray(poly.points) || poly.points.length < 4) continue
    if (!byLabel.has(label)) byLabel.set(label, [])
    byLabel.get(label).push(poly)
  }

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

  if (s1) lines.S1_sup = estimateEndplateLine(s1.points, 'superior')
  if (l1) lines.L1_sup = estimateEndplateLine(l1.points, 'superior')
  if (l4) lines.L4_sup = estimateEndplateLine(l4.points, 'superior')
  if (c2) lines.C2_inf = estimateEndplateLine(c2.points, 'inferior')
  if (c7) lines.C7_inf = estimateEndplateLine(c7.points, 'inferior')
  if (t1) lines.T1_sup = estimateEndplateLine(t1.points, 'superior')
  if (t12) lines.T12_inf = estimateEndplateLine(t12.points, 'inferior')

  const hip = estimateHipCenter(byLabel)
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
    if (!hip) missing.push('PT/PI: HC_L/HC_R 또는 FH_L/FH_R')
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
  }
}

export function renderSagittalMeasurementPanel(polygons = [], context = {}) {
  const panel = ensureMeasurementPanel()
  if (!panel) return

  const body = panel.querySelector('[data-measure-body]')
  const subtitle = panel.querySelector('[data-measure-subtitle]')
  if (!body) return

  const result = calculateSagittalMeasurements(polygons)
  const isLat = String(context.viewType || '').toUpperCase() === 'LAT'

  if (subtitle) {
    subtitle.textContent = `${context.filename || ''}${context.viewType ? ' · ' + context.viewType : ''}`.trim()
  }

  if (!isLat) {
    body.innerHTML = '<p class="measurement-empty">Sagittal alignment는 LAT 영상에서 계산합니다.</p>'
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
    <div class="measurement-actions">
      <button type="button" class="measurement-btn" data-copy-measurements>JSON 복사</button>
      <button type="button" class="measurement-btn" data-download-measurements>다운로드</button>
    </div>
    <p class="measurement-help">폴리곤 상단/하단 edge를 자동 추정해서 계산합니다. 결과 검수 시 PI ≈ SS + PT인지 확인하세요.</p>
  `

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
    <h3 class="panel-title"><i class="fas fa-ruler-combined"></i> 각도 계산</h3>
    <div class="measurement-subtitle" data-measure-subtitle></div>
    <div data-measure-body><p class="measurement-empty">라벨을 그리면 자동 계산합니다.</p></div>
  `

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

function missingHtml(missing) {
  if (!missing || missing.length === 0) return ''
  return `<p class="measurement-missing">부족한 라벨: ${escapeHtml(missing.slice(0, 4).join(', '))}${missing.length > 4 ? '…' : ''}</p>`
}

function estimateHipCenter(byLabel) {
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
  const box = bbox(points)
  const h = Math.max(1, box.maxY - box.minY)
  const cutoff = side === 'inferior' ? box.maxY - h * 0.38 : box.minY + h * 0.38
  let pool = points.filter(p => side === 'inferior' ? p.y >= cutoff : p.y <= cutoff)
  if (pool.length < 2) {
    pool = points.slice().sort((a, b) => side === 'inferior' ? b.y - a.y : a.y - b.y).slice(0, Math.min(4, points.length))
  }

  let best = null
  let bestScore = -Infinity
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]
      const b = pool[j]
      const dx = Math.abs(b.x - a.x)
      const dy = Math.abs(b.y - a.y)
      const dist = Math.hypot(dx, dy)
      if (dist < 2) continue
      const score = dx + dist * 0.25 - dy * 0.5
      if (score > bestScore) {
        bestScore = score
        best = [a, b]
      }
    }
  }

  if (!best) best = [points[0], points[1]]
  return best[0].x <= best[1].x ? best : [best[1], best[0]]
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
