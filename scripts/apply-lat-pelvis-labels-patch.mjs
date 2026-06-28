#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// labels.js: add LAT labels and color/category support.
{
  const file = 'public/static/labels.js'
  const before = read(file)
  let s = before

  s = s.replace(
    "export const EXTRA_LABELS = ['FH_L', 'FH_R', 'HC_L', 'HC_R']",
    "export const EXTRA_LABELS = ['FH_L', 'FH_R', 'HC_L', 'HC_R', 'FH_LAT', 'HC_LAT']"
  )
  s = s.replace(
    "if (label === 'FH_L' || label === 'FH_R') return COLOR_FEMORAL_HEAD",
    "if (label === 'FH_L' || label === 'FH_R' || label === 'FH_LAT') return COLOR_FEMORAL_HEAD"
  )
  s = s.replace(
    "if (label === 'HC_L' || label === 'HC_R') return COLOR_HIP_CENTER",
    "if (label === 'HC_L' || label === 'HC_R' || label === 'HC_LAT') return COLOR_HIP_CENTER"
  )
  s = s.replace(
    "return label === 'HC_L' || label === 'HC_R'",
    "return label === 'HC_L' || label === 'HC_R' || label === 'HC_LAT'"
  )
  s = s.replace(
    "if (label === 'FH_L' || label === 'FH_R') return 'femoral_head'",
    "if (label === 'FH_L' || label === 'FH_R' || label === 'FH_LAT') return 'femoral_head'"
  )
  s = s.replace(
    "if (label === 'HC_L' || label === 'HC_R') return 'hip_center'",
    "if (label === 'HC_L' || label === 'HC_R' || label === 'HC_LAT') return 'hip_center'"
  )

  save(file, before, s, 'LAT pelvis labels')
}

// app.js: add LAT buttons to the quick pelvis label panel.
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (s.includes('data-label="FH_L"') && !s.includes('data-label="FH_LAT"')) {
    s = s.replace(
      `      <button type="button" class="pelvis-label-btn" data-label="HC_R" data-mode="point">HC_R 점</button>`,
      `      <button type="button" class="pelvis-label-btn" data-label="HC_R" data-mode="point">HC_R 점</button>
      <button type="button" class="pelvis-label-btn pelvis-label-btn-lat" data-label="FH_LAT" data-mode="polygon">FH_LAT</button>
      <button type="button" class="pelvis-label-btn pelvis-label-btn-lat" data-label="HC_LAT" data-mode="point">HC_LAT 점</button>`
    )
  }
  s = s.replace(
    'FH는 누른 뒤 폴리곤을 그리고, HC는 누른 뒤 중심을 한 번 클릭합니다.',
    'AP는 L/R 버튼을 쓰고, LAT는 FH_LAT/HC_LAT를 씁니다. FH는 폴리곤, HC는 점 클릭입니다.'
  )

  save(file, before, s, 'LAT pelvis label controls')
}

// style.css: LAT buttons span two compact columns cleanly.
{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  const css = `

/* LAT pelvis labels */
.pelvis-label-btn-lat {
  border-style: dashed;
}
`
  if (!s.includes('LAT pelvis labels')) s += css
  save(file, before, s, 'LAT pelvis label styles')
}

console.log('OK LAT pelvis labels patch installed')
