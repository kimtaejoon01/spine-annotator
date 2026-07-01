#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/landmark-tools.js'
const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
let s = before

if (s.includes('function ensureLandmarkListV2') && !s.includes('renderPanelWithLandmarkListV2')) {
  const needle = '  const api = { refresh: renderPanel }'
  const patch = `  const baseRenderPanelForLandmarkListV2 = renderPanel
  renderPanel = function renderPanelWithLandmarkListV2() {
    baseRenderPanelForLandmarkListV2()
    const el = ensurePanel()
    if (!el) return
    const current = LAT_5POINT_SEQUENCE[sequenceIndex] || LAT_5POINT_SEQUENCE[0]
    ensureLandmarkListV2(el, current)
  }

  const api = { refresh: renderPanel }`
  if (!s.includes(needle)) {
    console.log('WARN landmark list v2 wrapper anchor not found')
  } else {
    s = s.replace(needle, patch)
  }
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH landmark list v2 render wrapper')
} else {
  console.log('OK landmark list v2 render wrapper already patched')
}
