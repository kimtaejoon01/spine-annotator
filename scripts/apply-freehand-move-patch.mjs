#!/usr/bin/env node

import fs from 'node:fs'

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function write(file, text) {
  fs.writeFileSync(file, text)
}

function replaceOrFail(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement)
  if (next === text) {
    throw new Error(`Patch failed: ${label}`)
  }
  console.log(`PATCH ${label}`)
  return next
}

function replaceOptional(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement)
  if (next !== text) console.log(`PATCH ${label}`)
  return next
}

const annotatorFile = 'public/static/annotator.js'
let s = read(annotatorFile)

// 1) Do not start freehand from mouse-down anymore.
s = replaceOrFail(
  s,
  /      \/\/ 자유곡선 모드: 드래그 시작\n      if \(this\.freehandMode\) \{\n        this\.freehandDragging = true\n        this\.addPoint\(pos\.x, pos\.y\)\n        return\n      \}\n\n/,
  `      // 자유곡선 모드에서는 클릭이 아니라 마우스 이동으로 점을 추가합니다.\n      // 마우스를 누르고 있을 필요가 없도록 여기서는 일반 클릭 점 추가를 막습니다.\n      if (this.freehandMode) return\n\n`,
  'disable mouse-down freehand start'
)

// 2) Replace mouse-up + mouse-move handlers with move-only freehand behavior.
s = replaceOrFail(
  s,
  /  onMouseUp\(e\) \{\n    \/\/ 자유곡선 드래그 종료[\s\S]*?\n  \}\n\n  onMouseMove\(e\) \{[\s\S]*?\n  \}\n\n  \/\*\*\n   \* 마우스 위치에서 가장 가까운 변을 찾아 미리보기 점 표시/,
  `  onMouseUp(e) {\n    // 자유곡선은 이제 마우스 버튼을 누르고 있을 필요가 없으므로 별도 처리 없음\n  }\n\n  onMouseMove(e) {\n    const pos = this.getImagePos()\n\n    // S 자유곡선 모드: 마우스 버튼을 누르지 않고 이동만 해도 일정 간격마다 점 추가\n    if (this.tool === 'draw' && this.freehandMode && !this.panMode) {\n      if (!pos) return\n\n      const n = this.currentPoints.length\n      if (!this.drawing || n < 2) {\n        this.addPoint(pos.x, pos.y)\n        return\n      }\n\n      const lastX = this.currentPoints[n - 2]\n      const lastY = this.currentPoints[n - 1]\n      const dx = pos.x - lastX\n      const dy = pos.y - lastY\n      const screenDist = Math.sqrt(dx * dx + dy * dy) * this.stage.scaleX()\n      if (screenDist >= this.FREEHAND_SPACING_PX) {\n        this.addPoint(pos.x, pos.y)\n        return\n      }\n\n      this.updatePreview(pos.x, pos.y)\n      return\n    }\n\n    // 그리기 중 + 그리기 모드: 기존 미리보기 동작\n    if (this.drawing && this.tool === 'draw') {\n      if (!pos) return\n      this.updatePreview(pos.x, pos.y)\n      return\n    }\n\n    // 편집 모드 + 그리기 아님: 선택된 폴리곤의 변 호버 미리보기\n    if (this.tool === 'edit' && !this.drawing && this.selectedId != null && !this.panMode) {\n      this.updateEditHover()\n    } else if (this.editHover) {\n      this.clearEditHover()\n    }\n  }\n\n  /**\n   * 마우스 위치에서 가장 가까운 변을 찾아 미리보기 점 표시`,
  'move-only freehand mouse handlers'
)

// 3) Remove obsolete drag-state cleanup if present.
s = replaceOptional(
  s,
  /\n    if \(!enabled\) \{\n      this\.freehandDragging = false\n    \}/,
  '',
  'remove freehandDragging reset'
)

s = replaceOptional(
  s,
  /\n    this\.freehandDragging = false  \/\/ 실제 드래그 진행 중 \(마우스 다운 상태\)/,
  '',
  'remove freehandDragging state'
)

// 4) Update visible status/manual strings.
s = s.replaceAll('마우스 드래그하면 일정 간격마다 점 자동 추가됨', '마우스를 움직이면 일정 간격마다 점 자동 추가됨')
s = s.replaceAll('드래그도 멈춤', '일반 클릭 모드로 복귀')
s = s.replaceAll('🖊️ 자유곡선 드래그 중 — 점 ${n}개 (마우스 놓으면 일시 정지, 다시 드래그 가능)', '🖊️ 자유곡선 모드 — 마우스를 움직이면 점 추가 (현재 ${n}개) / S 떼면 일시 정지 / Q: 완성')
s = s.replaceAll('🖊️ 자유곡선 모드 — 드래그로 점 추가 (현재 ${n}개) / S 떼면 종료 / Q: 완성', '🖊️ 자유곡선 모드 — 마우스를 움직이면 점 추가 (현재 ${n}개) / S 떼면 일시 정지 / Q: 완성')
s = s.replaceAll('🖊️ 자유곡선 모드 — 마우스를 누른 채 드래그하세요 (S 떼면 일반 클릭 모드)', '🖊️ 자유곡선 모드 — 마우스를 움직이면 바로 점이 찍힙니다 (S 떼면 일반 클릭 모드)')
s = s.replaceAll('S(드래그): 자유곡선', 'S+마우스 이동: 자유곡선')
s = s.replaceAll('S 누른 채 드래그: 자유곡선', 'S 누른 채 마우스 이동: 자유곡선')

// 5) Guard: build must fail if the old mouse-hold freehand logic remains.
if (s.includes('this.freehandMode && this.freehandDragging')) {
  throw new Error('Old freehandDragging condition still remains in annotator.js')
}
if (s.includes('자유곡선 모드: 드래그 시작')) {
  throw new Error('Old mouse-down freehand start still remains in annotator.js')
}
if (s.includes('마우스를 누른 채 드래그하세요')) {
  throw new Error('Old freehand status text still remains in annotator.js')
}

write(annotatorFile, s)
console.log('OK public/static/annotator.js freehand now uses S + mouse move only')

// Lightweight docs/string updates. Do not fail build if docs already changed.
for (const file of ['public/static/shortcuts.js', 'src/index.tsx']) {
  if (!fs.existsSync(file)) continue
  let t = read(file)
  t = t.replaceAll('자유 곡선 (누르고 드래그)', '자유 곡선 (누르고 이동)')
  t = t.replaceAll('S+드래그', 'S+마우스 이동')
  t = t.replaceAll('<kbd>S</kbd> + 드래그', '<kbd>S</kbd> + 마우스 이동')
  t = t.replaceAll('자유곡선 (누르고 있는 동안 점 자동 추가)', '자유곡선 (S 누른 채 마우스 이동으로 점 자동 추가)')
  write(file, t)
}

console.log('Done. Continue build.')
