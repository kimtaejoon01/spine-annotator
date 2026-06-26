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

// Keep polygon shapes visible. Toggle only C2/C3 label text and its background.
patchFile('public/static/annotator.js', 'label names only toggle', (s) => {
  s = s.replace(
    `  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    if (this.polyLayer) {
      this.polyLayer.visible(this.labelOverlayVisible)
      this.polyLayer.batchDraw()
    }
  }`,
    `  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    this.renderPolygons()
  }`
  )

  s = s.replace(
    `    this.polyLayer.destroyChildren()
    this.polyLayer.visible(this.labelOverlayVisible !== false)

    this.polygons.forEach(poly => {`,
    `    this.polyLayer.destroyChildren()
    this.polyLayer.visible(true)

    this.polygons.forEach(poly => {`
  )

  s = s.replace(
    `      const showLabel = polyScreenMin >= 16 || isSelected`,
    `      const showLabel = (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)`
  )

  return s
})

patchFile('src/index.tsx', 'label toggle UI copy', (s) => {
  s = s.replace('사람 라벨 선/이름 보기', 'C2/C3 이름 보기')
  s = s.replace('화면 표시만 바꾸며 저장 라벨은 변경하지 않습니다', '폴리곤은 그대로 두고 C2/C3 이름표만 숨깁니다. 저장 라벨은 변경하지 않습니다')
  return s
})

console.log('OK label name-only toggle patch installed')
