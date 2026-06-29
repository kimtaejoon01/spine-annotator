#!/usr/bin/env node

import fs from 'node:fs'

const appFile = 'public/static/app.js'
let s = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n')
let changed = false

function replaceOnce(label, from, to) {
  if (s.includes(to)) {
    console.log('OK ' + label + ' already patched')
    return
  }
  if (!s.includes(from)) throw new Error('Patch failed: ' + label)
  s = s.replace(from, to)
  console.log('PATCH ' + label)
  changed = true
}

// Add zoom state.
if (!s.includes('aiCompareZoom: 1')) {
  s = s.replace(
    'aiCompareCache: new Map(),',
    'aiCompareCache: new Map(),\n  aiCompareZoom: 1,\n  aiComparePanX: 0,\n  aiComparePanY: 0,\n  aiCompareDragging: false,'
  )
  console.log('PATCH AI compare zoom state')
  changed = true
} else {
  console.log('OK AI compare zoom state already patched')
}

// Add zoom controls to header HTML.
const oldHeader = '<div class="ai-compare-header"><span><i class="fas fa-robot"></i> AI 비교</span><button class="btn-icon" id="closeAiComparePanel" title="비교창 닫기"><i class="fas fa-times"></i></button></div>'
const newHeader = '<div class="ai-compare-header"><span><i class="fas fa-robot"></i> AI 비교</span><div class="ai-compare-actions"><button class="btn-icon" id="aiCompareZoomOut" title="축소"><i class="fas fa-search-minus"></i></button><button class="btn-icon" id="aiCompareZoomReset" title="맞춤"><span>100</span></button><button class="btn-icon" id="aiCompareZoomIn" title="확대"><i class="fas fa-search-plus"></i></button><button class="btn-icon" id="closeAiComparePanel" title="비교창 닫기"><i class="fas fa-times"></i></button></div></div>'
replaceOnce('AI compare zoom buttons', oldHeader, newHeader)

// Initialize zoom controls when the panel is created.
const oldCloseBlock = `  document.getElementById('closeAiComparePanel')?.addEventListener('click', () => {
    state.aiCompareVisible = false
    const cb = document.getElementById('toggleAiCompare')
    if (cb) cb.checked = false
    updateAiComparePanel([]).catch(() => {})
  })
}`
const newCloseBlock = `  document.getElementById('closeAiComparePanel')?.addEventListener('click', () => {
    state.aiCompareVisible = false
    const cb = document.getElementById('toggleAiCompare')
    if (cb) cb.checked = false
    updateAiComparePanel([]).catch(() => {})
  })
  initAiCompareZoomControls()
}`
replaceOnce('AI compare zoom controls init', oldCloseBlock, newCloseBlock)

// Insert helper functions before updateAiComparePanel. Be idempotent with the
// newer main-wheel-quality patch, which replaces zoomAiCompare() with
// zoomAiCompareAtPoint(). Checking only zoomAiCompare() caused this patch to
// reinsert a second initAiCompareZoomControls() on every dev run.
const helperNeedle = 'async function updateAiComparePanel(maskItems = []) {'
const helpers = `function initAiCompareZoomControls() {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  if (!stage || stage.dataset.zoomReady === '1') return
  stage.dataset.zoomReady = '1'

  document.getElementById('aiCompareZoomIn')?.addEventListener('click', () => zoomAiCompare(1.08))
  document.getElementById('aiCompareZoomOut')?.addEventListener('click', () => zoomAiCompare(1 / 1.08))
  document.getElementById('aiCompareZoomReset')?.addEventListener('click', () => resetAiCompareZoom())

  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.04 : 1 / 1.04
    const rect = stage.getBoundingClientRect()
    zoomAiCompare(factor, e.clientX - rect.left, e.clientY - rect.top)
  }, { passive: false })

  stage.addEventListener('pointerdown', (e) => {
    if ((state.aiCompareZoom || 1) <= 1.001) return
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

function zoomAiCompare(factor, originX = null, originY = null) {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  if (!stage || !wrap) return

  const oldZoom = state.aiCompareZoom || 1
  const newZoom = Math.max(1, Math.min(8, oldZoom * factor))
  if (Math.abs(newZoom - oldZoom) < 0.001) return

  if (originX == null || originY == null) {
    originX = stage.clientWidth / 2
    originY = stage.clientHeight / 2
  }

  const px = state.aiComparePanX || 0
  const py = state.aiComparePanY || 0
  const ratio = newZoom / oldZoom
  state.aiComparePanX = originX - (originX - px) * ratio
  state.aiComparePanY = originY - (originY - py) * ratio
  state.aiCompareZoom = newZoom

  if (state.aiCompareZoom <= 1.01) {
    state.aiCompareZoom = 1
    state.aiComparePanX = 0
    state.aiComparePanY = 0
  }
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
  wrap.style.transformOrigin = 'center center'
  wrap.classList.toggle('zoomed', z > 1)
  if (resetBtn) resetBtn.textContent = Math.round(z * 100)
}

`
if (!s.includes('function initAiCompareZoomControls(')) {
  if (!s.includes(helperNeedle)) throw new Error('Patch failed: AI compare zoom helper needle')
  s = s.replace(helperNeedle, helpers + helperNeedle)
  console.log('PATCH AI compare zoom helper functions')
  changed = true
} else {
  console.log('OK AI compare zoom helper functions already patched')
}

// Reset zoom only when the original image actually changes.
const imageSet = '  if (base.src !== state.currentImageUrl) base.src = state.currentImageUrl'
const imageSetZoom = `  if (base.dataset.currentImageUrl !== state.currentImageUrl) {
    base.dataset.currentImageUrl = state.currentImageUrl
    base.src = state.currentImageUrl
    resetAiCompareZoom()
  }`
replaceOnce('AI compare reset zoom on image change', imageSet, imageSetZoom)

fs.writeFileSync(appFile, s)
console.log(changed ? 'OK AI compare zoom/pan patch installed' : 'OK AI compare zoom/pan already installed')
