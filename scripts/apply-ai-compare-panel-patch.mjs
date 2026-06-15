#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

function patch(label, fn) {
  const next = fn(s)
  if (next === s) {
    console.log('OK ' + label + ' already patched')
  } else {
    console.log('PATCH ' + label)
    s = next
  }
}

patch('AI compare state/default main overlay off', (x) => x
  .replace('aiMaskVisible: true,', 'aiMaskVisible: false,\n  aiCompareVisible: true,')
  .replace('aiCompareVisible: true,\n  aiCompareVisible: true,', 'aiCompareVisible: true,'))

patch('track sample image url', (x) => x.replace(
  "  const sampleUrl = '/static/sample-spine.png'\n",
  "  const sampleUrl = '/static/sample-spine.png'\n  state.currentImageUrl = sampleUrl\n"
))

patch('track uploaded image url', (x) => x.replace(
  "  const url = URL.createObjectURL(file)\n  state.annotator.loadImage(url).then(() => {",
  "  const url = URL.createObjectURL(file)\n  state.currentImageUrl = url\n  state.annotator.loadImage(url).then(() => {"
))

patch('track folder image url', (x) => x.replace(
  "    state.currentObjectUrl = url\n    state.filename = fileEntry.name",
  "    state.currentObjectUrl = url\n    state.currentImageUrl = url\n    state.filename = fileEntry.name"
))

patch('inject compare controls binding', (x) => x.replace(
  "  const aiToggle = document.getElementById('toggleAiOverlay')\n  if (aiToggle) {",
  "  ensureAiComparePanel()\n  injectAiCompareControls()\n  const aiToggle = document.getElementById('toggleAiOverlay')\n  if (aiToggle) {\n    const labelSpan = aiToggle.closest('label')?.querySelector('span')\n    if (labelSpan) labelSpan.textContent = '현재 화면에 AI 겹쳐보기'"
))

const helperNeedle = "function toggleOriginalOnly() {\n"
const helpers = `function injectAiCompareControls() {
  if (document.getElementById('toggleAiCompare')) return
  const status = document.getElementById('aiFolderStatus')
  if (!status) return
  status.insertAdjacentHTML('afterend', '<div class="control-group"><label class="checkbox-label"><input type="checkbox" id="toggleAiCompare" checked /><span>AI 비교창 보기</span></label></div>')
  const cb = document.getElementById('toggleAiCompare')
  cb.checked = state.aiCompareVisible
  cb.addEventListener('change', (e) => {
    state.aiCompareVisible = e.target.checked
    updateAiComparePanel(state.currentAiCompareItems || []).catch(() => {})
  })
}

function ensureAiComparePanel() {
  if (document.getElementById('aiComparePanel')) return
  const container = document.getElementById('canvasContainer')
  if (!container) return
  const panel = document.createElement('div')
  panel.id = 'aiComparePanel'
  panel.className = 'ai-compare-panel hidden'
  panel.innerHTML = '<div class="ai-compare-header"><span><i class="fas fa-robot"></i> AI 비교</span><button class="btn-icon" id="closeAiComparePanel" title="비교창 닫기"><i class="fas fa-times"></i></button></div><div class="ai-compare-body"><div class="ai-compare-stage"><div class="ai-compare-image-wrap"><img id="aiCompareBase" alt="원본" /><div id="aiCompareOverlayStack"></div></div></div><div id="aiCompareCaption" class="ai-compare-caption">AI mask 폴더를 연결하세요</div></div>'
  container.appendChild(panel)
  document.getElementById('closeAiComparePanel')?.addEventListener('click', () => {
    state.aiCompareVisible = false
    const cb = document.getElementById('toggleAiCompare')
    if (cb) cb.checked = false
    updateAiComparePanel([]).catch(() => {})
  })
}

async function updateAiComparePanel(maskItems = []) {
  ensureAiComparePanel()
  state.currentAiCompareItems = maskItems
  const panel = document.getElementById('aiComparePanel')
  const base = document.getElementById('aiCompareBase')
  const stack = document.getElementById('aiCompareOverlayStack')
  const caption = document.getElementById('aiCompareCaption')
  if (!panel || !base || !stack || !caption) return

  const show = state.aiCompareVisible && !state.originalOnly && !!state.currentImageUrl
  panel.classList.toggle('hidden', !show)
  if (!show) return

  base.src = state.currentImageUrl
  stack.innerHTML = ''
  if (!maskItems.length) {
    caption.textContent = '현재 이미지에 매칭된 AI mask가 없습니다.'
    return
  }

  const names = []
  for (const item of maskItems) {
    try {
      const url = await colorizeMaskForCompare(item.url, item.color || '#58a6ff')
      const img = document.createElement('img')
      img.className = 'ai-compare-mask'
      img.src = url
      img.alt = item.region + ' ' + item.modelKey
      stack.appendChild(img)
      names.push((item.region || '') + ': ' + (item.modelKey || item.model || 'model'))
    } catch (err) {
      console.warn('[AI compare] mask render failed:', item, err)
    }
  }
  caption.textContent = names.join(' / ')
}

function colorizeMaskForCompare(src, color) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const rgb = hexToRgbForCompare(color)
      const alphaScale = Math.max(0, Math.min(100, Number(state.aiOpacity || 45))) / 100
      for (let i = 0; i < image.data.length; i += 4) {
        const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2], a = image.data[i + 3]
        const bright = Math.max(r, g, b)
        if (a > 0 && bright > 20) {
          image.data[i] = rgb.r
          image.data[i + 1] = rgb.g
          image.data[i + 2] = rgb.b
          image.data[i + 3] = Math.round(230 * alphaScale)
        } else {
          image.data[i + 3] = 0
        }
      }
      ctx.putImageData(image, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = src
  })
}

function hexToRgbForCompare(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{6})$/i)
  if (!m) return { r: 88, g: 166, b: 255 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

`
patch('AI compare panel helper functions', (x) => x.includes('function updateAiComparePanel') ? x : x.replace(helperNeedle, helpers + helperNeedle))

const start = s.indexOf('async function applyAiOverlayForCurrentFile()')
const end = s.indexOf('function revokeAiObjectUrls()', start)
if (start < 0 || end < 0) throw new Error('applyAiOverlayForCurrentFile not found')
const newApply = `async function applyAiOverlayForCurrentFile() {
  const token = ++state.aiLoadToken
  revokeAiObjectUrls()
  if (!state.annotator) return

  renderAiRegionControls()
  const candidates = getAiCandidatesForCurrentFile()
  const selected = []
  for (const region of AI_REGIONS) {
    if (!state.aiRegionVisible[region.id]) continue
    const item = candidates.find(x => x.region === region.id && x.modelKey === state.aiSelectedModel[region.id])
    if (item) selected.push({ ...item, color: region.color })
  }

  const maskItems = []
  for (const item of selected) {
    const obj = await fileHandleToUrl(item.handle)
    state.aiObjectUrls.push(obj.url)
    maskItems.push({ ...item, url: obj.url })
  }
  if (token !== state.aiLoadToken) {
    revokeAiObjectUrls()
    return
  }

  state.annotator.setAiMaskOpacity(state.aiOpacity)
  if (state.aiMaskVisible && !state.originalOnly) {
    state.annotator.setAiMaskVisible(true)
    await state.annotator.loadAiMasks(maskItems)
  } else {
    state.annotator.clearAiMasks()
    state.annotator.setAiMaskVisible(false)
  }
  await updateAiComparePanel(maskItems)
}
`
const currentApply = s.slice(start, end)
if (!currentApply.includes('await updateAiComparePanel(maskItems)')) {
  s = s.slice(0, start) + newApply + s.slice(end)
  console.log('PATCH AI compare apply flow')
} else {
  console.log('OK AI compare apply flow already patched')
}

// Update original-only mode to refresh the side panel too.
patch('original-only refresh compare panel', (x) => x.replace(
  "  state.annotator.setAiMaskVisible(state.originalOnly ? false : state.aiMaskVisible)\n}",
  "  state.annotator.setAiMaskVisible(state.originalOnly ? false : state.aiMaskVisible)\n  updateAiComparePanel(state.currentAiCompareItems || []).catch(() => {})\n}"
))

// Opacity slider should refresh side panel as well as main Konva overlay.
patch('opacity refresh compare panel', (x) => x.replace(
  "      state.annotator.setAiMaskOpacity(state.aiOpacity)\n    })",
  "      state.annotator.setAiMaskOpacity(state.aiOpacity)\n      updateAiComparePanel(state.currentAiCompareItems || []).catch(() => {})\n    })"
))

fs.writeFileSync(file, s)
console.log('OK side-by-side AI compare panel installed')
