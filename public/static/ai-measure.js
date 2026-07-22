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

// 덩어리의 외곽 윤곽선을 '경계 추적(Moore-neighbor tracing)'으로 순서대로 추출
// (각도 정렬 방식은 오목한 모양에서 별 모양으로 꼬여서 사용하지 않음)
export function componentToPolygon(comp, bin, w, h, targetPoints = 60) {
  const set = new Set(comp.pixels)
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && set.has(y * w + x)

  // 시작점: 가장 위쪽 행에서 가장 왼쪽 픽셀
  let sx = -1, sy = -1
  for (let y = comp.minY; y <= comp.maxY && sx < 0; y++) {
    for (let x = comp.minX; x <= comp.maxX; x++) {
      if (inside(x, y)) { sx = x; sy = y; break }
    }
  }
  if (sx < 0) return null

  // 8방향 (시계 방향)
  const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  const contour = []
  let cx = sx, cy = sy
  let dir = 6 // 위쪽에서 진입했다고 가정
  const maxSteps = comp.pixels.length * 8 + 1000
  let steps = 0
  do {
    contour.push([cx, cy])
    let found = false
    // 이전 진행 방향의 반대편부터 시계방향 탐색
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8
      const nx = cx + N8[d][0], ny = cy + N8[d][1]
      if (inside(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break }
    }
    if (!found) break
    steps++
  } while ((cx !== sx || cy !== sy) && steps < maxSteps)

  if (contour.length < 8) return null

  // 균등 다운샘플 (폴리곤 점 수 제한)
  const stride = Math.max(1, Math.floor(contour.length / targetPoints))
  const out = []
  for (let i = 0; i < contour.length; i += stride) out.push(contour[i])
  return out.length >= 6 ? out : contour
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


// 마스크 PNG → 색칠된 반투명 캔버스 (오버레이 표시용)
// 흰색(전경)만 지정 색으로, 나머지는 투명
export async function maskToColorCanvas(blobOrUrl, { color = [34, 211, 238], threshold = 127, alpha = 110 } = {}) {
  const img = await loadImage(blobOrUrl)
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const imgData = ctx.getImageData(0, 0, w, h)
  const d = imgData.data
  for (let p = 0; p < d.length; p += 4) {
    const v = (d[p] + d[p + 1] + d[p + 2]) / 3
    if (v >= threshold && d[p + 3] > 10) {
      d[p] = color[0]; d[p + 1] = color[1]; d[p + 2] = color[2]; d[p + 3] = alpha
    } else {
      d[p + 3] = 0
    }
  }
  ctx.putImageData(imgData, 0, 0)
  return cv
}
