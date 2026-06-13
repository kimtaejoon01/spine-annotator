#!/usr/bin/env node

import fs from 'node:fs'

function patch(file, transform) {
  const before = fs.readFileSync(file, 'utf8')
  const after = transform(before)
  if (after === before) {
    console.log(`SKIP ${file}`)
    return
  }
  fs.writeFileSync(file, after)
  console.log(`PATCH ${file}`)
}

patch('public/static/annotator.js', (s) => {
  s = s.replace(/\/\/ 자유곡선 드로잉 모드 \(S키 \+ 드래그\)\n\s*\/\/ S 누른 상태에서 드래그하면 일정 간격마다 점이 자동 추가됨\n\s*this\.freehandMode = false\s*\/\/ S키 눌림 \(드래그 안 해도 활성화\)\n\s*this\.freehandDragging = false\s*\/\/ 실제 드래그 진행 중 \(마우스 다운 상태\)/, `// 자유곡선 드로잉 모드 (S키 + 마우스 이동)
    // S 누른 상태에서 마우스를 움직이면 일정 간격마다 점이 자동 추가됨
    this.freehandMode = false      // S키 눌림`)

  s = s.replace(/\n\s*\/\/ 캔버스 밖으로 빠져나가도 freehand 드래그 종료\n\s*window\.addEventListener\('mouseup', \(\) => \{\n\s*if \(this\.freehandDragging\) this\.freehandDragging = false\n\s*\}\)/, '')

  s = s.replace(/\n\s*if \(!enabled\) \{\n\s*this\.freehandDragging = false\n\s*\}/, '')

  s = s.replace(/\* - 활성화 시: 마우스 드래그하면 일정 간격마다 점 자동 추가됨\n\s*\* - 그리기 도구일 때만 의미 있음\n\s*\* - 비활성화 시: 드래그도 멈춤/, `* - 활성화 시: 마우스를 움직이면 일정 간격마다 점 자동 추가됨
   * - 그리기 도구일 때만 의미 있음
   * - 비활성화 시: 일반 클릭 모드로 복귀`)

  s = s.replace(/if \(this\.freehandDragging\) \{\n\s*text = `🖊️ 자유곡선 드래그 중[^`]+`\n\s*\} else if \(this\.drawing\) \{\n\s*text = `🖊️ 자유곡선 모드 — 드래그로 점 추가 \(현재 \$\{n\}개\) \/ S 떼면 종료 \/ Q: 완성`\n\s*\} else \{\n\s*text = '🖊️ 자유곡선 모드 — 마우스를 누른 채 드래그하세요 \(S 떼면 일반 클릭 모드\)'\n\s*\}/, `if (this.drawing) {
        text = ` + '`🖊️ 자유곡선 모드 — 마우스를 움직이면 점 추가 (현재 ${n}개) / S 떼면 일시 정지 / Q: 완성`' + `
      } else {
        text = '🖊️ 자유곡선 모드 — 마우스를 움직이면 바로 점이 찍힙니다 (S 떼면 일반 클릭 모드)'
      }`)

  s = s.replace(/\/\/ 자유곡선 모드: 드래그 시작\n\s*if \(this\.freehandMode\) \{\n\s*this\.freehandDragging = true\n\s*this\.addPoint\(pos\.x, pos\.y\)\n\s*return\n\s*\}\n/, `// 자유곡선 모드에서는 클릭이 아니라 마우스 이동으로 점을 추가합니다.
      // 마우스를 누르고 있을 필요가 없도록 여기서는 일반 클릭 점 추가를 막습니다.
      if (this.freehandMode) return
`)

  s = s.replace(/onMouseUp\(e\) \{\n\s*\/\/ 자유곡선 드래그 종료[\s\S]*?\n\s*\}\n\s*\n\s*onMouseMove\(e\) \{\n\s*\/\/ 그리기 중 \+ 그리기 모드: 기존 미리보기 동작\n\s*if \(this\.drawing && this\.tool === 'draw'\) \{\n\s*const pos = this\.getImagePos\(\)\n\s*if \(!pos\) return\n\s*\/\/ 자유곡선 드래그 중: 일정 간격마다 점 자동 추가[\s\S]*?\n\s*this\.updatePreview\(pos\.x, pos\.y\)\n\s*return\n\s*\}\n/, `onMouseUp(e) {
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
`)

  s = s.replaceAll('S(드래그): 자유곡선', 'S+마우스 이동: 자유곡선')
  s = s.replaceAll('S 누른 채 드래그: 자유곡선', 'S 누른 채 마우스 이동: 자유곡선')
  return s
})

patch('public/static/shortcuts.js', (s) => s.replaceAll('자유 곡선 (누르고 드래그)', '자유 곡선 (누르고 이동)'))

patch('src/index.tsx', (s) => {
  s = s.replace(/<li><kbd>S<\/kbd> 키를 <strong>누른 상태로 유지<\/strong><\/li>\n\s*<li>마우스를 누른 채로 외곽을 따라 <strong>드래그<\/strong> — 이동 거리에 따라 점이 자동 추가됨<\/li>\n\s*<li>마우스 떼기 → 일시 정지 \(다시 드래그 가능\)<\/li>\n\s*<li><kbd>S<\/kbd> 떼면 일반 클릭 모드로 복귀<\/li>\n\s*<li><kbd>Q<\/kbd>로 완성<\/li>/, `<li><kbd>S</kbd> 키를 <strong>누른 상태로 유지</strong></li>
        <li>마우스 버튼을 누르지 말고 외곽을 따라 <strong>마우스만 이동</strong> — 이동 거리에 따라 점이 자동 추가됨</li>
        <li><kbd>S</kbd>를 떼면 일시 정지되고, 다시 누르면 이어서 점 추가 가능</li>
        <li><kbd>Q</kbd>로 완성</li>`)
  s = s.replaceAll('S+드래그', 'S+마우스 이동')
  s = s.replaceAll('<kbd>S</kbd> + 드래그', '<kbd>S</kbd> + 마우스 이동')
  s = s.replaceAll('자유곡선 (누르고 있는 동안 점 자동 추가)', '자유곡선 (S 누른 채 마우스 이동으로 점 자동 추가)')
  return s
})

console.log('\nDone. Now run: npm run build')
