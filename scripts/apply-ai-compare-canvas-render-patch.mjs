#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
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

// Replace compare panel DOM from stacked <img> overlay to one canvas.
s = s.replace(
  '<div class="ai-compare-stage"><div class="ai-compare-image-wrap"><img id="aiCompareBase" alt="원본" /><div id="aiCompareOverlayStack"></div></div></div>',
  '<div class="ai-compare-stage"><div class="ai-compare-image-wrap"><canvas id="aiCompareCanvas"></canvas></div></div>'
)
if (s.includes('canvas id="aiCompareCanvas"')) {
  console.log('OK AI compare canvas DOM ready')
}

const updateReplacement = `async function updateAiComparePanel(maskItems = []) {
  ensureAiComparePanel()
  state.currentAiCompareItems = maskItems
  const panel = document.getElementById('aiComparePanel')
  const canvas = document.getElementById('aiCompareCanvas')
  const caption = document.getElementById('aiCompareCaption')
  if (!panel || !canvas || !caption) return

  const show = state.aiCompareVisible && !state.originalOnly && !!state.currentImageUrl
  panel.classList.toggle('hidden', !show)
  if (!show) return

  const renderToken = (state.aiCompareRenderToken || 0) + 1
  state.aiCompareRenderToken = renderToken

  try {
    const names = await renderAiCompareCanvas(canvas, maskItems, renderToken)
    if (renderToken !== state.aiCompareRenderToken) return
    if (!maskItems.length) caption.textContent = '현재 이미지에 매칭된 AI mask가 없습니다.'
    else caption.textContent = names.length ? names.join(' / ') : 'AI mask를 표시하지 못했습니다. 폴더 새로고침을 눌러보세요.'
  } catch (err) {
    if (renderToken !== state.aiCompareRenderToken) return
    console.warn('[AI compare] canvas render failed:', err)
    caption.textContent = 'AI 비교창 렌더링 실패: ' + (err.message || err)
  }
}

`
replaceBlock(
  'AI compare canvas update flow',
  'async function updateAiComparePanel(maskItems = [])',
  'function colorizeMaskForCompare',
  updateReplacement,
  'renderAiCompareCanvas(canvas, maskItems, renderToken)'
)

const renderHelpers = `function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function renderAiCompareCanvas(canvas, maskItems = [], renderToken = 0) {
  const baseImg = await loadImageElement(state.currentImageUrl)
  if (renderToken !== state.aiCompareRenderToken) return []

  const w = baseImg.naturalWidth || baseImg.width
  const h = baseImg.naturalHeight || baseImg.height
  if (!w || !h) throw new Error('원본 이미지 크기를 읽지 못했습니다')

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(baseImg, 0, 0, w, h)

  const alphaScale = Math.max(0, Math.min(100, Number(state.aiOpacity || 45))) / 100
  const names = []

  for (const item of maskItems) {
    if (renderToken !== state.aiCompareRenderToken) return names
    const maskImg = await loadImageElement(item.url)
    if (renderToken !== state.aiCompareRenderToken) return names

    const rgb = hexToRgbForCompare(item.color || '#58a6ff')
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const tctx = tmp.getContext('2d', { willReadFrequently: true })

    // 핵심: 원본과 mask를 CSS로 따로 맞추지 않고, 원본 canvas 좌표계에 mask를 직접 리사이즈해서 그립니다.
    // 이렇게 해야 object-fit/브라우저 scaling 때문에 AI mask가 밀려 보이지 않습니다.
    tctx.drawImage(maskImg, 0, 0, w, h)
    const imgData = tctx.getImageData(0, 0, w, h)
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i]
      const g = imgData.data[i + 1]
      const b = imgData.data[i + 2]
      const a = imgData.data[i + 3]
      const bright = Math.max(r, g, b)
      if (a > 0 && bright >= 128) {
        imgData.data[i] = rgb.r
        imgData.data[i + 1] = rgb.g
        imgData.data[i + 2] = rgb.b
        imgData.data[i + 3] = Math.round(230 * alphaScale)
      } else {
        imgData.data[i + 3] = 0
      }
    }
    tctx.putImageData(imgData, 0, 0)
    ctx.drawImage(tmp, 0, 0)
    names.push((item.region || '') + ': ' + (item.modelKey || item.model || 'model'))
  }

  updateAiCompareCanvasSize()
  return names
}

function updateAiCompareCanvasSize() {
  const stage = document.querySelector('#aiComparePanel .ai-compare-stage')
  const wrap = document.querySelector('#aiComparePanel .ai-compare-image-wrap')
  const canvas = document.getElementById('aiCompareCanvas')
  if (!stage || !wrap || !canvas || !canvas.width || !canvas.height) return

  const maxW = Math.max(1, stage.clientWidth - 2)
  const maxH = Math.max(1, stage.clientHeight - 2)
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1)
  const cssW = Math.max(1, Math.round(canvas.width * scale))
  const cssH = Math.max(1, Math.round(canvas.height * scale))
  wrap.style.width = cssW + 'px'
  wrap.style.height = cssH + 'px'
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'
  applyAiCompareTransform()
}

`
if (!s.includes('function renderAiCompareCanvas(')) {
  const needle = 'function colorizeMaskForCompare(src, color) {'
  if (!s.includes(needle)) throw new Error('Patch failed: canvas render helpers needle')
  s = s.replace(needle, renderHelpers + needle)
  console.log('PATCH AI compare canvas render helpers')
  changed = true
} else {
  console.log('OK AI compare canvas render helpers already patched')
}

if (changed) fs.writeFileSync(file, s)
console.log(changed ? 'OK AI compare canvas render patch installed' : 'OK AI compare canvas render already installed')
