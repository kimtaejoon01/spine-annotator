#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

const file = 'public/static/measurements.js'
const before = read(file)
let s = before

const replacement = `function estimateEndplateLine(flatPoints, side) {
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

function toPoints(flatPoints) {`

if (!s.includes('estimateBoundaryEndplateLine(points, side)')) {
  const re = /function estimateEndplateLine\(flatPoints, side\) \{[\s\S]*?\n\}\n\nfunction toPoints\(flatPoints\) \{/
  if (!re.test(s)) throw new Error('estimateEndplateLine block not found')
  s = s.replace(re, replacement)
}

save(file, before, s, 'edge-based endplate estimation')
console.log('OK edge-based endplate estimation patch installed')
