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

const zoomHelpers = `function initAiCompareZoomControls() {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  if (!stage || stage.dataset.zoomReady === '1') return
  stage.dataset.zoomReady = '1'

  document.getElementById('aiCompareZoomIn')?.addEventListener('click', () => zoomAiCompareAtCenter((state.aiCompareZoom || 1) * 1.2))
  document.getElementById('aiCompareZoomOut')?.addEventListener('click', () => zoomAiCompareAtCenter((state.aiCompareZoom || 1) / 1.2))
  document.getElementById('aiCompareZoomReset')?.addEventListener('click', () => resetAiCompareZoom())

  stage.addEventListener('wheel', (e) => {
    e.preventDefault()

    // 본 앱 라벨링 캔버스와 같은 wheel 정규화/감도 로직.
    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= 16
    else if (e.deltaMode === 2) dy *= 100
    dy = Math.max(-200, Math.min(200, dy))
    const sensitivity = 0.0005
    const factor = Math.exp(-dy * sensitivity)

    const rect = stage.getBoundingClientRect()
    zoomAiCompareAtPoint((state.aiCompareZoom || 1) * factor, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }, { passive: false })

  stage.addEventListener('pointerdown', (e) => {
    state.aiCompareDragging = true
    state.aiCompareDragStartX = e.clientX
    state.aiCompareDragStartY = e.clientY
    state.aiCompareStartPanX = state.aiComparePanX || 0
    state.aiCompareStartPanY = state.aiComparePanY || 0
    stage.setPointerCapture?.(e.pointerId)
    stage.classList.add('dragging')
    e.preventDefault()
  })

  stage.addEventListener('pointermove', (e) => {
    if (!state.aiCompareDragging) return
    state.aiComparePanX = (state.aiCompareStartPanX || 0) + (e.clientX - state.aiCompareDragStartX)
    state.aiComparePanY = (state.aiCompareStartPanY || 0) + (e.clientY - state.aiCompareDragStartY)
    applyAiCompareTransform()
    e.preventDefault()
  })

  const stopDrag = (e) => {
    if (!state.aiCompareDragging) return
    state.aiCompareDragging = false
    stage.releasePointerCapture?.(e.pointerId)
    stage.classList.remove('dragging')
    e.preventDefault()
  }
  stage.addEventListener('pointerup', stopDrag)
  stage.addEventListener('pointercancel', stopDrag)
  stage.addEventListener('dblclick', () => resetAiCompareZoom())
}

function zoomAiCompareAtCenter(newScale) {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  if (!stage) return
  zoomAiCompareAtPoint(newScale, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 })
}

function zoomAiCompareAtPoint(newScale, point) {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  if (!stage || !wrap) return

  newScale = Math.max(0.25, Math.min(20, Number(newScale) || 1))
  const oldScale = state.aiCompareZoom || 1

  const layoutX = wrap.offsetLeft
  const layoutY = wrap.offsetTop
  const panX = state.aiComparePanX || 0
  const panY = state.aiComparePanY || 0

  // 본 앱의 zoomAtPoint와 같은 원리:
  // 포인터 아래의 이미지 좌표가 줌 전/후에도 같은 위치에 남도록 pan을 재계산합니다.
  const pointTo = {
    x: (point.x - layoutX - panX) / oldScale,
    y: (point.y - layoutY - panY) / oldScale,
  }

  state.aiCompareZoom = newScale
  state.aiComparePanX = point.x - layoutX - pointTo.x * newScale
  state.aiComparePanY = point.y - layoutY - pointTo.y * newScale
  applyAiCompareTransform()
}

function resetAiCompareZoom() {
  state.aiCompareZoom = 1
  state.aiComparePanX = 0
  state.aiComparePanY = 0
  applyAiCompareTransform()
}

function applyAiCompareTransform() {
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  const resetBtn = document.getElementById('aiCompareZoomReset')
  if (!wrap) return
  const z = state.aiCompareZoom || 1
  wrap.style.transform = 'translate(' + (state.aiComparePanX || 0) + 'px, ' + (state.aiComparePanY || 0) + 'px) scale(' + z + ')'
  wrap.style.transformOrigin = '0 0'
  wrap.classList.toggle('zoomed', z > 1)
  if (resetBtn) resetBtn.textContent = Math.round(z * 100)
}

`
replaceBlock(
  'AI compare zoom helpers match main canvas',
  'function initAiCompareZoomControls() {',
  'async function updateAiComparePanel(maskItems = []) {',
  zoomHelpers + '\n',
  '본 앱 라벨링 캔버스와 같은 wheel 정규화/감도 로직'
)

// Improve render quality: keep full-resolution backing canvas, use high-quality base image draw,
// and crisp binary masks. Also resize CSS presentation only, not the backing canvas.
s = s.replace(
  "  const ctx = canvas.getContext('2d', { willReadFrequently: true })\n  ctx.clearRect(0, 0, w, h)\n  ctx.drawImage(baseImg, 0, 0, w, h)",
  "  const ctx = canvas.getContext('2d', { willReadFrequently: true })\n  ctx.imageSmoothingEnabled = true\n  ctx.imageSmoothingQuality = 'high'\n  ctx.clearRect(0, 0, w, h)\n  ctx.drawImage(baseImg, 0, 0, w, h)"
)
s = s.replace(
  "    const tctx = tmp.getContext('2d', { willReadFrequently: true })\n\n    // 핵심:",
  "    const tctx = tmp.getContext('2d', { willReadFrequently: true })\n    tctx.imageSmoothingEnabled = false\n\n    // 핵심:"
)
if (s.includes("ctx.imageSmoothingQuality = 'high'") && s.includes('tctx.imageSmoothingEnabled = false')) {
  console.log('PATCH/OK AI compare render quality settings')
  changed = true
}

if (changed) fs.writeFileSync(appFile, s)

const cssFile = 'public/static/style.css'
let css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n')
const cssAdd = `

/* AI compare: preserve crisp canvas rendering and main-canvas-like pan cursor */
#aiCompareCanvas {
  display: block;
  max-width: none;
  max-height: none;
}
.ai-compare-stage {
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.ai-compare-image-wrap {
  transform-origin: 0 0 !important;
}
`
if (!css.includes('#aiCompareCanvas')) {
  css += cssAdd
  fs.writeFileSync(cssFile, css)
  console.log('PATCH AI compare canvas quality styles')
} else {
  console.log('OK AI compare canvas quality styles already patched')
}

console.log('OK AI compare main wheel and quality patch installed')
