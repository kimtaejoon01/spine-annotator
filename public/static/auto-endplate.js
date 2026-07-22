/* ================================================================
   폴리곤 → 4코너(상앞/상뒤/하앞/하뒤) 자동 추정 → 종판 벡터 → 각도
   랜드마크 없이 폴리곤만으로 sagittal alignment 각 계산.
   (Genspark Python 스크립트의 브라우저 JS 포팅)
   좌표는 이미지 좌표계(y가 아래로 증가) 가정 — 앱의 폴리곤과 동일.
   ================================================================ */

const ORDER = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
  'L1', 'L2', 'L3', 'L4', 'L5']

export const DEFAULT_RANGES = { TK: ['T4', 'T12'], LL: ['L1', 'L5'], CL: ['C2', 'C7'] }

// flat [x,y,x,y,...] → [[x,y],...]
export function polyToPoints(flat) {
  const pts = []
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([+flat[i], +flat[i + 1]])
  return pts
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1]] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] }
function norm(v) { return Math.hypot(v[0], v[1]) }
function unit(v) { const n = norm(v); return n > 0 ? [v[0] / n, v[1] / n] : v }
function mean(pts) {
  let sx = 0, sy = 0
  for (const p of pts) { sx += p[0]; sy += p[1] }
  return [sx / pts.length, sy / pts.length]
}
function median(arr) {
  const a = arr.slice().sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

// ---- convex hull (Andrew's monotone chain) ----
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return lower.concat(upper)
}

// ---- minimum-area rectangle (rotating calipers) → 4 box corners ----
export function minAreaRect(points) {
  const hull = convexHull(points)
  if (hull.length < 3) {
    // 퇴화: 축 정렬 bbox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of points) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]) }
    return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]
  }
  let best = null
  for (let i = 0; i < hull.length; i++) {
    const p0 = hull[i], p1 = hull[(i + 1) % hull.length]
    const ex = unit(sub(p1, p0))          // edge direction
    const ey = [-ex[1], ex[0]]            // perpendicular
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const p of hull) {
      const u = dot(p, ex), v = dot(p, ey)
      if (u < minU) minU = u; if (u > maxU) maxU = u
      if (v < minV) minV = v; if (v > maxV) maxV = v
    }
    const area = (maxU - minU) * (maxV - minV)
    if (!best || area < best.area) {
      best = { area, ex, ey, minU, maxU, minV, maxV }
    }
  }
  const { ex, ey, minU, maxU, minV, maxV } = best
  const P = (u, v) => [ex[0] * u + ey[0] * v, ex[1] * u + ey[1] * v]
  return [P(minU, minV), P(maxU, minV), P(maxU, maxV), P(minU, maxV)]
}

// ---- 폴리곤 → 4코너 {SA, SP, IA, IP} ----
export function fourCorners(points, isC2 = false) {
  const box = minAreaRect(points)
  const edges = [[box[0], box[1]], [box[1], box[2]], [box[2], box[3]], [box[3], box[0]]]
  const lengths = edges.map(([a, b]) => norm(sub(a, b)))
  // 처음 두 변 중 긴/짧은 쪽을 전후축으로 (C2는 짧은 쪽)
  const iLong = isC2
    ? (lengths[0] <= lengths[1] ? 0 : 1)
    : (lengths[0] >= lengths[1] ? 0 : 1)
  let ap = unit(sub(edges[iLong][1], edges[iLong][0])) // 전후축(종판 방향)
  if (ap[0] < 0) ap = [-ap[0], -ap[1]]                 // +x = 앞(anterior)
  let si = [-ap[1], ap[0]]                             // 상하축
  if (si[1] < 0) si = [-si[0], -si[1]]                 // +y = 아래(inferior)

  const center = mean(points)
  const aArr = [], sArr = []
  for (const p of points) {
    const rel = sub(p, center)
    aArr.push(dot(rel, ap))  // + = 앞
    sArr.push(dot(rel, si))  // + = 아래
  }
  const aMid = median(aArr), sMid = median(sArr)
  const pick = (condFn, scoreFn) => {
    let bestIdx = -1, bestScore = -Infinity
    for (let i = 0; i < points.length; i++) {
      if (!condFn(aArr[i], sArr[i])) continue
      const sc = scoreFn(aArr[i], sArr[i])
      if (sc > bestScore) { bestScore = sc; bestIdx = i }
    }
    if (bestIdx < 0) { // 조건 만족 없으면 전체에서
      for (let i = 0; i < points.length; i++) {
        const sc = scoreFn(aArr[i], sArr[i])
        if (sc > bestScore) { bestScore = sc; bestIdx = i }
      }
    }
    return points[bestIdx]
  }
  const SA = pick((a, s) => a >= aMid && s <= sMid, (a, s) => a - s)   // 앞+위
  const SP = pick((a, s) => a < aMid && s <= sMid, (a, s) => -a - s)   // 뒤+위
  const IA = pick((a, s) => a >= aMid && s > sMid, (a, s) => a + s)    // 앞+아래
  const IP = pick((a, s) => a < aMid && s > sMid, (a, s) => -a + s)    // 뒤+아래
  return { SA, SP, IA, IP }
}

// 상종판 벡터 = SA→SP, 하종판 벡터 = IA→IP
function supVec(c) { return c ? sub(c.SP, c.SA) : null }
function infVec(c) { return c ? sub(c.IP, c.IA) : null }

export function cobbAngle(v1, v2) {
  if (!v1 || !v2) return NaN
  const c = dot(v1, v2) / (norm(v1) * norm(v2))
  const ang = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI
  return ang <= 90 ? ang : 180 - ang
}

export function slopeH(v) {
  if (!v) return NaN
  let a = Math.abs(Math.atan2(v[1], v[0]) * 180 / Math.PI)
  if (a > 90) a = 180 - a   // 수평 종판 = 0, 기울수록 증가 ([0,90]로 접음)
  return a
}

// ---- 메인: 폴리곤 배열 → 코너 + 각도 ----
// polygons: [{ label, points: [x,y,...] }]
export function computeSagittalFromPolygons(polygons, ranges = DEFAULT_RANGES) {
  const corners = {}
  for (const p of polygons) {
    const label = p.label
    if (!label || !ORDER.includes(label)) continue
    const pts = polyToPoints(p.points)
    if (pts.length < 4) continue
    corners[label] = fourCorners(pts, label === 'C2')
  }
  const SUP = n => supVec(corners[n])
  const INF = n => infVec(corners[n])

  const angles = {}
  angles['LL'] = cobbAngle(SUP(ranges.LL[0]), INF(ranges.LL[1]))
  angles['TK'] = cobbAngle(SUP(ranges.TK[0]), INF(ranges.TK[1]))
  angles['CL'] = cobbAngle(INF(ranges.CL[0]), INF(ranges.CL[1]))
  angles['T1_slope'] = slopeH(SUP('T1'))

  const present = ORDER.filter(v => corners[v])
  const segmental = {}
  for (let i = 0; i + 1 < present.length; i++) {
    segmental[`${present[i]}_${present[i + 1]}`] = cobbAngle(INF(present[i]), SUP(present[i + 1]))
  }
  const wedge = {}
  for (const v of present) wedge[v] = cobbAngle(SUP(v), INF(v))

  return { corners, angles, segmental, wedge, present }
}

// ---- CSV ----
export function toCSV(result, meta = {}) {
  const rows = [['metric', 'value_deg']]
  rows.push(['file_name', meta.file_name || ''])
  rows.push(['n_vertebrae', String(result.present.length)])
  for (const k of ['LL', 'TK', 'CL', 'T1_slope']) rows.push([k, fmt(result.angles[k])])
  for (const k in result.segmental) rows.push([`seg_${k}`, fmt(result.segmental[k])])
  for (const k in result.wedge) rows.push([`wedge_${k}`, fmt(result.wedge[k])])
  return rows.map(r => r.join(',')).join('\n')
}
function fmt(v) { return (v == null || Number.isNaN(v)) ? '' : (Math.round(v * 10) / 10).toString() }


// ================================================================
// v2 (그룹 피팅) + 검증 알고리즘  — Python 코드 A/B 포팅
// ================================================================
export const VALIDATION = { MAX_NEIGHBOR_JUMP: 35.0, MIN_PERP_TO_SPINE: 40.0, MAX_WEDGE: 40.0, FRAC: 0.30 }

// 점들의 주방향(최대 분산 방향) — PCA (2x2 공분산 고유벡터)
function fitLineDir(pts) {
  const n = pts.length
  let mx = 0, my = 0
  for (const p of pts) { mx += p[0]; my += p[1] }
  mx /= n; my /= n
  let sxx = 0, sxy = 0, syy = 0
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy }
  sxx /= n; sxy /= n; syy /= n
  // 2x2 대칭행렬 최대 고유값의 고유벡터
  const tr = sxx + syy, det = sxx * syy - sxy * sxy
  const lam = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det))
  let v = Math.abs(sxy) > 1e-12 ? [lam - syy, sxy] : (sxx >= syy ? [1, 0] : [0, 1])
  v = unit(v)
  return v[0] >= 0 ? v : [-v[0], -v[1]]
}

// minAreaRect 기반 전후축/상하축
function rectAxes(points, isC2) {
  const box = minAreaRect(points)
  const edges = [[box[0], box[1]], [box[1], box[2]], [box[2], box[3]], [box[3], box[0]]]
  const len = edges.map(([a, b]) => norm(sub(a, b)))
  const i = isC2 ? (len[0] <= len[1] ? 0 : 1) : (len[0] >= len[1] ? 0 : 1)
  let ap = unit(sub(edges[i][1], edges[i][0]))
  if (ap[0] < 0) ap = [-ap[0], -ap[1]]
  let si = [-ap[1], ap[0]]
  if (si[1] < 0) si = [-si[0], -si[1]]
  return { ap, si }
}

// 방향 벡터를 앞(+x) 쪽으로 통일
function orientAnterior(v) { return v[0] < 0 ? [-v[0], -v[1]] : v }

// 두 방향의 예각(0~90)
export function angleBetweenLines(v1, v2) {
  const c = Math.abs(dot(unit(v1), unit(v2)))
  return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI
}
// 수평 기준 기울기(0=수평, 90=수직)
export function tiltH(v) {
  if (!v) return NaN
  let a = Math.abs(Math.atan2(v[1], v[0]) * 180 / Math.PI)
  return a > 90 ? 180 - a : a
}

// ---- v1: 4코너 극점 ----
export function endplateA(points, isC2, useYAxis) {
  let ap, si
  if (useYAxis) { ap = [1, 0]; si = [0, 1] } else { ({ ap, si } = rectAxes(points, isC2)) }
  const center = mean(points)
  const aArr = [], sArr = []
  for (const p of points) { const r = sub(p, center); aArr.push(dot(r, ap)); sArr.push(dot(r, si)) }
  const aMid = median(aArr), sMid = median(sArr)
  const pick = (cond, score) => {
    let bi = -1, bs = -Infinity
    for (let i = 0; i < points.length; i++) { if (!cond(aArr[i], sArr[i])) continue; const v = score(aArr[i], sArr[i]); if (v > bs) { bs = v; bi = i } }
    if (bi < 0) for (let i = 0; i < points.length; i++) { const v = score(aArr[i], sArr[i]); if (v > bs) { bs = v; bi = i } }
    return points[bi]
  }
  const SA = pick((a, s) => a >= aMid && s <= sMid, (a, s) => a - s)
  const SP = pick((a, s) => a < aMid && s <= sMid, (a, s) => -a - s)
  const IA = pick((a, s) => a >= aMid && s > sMid, (a, s) => a + s)
  const IP = pick((a, s) => a < aMid && s > sMid, (a, s) => -a + s)
  return { SA, SP, IA, IP, supVec: orientAnterior(unit(sub(SP, SA))), infVec: orientAnterior(unit(sub(IP, IA))) }
}

// ---- v2: 종판 그룹 피팅 ----
export function endplateB(points, isC2, useYAxis, frac) {
  frac = frac || VALIDATION.FRAC
  let si
  if (useYAxis) { si = [0, 1] } else { ({ si } = rectAxes(points, isC2)) }
  const center = mean(points)
  const sArr = points.map(p => dot(sub(p, center), si))
  const sMin = Math.min(...sArr), sMax = Math.max(...sArr), span = sMax - sMin
  let top = points.filter((p, i) => sArr[i] <= sMin + frac * span)
  let bot = points.filter((p, i) => sArr[i] >= sMax - frac * span)
  const order = sArr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).map(x => x[1])
  if (top.length < 2) top = order.slice(0, 3).map(i => points[i])
  if (bot.length < 2) bot = order.slice(-3).map(i => points[i])
  const supVec = orientAnterior(fitLineDir(top))
  const infVec = orientAnterior(fitLineDir(bot))
  // 오버레이/검수 호환을 위해 그룹의 양 끝점을 코너로 변환
  const ends = (grp, v) => {
    const proj = grp.map(p => dot(p, v))
    const iMin = proj.indexOf(Math.min(...proj)), iMax = proj.indexOf(Math.max(...proj))
    return [grp[iMax], grp[iMin]]   // [앞(+), 뒤(-)]
  }
  const [SA, SP] = ends(top, supVec)
  const [IA, IP] = ends(bot, infVec)
  return { SA, SP, IA, IP, supVec, infVec, supPts: top, infPts: bot }
}

// ---- 검증 + y축 폴백 ----
// signals >= 2 → y축 폴백 재계산(quality 'fallback'), ==1 → 'review', 0 → 'ok'
export function validateAndFix(method, vertsPts, isC2Map, opts = {}) {
  const fit = (pts, isC2, useY) => method === 'v2'
    ? endplateB(pts, isC2, useY, opts.frac)
    : endplateA(pts, isC2, useY)
  const present = ORDER.filter(n => vertsPts[n])
  const raw = {}
  const centers = {}
  for (const n of present) { raw[n] = fit(vertsPts[n], !!isC2Map[n], false); centers[n] = mean(vertsPts[n]) }
  const out = {}
  for (let i = 0; i < present.length; i++) {
    const n = present[i]
    let r = raw[n]
    let signals = 0
    const reasons = []
    // 1) 이웃 종판각 급변
    const nb = []
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < present.length) nb.push(tiltH(raw[present[j]].infVec))
    if (nb.length) {
      const med = median(nb)
      if (Math.abs(tiltH(r.infVec) - med) > VALIDATION.MAX_NEIGHBOR_JUMP) { signals++; reasons.push('이웃과 각도 급변') }
    }
    // 2) 척추 진행축과의 수직성 (C2 양옆으로 잡히는 케이스 검출)
    if (i > 0 && i < present.length - 1) {
      const spineDir = sub(centers[present[i + 1]], centers[present[i - 1]])
      if (angleBetweenLines(r.infVec, spineDir) < VALIDATION.MIN_PERP_TO_SPINE) { signals++; reasons.push('척추축과 나란함') }
    }
    // 3) 추체 내 상·하 종판 모순
    if (Math.abs(tiltH(r.supVec) - tiltH(r.infVec)) > VALIDATION.MAX_WEDGE) { signals++; reasons.push('상·하 종판 모순') }

    let quality = 'ok'
    if (signals >= 2) { r = fit(vertsPts[n], !!isC2Map[n], true); quality = 'fallback' }
    else if (signals === 1) quality = 'review'
    out[n] = { ...r, quality, reasons }
  }
  return out
}

// ---- 통합 계산 (method: 'v1' | 'v2') ----
export function computeSagittal(polygons, ranges = DEFAULT_RANGES, opts = {}) {
  const method = opts.method || 'v1'
  const vertsPts = {}, isC2Map = {}
  for (const p of polygons) {
    if (!p.label || !ORDER.includes(p.label)) continue
    const pts = polyToPoints(p.points)
    if (pts.length < 4) continue
    vertsPts[p.label] = pts
    isC2Map[p.label] = p.label === 'C2'
  }
  const fits = validateAndFix(method, vertsPts, isC2Map, opts)
  const corners = {}
  const quality = {}
  for (const n in fits) {
    corners[n] = { SA: fits[n].SA, SP: fits[n].SP, IA: fits[n].IA, IP: fits[n].IP }
    quality[n] = { quality: fits[n].quality, reasons: fits[n].reasons }
  }
  const SUP = n => fits[n] ? fits[n].supVec : null
  const INF = n => fits[n] ? fits[n].infVec : null
  const angles = {
    LL: cobbAngle(SUP(ranges.LL[0]), INF(ranges.LL[1])),
    TK: cobbAngle(SUP(ranges.TK[0]), INF(ranges.TK[1])),
    CL: cobbAngle(INF(ranges.CL[0]), INF(ranges.CL[1])),
    T1_slope: tiltH(SUP('T1')),
  }
  const present = ORDER.filter(n => fits[n])
  const segmental = {}, wedge = {}
  for (let i = 0; i + 1 < present.length; i++) segmental[`${present[i]}_${present[i + 1]}`] = cobbAngle(INF(present[i]), SUP(present[i + 1]))
  for (const n of present) wedge[n] = Math.abs(tiltH(fits[n].supVec) - tiltH(fits[n].infVec))
  return { corners, angles, segmental, wedge, present, quality, method }
}
