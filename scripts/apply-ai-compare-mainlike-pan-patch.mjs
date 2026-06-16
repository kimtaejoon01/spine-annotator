#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
let changed = false

function replace(label, from, to) {
  if (s.includes(to)) {
    console.log('OK ' + label + ' already patched')
    return
  }
  if (!s.includes(from)) throw new Error('Patch failed: ' + label)
  s = s.replace(from, to)
  console.log('PATCH ' + label)
  changed = true
}

replace('slower AI compare click zoom in', 'zoomAiCompare(1.08)', 'zoomAiCompare(1.04)')
replace('slower AI compare click zoom out', 'zoomAiCompare(1 / 1.08)', 'zoomAiCompare(1 / 1.04)')
replace('slower AI compare wheel zoom in', 'e.deltaY < 0 ? 1.04 : 1 / 1.04', 'e.deltaY < 0 ? 1.025 : 1 / 1.025')

// Allow drag-pan even at 1x, like the main canvas feel.
s = s.replace('    if ((state.aiCompareZoom || 1) <= 1.001) return\n    state.aiCompareDragging = true', '    state.aiCompareDragging = true')
if (!s.includes('if ((state.aiCompareZoom || 1) <= 1.001) return')) {
  console.log('PATCH AI compare pan at any zoom')
  changed = true
} else {
  console.log('OK AI compare pan at any zoom already patched')
}

// Remove the auto pan reset at low zoom. The user can press 100 to reset.
s = s.replace(`
  // 확대가 1배 가까이면 자동으로 맞춤 상태로 복귀합니다.
  if (state.aiCompareZoom <= 1.01) {
    state.aiCompareZoom = 1
    state.aiComparePanX = 0
    state.aiComparePanY = 0
  }
  applyAiCompareTransform()`, `
  if (state.aiCompareZoom <= 1.001) state.aiCompareZoom = 1
  applyAiCompareTransform()`)
if (s.includes('The user can press 100 to reset')) {
  console.log('PATCH AI compare no auto pan reset')
  changed = true
} else {
  console.log('OK AI compare no auto pan reset already patched')
}

if (changed) fs.writeFileSync(file, s)
console.log(changed ? 'OK AI compare main-like pan patch installed' : 'OK AI compare main-like pan already installed')
