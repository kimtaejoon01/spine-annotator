#!/usr/bin/env node

import fs from 'node:fs'

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}
function write(file, text) {
  fs.writeFileSync(file, text)
}
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else {
    write(file, after)
    console.log('PATCH ' + label)
  }
}

// -----------------------------------------------------------------------------
// annotator.js: final visibility semantics in the rendering engine.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before

  if (!s.includes('this.humanLabelVisible = true')) {
    if (s.includes('this.labelOverlayVisible = true')) {
      s = s.replace('this.labelOverlayVisible = true', 'this.humanLabelVisible = true\n    this.labelOverlayVisible = true')
    } else {
      s = s.replace(
        '    this.imageFilters = { brightness: 0, contrast: 0, invert: false }',
        '    this.imageFilters = { brightness: 0, contrast: 0, invert: false }\n    this.humanLabelVisible = true\n    this.labelOverlayVisible = true'
      )
    }
  }

  const finalMethods = `  setHumanLabelVisible(visible) {
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

  const methodStart = s.search(/  setHumanLabelVisible\(visible\)|  setLabelOverlayVisible\(visible\)/)
  if (methodStart >= 0) {
    const afterGetter = s.indexOf('\n  // ============================================================', methodStart)
    if (afterGetter > methodStart) {
      s = s.slice(0, methodStart) + finalMethods + s.slice(afterGetter + 1)
    }
  } else {
    const needle = `  setImageFilter(opts) {
    this.imageFilters = { ...this.imageFilters, ...opts }
    this.applyImageFilters()
  }

`
    if (!s.includes(needle)) throw new Error('setImageFilter insert point not found')
    s = s.replace(needle, needle + finalMethods)
  }

  // Remove older visibility override blocks before adding one final block.
  s = s.replace(/      \/\/ FINAL_LABEL_VISIBILITY_FIX:[\s\S]*?      group\.add\(shape\)/g, '      group.add(shape)')
  s = s.replace(/      \/\/ CORRECT_FINAL_LINE_NAME_TOGGLE:[\s\S]*?      group\.add\(shape\)/g, '      group.add(shape)')

  // The polygon layer is the whole human annotation overlay. It follows only humanLabelVisible.
  s = s.replace(
    /    this\.polyLayer\.destroyChildren\(\)\n(?:    this\.polyLayer\.visible\([^\n]+\)\n)*/,
    '    this.polyLayer.destroyChildren()\n    this.polyLayer.visible(this.humanLabelVisible !== false)\n'
  )

  // Mask fill opacity is fixed. It should not get darker when line/name is hidden.
  s = s.replace(/        fill:\s*color \+ \(\(this\.labelOverlayVisible !== false\) \? '33' : '66'\)[^\n]*/g, "        fill: color + '33', // 20% 투명")
  s = s.replace(/        fill:\s*color \+ '66'[^\n]*/g, "        fill: color + '33', // 20% 투명")

  // Shape base stroke stays normal; final block controls visible outline.
  s = s.replace(
    /        stroke:\s*\(this\.labelOverlayVisible !== false\) \? color : 'rgba\(0,0,0,0\)',\n        strokeWidth:\s*\(this\.labelOverlayVisible !== false\) \? \(\(isSelected \? 3 : 2\) \/ this\.stage\.scaleX\(\)\) : 0,/g,
    "        stroke: color,\n        strokeWidth: (isSelected ? 3 : 2) / this.stage.scaleX(),"
  )

  // Add final outline visibility block before group.add(shape).
  if (!s.includes('VISIBILITY_MODULE_FINAL_OUTLINE')) {
    const needle = '      group.add(shape)'
    if (!s.includes(needle)) throw new Error('group.add(shape) not found')
    s = s.replace(
      needle,
      `      // VISIBILITY_MODULE_FINAL_OUTLINE: line/name toggle hides outline only.
      // Mask fill stays visible until humanLabelVisible hides the full polyLayer.
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

  // C2/C3 text follows line/name toggle. Active drawing preview is on previewLayer and is not affected.
  s = s.replace(/      const showLabel = .*polyScreenMin.*isSelected.*\n/g, '      const showLabel = (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)\n')

  save(file, before, s, 'annotator visibility semantics')
}

// -----------------------------------------------------------------------------
// app.js: import visibility module and make it the only binding path.
// Existing older listeners remain but module uses capture + stopImmediatePropagation.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (!s.includes("from './modules/visibility.js'")) {
    const needle = "import { exportToCOCO } from './coco.js'\n"
    if (!s.includes(needle)) throw new Error('app import needle not found')
    s = s.replace(
      needle,
      needle + "import { initVisibilityControls, refreshVisibilityControls } from './modules/visibility.js'\n"
    )
  }

  if (!s.includes('lineNameVisible:')) {
    if (s.includes('labelOverlayVisible:')) {
      s = s.replace(/(\n\s*labelOverlayVisible:\s*[^,\n]+,?)/, '$1\n  lineNameVisible: true,')
    } else {
      s = s.replace('  currentObjectUrl: null,', '  currentObjectUrl: null,\n  humanLabelVisible: true,\n  labelOverlayVisible: true,\n  lineNameVisible: true,')
    }
  }

  // Prefer module init directly after UI binding.
  if (!s.includes('initVisibilityControls({ state, annotator: state.annotator })')) {
    if (s.includes('  bindLabelOverlayToggle()')) {
      s = s.replace('  bindLabelOverlayToggle()', '  initVisibilityControls({ state, annotator: state.annotator })')
    } else {
      s = s.replace(
        '  bindUIEvents()\n  bindKeyboardEvents()',
        '  bindUIEvents()\n  initVisibilityControls({ state, annotator: state.annotator })\n  bindKeyboardEvents()'
      )
    }
  }

  // Ensure visibility is re-applied after saved labels are loaded or remote labels refresh.
  if (!s.includes('refreshVisibilityControls({ state, annotator: state.annotator })')) {
    s = s.replace(
      '    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])',
      '    state.annotator.loadPolygons(Array.isArray(data.polygons) ? data.polygons : [])\n    refreshVisibilityControls({ state, annotator: state.annotator })'
    )
    s = s.replace(
      '      state.annotator.loadPolygons([])\n      // 이 시점 이후 다른 사람이 수정하면 알림',
      '      state.annotator.loadPolygons([])\n      refreshVisibilityControls({ state, annotator: state.annotator })\n      // 이 시점 이후 다른 사람이 수정하면 알림'
    )
  }

  save(file, before, s, 'app visibility module integration')
}

// -----------------------------------------------------------------------------
// UI copy: two separate toggles.
// -----------------------------------------------------------------------------
{
  const file = 'src/index.tsx'
  const before = read(file)
  let s = before
  s = s.replaceAll('C2/C3 이름 보기', '선/이름표 보기')
  s = s.replaceAll('사람 라벨 선/이름 보기', '선/이름표 보기')
  s = s.replaceAll('폴리곤은 그대로 두고 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  s = s.replaceAll('화면 표시만 바꾸며 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  save(file, before, s, 'visibility UI copy')
}

console.log('OK visibility module refactor patch installed')
