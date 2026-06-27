#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, s) { fs.writeFileSync(file, s) }

// -----------------------------------------------------------------------------
// Final, explicit behavior:
// - toggle ON  : mask fill + outline + C2/C3 label visible
// - toggle OFF : mask fill visible, outline and C2/C3 label hidden
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  let s = read(file)
  const before = s

  if (!s.includes('this.labelOverlayVisible = true')) {
    s = s.replace(
      "    this.imageFilters = { brightness: 0, contrast: 0, invert: false }",
      "    this.imageFilters = { brightness: 0, contrast: 0, invert: false }\n    this.labelOverlayVisible = true"
    )
  }

  // Replace any previous implementation that hid the entire polyLayer.
  s = s.replace(
    /  setLabelOverlayVisible\(visible\) \{[\s\S]*?\n  \}\n\n  getLabelOverlayVisible\(\)/,
    `  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    this.renderPolygons()
  }

  getLabelOverlayVisible()`
  )

  // Never hide the polygon layer, because mask fill lives on it.
  s = s.replaceAll('this.polyLayer.visible(this.labelOverlayVisible)', 'this.polyLayer.visible(true)')
  s = s.replaceAll('this.polyLayer.visible(this.labelOverlayVisible !== false)', 'this.polyLayer.visible(true)')

  // Make fill remain visible; when outlines/names are hidden, make fill slightly stronger so review mode still shows masks.
  s = s.replace(
    /fill:\s*color \+ '33'[^\n]*/,
    "fill: color + ((this.labelOverlayVisible !== false) ? '33' : '66'), // mask fill remains visible"
  )

  // Force outline off when toggle is false. Insert once right before group.add(shape).
  if (!s.includes('FINAL_LABEL_VISIBILITY_FIX')) {
    const needle = '      group.add(shape)'
    if (!s.includes(needle)) throw new Error('group.add(shape) not found')
    s = s.replace(
      needle,
      `      // FINAL_LABEL_VISIBILITY_FIX: hide outline only, keep mask fill visible
      if (this.labelOverlayVisible === false) {
        shape.strokeEnabled(false)
        shape.strokeWidth(0)
      } else {
        shape.strokeEnabled(true)
      }
      ${needle}`
    )
  }

  // Force name/background off when toggle is false.
  s = s.replace(
    /const showLabel = .*polyScreenMin.*isSelected.*\n/,
    '      const showLabel = (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)\n'
  )

  if (s !== before) {
    write(file, s)
    console.log('PATCH final label visibility behavior')
  } else {
    console.log('OK final label visibility behavior already patched')
  }
}

// -----------------------------------------------------------------------------
// Bind both possible checkboxes to the same final behavior.
// Some builds have the old AI panel checkbox (#toggleLabelOverlay), and newer builds
// also have #humanLabelOverlayToggle. Keep them in sync.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  let s = read(file)
  const before = s

  if (s.includes('function bindLabelOverlayToggle()')) {
    s = s.replace(
      /function bindLabelOverlayToggle\(\) \{[\s\S]*?\n\}\n\n/,
      `function bindLabelOverlayToggle() {
  const boxes = [
    document.getElementById('humanLabelOverlayToggle'),
    document.getElementById('toggleLabelOverlay'),
  ].filter(Boolean)
  const apply = (visible) => {
    setLabelOverlayVisible(visible)
    for (const box of boxes) box.checked = state.labelOverlayVisible !== false
  }
  for (const box of boxes) {
    box.checked = state.labelOverlayVisible !== false
    if (!box.dataset.labelVisibilityBound) {
      box.dataset.labelVisibilityBound = '1'
      box.addEventListener('change', () => apply(box.checked))
    }
  }
  apply(state.labelOverlayVisible !== false)
}

`
    )
  }

  // If the older AI-panel binding is present, make it use the shared helper instead of bypassing it.
  s = s.replace(
    `      state.labelOverlayVisible = e.target.checked
      state.originalOnly = false
      updateOriginalOnlyButton()
      state.annotator.setLabelOverlayVisible(state.labelOverlayVisible)`,
    `      state.originalOnly = false
      updateOriginalOnlyButton()
      setLabelOverlayVisible(e.target.checked)`
  )

  if (s !== before) {
    write(file, s)
    console.log('PATCH final label visibility checkbox binding')
  } else {
    console.log('OK final label visibility checkbox binding already patched')
  }
}

// UI copy.
{
  const file = 'src/index.tsx'
  let s = read(file)
  const before = s
  s = s.replaceAll('사람 라벨 선/이름 보기', '선/이름표 보기')
  s = s.replaceAll('C2/C3 이름 보기', '선/이름표 보기')
  s = s.replaceAll('폴리곤은 그대로 두고 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  s = s.replaceAll('화면 표시만 바꾸며 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  if (s !== before) {
    write(file, s)
    console.log('PATCH final label visibility UI copy')
  } else {
    console.log('OK final label visibility UI copy already patched')
  }
}

console.log('OK final label visibility fix installed')
