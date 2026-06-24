#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, s) { fs.writeFileSync(file, s) }

// -----------------------------------------------------------------------------
// Route UI: add parent-folder batch button and default to 2-column larger cards.
// -----------------------------------------------------------------------------
{
  const file = 'src/index.tsx'
  let s = read(file)
  const before = s

  if (!s.includes('id="reviewAddAiParent"')) {
    s = s.replace(
      '<button class="btn-secondary" id="reviewAddAiFolder"><i class="fas fa-layer-group"></i> AI 폴더 추가</button>',
      '<button class="btn-secondary" id="reviewAddAiFolder"><i class="fas fa-layer-group"></i> AI 폴더 추가</button>\n          <button class="btn-secondary" id="reviewAddAiParent"><i class="fas fa-sitemap"></i> 상위 폴더 일괄 추가</button>'
    )
  }
  s = s.replace('class="ai-review-grid cols-3"', 'class="ai-review-grid cols-2"')
  s = s.replace('<option value="2">2열</option>\n              <option value="3" selected>3열</option>', '<option value="2" selected>2열</option>\n              <option value="3">3열</option>')

  if (s !== before) { write(file, s); console.log('PATCH AI review route batch/default columns') }
  else console.log('OK AI review route batch/default columns already patched')
}

// -----------------------------------------------------------------------------
// Page logic: one comparison card per AI folder/source. Multiple matching masks in
// a folder are composited together in that card. Add parent-folder batch import.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/ai-review.js'
  let s = read(file)
  const before = s

  if (!s.includes("reviewAddAiParent')?.addEventListener('click'")) {
    s = s.replace(
      "  document.getElementById('reviewAddAiFolder')?.addEventListener('click', addAiFolder)",
      "  document.getElementById('reviewAddAiFolder')?.addEventListener('click', addAiFolder)\n  document.getElementById('reviewAddAiParent')?.addEventListener('click', addAiParentFolder)"
    )
  }

  const startAdd = s.indexOf('async function addAiFolder() {')
  const endAdd = s.indexOf('async function refreshAll() {', startAdd)
  if (startAdd >= 0 && endAdd > startAdd && !s.includes('async function addAiSource(')) {
    const replacement = `async function addAiFolder() {
  if (!window.showDirectoryPicker) return alert('Chrome 또는 Edge에서만 폴더 연결을 지원합니다.')
  try {
    const handle = await window.showDirectoryPicker({ id: 'spine-ai-review-ai-results', mode: 'read', startIn: 'pictures' })
    await addAiSource(handle, handle.name)
    renderAiFolderList()
    await renderCurrentImage()
  } catch (err) {
    if (err.name !== 'AbortError') alert('AI 폴더 연결 실패: ' + err.message)
  }
}

async function addAiParentFolder() {
  if (!window.showDirectoryPicker) return alert('Chrome 또는 Edge에서만 폴더 연결을 지원합니다.')
  try {
    const parent = await window.showDirectoryPicker({ id: 'spine-ai-review-ai-parent', mode: 'read', startIn: 'pictures' })
    let added = 0
    for await (const [name, entry] of parent.entries()) {
      if (entry.kind !== 'directory') continue
      await addAiSource(entry, name)
      added += 1
    }
    if (added === 0) {
      await addAiSource(parent, parent.name)
      added = 1
    }
    renderAiFolderList()
    await renderCurrentImage()
    alert(added + '개 AI 폴더를 추가했습니다.')
  } catch (err) {
    if (err.name !== 'AbortError') alert('상위 AI 폴더 연결 실패: ' + err.message)
  }
}

async function addAiSource(handle, displayName) {
  const files = await listAiFilesRecursive(handle)
  const folder = {
    id: Math.random().toString(36).slice(2),
    name: displayName || handle.name,
    handle,
    files,
    byBase: groupByBase(files),
    visible: true,
    color: pickColor(state.aiFolders.length),
  }
  state.aiFolders.push(folder)
  return folder
}

`
    s = s.slice(0, startAdd) + replacement + s.slice(endAdd)
  }

  const startRender = s.indexOf('  let matched = 0\n  for (const folder of state.aiFolders.filter(f => f.visible)) {')
  const endRender = s.indexOf("  document.getElementById('reviewMatchSummary').textContent", startRender)
  if (startRender >= 0 && endRender > startRender && !s.includes('const masks = []\n    const labels = []')) {
    const replacement = `  let matched = 0
  for (const folder of state.aiFolders.filter(f => f.visible)) {
    const items = folder.byBase.get(imgEntry.base) || []
    if (!items.length) {
      const empty = createEmptyCard(folder.name, '매칭되는 mask 없음')
      grid.appendChild(empty)
      continue
    }

    // 한 AI 폴더는 한 비교 카드로 표시합니다.
    // 그 폴더 안에 current image와 매칭되는 binary PNG mask가 여러 개 있으면 한 카드에 합성합니다.
    matched += items.length
    const masks = []
    const labels = []
    for (const item of items) {
      const file = await item.handle.getFile()
      const maskUrl = URL.createObjectURL(file)
      state.objectUrls.push(maskUrl)
      const maskImg = await loadImg(maskUrl)
      masks.push({ img: maskImg, color: folder.color })
      labels.push((item.region || 'mask') + ' · ' + (item.modelKey || item.model || 'binary_png'))
    }
    const subtitle = labels.length <= 3 ? labels.join(' / ') : labels.slice(0, 3).join(' / ') + ' +' + (labels.length - 3)
    const card = createCard(folder.name, subtitle, folder.name + ' · ' + items.length + ' mask(s)')
    await renderCanvas(card.canvas, baseImg, masks)
    grid.appendChild(card.el)
  }
`
    s = s.slice(0, startRender) + replacement + s.slice(endRender)
  }

  // Use smoother mask resizing in review page; binary thresholding still keeps final mask binary.
  s = s.replace('    tctx.imageSmoothingEnabled = false\n    tctx.drawImage(mask.img, 0, 0, w, h)', "    tctx.imageSmoothingEnabled = true\n    tctx.imageSmoothingQuality = 'high'\n    tctx.drawImage(mask.img, 0, 0, w, h)")

  if (s !== before) { write(file, s); console.log('PATCH AI review source cards/batch add') }
  else console.log('OK AI review source cards/batch add already patched')
}

// -----------------------------------------------------------------------------
// CSS: bigger cards by default and sharper canvas presentation.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/style.css'
  let s = read(file)
  const before = s
  if (!s.includes('AI review source-card quality overrides')) {
    s += `

/* AI review source-card quality overrides */
.ai-review-grid { align-items: start; }
.ai-review-grid.cols-2 { grid-template-columns: repeat(2, minmax(420px, 1fr)); }
.ai-review-grid.cols-3 { grid-template-columns: repeat(3, minmax(320px, 1fr)); }
.ai-review-card-canvas-wrap { min-height: 460px; }
.ai-review-grid.cols-2 .ai-review-card-canvas-wrap { min-height: 560px; }
.ai-review-card canvas { width: 100%; height: auto; max-height: none; image-rendering: auto; }
.ai-review-folder-row .ai-folder-name { max-width: 190px; }
`
  }
  if (s !== before) { write(file, s); console.log('PATCH AI review quality styles') }
  else console.log('OK AI review quality styles already patched')
}

console.log('OK AI review source grouping, batch add, and quality patch installed')
