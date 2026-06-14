#!/usr/bin/env node

import fs from 'node:fs'

const annotatorFile = 'public/static/annotator.js'
const docsFiles = ['public/static/shortcuts.js', 'src/index.tsx']

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function write(file, text) {
  fs.writeFileSync(file, text)
}

function patchOrSkip(text, pattern, replacement, label, alreadyPattern) {
  const next = text.replace(pattern, replacement)
  if (next !== text) {
    console.log(`PATCH ${label}`)
    return next
  }
  if (alreadyPattern && alreadyPattern.test(text)) {
    console.log(`OK ${label} already patched`)
    return text
  }
  console.log(`MISS ${label}; continuing and checking final guard`)
  return text
}

let s = read(annotatorFile)

// Do not start freehand from mouse-down anymore.
s = patchOrSkip(
  s,
  /\n\s*\/\/[^\n]*자유곡선[^\n]*드래그[^\n]*\n\s*if \(this\.freehandMode\) \{\n\s*this\.freehandDragging = true\n\s*this\.addPoint\(pos\.x, pos\.y\)\n\s*return\n\s*\}\n/,
  `\n      // 자유곡선 모드에서는 클릭이 아니라 마우스 이동으로 점을 추가합니다.\n      // 마우스를 누르고 있을 필요가 없도록 여기서는 일반 클릭 점 추가를 막습니다.\n      if (this.freehandMode) return\n`,
  'disable mouse-down freehand start',
  /if \(this\.freehandMode\) return/
)

// Replace mouse-up + mouse-move handlers with move-only freehand behavior.
const moveOnlyHandlers = `  onMouseUp(e) {
    // 자유곡선은 이제 마우스 버튼을 누르고 있을 필요가 없으므로 별도 처리 없음
  }

  onMouseMove(e) {
    const pos = this.getImagePos()

    // S 자유곡선 모드: 마우스 버튼을 누르지 않고 이동만 해도 일정 간격마다 점 추가
    if (this.tool === 'draw' && this.freehandMode && !this.panMode) {
      if (!pos) return

      const n = this.currentPoints.length
      if (!this.drawing || n < 2) {
        this.addPoint(pos.x, pos.y)
        return
      }

      const lastX = this.currentPoints[n - 2]
      const lastY = this.currentPoints[n - 1]
      const dx = pos.x - lastX
      const dy = pos.y - lastY
      const screenDist = Math.sqrt(dx * dx + dy * dy) * this.stage.scaleX()
      if (screenDist >= this.FREEHAND_SPACING_PX) {
        this.addPoint(pos.x, pos.y)
        return
      }

      this.updatePreview(pos.x, pos.y)
      return
    }

    // 그리기 중 + 그리기 모드: 기존 미리보기 동작
    if (this.drawing && this.tool === 'draw') {
      if (!pos) return
      this.updatePreview(pos.x, pos.y)
      return
    }

    // 편집 모드 + 그리기 아님: 선택된 폴리곤의 변 호버 미리보기
    if (this.tool === 'edit' && !this.drawing && this.selectedId != null && !this.panMode) {
      this.updateEditHover()
    } else if (this.editHover) {
      this.clearEditHover()
    }
  }

  /**
   * 마우스 위치에서 가장 가까운 변을 찾아 미리보기 점 표시`

s = patchOrSkip(
  s,
  /  onMouseUp\(e\) \{[\s\S]*?\n  \}\n\n  onMouseMove\(e\) \{[\s\S]*?\n  \}\n\n  \/\*\*\n   \* 마우스 위치에서 가장 가까운 변을 찾아 미리보기 점 표시/,
  moveOnlyHandlers,
  'move-only freehand mouse handlers',
  /S 자유곡선 모드: 마우스 버튼을 누르지 않고 이동만 해도 일정 간격마다 점 추가/
)

// Remove obsolete state/reset if still present.
s = s.replace(/\n\s*this\.freehandDragging = false\s*\/\/ 실제 드래그 진행 중 \(마우스 다운 상태\)/g, '')
s = s.replace(/\n\s*if \(!enabled\) \{\n\s*this\.freehandDragging = false\n\s*\}/g, '')
s = s.replace(/\n\s*\/\/ 캔버스 밖으로 빠져나가도 freehand 드래그 종료\n\s*window\.addEventListener\('mouseup', \(\) => \{\n\s*if \(this\.freehandDragging\) this\.freehandDragging = false\n\s*\}\)/g, '')

// Visible strings.
s = s.replaceAll('마우스 드래그하면 일정 간격마다 점 자동 추가됨', '마우스를 움직이면 일정 간격마다 점 자동 추가됨')
s = s.replaceAll('드래그도 멈춤', '일반 클릭 모드로 복귀')
s = s.replaceAll('🖊️ 자유곡선 드래그 중 — 점 ${n}개 (마우스 놓으면 일시 정지, 다시 드래그 가능)', '🖊️ 자유곡선 모드 — 마우스를 움직이면 점 추가 (현재 ${n}개) / S 떼면 일시 정지 / Q: 완성')
s = s.replaceAll('🖊️ 자유곡선 모드 — 드래그로 점 추가 (현재 ${n}개) / S 떼면 종료 / Q: 완성', '🖊️ 자유곡선 모드 — 마우스를 움직이면 점 추가 (현재 ${n}개) / S 떼면 일시 정지 / Q: 완성')
s = s.replaceAll('🖊️ 자유곡선 모드 — 마우스를 누른 채 드래그하세요 (S 떼면 일반 클릭 모드)', '🖊️ 자유곡선 모드 — 마우스를 움직이면 바로 점이 찍힙니다 (S 떼면 일반 클릭 모드)')
s = s.replaceAll('S(드래그): 자유곡선', 'S+마우스 이동: 자유곡선')
s = s.replaceAll('S 누른 채 드래그: 자유곡선', 'S 누른 채 마우스 이동: 자유곡선')

// Final guard. Build must fail only if old behavior truly remains.
const oldMarkers = [
  'this.freehandMode && this.freehandDragging',
  'this.freehandDragging = true',
  '자유곡선 모드: 드래그 시작',
  '마우스를 누른 채 드래그하세요',
]
const remaining = oldMarkers.filter((marker) => s.includes(marker))
if (remaining.length > 0) {
  throw new Error(`Old mouse-hold freehand logic still remains: ${remaining.join(', ')}`)
}

write(annotatorFile, s)
console.log('OK public/static/annotator.js freehand now uses S + mouse move only')

for (const file of docsFiles) {
  if (!fs.existsSync(file)) continue
  let t = read(file)
  t = t.replaceAll('자유 곡선 (누르고 드래그)', '자유 곡선 (누르고 이동)')
  t = t.replaceAll('S+드래그', 'S+마우스 이동')
  t = t.replaceAll('<kbd>S</kbd> + 드래그', '<kbd>S</kbd> + 마우스 이동')
  t = t.replaceAll('자유곡선 (누르고 있는 동안 점 자동 추가)', '자유곡선 (S 누른 채 마우스 이동으로 점 자동 추가)')
  write(file, t)
}

console.log('Done. Continue build.')
