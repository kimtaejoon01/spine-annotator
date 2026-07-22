/* ================================================================
   AI 예측 마스크(binary PNG) → 추체별 폴리곤 변환
   - 연결요소(connected component)로 추체를 분리
   - 각 덩어리의 외곽 윤곽선을 추출해 폴리곤으로
   - 위→아래 순으로 라벨(C2..L5) 부여
   → 그 폴리곤을 기존 자동 측정 알고리즘(v1/v2)에 그대로 투입
   ================================================================ */

const LABEL_ORDER = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
  'L1', 'L2', 'L3', 'L4', 'L5']

// 이미지 → 이진 배열 (0/1). 원본 크기 기준.
export async function maskToBinary(blobOrUrl, { threshold = 127, maxDim = 1600 } = {}) {
  const img = await loadImage(blobOrUrl)
  const ow = img.naturalWidth || img.width
  const oh = img.naturalHeight || img.height
  const scale = Math.min(1, maxDim / Math.max(ow, oh))
  const w = Math.max(1, Math.round(ow * scale))
  const h = Math.max(1, Math.round(oh * scale))
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const bin = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
    const v = (data[p] + data[p + 1] + data[p + 2]) / 3
    bin[i] = (v >= threshold && data[p + 3] > 10) ? 1 : 0
  }
  return { bin, w, h, scaleToOriginal: 1 / scale, originalWidth: ow, originalHeight: oh }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('마스크 이미지를 열 수 없습니다'))
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src)
  })
}

// 4-이웃 연결요소 분리 (반복 기반 flood fill)
export function connectedComponents(bin, w, h, minArea = 60) {
  const labels = new Int32Array(w * h).fill(0)
  const comps = []
  const stack = new Int32Array(w * h)
  let cur = 0
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || labels[i]) continue
    cur++
    let sp = 0, area = 0
    let minX = w, maxX = 0, minY = h, maxY = 0
    stack[sp++] = i
    labels[i] = cur
    const pixels = []
    while (sp > 0) {
      const idx = stack[--sp]
      const x = idx % w, y = (idx / w) | 0
      area++
      pixels.push(idx)
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (x > 0 && bin[idx - 1] && !labels[idx - 1]) { labels[idx - 1] = cur; stack[sp++] = idx - 1 }
      if (x < w - 1 && bin[idx + 1] && !labels[idx + 1]) { labels[idx + 1] = cur; stack[sp++] = idx + 1 }
      if (y > 0 && bin[idx - w] && !labels[idx - w]) { labels[idx - w] = cur; stack[sp++] = idx - w }
      if (y < h - 1 && bin[idx + w] && !labels[idx + w]) { labels[idx + w] = cur; stack[sp++] = idx + w }
    }
    if (area >= minArea) comps.push({ id: cur, area, minX, maxX, minY, maxY, pixels, cy: 0 })
  }
  for (const c of comps) {
    let sy = 0
    for (const idx of c.pixels) sy += (idx / w) | 0
    c.cy = sy / c.pixels.length
  }
  return comps
}

// 덩어리의 외곽 경계 점들을 추출(경계 픽셀) 후 각도순 정렬 → 폴리곤
export function componentToPolygon(comp, bin, w, h, step = 1) {
  const set = new Set(comp.pixels)
  const border = []
  for (const idx of comp.pixels) {
    const x = idx % w, y = (idx / w) | 0
    const isBorder =
      x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      !set.has(idx - 1) || !set.has(idx + 1) || !set.has(idx - w) || !set.has(idx + w)
    if (isBorder) border.push([x, y])
  }
  if (border.length < 8) return null
  // 중심 기준 각도순 정렬(볼록에 가까운 추체에 적합) + 다운샘플
  let cx = 0, cy = 0
  for (const p of border) { cx += p[0]; cy += p[1] }
  cx /= border.length; cy /= border.length
  border.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx))
  const out = []
  const stride = Math.max(1, Math.round(border.length / 80)) * step
  for (let i = 0; i < border.length; i += stride) out.push(border[i])
  return out
}

// 마스크 → 라벨 붙은 폴리곤 배열
// startLabel: 가장 위 덩어리에 부여할 라벨 (기본 C2)
export async function maskToPolygons(blobOrUrl, { startLabel = 'C2', minArea = 60, threshold = 127 } = {}) {
  const { bin, w, h, scaleToOriginal } = await maskToBinary(blobOrUrl, { threshold })
  const comps = connectedComponents(bin, w, h, minArea)
  comps.sort((a, b) => a.cy - b.cy)
  const startIdx = Math.max(0, LABEL_ORDER.indexOf(startLabel))
  const polys = []
  for (let i = 0; i < comps.length; i++) {
    const label = LABEL_ORDER[startIdx + i]
    if (!label) break
    const pts = componentToPolygon(comps[i], bin, w, h)
    if (!pts) continue
    const flat = []
    for (const [x, y] of pts) { flat.push(x * scaleToOriginal, y * scaleToOriginal) }
    polys.push({ label, points: flat, source: 'ai', area: comps[i].area })
  }
  return { polygons: polys, componentCount: comps.length, width: w, height: h }
}
