#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, s) { fs.writeFileSync(file, s) }

// -----------------------------------------------------------------------------
// 1) Label visibility toggle should hide outline + C2/C3 tag only.
//    Polygon mask fill must remain visible.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/annotator.js'
  let s = read(file)
  const before = s

  // Force the toggle method to re-render instead of hiding the whole polygon layer.
  s = s.replace(
    /  setLabelOverlayVisible\(visible\) \{[\s\S]*?\n  \}\n\n  getLabelOverlayVisible\(\)/,
    `  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    this.renderPolygons()
  }

  getLabelOverlayVisible()`
  )

  // Never hide the polygon layer; the fill mask lives on this layer.
  s = s.replaceAll('this.polyLayer.visible(this.labelOverlayVisible)', 'this.polyLayer.visible(true)')
  s = s.replaceAll('this.polyLayer.visible(this.labelOverlayVisible !== false)', 'this.polyLayer.visible(true)')

  // Hide only stroke/outline when the toggle is off. Fill remains unchanged.
  s = s.replace(
    `        stroke: color,
        strokeWidth: (isSelected ? 3 : 2) / this.stage.scaleX(),`,
    `        stroke: (this.labelOverlayVisible !== false) ? color : 'rgba(0,0,0,0)',
        strokeWidth: (this.labelOverlayVisible !== false) ? ((isSelected ? 3 : 2) / this.stage.scaleX()) : 0,`
  )

  // Hide C2/C3 text + background only when toggle is off.
  s = s.replace(
    `      const showLabel = polyScreenMin >= 16 || isSelected`,
    `      const showLabel = (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)`
  )
  s = s.replace(
    `      const showLabel = (this.labelOverlayVisible !== false) && ((this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected))`,
    `      const showLabel = (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)`
  )

  if (s !== before) {
    write(file, s)
    console.log('PATCH mask fill stays visible; outlines/names toggle only')
  } else {
    console.log('OK mask fill visibility already patched')
  }
}

// -----------------------------------------------------------------------------
// 2) UI copy: make clear that fill mask stays visible.
// -----------------------------------------------------------------------------
{
  const file = 'src/index.tsx'
  let s = read(file)
  const before = s
  s = s.replace('사람 라벨 선/이름 보기', '선/이름표 보기')
  s = s.replace('C2/C3 이름 보기', '선/이름표 보기')
  s = s.replace('폴리곤은 그대로 두고 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  s = s.replace('화면 표시만 바꾸며 저장 라벨은 변경하지 않습니다', '라벨링 마스크는 그대로 두고 선과 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  if (s !== before) {
    write(file, s)
    console.log('PATCH visibility toggle UI copy')
  } else {
    console.log('OK visibility toggle UI copy already patched')
  }
}

// -----------------------------------------------------------------------------
// 3) Notes: make sure note loading is actually called when the image changes.
//    Earlier strict patch missed updateFileInfo after other patches added lines.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  let s = read(file)
  const before = s
  const call = `  loadNoteForCurrentFile().catch(err => console.warn('Note load failed:', err))`

  const start = s.indexOf('function updateFileInfo() {')
  if (start >= 0) {
    const end = s.indexOf('\n}\n', start)
    if (end > start) {
      const block = s.slice(start, end)
      if (!block.includes('loadNoteForCurrentFile()')) {
        s = s.slice(0, end) + '\n' + call + s.slice(end)
      }
    }
  }

  if (s !== before) {
    write(file, s)
    console.log('PATCH notes load on file change')
  } else {
    console.log('OK notes load on file change already patched')
  }
}

console.log('OK mask fill visibility and notes fix installed')
