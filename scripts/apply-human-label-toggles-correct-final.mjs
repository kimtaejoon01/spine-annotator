#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, s) { fs.writeFileSync(file, s) }
function patchFile(file, label, fn) {
  const before = read(file)
  const after = fn(before)
  if (after !== before) {
    write(file, after)
    console.log('PATCH ' + label)
  } else {
    console.log('OK ' + label + ' already patched')
  }
}

// -----------------------------------------------------------------------------
// Annotator engine
// - humanLabelVisible: whole human label layer, including mask fill
// - labelOverlayVisible: outline + C2/C3 name tags only
// -----------------------------------------------------------------------------
patchFile('public/static/annotator.js', 'correct annotator label visibility semantics', (s) => {
  if (!s.includes('this.humanLabelVisible = true')) {
    if (s.includes('this.labelOverlayVisible = true')) {
      s = s.replace('this.labelOverlayVisible = true', 'this.humanLabelVisible = true\n    this.labelOverlayVisible = true')
    } else {
      s = s.replace(
        "    this.imageFilters = { brightness: 0, contrast: 0, invert: false }",
        "    this.imageFilters = { brightness: 0, contrast: 0, invert: false }\n    this.humanLabelVisible = true\n    this.labelOverlayVisible = true"
      )
    }
  }

  const methods = `  setHumanLabelVisible(visible) {
    this.humanLabelVisible = visible !== false
    if (this.polyLayer) {
      this.polyLayer.visible(this.humanLabelVisible)
      this.polyLayer.batchDraw()
    }
  }

  getHumanLabelVisible() {
    return this.humanLabelVisible !== false
  }

  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    this.renderPolygons()
  }

  getLabelOverlayVisible() {
    return this.labelOverlayVisible !== false
  }
`

  if (/  setHumanLabelVisible\(visible\)/.test(s)) {
    s = s.replace(/  setHumanLabelVisible\(visible\) \{[\s\S]*?\n  getLabelOverlayVisible\(\) \{[\s\S]*?\n  \}\n/, methods)
  } else if (/  setLabelOverlayVisible\(visible\)/.test(s)) {
    s = s.replace(/  setLabelOverlayVisible\(visible\) \{[\s\S]*?\n  getLabelOverlayVisible\(\) \{[\s\S]*?\n  \}\n/, methods)
  } else {
    const needle = `  setImageFilter(opts) {
    this.imageFilters = { ...this.imageFilters, ...opts }
    this.applyImageFilters()
  }
`
    if (!s.includes(needle)) throw new Error('setImageFilter insertion point not found')
    s = s.replace(needle, needle + '\n' + methods)
  }

  // The polygon layer must only follow humanLabelVisible. It must not be controlled by line/name toggle.
  s = s.replace(
    /    this\.polyLayer\.destroyChildren\(\)\n(?:    this\.polyLayer\.visible\([^\n]+\)\n)?/,
    "    this.polyLayer.destroyChildren()\n    this.polyLayer.visible(this.humanLabelVisible !== false)\n"
  )
  s = s.replaceAll('this.polyLayer.visible(this.labelOverlayVisible)', 'this.polyLayer.visible(this.humanLabelVisible !== false)')
  s = s.replaceAll('this.polyLayer.visible(this.labelOverlayVisible !== false)', 'this.polyLayer.visible(this.humanLabelVisible !== false)')
  s = s.replaceAll('this.polyLayer.visible(true)', 'this.polyLayer.visible(this.humanLabelVisible !== false)')

  // Mask fill should never become stronger just because outline/name is hidden.
  s = s.replace(/fill:\s*color \+ \(\(this\.labelOverlayVisible !== false\) \? '33' : '66'\)[^\n]*/g, "fill: color + '33', // 20% 투명")
  s = s.replace(/fill:\s*color \+ '66'[^\n]*/g, "fill: color + '33', // 20% 투명")

  // Force outline visibility based on labelOverlayVisible only.
  if (!s.includes('CORRECT_FINAL_LINE_NAME_TOGGLE')) {
    const needle = '      group.add(shape)'
    if (!s.includes(needle)) throw new Error('group.add(shape) insertion point not found')
    s = s.replace(
      needle,
      `      // CORRECT_FINAL_LINE_NAME_TOGGLE: hide outline only; mask fill remains unchanged
      if (this.labelOverlayVisible === false) {
        shape.strokeEnabled(false)
        shape.strokeWidth(0)
      } else {
        shape.strokeEnabled(true)
        shape.stroke(color)
        shape.strokeWidth((isSelected ? 3 : 2) / this.stage.scaleX())
      }
      ${needle}`
    )
  }

  // C2/C3 name tag depends on line/name toggle only.
  s = s.replace(/      const showLabel = .*polyScreenMin.*isSelected.*\n/g, '      const showLabel = (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)\n')

  return s
})

// -----------------------------------------------------------------------------
// App state + bindings
// - #toggleLabelOverlay       = 사람 라벨 보기: full mask fill/outline/name on/off
// - #humanLabelOverlayToggle = 선/이름표 보기: outline/name only on/off
// Capture-phase listeners stop older stale listeners from previous patches.
// -----------------------------------------------------------------------------
patchFile('public/static/app.js', 'correct UI binding for human label and line-name toggles', (s) => {
  if (!s.includes("const HUMAN_LABEL_VISIBLE_KEY")) {
    s = s.replace(
      "const LABEL_OVERLAY_VISIBLE_KEY = 'spine-annotator:label-overlay-visible'",
      "const LABEL_OVERLAY_VISIBLE_KEY = 'spine-annotator:label-overlay-visible'\nconst HUMAN_LABEL_VISIBLE_KEY = 'spine-annotator:human-label-visible'"
    )
    if (!s.includes("const HUMAN_LABEL_VISIBLE_KEY")) {
      s = s.replace(
        "const POLL_INTERVAL_MS = 2000  // 5초 → 2초로 단축",
        "const POLL_INTERVAL_MS = 2000  // 5초 → 2초로 단축\nconst LABEL_OVERLAY_VISIBLE_KEY = 'spine-annotator:label-overlay-visible'\nconst HUMAN_LABEL_VISIBLE_KEY = 'spine-annotator:human-label-visible'"
      )
    }
  }

  if (!s.includes('humanLabelVisible:')) {
    if (s.includes('labelOverlayVisible: loadLabelOverlayVisible()')) {
      s = s.replace('labelOverlayVisible: loadLabelOverlayVisible()', 'humanLabelVisible: loadHumanLabelVisible(),\n  labelOverlayVisible: loadLabelOverlayVisible()')
    } else if (s.includes('labelOverlayVisible: true')) {
      s = s.replace('labelOverlayVisible: true', 'humanLabelVisible: loadHumanLabelVisible(),\n  labelOverlayVisible: loadLabelOverlayVisible()')
    } else {
      s = s.replace('currentObjectUrl: null,', 'currentObjectUrl: null,\n  humanLabelVisible: loadHumanLabelVisible(),\n  labelOverlayVisible: loadLabelOverlayVisible(),')
    }
  }

  const helper = `// ================================================================
// 검수용 표시 토글
// ================================================================
function loadHumanLabelVisible() {
  try {
    const raw = localStorage.getItem(HUMAN_LABEL_VISIBLE_KEY)
    return raw == null ? true : raw !== 'false'
  } catch {
    return true
  }
}

function loadLabelOverlayVisible() {
  try {
    const raw = localStorage.getItem(LABEL_OVERLAY_VISIBLE_KEY)
    return raw == null ? true : raw !== 'false'
  } catch {
    return true
  }
}

function setHumanLabelVisible(visible) {
  state.humanLabelVisible = visible !== false
  try { localStorage.setItem(HUMAN_LABEL_VISIBLE_KEY, String(state.humanLabelVisible)) } catch {}
  if (state.annotator && typeof state.annotator.setHumanLabelVisible === 'function') {
    state.annotator.setHumanLabelVisible(state.humanLabelVisible)
  }
}

function setLabelOverlayVisible(visible) {
  state.labelOverlayVisible = visible !== false
  try { localStorage.setItem(LABEL_OVERLAY_VISIBLE_KEY, String(state.labelOverlayVisible)) } catch {}
  if (state.annotator && typeof state.annotator.setLabelOverlayVisible === 'function') {
    state.annotator.setLabelOverlayVisible(state.labelOverlayVisible)
  }
}

function bindLabelOverlayToggle() {
  const human = document.getElementById('toggleLabelOverlay')
  if (human) {
    human.checked = state.humanLabelVisible !== false
    const span = human.closest('label')?.querySelector('span')
    if (span) span.textContent = '사람 라벨 보기'
    if (!human.dataset.correctHumanLabelBound) {
      human.dataset.correctHumanLabelBound = '1'
      human.addEventListener('change', (e) => {
        e.stopImmediatePropagation()
        setHumanLabelVisible(human.checked)
      }, true)
    }
  }

  const lineName = document.getElementById('humanLabelOverlayToggle')
  if (lineName) {
    lineName.checked = state.labelOverlayVisible !== false
    const span = lineName.closest('label')?.querySelector('span')
    if (span) span.textContent = '선/이름표 보기'
    if (!lineName.dataset.correctLineNameBound) {
      lineName.dataset.correctLineNameBound = '1'
      lineName.addEventListener('change', (e) => {
        e.stopImmediatePropagation()
        setLabelOverlayVisible(lineName.checked)
      }, true)
    }
  }

  setHumanLabelVisible(state.humanLabelVisible !== false)
  setLabelOverlayVisible(state.labelOverlayVisible !== false)
}
`

  if (s.includes('function loadHumanLabelVisible()')) {
    s = s.replace(/\/\/ ================================================================\n\/\/ 검수용[\s\S]*?function bindLabelOverlayToggle\(\) \{[\s\S]*?\n\}\n/, helper)
  } else if (s.includes('function loadLabelOverlayVisible()')) {
    s = s.replace(/\/\/ ================================================================\n\/\/ 검수용[\s\S]*?function bindLabelOverlayToggle\(\) \{[\s\S]*?\n\}\n/, helper)
    if (!s.includes('function loadHumanLabelVisible()')) {
      const needle = '// ================================================================\n// 초기화\n// ================================================================'
      s = s.replace(needle, helper + '\n' + needle)
    }
  } else {
    const needle = '// ================================================================\n// 초기화\n// ================================================================'
    if (!s.includes(needle)) throw new Error('init insertion point not found')
    s = s.replace(needle, helper + '\n' + needle)
  }

  if (!s.includes('bindLabelOverlayToggle()')) {
    s = s.replace('  bindUIEvents()\n  bindKeyboardEvents()', '  bindUIEvents()\n  bindLabelOverlayToggle()\n  bindKeyboardEvents()')
  }

  // Older AI panel listener should update human label visibility, not line/name visibility.
  s = s.replace(
    `      state.originalOnly = false
      updateOriginalOnlyButton()
      setLabelOverlayVisible(e.target.checked)`,
    `      state.originalOnly = false
      updateOriginalOnlyButton()
      setHumanLabelVisible(e.target.checked)`
  )
  s = s.replace(
    `      state.labelOverlayVisible = e.target.checked
      state.originalOnly = false
      updateOriginalOnlyButton()
      state.annotator.setLabelOverlayVisible(state.labelOverlayVisible)`,
    `      state.originalOnly = false
      updateOriginalOnlyButton()
      setHumanLabelVisible(e.target.checked)`
  )

  return s
})

// -----------------------------------------------------------------------------
// UI copy
// -----------------------------------------------------------------------------
patchFile('src/index.tsx', 'correct visibility toggle copy', (s) => {
  s = s.replaceAll('C2/C3 이름 보기', '선/이름표 보기')
  s = s.replaceAll('사람 라벨 선/이름 보기', '선/이름표 보기')
  s = s.replaceAll('폴리곤은 그대로 두고 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  s = s.replaceAll('라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  return s
})

console.log('OK correct human label / line-name toggle behavior installed')
