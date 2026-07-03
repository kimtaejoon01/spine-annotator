/* ================================================================
   COCO JSON Export
   ================================================================ */

import { ALL_LABELS, getSupercategory } from './labels.js'

/**
 * 폴리곤 데이터를 COCO 형식으로 변환
 *
 * @param {Object} params
 * @param {string} params.filename - 이미지 파일명
 * @param {number} params.width - 이미지 너비
 * @param {number} params.height - 이미지 높이
 * @param {Array} params.polygons - [{ id, label, points: [x1,y1,x2,y2,...] }]
 * @returns {Object} COCO format JSON
 */
export function exportToCOCO({ filename, width, height, polygons, landmarks = [] }) {
  // categories: 사용하는 라벨만 포함
  const usedLabels = new Set(polygons.map(p => p.label).filter(Boolean))
  const categories = ALL_LABELS
    .filter(lbl => usedLabels.has(lbl))
    .map((lbl, idx) => ({
      id: ALL_LABELS.indexOf(lbl) + 1, // 1-based: C1=1, C2=2, ..., S1=25
      name: lbl,
      supercategory: getSupercategory(lbl),
    }))

  // annotations
  const annotations = polygons
    .filter(p => p.label && p.points.length >= 6) // 최소 3개 점
    .map((poly, idx) => {
      const pts = poly.points
      const bbox = computeBBox(pts)
      const area = computePolygonArea(pts)
      const categoryId = ALL_LABELS.indexOf(poly.label) + 1
      return {
        id: idx + 1,
        image_id: 1,
        category_id: categoryId,
        segmentation: [pts.map(v => Math.round(v * 100) / 100)],
        bbox: bbox.map(v => Math.round(v * 100) / 100),
        area: Math.round(area * 100) / 100,
        iscrowd: 0,
      }
    })

  const coco = {
    info: {
      description: 'Spine X-ray Vertebral Body Segmentation Dataset',
      version: '0.1',
      contributor: 'Spine Annotator',
      date_created: new Date().toISOString(),
    },
    licenses: [],
    images: [
      {
        id: 1,
        file_name: filename,
        width: width,
        height: height,
      },
    ],
    categories,
    annotations,
    landmarks: (Array.isArray(landmarks) ? landmarks : []).map(lm => ({
      id: lm.id,
      label: lm.label,
      target: lm.target,
      kind: lm.kind || 'point',
      x: Math.round(Number(lm.x) * 100) / 100,
      y: Math.round(Number(lm.y) * 100) / 100,
      visibility: lm.visibility || 'visible',
      order_version: lm.order_version || null,
    })),
  }

  return coco
}

/**
 * 폴리곤 점 배열에서 bounding box 계산
 * @param {number[]} pts [x1,y1,x2,y2,...]
 * @returns {number[]} [x, y, w, h]
 */
function computeBBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]
    const y = pts[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX - minX, maxY - minY]
}

/**
 * 폴리곤 면적 계산 (Shoelace formula)
 * @param {number[]} pts [x1,y1,x2,y2,...]
 * @returns {number}
 */
function computePolygonArea(pts) {
  let area = 0
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const x1 = pts[i * 2]
    const y1 = pts[i * 2 + 1]
    const x2 = pts[((i + 1) % n) * 2]
    const y2 = pts[((i + 1) % n) * 2 + 1]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) / 2
}
