#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

if (!s.includes('aiCompareRenderToken')) {
  s = s.replace(
    'aiCompareVisible: true,',
    'aiCompareVisible: true,\n  aiCompareRenderToken: 0,\n  aiCompareCache: new Map(),'
  )
  console.log('PATCH AI compare render state')
} else {
  console.log('OK AI compare render state already patched')
}

const start = s.indexOf('async function updateAiComparePanel(maskItems = [])')
const end = s.indexOf('function colorizeMaskForCompare', start)
if (start < 0 || end < 0) throw new Error('updateAiComparePanel block not found')

const replacement = `async function updateAiComparePanel(maskItems = []) {
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

  const renderToken = (state.aiCompareRenderToken || 0) + 1
  state.aiCompareRenderToken = renderToken

  if (base.src !== state.currentImageUrl) base.src = state.currentImageUrl

  if (!maskItems.length) {
    stack.replaceChildren()
    caption.textContent = '현재 이미지에 매칭된 AI mask가 없습니다.'
    return
  }

  // 기존 mask를 먼저 지우지 않습니다. Google Drive 스트리밍/큰 PNG에서 새 mask가 준비되기 전까지
  // 이전 화면을 유지해야 깜빡이거나 보였다 말았다 하지 않습니다.
  const nextNodes = []
  const names = []
  for (const item of maskItems) {
    try {
      const cacheKey = [item.path || item.name || item.url, item.color || '#58a6ff', state.aiOpacity || 45].join('|')
      let url = state.aiCompareCache?.get(cacheKey)
      if (!url) {
        url = await colorizeMaskForCompare(item.url, item.color || '#58a6ff')
        if (!state.aiCompareCache) state.aiCompareCache = new Map()
        state.aiCompareCache.set(cacheKey, url)
      }
      if (renderToken !== state.aiCompareRenderToken) return
      const img = document.createElement('img')
      img.className = 'ai-compare-mask'
      img.src = url
      img.alt = item.region + ' ' + item.modelKey
      nextNodes.push(img)
      names.push((item.region || '') + ': ' + (item.modelKey || item.model || 'model'))
    } catch (err) {
      if (renderToken !== state.aiCompareRenderToken) return
      console.warn('[AI compare] mask render failed:', item, err)
    }
  }

  if (renderToken !== state.aiCompareRenderToken) return
  stack.replaceChildren(...nextNodes)
  caption.textContent = names.length ? names.join(' / ') : 'AI mask를 표시하지 못했습니다. 폴더 새로고침을 눌러보세요.'
}

`

const current = s.slice(start, end)
if (current.includes('기존 mask를 먼저 지우지 않습니다')) {
  console.log('OK AI compare flicker fix already patched')
} else {
  s = s.slice(0, start) + replacement + s.slice(end)
  console.log('PATCH AI compare flicker fix')
}

fs.writeFileSync(file, s)
console.log('OK AI compare flicker fix installed')
