#!/usr/bin/env node

import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n') }
function write(path, content) { fs.writeFileSync(path, content) }
function patch(label, path, fn) {
  const before = read(path)
  const after = fn(before)
  if (after === before) console.log('OK ' + label + ' already patched')
  else { write(path, after); console.log('PATCH ' + label) }
}

// 1) app.js guard: it is loaded globally by renderer, so do not run it on /ai-review.
patch('app.js non-annotate guard', 'public/static/app.js', (s) => {
  const needle = "window.addEventListener('DOMContentLoaded', async () => {\n"
  const insert = "window.addEventListener('DOMContentLoaded', async () => {\n  if (!document.getElementById('canvasStage')) return\n"
  if (s.includes(insert)) return s
  if (!s.includes(needle)) throw new Error('DOMContentLoaded needle not found')
  return s.replace(needle, insert)
})

// 2) Add /ai-review route.
patch('src/index.tsx ai-review route', 'src/index.tsx', (s) => {
  if (s.includes("app.get('/ai-review'")) return s
  const route = `
// AI 추론 결과 전용 비교 페이지
app.get('/ai-review', (c) => {
  return c.render(
    <div id="ai-review-root" class="ai-review-root">
      <header class="app-header ai-review-header">
        <div class="header-left">
          <span class="app-title"><i class="fas fa-robot"></i> AI 결과 비교</span>
          <span class="file-info"><span id="reviewFileName">이미지 폴더를 연결하세요</span></span>
        </div>
        <div class="header-right">
          <button class="btn-secondary" id="reviewConnectImages"><i class="fas fa-folder-open"></i> 원본 이미지 폴더</button>
          <button class="btn-secondary" id="reviewAddAiFolder"><i class="fas fa-layer-group"></i> AI 폴더 추가</button>
          <button class="btn-secondary" id="reviewRefresh"><i class="fas fa-sync"></i> 새로고침</button>
          <button class="btn-secondary" id="reviewClearAi"><i class="fas fa-times"></i> AI 폴더 초기화</button>
          <a class="btn-secondary" href="/annotate"><i class="fas fa-edit"></i> 라벨링으로</a>
        </div>
      </header>

      <div class="ai-review-layout">
        <aside class="ai-review-sidebar">
          <div class="panel">
            <h3 class="panel-title"><i class="fas fa-images"></i> 원본 이미지 <span class="label-count" id="reviewImageCount">0</span></h3>
            <div id="reviewImageStatus" class="folder-status"><span class="folder-status-empty"><i class="fas fa-info-circle"></i> 원본 폴더 없음</span></div>
            <input id="reviewSearch" class="select-input file-search" placeholder="파일명 검색..." />
            <ul id="reviewImageList" class="file-list"></ul>
          </div>
          <div class="panel">
            <h3 class="panel-title"><i class="fas fa-layer-group"></i> AI 결과 폴더 <span class="label-count" id="reviewAiCount">0</span></h3>
            <div id="reviewAiFolderList" class="ai-review-folder-list"><p class="empty-state">AI 결과 폴더를 여러 개 추가할 수 있습니다.</p></div>
          </div>
          <div class="panel">
            <h3 class="panel-title"><i class="fas fa-sliders-h"></i> 보기 설정</h3>
            <label class="control-label">AI 투명도 <span id="reviewOpacityValue">45</span>%</label>
            <input id="reviewOpacity" type="range" min="0" max="100" value="45" />
            <label class="control-label">카드 열 수</label>
            <select id="reviewColumns" class="select-input">
              <option value="2">2열</option>
              <option value="3" selected>3열</option>
              <option value="4">4열</option>
            </select>
            <p class="note-hint">휠 줌/드래그 팬은 라벨링 화면과 같은 방식으로 모든 비교 카드에 동시에 적용됩니다.</p>
          </div>
        </aside>

        <main class="ai-review-main">
          <div class="ai-review-toolbar">
            <button class="btn-secondary" id="reviewPrev"><i class="fas fa-chevron-left"></i> 이전</button>
            <button class="btn-secondary" id="reviewFit"><i class="fas fa-compress-arrows-alt"></i> 맞춤</button>
            <span id="reviewZoomLabel" class="zoom-level">100%</span>
            <button class="btn-secondary" id="reviewNext">다음 <i class="fas fa-chevron-right"></i></button>
            <span id="reviewMatchSummary" class="ai-review-summary">-</span>
          </div>
          <div id="reviewStage" class="ai-review-stage">
            <div id="reviewGrid" class="ai-review-grid cols-3">
              <div class="ai-review-empty">
                <i class="fas fa-folder-open fa-3x"></i>
                <p>원본 이미지 폴더와 AI 결과 폴더를 연결하세요.</p>
              </div>
            </div>
          </div>
        </main>
      </div>
      <script type="module" src="/static/ai-review.js"></script>
    </div>
  )
})

`
  const needle = "// 라벨링 화면 (Phase 1 프로토타입)\n"
  if (!s.includes(needle)) throw new Error('route insert needle not found')
  return s.replace(needle, route + needle)
})

// 3) Add AI review script.
const js = `/* ================================================================
   AI Review - multiple folder AI inference comparison page
   ================================================================ */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp'])
const state = {
  imageFolder: null,
  images: [],
  aiFolders: [],
  currentIndex: -1,
  search: '',
  opacity: 45,
  zoom: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  startPanX: 0,
  startPanY: 0,
  objectUrls: [],
}

window.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('ai-review-root')) return
  bindReviewUI()
  renderImageList()
  renderAiFolderList()
})

function bindReviewUI() {
  document.getElementById('reviewConnectImages')?.addEventListener('click', connectImageFolder)
  document.getElementById('reviewAddAiFolder')?.addEventListener('click', addAiFolder)
  document.getElementById('reviewRefresh')?.addEventListener('click', refreshAll)
  document.getElementById('reviewClearAi')?.addEventListener('click', clearAiFolders)
  document.getElementById('reviewPrev')?.addEventListener('click', () => moveImage(-1))
  document.getElementById('reviewNext')?.addEventListener('click', () => moveImage(1))
  document.getElementById('reviewFit')?.addEventListener('click', resetView)
  document.getElementById('reviewSearch')?.addEventListener('input', (e) => { state.search = e.target.value.toLowerCase().trim(); renderImageList() })
  document.getElementById('reviewOpacity')?.addEventListener('input', (e) => {
    state.opacity = Number(e.target.value)
    document.getElementById('reviewOpacityValue').textContent = String(state.opacity)
    renderCurrentImage().catch(console.error)
  })
  document.getElementById('reviewColumns')?.addEventListener('change', (e) => {
    const grid = document.getElementById('reviewGrid')
    grid.classList.remove('cols-2', 'cols-3', 'cols-4')
    grid.classList.add('cols-' + e.target.value)
  })

  const stage = document.getElementById('reviewStage')
  stage.addEventListener('wheel', onWheel, { passive: false })
  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  stage.addEventListener('pointercancel', onPointerUp)
  stage.addEventListener('dblclick', resetView)
}

async function connectImageFolder() {
  if (!window.showDirectoryPicker) return alert('Chrome 또는 Edge에서만 폴더 연결을 지원합니다.')
  try {
    const handle = await window.showDirectoryPicker({ id: 'spine-ai-review-images', mode: 'read', startIn: 'pictures' })
    state.imageFolder = handle
    state.images = await listImageFiles(handle)
    state.currentIndex = state.images.length ? 0 : -1
    updateImageStatus()
    renderImageList()
    await renderCurrentImage()
  } catch (err) {
    if (err.name !== 'AbortError') alert('원본 폴더 연결 실패: ' + err.message)
  }
}

async function addAiFolder() {
  if (!window.showDirectoryPicker) return alert('Chrome 또는 Edge에서만 폴더 연결을 지원합니다.')
  try {
    const handle = await window.showDirectoryPicker({ id: 'spine-ai-review-ai-results', mode: 'read', startIn: 'pictures' })
    const files = await listAiFilesRecursive(handle)
    const folder = {
      id: Math.random().toString(36).slice(2),
      name: handle.name,
      handle,
      files,
      byBase: groupByBase(files),
      visible: true,
      color: pickColor(state.aiFolders.length),
    }
    state.aiFolders.push(folder)
    renderAiFolderList()
    await renderCurrentImage()
  } catch (err) {
    if (err.name !== 'AbortError') alert('AI 폴더 연결 실패: ' + err.message)
  }
}

async function refreshAll() {
  try {
    if (state.imageFolder) state.images = await listImageFiles(state.imageFolder)
    for (const folder of state.aiFolders) {
      folder.files = await listAiFilesRecursive(folder.handle)
      folder.byBase = groupByBase(folder.files)
    }
    updateImageStatus()
    renderImageList()
    renderAiFolderList()
    await renderCurrentImage()
  } catch (err) {
    alert('새로고침 실패: ' + err.message)
  }
}

function clearAiFolders() {
  if (!state.aiFolders.length) return
  if (!confirm('AI 결과 폴더 목록을 비울까요? 원본 파일은 삭제되지 않습니다.')) return
  state.aiFolders = []
  renderAiFolderList()
  renderCurrentImage().catch(console.error)
}

function updateImageStatus() {
  const count = state.images.length
  document.getElementById('reviewImageCount').textContent = String(count)
  const el = document.getElementById('reviewImageStatus')
  if (count) el.innerHTML = '<span class="folder-status-connected"><i class="fas fa-check-circle"></i> 연결됨: ' + count + '개 이미지 <span class="folder-name">' + escapeHtml(state.imageFolder?.name || '') + '</span></span>'
  else el.innerHTML = '<span class="folder-status-empty"><i class="fas fa-info-circle"></i> 원본 폴더 없음</span>'
}

async function listImageFiles(handle) {
  const out = []
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file') continue
    const ext = name.split('.').pop()?.toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    if (parseAiMaskFile(name, name)) continue
    out.push({ name, handle: entry, base: imageBase(name) })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return out
}

async function listAiFilesRecursive(dirHandle, prefix = '') {
  const out = []
  for await (const [name, entry] of dirHandle.entries()) {
    const relPath = prefix ? prefix + '/' + name : name
    if (entry.kind === 'directory') {
      out.push(...await listAiFilesRecursive(entry, relPath))
      continue
    }
    const ext = name.split('.').pop()?.toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const lower = name.toLowerCase()
    if (lower.includes('_prob') || lower.includes('_overlay')) continue
    const parsed = parseAiMaskFile(name, relPath)
    if (parsed) out.push({ ...parsed, name, path: relPath, handle: entry })
  }
  out.sort((a, b) => (a.base + a.modelKey).localeCompare(b.base + b.modelKey, undefined, { numeric: true }))
  return out
}

function groupByBase(files) {
  const m = new Map()
  for (const f of files) {
    const arr = m.get(f.base) || []
    arr.push(f)
    m.set(f.base, arr)
  }
  return m
}

function parseAiMaskFile(name, relPath = name) {
  const noExt = name.replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '')
  let m = noExt.match(/^(?<base>.+)_AIresult_(?<region>cervical|thoracic|lumbar)_(?<model>.+)_(?<version>v\d+)$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, m.groups.version)
  m = noExt.match(/^(?<base>.+)_(?<region>cervical|lumbar)_(?<model>.+)_binary_full$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, 'v0')
  const parts = relPath.split('/')
  if (/_mask$/i.test(noExt) && parts.length >= 3) return normalizeAiMeta(parts[parts.length - 3], 'thoracic', parts[parts.length - 2], 'v0')
  m = noExt.match(/^(?<base>.+?)_(?<model>Weighted_Ensemble|Majority_Vote|U_Net|Coordconv_UNet|Center_plus_Coordconv)_mask$/i)
  if (m) return normalizeAiMeta(m.groups.base, 'thoracic', m.groups.model, 'v0')
  m = noExt.match(/^(?<base>.+?)_(?<region>cervical|thoracic|lumbar)_(?<model>.+)_mask$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, 'v0')
  return null
}

function normalizeAiMeta(base, region, model, version) {
  const modelKey = slug(model) + '_' + String(version || 'v0').toLowerCase()
  return { base, region: String(region).toLowerCase(), model: slug(model), version: String(version || 'v0').toLowerCase(), modelKey }
}
function slug(s) { return String(s).normalize('NFKC').replace(/^[A-Z]_/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase() }
function imageBase(name) { return String(name || '').replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '') }

function renderImageList() {
  const ul = document.getElementById('reviewImageList')
  const filtered = state.images.filter(x => !state.search || x.name.toLowerCase().includes(state.search))
  if (!filtered.length) { ul.innerHTML = '<li class="file-list-empty">이미지가 없습니다</li>'; return }
  ul.innerHTML = ''
  for (const img of filtered) {
    const idx = state.images.indexOf(img)
    const li = document.createElement('li')
    li.className = 'file-list-item' + (idx === state.currentIndex ? ' active' : '')
    li.innerHTML = '<span class="file-name">' + escapeHtml(img.name) + '</span><span class="file-view-badge">' + matchCountForBase(img.base) + '</span>'
    li.addEventListener('click', () => { state.currentIndex = idx; resetView(); renderImageList(); renderCurrentImage().catch(console.error) })
    ul.appendChild(li)
  }
}

function renderAiFolderList() {
  document.getElementById('reviewAiCount').textContent = String(state.aiFolders.length)
  const list = document.getElementById('reviewAiFolderList')
  if (!state.aiFolders.length) { list.innerHTML = '<p class="empty-state">AI 결과 폴더를 여러 개 추가할 수 있습니다.</p>'; return }
  list.innerHTML = ''
  for (const folder of state.aiFolders) {
    const row = document.createElement('div')
    row.className = 'ai-review-folder-row'
    row.style.setProperty('--folder-color', folder.color)
    row.innerHTML = '<label class="checkbox-label"><input type="checkbox" ' + (folder.visible ? 'checked' : '') + ' /><span class="ai-color-dot"></span><span class="ai-folder-name">' + escapeHtml(folder.name) + '</span></label><span class="ai-folder-count">' + folder.files.length + '</span><button class="label-action-btn" title="제거"><i class="fas fa-times"></i></button>'
    row.querySelector('input').addEventListener('change', e => { folder.visible = e.target.checked; renderCurrentImage().catch(console.error) })
    row.querySelector('button').addEventListener('click', () => { state.aiFolders = state.aiFolders.filter(f => f !== folder); renderAiFolderList(); renderCurrentImage().catch(console.error) })
    list.appendChild(row)
  }
}

function matchCountForBase(base) {
  let n = 0
  for (const folder of state.aiFolders) n += (folder.byBase.get(base) || []).length
  return n ? n + ' AI' : '-'
}

function moveImage(delta) {
  if (!state.images.length) return
  state.currentIndex = Math.max(0, Math.min(state.images.length - 1, state.currentIndex + delta))
  resetView()
  renderImageList()
  renderCurrentImage().catch(console.error)
}

async function renderCurrentImage() {
  clearObjectUrls()
  const grid = document.getElementById('reviewGrid')
  if (!state.images.length || state.currentIndex < 0) {
    grid.innerHTML = '<div class="ai-review-empty"><i class="fas fa-folder-open fa-3x"></i><p>원본 이미지 폴더를 연결하세요.</p></div>'
    document.getElementById('reviewFileName').textContent = '이미지 폴더를 연결하세요'
    document.getElementById('reviewMatchSummary').textContent = '-'
    return
  }

  const imgEntry = state.images[state.currentIndex]
  document.getElementById('reviewFileName').textContent = imgEntry.name
  grid.innerHTML = ''

  const baseFile = await imgEntry.handle.getFile()
  const baseUrl = URL.createObjectURL(baseFile)
  state.objectUrls.push(baseUrl)
  const baseImg = await loadImg(baseUrl)

  const baseCard = createCard('원본', imgEntry.name, 'original')
  await renderCanvas(baseCard.canvas, baseImg, [])
  grid.appendChild(baseCard.el)

  let matched = 0
  for (const folder of state.aiFolders.filter(f => f.visible)) {
    const items = folder.byBase.get(imgEntry.base) || []
    if (!items.length) {
      const empty = createEmptyCard(folder.name, '매칭되는 mask 없음')
      grid.appendChild(empty)
      continue
    }
    for (const item of items) {
      matched++
      const file = await item.handle.getFile()
      const maskUrl = URL.createObjectURL(file)
      state.objectUrls.push(maskUrl)
      const maskImg = await loadImg(maskUrl)
      const card = createCard(folder.name, item.region + ' · ' + item.modelKey, item.path)
      await renderCanvas(card.canvas, baseImg, [{ img: maskImg, color: folder.color }])
      grid.appendChild(card.el)
    }
  }
  document.getElementById('reviewMatchSummary').textContent = matched + '개 AI 결과 표시'
  applyTransform()
  renderImageList()
}

function createCard(title, subtitle, path) {
  const el = document.createElement('div')
  el.className = 'ai-review-card'
  el.innerHTML = '<div class="ai-review-card-head"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(subtitle) + '</span></div><div class="ai-review-card-canvas-wrap"><canvas></canvas></div><div class="ai-review-card-path" title="' + escapeHtml(path || '') + '">' + escapeHtml(path || '') + '</div>'
  return { el, canvas: el.querySelector('canvas') }
}
function createEmptyCard(title, msg) {
  const el = document.createElement('div')
  el.className = 'ai-review-card ai-review-card-empty'
  el.innerHTML = '<div class="ai-review-card-head"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(msg) + '</span></div><div class="ai-review-card-missing"><i class="fas fa-ban"></i><p>' + escapeHtml(msg) + '</p></div>'
  return el
}

async function renderCanvas(canvas, baseImg, masks) {
  const w = baseImg.naturalWidth || baseImg.width
  const h = baseImg.naturalHeight || baseImg.height
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(baseImg, 0, 0, w, h)

  const alpha = Math.round(230 * Math.max(0, Math.min(100, state.opacity)) / 100)
  for (const mask of masks) {
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const tctx = tmp.getContext('2d', { willReadFrequently: true })
    tctx.imageSmoothingEnabled = false
    tctx.drawImage(mask.img, 0, 0, w, h)
    const data = tctx.getImageData(0, 0, w, h)
    const rgb = hexToRgb(mask.color)
    for (let i = 0; i < data.data.length; i += 4) {
      const bright = Math.max(data.data[i], data.data[i + 1], data.data[i + 2])
      if (data.data[i + 3] > 0 && bright >= 128) {
        data.data[i] = rgb.r; data.data[i + 1] = rgb.g; data.data[i + 2] = rgb.b; data.data[i + 3] = alpha
      } else data.data[i + 3] = 0
    }
    tctx.putImageData(data, 0, 0)
    ctx.drawImage(tmp, 0, 0)
  }
}

function loadImg(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src }) }
function clearObjectUrls() { for (const u of state.objectUrls) URL.revokeObjectURL(u); state.objectUrls = [] }
function pickColor(i) { return ['#58a6ff', '#3fb950', '#bc8cff', '#f0b35e', '#ff7b72', '#39c5cf'][i % 6] }
function hexToRgb(hex) { const n = parseInt(String(hex).replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } }
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }

function onWheel(e) {
  e.preventDefault()
  let dy = e.deltaY
  if (e.deltaMode === 1) dy *= 16
  else if (e.deltaMode === 2) dy *= 100
  dy = Math.max(-200, Math.min(200, dy))
  const factor = Math.exp(-dy * 0.0005)
  const rect = document.getElementById('reviewStage').getBoundingClientRect()
  zoomAtPoint(state.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top })
}
function zoomAtPoint(newScale, point) {
  newScale = Math.max(0.05, Math.min(20, newScale))
  const oldScale = state.zoom || 1
  const pos = { x: state.panX || 0, y: state.panY || 0 }
  const mousePointTo = { x: (point.x - pos.x) / oldScale, y: (point.y - pos.y) / oldScale }
  state.zoom = newScale
  state.panX = point.x - mousePointTo.x * newScale
  state.panY = point.y - mousePointTo.y * newScale
  applyTransform()
}
function resetView() { state.zoom = 1; state.panX = 0; state.panY = 0; applyTransform() }
function onPointerDown(e) { state.dragging = true; state.dragStartX = e.clientX; state.dragStartY = e.clientY; state.startPanX = state.panX; state.startPanY = state.panY; e.currentTarget.setPointerCapture?.(e.pointerId); e.currentTarget.classList.add('dragging') }
function onPointerMove(e) { if (!state.dragging) return; state.panX = state.startPanX + (e.clientX - state.dragStartX); state.panY = state.startPanY + (e.clientY - state.dragStartY); applyTransform() }
function onPointerUp(e) { if (!state.dragging) return; state.dragging = false; e.currentTarget.releasePointerCapture?.(e.pointerId); e.currentTarget.classList.remove('dragging') }
function applyTransform() { const grid = document.getElementById('reviewGrid'); grid.style.transform = 'translate(' + state.panX + 'px,' + state.panY + 'px) scale(' + state.zoom + ')'; document.getElementById('reviewZoomLabel').textContent = Math.round(state.zoom * 100) + '%' }
`
write('public/static/ai-review.js', js)
console.log('WRITE public/static/ai-review.js')

// 4) Add styles.
patch('style.css ai-review styles', 'public/static/style.css', (s) => {
  if (s.includes('.ai-review-root')) return s
  return s + `

/* AI Review page */
.ai-review-root { height: 100vh; display: flex; flex-direction: column; background: var(--bg-primary); color: var(--text-primary); }
.ai-review-layout { flex: 1; min-height: 0; display: flex; }
.ai-review-sidebar { width: 320px; min-width: 260px; max-width: 420px; overflow-y: auto; border-right: 1px solid var(--border-color); background: var(--bg-secondary); padding: 10px; }
.ai-review-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ai-review-toolbar { height: 44px; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
.ai-review-summary { margin-left: auto; color: var(--text-secondary); font-size: 13px; }
.ai-review-stage { flex: 1; min-height: 0; overflow: hidden; position: relative; background: #05070a; cursor: grab; touch-action: none; user-select: none; }
.ai-review-stage.dragging { cursor: grabbing; }
.ai-review-grid { transform-origin: 0 0; display: grid; gap: 12px; padding: 14px; will-change: transform; }
.ai-review-grid.cols-2 { grid-template-columns: repeat(2, minmax(260px, 1fr)); }
.ai-review-grid.cols-3 { grid-template-columns: repeat(3, minmax(240px, 1fr)); }
.ai-review-grid.cols-4 { grid-template-columns: repeat(4, minmax(220px, 1fr)); }
.ai-review-card { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; min-height: 260px; display: flex; flex-direction: column; box-shadow: 0 2px 10px rgba(0,0,0,0.18); }
.ai-review-card-head { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; border-bottom: 1px solid var(--border-color); }
.ai-review-card-head strong { font-size: 13px; }
.ai-review-card-head span { color: var(--text-secondary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-review-card-canvas-wrap { flex: 1; min-height: 220px; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; }
.ai-review-card canvas { max-width: 100%; max-height: 420px; width: auto; height: auto; display: block; }
.ai-review-card-path { padding: 5px 8px; color: var(--text-secondary); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-top: 1px solid var(--border-color); }
.ai-review-card-missing, .ai-review-empty { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-secondary); gap: 10px; text-align: center; }
.ai-review-folder-list { display: flex; flex-direction: column; gap: 6px; }
.ai-review-folder-row { display: flex; align-items: center; gap: 6px; padding: 6px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); }
.ai-review-folder-row .ai-color-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--folder-color); display: inline-block; }
.ai-folder-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-folder-count { margin-left: auto; color: var(--text-secondary); font-size: 12px; }
@media (max-width: 1100px) { .ai-review-grid.cols-3, .ai-review-grid.cols-4 { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
`
})

console.log('OK AI review page patch installed')
