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
  if (!s.includes(from)) {
    console.log('OK ' + label + ' skipped; source pattern not present')
    return
  }
  s = s.replace(from, to)
  console.log('PATCH ' + label)
  changed = true
}

replace('slower AI compare click zoom in', 'zoomAiCompare(1.08)', 'zoomAiCompare(1.04)')
replace('slower AI compare click zoom out', 'zoomAiCompare(1 / 1.08)', 'zoomAiCompare(1 / 1.04)')
replace('slower AI compare wheel zoom in', 'e.deltaY < 0 ? 1.04 : 1 / 1.04', 'e.deltaY < 0 ? 1.025 : 1 / 1.025')

// Allow drag-pan even at 1x, like the main canvas feel. Newer zoom helpers may
// already use zoomAiCompareAtPoint() and no longer contain this old guard.
const oldPanGuard = '    if ((state.aiCompareZoom || 1) <= 1.001) return\n    state.aiCompareDragging = true'
if (s.includes(oldPanGuard)) {
  s = s.replace(oldPanGuard, '    state.aiCompareDragging = true')
  console.log('PATCH AI compare pan at any zoom')
  changed = true
} else {
  console.log('OK AI compare pan at any zoom already patched/skipped')
}

// Remove the auto pan reset at low zoom. The user can press 100 to reset.
const oldAutoReset = `
  // 확대가 1배 가까이면 자동으로 맞춤 상태로 복귀합니다.
  if (state.aiCompareZoom <= 1.01) {
    state.aiCompareZoom = 1
    state.aiComparePanX = 0
    state.aiComparePanY = 0
  }
  applyAiCompareTransform()`
const newAutoReset = `
  if (state.aiCompareZoom <= 1.001) state.aiCompareZoom = 1
  applyAiCompareTransform()`
if (s.includes(newAutoReset)) {
  console.log('OK AI compare no auto pan reset already patched')
} else if (s.includes(oldAutoReset)) {
  s = s.replace(oldAutoReset, newAutoReset)
  console.log('PATCH AI compare no auto pan reset')
  changed = true
} else {
  console.log('OK AI compare no auto pan reset skipped; source pattern not present')
}

if (changed) fs.writeFileSync(file, s)
console.log(changed ? 'OK AI compare main-like pan patch installed' : 'OK AI compare main-like pan already installed')
