/* ================================================================
   전처리 엔진 (표시 전용 / display-only)
   - 원본 픽셀·라벨 좌표는 절대 변경하지 않음. 화면 표시만 바꾼다.
   - 입력은 grayscale X-ray 가정 (RGBA는 luminance로 변환).
   - 가벼운 연산(normalize/gamma/unsharp/aniso/invert)은 순수 JS.
   - 무거운 연산(clahe/canny)은 opencv.js(WASM)를 "지연 로딩"해서 사용.
   ================================================================ */

// ---- 표준 처리 순서 (명세서 규칙) ----
// normalize -> gamma -> clahe -> unsharp -> aniso -> (canny | invert)
export const STEP_ORDER = ['normalize', 'gamma', 'clahe', 'unsharp', 'aniso', 'canny', 'invert']

export const DEFAULT_PARAMS = {
  normalize: { low: 2, high: 98 },
  gamma: { gamma: 0.6 },
  clahe: { clip: 2.0, tile: 8 },
  unsharp: { radius: 2.0, amount: 1.5 },
  aniso: { iterations: 10, kappa: 50, lambda: 0.1 },
  canny: { low: 50, high: 150 },
  invert: {},
}

// ---- 프리셋 (원본 + 6종) ----
export const PRESETS = [
  { id: 'original', name: '원본', steps: [] },
  { id: 'lumbar', name: '요추용', steps: ['clahe'] },
  { id: 'upper_thoracic', name: '상부흉추용', steps: ['gamma', 'unsharp'] },
  { id: 'max', name: '최강조합', steps: ['gamma', 'clahe', 'unsharp'] },
  { id: 'denoise', name: '노이즈억제', steps: ['clahe', 'aniso'] },
  { id: 'edges', name: '경계표시', steps: ['canny'] },
  { id: 'invert', name: '반전', steps: ['invert'] },
]

export function presetById(id) {
  return PRESETS.find(p => p.id === id) || PRESETS[0]
}

export function needsOpenCV(steps) {
  return steps.some(s => s === 'clahe' || s === 'canny')
}

// ================================================================
// grayscale 버퍼 유틸
// ================================================================
// canvas/image -> { gray: Uint8ClampedArray(w*h), w, h }
function toGray(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, w, h)
  const gray = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // Rec.601 luminance (grayscale PNG면 R=G=B라 사실상 그대로)
    gray[i] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) | 0
  }
  return { gray, w, h }
}

// gray -> RGBA canvas
function grayToCanvas(gray, w, h) {
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d')
  const out = ctx.createImageData(w, h)
  const d = out.data
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i]
    d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

// ================================================================
// 순수 JS 연산 (in-place on gray Uint8ClampedArray)
// ================================================================

// Percentile Normalization: 하위 low% ~ 상위 high% 로 clip 후 0~255 재정규화
export function opNormalize(gray, { low = 2, high = 98 } = {}) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  const loCount = total * (low / 100)
  const hiCount = total * (high / 100)
  let cum = 0, loV = 0, hiV = 255
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= loCount) { loV = v; break } }
  cum = 0
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= hiCount) { hiV = v; break } }
  if (hiV <= loV) return gray
  const scale = 255 / (hiV - loV)
  for (let i = 0; i < gray.length; i++) {
    let v = (gray[i] - loV) * scale
    gray[i] = v < 0 ? 0 : v > 255 ? 255 : v
  }
  return gray
}

// Gamma Correction: out = 255 * (in/255)^gamma  (LUT)
export function opGamma(gray, { gamma = 0.6 } = {}) {
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, gamma)
  for (let i = 0; i < gray.length; i++) gray[i] = lut[gray[i]]
  return gray
}

export function opInvert(gray) {
  for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]
  return gray
}

// 분리형(separable) 박스 블러를 여러 번 => 가우시안 근사. radius(px) 기반.
function boxBlurGray(gray, w, h, radius) {
  const r = Math.max(1, Math.round(radius))
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let i = 0; i < gray.length; i++) out[i] = gray[i]
  const passes = 3
  const win = 2 * r + 1
  for (let pass = 0; pass < passes; pass++) {
    // 가로
    for (let y = 0; y < h; y++) {
      let acc = 0
      const row = y * w
      for (let x = -r; x <= r; x++) acc += out[row + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / win
        const xr = Math.min(w - 1, x + r + 1)
        const xl = Math.max(0, x - r)
        acc += out[row + xr] - out[row + xl]
      }
    }
    // 세로
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / win
        const yb = Math.min(h - 1, y + r + 1)
        const yt = Math.max(0, y - r)
        acc += tmp[yb * w + x] - tmp[yt * w + x]
      }
    }
  }
  return out
}

// Unsharp Masking: out = in + amount*(in - blurred)
export function opUnsharp(gray, w, h, { radius = 2.0, amount = 1.5 } = {}) {
  const blurred = boxBlurGray(gray, w, h, radius)
  for (let i = 0; i < gray.length; i++) {
    let v = gray[i] + amount * (gray[i] - blurred[i])
    gray[i] = v < 0 ? 0 : v > 255 ? 255 : v
  }
  return gray
}

// Anisotropic Diffusion (Perona-Malik). 경계 보존 노이즈 제거.
export function opAniso(gray, w, h, { iterations = 10, kappa = 50, lambda = 0.1 } = {}) {
  let img = new Float32Array(w * h)
  for (let i = 0; i < gray.length; i++) img[i] = gray[i]
  const k2 = kappa * kappa
  for (let t = 0; t < iterations; t++) {
    const next = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = img[i]
        const n = y > 0 ? img[i - w] - c : 0
        const s = y < h - 1 ? img[i + w] - c : 0
        const e = x < w - 1 ? img[i + 1] - c : 0
        const west = x > 0 ? img[i - 1] - c : 0
        // Perona-Malik conduction (exp version)
        const cn = Math.exp(-(n * n) / k2)
        const cs = Math.exp(-(s * s) / k2)
        const ce = Math.exp(-(e * e) / k2)
        const cw = Math.exp(-(west * west) / k2)
        next[i] = c + lambda * (cn * n + cs * s + ce * e + cw * west)
      }
    }
    img = next
  }
  for (let i = 0; i < gray.length; i++) {
    const v = img[i]
    gray[i] = v < 0 ? 0 : v > 255 ? 255 : v
  }
  return gray
}

// ================================================================
// opencv.js 지연 로딩 (CLAHE / Canny 용)
// ================================================================
let _cvPromise = null
const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js'

export function loadOpenCV() {
  if (typeof window !== 'undefined' && window.cv && window.cv.Mat) return Promise.resolve(window.cv)
  if (_cvPromise) return _cvPromise
  _cvPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = OPENCV_URL
    script.async = true
    script.onload = () => {
      const cv = window.cv
      if (cv && cv.Mat) return resolve(cv)
      // WASM 초기화가 비동기인 빌드 대응
      if (cv && typeof cv.then === 'function') { cv.then(resolve); return }
      if (cv) { cv.onRuntimeInitialized = () => resolve(window.cv); return }
      reject(new Error('opencv.js 로드 실패'))
    }
    script.onerror = () => reject(new Error('opencv.js 네트워크 로드 실패'))
    document.head.appendChild(script)
  })
  return _cvPromise
}

function cvClahe(cv, gray, w, h, { clip = 2.0, tile = 8 } = {}) {
  const src = cv.matFromArray(h, w, cv.CV_8UC1, gray)
  const dst = new cv.Mat()
  const clahe = new cv.CLAHE(clip, new cv.Size(tile, tile))
  clahe.apply(src, dst)
  const out = new Uint8ClampedArray(dst.data)
  src.delete(); dst.delete(); clahe.delete()
  return out
}

function cvCanny(cv, gray, w, h, { low = 50, high = 150 } = {}) {
  const src = cv.matFromArray(h, w, cv.CV_8UC1, gray)
  const dst = new cv.Mat()
  cv.Canny(src, dst, low, high)
  const out = new Uint8ClampedArray(dst.data)
  src.delete(); dst.delete()
  return out
}

// ================================================================
// 파이프라인 실행
//  source: HTMLImageElement | HTMLCanvasElement
//  steps: STEP_ORDER 의 부분집합
//  params: DEFAULT_PARAMS 구조
//  maxDim: 처리 해상도 상한(긴 변). display 전용이라 다운스케일 OK.
//  반환: 처리된 canvas (steps 비었으면 null → 원본 사용)
// ================================================================
export async function runPipeline(source, steps, params = {}, { maxDim = 1400 } = {}) {
  const orderedSteps = STEP_ORDER.filter(s => steps.includes(s))
  if (orderedSteps.length === 0) return null

  const sw = source.naturalWidth || source.width
  const sh = source.naturalHeight || source.height
  const scale = Math.min(1, maxDim / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))

  const work = Object.assign(document.createElement('canvas'), { width: w, height: h })
  work.getContext('2d').drawImage(source, 0, 0, w, h)

  let { gray } = toGray(work)
  const P = k => ({ ...DEFAULT_PARAMS[k], ...(params[k] || {}) })

  for (const step of orderedSteps) {
    switch (step) {
      case 'normalize': opNormalize(gray, P('normalize')); break
      case 'gamma': opGamma(gray, P('gamma')); break
      case 'unsharp': opUnsharp(gray, w, h, P('unsharp')); break
      case 'aniso': opAniso(gray, w, h, P('aniso')); break
      case 'invert': opInvert(gray); break
      case 'clahe': { const cv = await loadOpenCV(); gray = cvClahe(cv, gray, w, h, P('clahe')); break }
      case 'canny': { const cv = await loadOpenCV(); gray = cvCanny(cv, gray, w, h, P('canny')); break }
    }
  }
  return grayToCanvas(gray, w, h)
}
