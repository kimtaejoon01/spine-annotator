#!/usr/bin/env node

import fs from 'node:fs'

const appFile = 'public/static/app.js'
let s = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n')
let changed = false

function replaceBlock(label, startNeedle, endNeedle, replacement, alreadyNeedle) {
  if (alreadyNeedle && s.includes(alreadyNeedle)) {
    console.log('OK ' + label + ' already patched')
    return
  }
  const start = s.indexOf(startNeedle)
  const end = s.indexOf(endNeedle, start)
  if (start < 0 || end < 0) throw new Error('Patch failed: ' + label)
  s = s.slice(0, start) + replacement + s.slice(end)
  console.log('PATCH ' + label)
  changed = true
}

const zoomAtPoint = `function zoomAiCompareAtPoint(newScale, point) {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  const canvas = document.getElementById('aiCompareCanvas')
  if (!stage || !wrap || !canvas) return

  newScale = Math.max(0.25, Math.min(20, Number(newScale) || 1))
  const oldScale = state.aiCompareZoom || 1

  const fitW = state.aiCompareFitW || Number(wrap.dataset.fitW) || wrap.offsetWidth || canvas.clientWidth || canvas.width || 1
  const fitH = state.aiCompareFitH || Number(wrap.dataset.fitH) || wrap.offsetHeight || canvas.clientHeight || canvas.height || 1

  const oldW = fitW * oldScale
  const oldH = fitH * oldScale
  const oldLeft = (stage.clientWidth - oldW) / 2 + (state.aiComparePanX || 0)
  const oldTop = (stage.clientHeight - oldH) / 2 + (state.aiComparePanY || 0)

  // 본 앱 zoomAtPoint와 같은 원리입니다.
  // 포인터 아래의 이미지 좌표가 줌 전/후에도 같은 화면 위치에 남도록 pan을 재계산합니다.
  const pointTo = {
    x: (point.x - oldLeft) / oldScale,
    y: (point.y - oldTop) / oldScale,
  }

  const newW = fitW * newScale
  const newH = fitH * newScale
  const newLeft = point.x - pointTo.x * newScale
  const newTop = point.y - pointTo.y * newScale

  state.aiCompareZoom = newScale
  state.aiComparePanX = newLeft - (stage.clientWidth - newW) / 2
  state.aiComparePanY = newTop - (stage.clientHeight - newH) / 2
  applyAiCompareTransform()
}

`
replaceBlock(
  'AI compare no-transform zoomAtPoint',
  'function zoomAiCompareAtPoint(newScale, point) {',
  'function resetAiCompareZoom() {',
  zoomAtPoint,
  'AI compare no-transform zoomAtPoint'
)

const transformFn = `function applyAiCompareTransform() {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  const canvas = document.getElementById('aiCompareCanvas')
  const resetBtn = document.getElementById('aiCompareZoomReset')
  if (!stage || !wrap || !canvas) return

  const z = state.aiCompareZoom || 1
  const fitW = state.aiCompareFitW || Number(wrap.dataset.fitW) || canvas.clientWidth || canvas.width || 1
  const fitH = state.aiCompareFitH || Number(wrap.dataset.fitH) || canvas.clientHeight || canvas.height || 1
  const cssW = Math.max(1, fitW * z)
  const cssH = Math.max(1, fitH * z)
  const left = (stage.clientWidth - cssW) / 2 + (state.aiComparePanX || 0)
  const top = (stage.clientHeight - cssH) / 2 + (state.aiComparePanY || 0)

  // 화질 개선 핵심:
  // CSS transform: scale(...)로 이미 축소 렌더된 canvas를 확대하지 않고,
  // canvas 표시 크기 자체를 zoom에 맞춰 바꿉니다. backing canvas는 원본 해상도 그대로 유지됩니다.
  wrap.style.position = 'absolute'
  wrap.style.left = left + 'px'
  wrap.style.top = top + 'px'
  wrap.style.width = cssW + 'px'
  wrap.style.height = cssH + 'px'
  wrap.style.transform = 'none'
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'

  wrap.classList.toggle('zoomed', z > 1)
  if (resetBtn) resetBtn.textContent = Math.round(z * 100)
}

`
replaceBlock(
  'AI compare no-transform apply transform',
  'function applyAiCompareTransform() {',
  'async function updateAiComparePanel(maskItems = []) {',
  transformFn,
  'CSS transform: scale(...)로 이미 축소 렌더된 canvas를 확대하지 않고'
)

const sizeFn = `function updateAiCompareCanvasSize() {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  const canvas = document.getElementById('aiCompareCanvas')
  if (!stage || !wrap || !canvas || !canvas.width || !canvas.height) return

  const maxW = Math.max(1, stage.clientWidth - 8)
  const maxH = Math.max(1, stage.clientHeight - 8)
  // 본 앱 zoomToFit처럼 처음에는 화면에 맞추되, backing canvas는 원본 해상도 그대로 둡니다.
  const fitScale = Math.min(maxW / canvas.width, maxH / canvas.height) * 0.95
  const fitW = Math.max(1, canvas.width * fitScale)
  const fitH = Math.max(1, canvas.height * fitScale)

  state.aiCompareFitW = fitW
  state.aiCompareFitH = fitH
  wrap.dataset.fitW = String(fitW)
  wrap.dataset.fitH = String(fitH)
  applyAiCompareTransform()
}

`
replaceBlock(
  'AI compare no-transform fit sizing',
  'function updateAiCompareCanvasSize() {',
  'function colorizeMaskForCompare',
  sizeFn,
  'backing canvas는 원본 해상도 그대로 둡니다'
)

if (changed) fs.writeFileSync(appFile, s)

const cssFile = 'public/static/style.css'
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n')
const cssAdd = `

/* AI compare: high-quality pan/zoom without CSS scale blur */
.ai-compare-stage {
  position: relative !important;
  overflow: hidden !important;
}
#aiComparePanel .ai-compare-image-wrap {
  position: absolute;
  transform: none !important;
  max-width: none !important;
  max-height: none !important;
  line-height: 0;
}
#aiCompareCanvas {
  display: block;
  max-width: none !important;
  max-height: none !important;
}
`
if (!css.includes('high-quality pan/zoom without CSS scale blur')) {
  css += cssAdd
  fs.writeFileSync(cssFile, css)
  console.log('PATCH AI compare no-transform quality styles')
} else {
  console.log('OK AI compare no-transform quality styles already patched')
}

console.log(changed ? 'OK AI compare no-transform quality patch installed' : 'OK AI compare no-transform quality already installed')
