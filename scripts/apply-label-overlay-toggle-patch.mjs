#!/usr/bin/env node

import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n') }
function write(path, content) { fs.writeFileSync(path, content) }
function patchFile(path, label, fn) {
  const before = read(path)
  const after = fn(before)
  if (after !== before) {
    write(path, after)
    console.log('PATCH ' + label)
  } else {
    console.log('OK ' + label + ' already patched')
  }
}

// -----------------------------------------------------------------------------
// Annotator engine: show/hide human label overlay without changing saved data.
// -----------------------------------------------------------------------------
patchFile('public/static/annotator.js', 'annotator label overlay visibility', (s) => {
  if (!s.includes('labelOverlayVisible')) {
    s = s.replace(
      "    this.imageFilters = { brightness: 0, contrast: 0, invert: false }",
      "    this.imageFilters = { brightness: 0, contrast: 0, invert: false }\n\n    // 검수용: 사람 라벨 선/텍스트 표시 여부. 저장 데이터에는 영향 없음.\n    this.labelOverlayVisible = true"
    )
  }

  if (!s.includes('setLabelOverlayVisible(visible)')) {
    const needle = `  setImageFilter(opts) {
    this.imageFilters = { ...this.imageFilters, ...opts }
    this.applyImageFilters()
  }
`
    const insert = `  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    if (this.polyLayer) {
      this.polyLayer.visible(this.labelOverlayVisible)
      this.polyLayer.batchDraw()
    }
  }

  getLabelOverlayVisible() {
    return this.labelOverlayVisible !== false
  }

`
    if (!s.includes(needle)) throw new Error('annotator setImageFilter needle not found')
    s = s.replace(needle, needle + insert)
  }

  if (!s.includes('this.polyLayer.visible(this.labelOverlayVisible !== false)')) {
    s = s.replace(
      `    this.polyLayer.destroyChildren()

    this.polygons.forEach(poly => {`,
      `    this.polyLayer.destroyChildren()
    this.polyLayer.visible(this.labelOverlayVisible !== false)

    this.polygons.forEach(poly => {`
    )
  }

  return s
})

// -----------------------------------------------------------------------------
// UI: right-side visibility panel.
// -----------------------------------------------------------------------------
patchFile('src/index.tsx', 'label overlay toggle UI', (s) => {
  if (s.includes('id="humanLabelOverlayToggle"')) return s
  const panel = `          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-eye"></i> 표시
            </h3>
            <label class="checkbox-label" title="화면 표시만 바꾸며 저장 라벨은 변경하지 않습니다">
              <input type="checkbox" id="humanLabelOverlayToggle" checked />
              <span>사람 라벨 선/이름 보기</span>
            </label>
          </div>
`
  const needle = `          <div class="panel panel-full">
            <h3 class="panel-title">
              <i class="fas fa-list"></i> 라벨 목록`
  if (!s.includes(needle)) throw new Error('right label list panel needle not found')
  return s.replace(needle, panel + needle)
})

// -----------------------------------------------------------------------------
// Main app: bind checkbox and persist preference per browser.
// -----------------------------------------------------------------------------
patchFile('public/static/app.js', 'label overlay toggle binding', (s) => {
  if (!s.includes('const LABEL_OVERLAY_VISIBLE_KEY')) {
    s = s.replace(
      `const POLL_INTERVAL_MS = 2000  // 5초 → 2초로 단축`,
      `const POLL_INTERVAL_MS = 2000  // 5초 → 2초로 단축\nconst LABEL_OVERLAY_VISIBLE_KEY = 'spine-annotator:label-overlay-visible'`
    )
  }

  if (!s.includes('labelOverlayVisible:')) {
    s = s.replace(
      `  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용)`,
      `  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용)\n  labelOverlayVisible: loadLabelOverlayVisible(), // 사람 라벨 선/이름 표시 여부`
    )
  }

  if (!s.includes('bindLabelOverlayToggle()')) {
    s = s.replace(
      `  // UI 이벤트 바인딩
  bindUIEvents()
  bindKeyboardEvents()`,
      `  // UI 이벤트 바인딩
  bindUIEvents()
  bindLabelOverlayToggle()
  bindKeyboardEvents()`
    )
  }

  if (!s.includes('function loadLabelOverlayVisible()')) {
    const helper = `
// ================================================================
// 검수용: 사람 라벨 선/이름 표시 토글
// ================================================================
function loadLabelOverlayVisible() {
  try {
    const raw = localStorage.getItem(LABEL_OVERLAY_VISIBLE_KEY)
    return raw == null ? true : raw !== 'false'
  } catch {
    return true
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
  const cb = document.getElementById('humanLabelOverlayToggle')
  if (!cb) return
  cb.checked = state.labelOverlayVisible !== false
  setLabelOverlayVisible(cb.checked)
  cb.addEventListener('change', () => setLabelOverlayVisible(cb.checked))
}
`
    const needle = `// ================================================================
// 초기화
// ================================================================`
    if (!s.includes(needle)) throw new Error('app init section needle not found')
    s = s.replace(needle, helper + '\n' + needle)
  }

  return s
})

console.log('OK label overlay toggle patch installed')
