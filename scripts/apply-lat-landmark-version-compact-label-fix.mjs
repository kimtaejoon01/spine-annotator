#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

const file = 'public/static/landmark-tools.js'
const before = read(file)
let s = before

if (!s.includes("const LANDMARK_ORDER_VERSION = 'lat-left-screen-v2'")) {
  s = s.replace(
    `const VERTEBRAE_FULL = [`,
    `const LANDMARK_ORDER_VERSION = 'lat-left-screen-v2'\n\nconst VERTEBRAE_FULL = [`
  )
}

if (!s.includes('let ignoredLegacyCount = 0')) {
  s = s.replace(`  let panel = null\n`, `  let panel = null\n  let ignoredLegacyCount = 0\n`)
}

if (!s.includes('order_version: LANDMARK_ORDER_VERSION')) {
  s = s.replace(
    `      visibility,\n    }\n    if (existing)`,
    `      visibility,\n      order_version: LANDMARK_ORDER_VERSION,\n    }\n    if (existing)`
  )
  s = s.replace(
    `      visibility: l.visibility || 'visible',\n    })).filter(l => Number.isFinite(l.x) && Number.isFinite(l.y))`,
    `      visibility: l.visibility || 'visible',\n      order_version: l.order_version || LANDMARK_ORDER_VERSION,\n    })).filter(l => Number.isFinite(l.x) && Number.isFinite(l.y))`
  )
}

if (!s.includes('Before this version the UI used anatomical names directly')) {
  const re = /  annotator\.loadLandmarks = function loadLandmarks\(landmarks\) \{[\s\S]*?\n  \}\n\n  annotator\.renderLandmarks = function renderLandmarks\(\) \{/
  const replacement = `  annotator.loadLandmarks = function loadLandmarks(landmarks) {
    ignoredLegacyCount = 0
    const loaded = []
    for (const [i, l] of (Array.isArray(landmarks) ? landmarks : []).entries()) {
      const orderVersion = String(l?.order_version || '')
      // Before this version the UI used anatomical names directly. Those old
      // points can connect as vertical/diagonal nonsense after the screen-order
      // change, so ignore them and make the user re-mark the file cleanly.
      if (orderVersion !== LANDMARK_ORDER_VERSION) {
        ignoredLegacyCount++
        continue
      }
      const item = {
        id: l.id || \`lm_loaded_\${i}\`,
        label: String(l.label || '').trim().toUpperCase(),
        target: l.target || landmarkTarget(l.label),
        kind: l.kind || 'point',
        x: Number(l.x),
        y: Number(l.y),
        visibility: l.visibility || 'visible',
        order_version: LANDMARK_ORDER_VERSION,
      }
      if (item.label && Number.isFinite(item.x) && Number.isFinite(item.y)) loaded.push(item)
    }
    this.landmarks = loaded
    sequenceIndex = findNextMissingIndex(this.landmarks, 0)
    this.renderLandmarks()
    renderPanel()
  }

  annotator.renderLandmarks = function renderLandmarks() {`
  if (re.test(s)) {
    s = s.replace(re, replacement)
  } else {
    console.log('OK loadLandmarks block not found; skipping legacy version patch because later landmark rewrite owns this file')
  }
}

if (!s.includes('ignoredLegacyCount = 0\n    const existing')) {
  s = s.replace(
    `    if (!clean) return\n    const existing = this.landmarks.find(l => l.label === clean)`,
    `    if (!clean) return\n    ignoredLegacyCount = 0\n    const existing = this.landmarks.find(l => l.label === clean)`
  )
}

if (!s.includes('ignoredLegacyCount = 0\n    this.renderLandmarks()')) {
  s = s.replace(
    `    this.pendingLandmark = null\n    this.renderLandmarks()`,
    `    this.pendingLandmark = null\n    ignoredLegacyCount = 0\n    this.renderLandmarks()`
  )
}

if (!s.includes('const legacyWarning = ignoredLegacyCount > 0')) {
  s = s.replace(
    `    const completed = LAT_5POINT_SEQUENCE.filter(label => done.has(label)).length\n`,
    `    const completed = LAT_5POINT_SEQUENCE.filter(label => done.has(label)).length\n    const legacyWarning = ignoredLegacyCount > 0\n      ? \`<p class="landmark-warning">이전 버전 landmark \${ignoredLegacyCount}개는 방향 매핑이 달라 자동으로 숨겼습니다. 이 파일은 새 순서로 다시 찍어주세요.</p>\`\n      : ''\n`
  )
  s = s.replace(
    `      <div class="landmark-progress"><strong>\${completed}</strong> / \${LAT_5POINT_SEQUENCE.length} points</div>\n      <div class="landmark-current`,
    `      <div class="landmark-progress"><strong>\${completed}</strong> / \${LAT_5POINT_SEQUENCE.length} points</div>\n      \${legacyWarning}\n      <div class="landmark-current`
  )
}

s = s.replace(
  `      <p class="landmark-help">왼쪽을 보는 LAT 기준으로 위-왼쪽 → 위-오른쪽 → 아래-오른쪽 → 아래-왼쪽 → 중심 순서입니다. 내부 저장은 ANT/POST로 자동 변환됩니다. 점은 드래그로 수정, 더블클릭/우클릭으로 삭제.</p>`,
  `      <p class="landmark-help">왼쪽을 보는 LAT 기준으로 1 위-왼쪽 → 2 위-오른쪽 → 3 아래-오른쪽 → 4 아래-왼쪽 → 5 중심 순서입니다. 화면에는 C7 1처럼 짧게 표시하고, 저장명은 ANT/POST로 자동 변환합니다.</p>`
)

if (!s.includes("SUP_ANT: '1'")) {
  const re = /function displayLandmarkLabel\(label, compact = false\) \{[\s\S]*?\n\}/
  const replacement = `function displayLandmarkLabel(label, compact = false) {
  const text = String(label || '').toUpperCase()
  if (!text) return ''
  if (text === 'HC_LAT') return compact ? 'HC' : 'HC_LAT / 고관절 중심'
  const parts = text.split('_')
  const target = parts[0] || ''
  const suffix = parts.slice(1).join('_')
  const compactMap = {
    SUP_ANT: '1',
    SUP_POST: '2',
    INF_POST: '3',
    INF_ANT: '4',
    CENTER: '5',
  }
  const fullMap = {
    SUP_ANT: '1 위-왼쪽',
    SUP_POST: '2 위-오른쪽',
    INF_POST: '3 아래-오른쪽',
    INF_ANT: '4 아래-왼쪽',
    CENTER: '5 중심',
  }
  if (compact) return \`\${target} \${compactMap[suffix] || suffix}\`
  return \`\${target} \${fullMap[suffix] || suffix}\`
}`
  if (re.test(s)) {
    s = s.replace(re, replacement)
  } else {
    console.log('OK displayLandmarkLabel block not found; skipping compact label patch because later landmark rewrite owns this file')
  }
}

save(file, before, s, 'LAT landmark version + compact labels')
console.log('OK LAT landmark version + compact label patch installed')
