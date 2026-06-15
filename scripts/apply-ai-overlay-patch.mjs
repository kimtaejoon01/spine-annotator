#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function fail(label) { throw new Error('Patch failed: ' + label) }
function replaceOnce(s, pattern, repl, label, already) {
  if (already && already.test(s)) { console.log('OK ' + label + ' already patched'); return s }
  const n = s.replace(pattern, repl)
  if (n === s) fail(label)
  console.log('PATCH ' + label)
  return n
}
function insertBefore(s, needle, ins, label, already) {
  if (already && already.test(s)) { console.log('OK ' + label + ' already patched'); return s }
  if (!s.includes(needle)) fail(label)
  console.log('PATCH ' + label)
  return s.replace(needle, ins + needle)
}
function insertAfter(s, needle, ins, label, already) {
  if (already && already.test(s)) { console.log('OK ' + label + ' already patched'); return s }
  if (!s.includes(needle)) fail(label)
  console.log('PATCH ' + label)
  return s.replace(needle, needle + ins)
}

// annotator.js
{
  const file = 'public/static/annotator.js'
  let s = read(file)
  s = replaceOnce(s,
    /    this\.imageNode = null\n    this\.imageFilters = \{ brightness: 0, contrast: 0, invert: false \}\n/,
    "    this.imageNode = null\n    this.imageFilters = { brightness: 0, contrast: 0, invert: false }\n\n    // 오버레이 표시 상태\n    this.aiMaskNodes = []\n    this.aiMaskOpacity = 0.45\n    this.labelOverlayVisible = true\n    this.aiMaskOverlayVisible = true\n",
    'annotator overlay state', /this\.aiMaskNodes = \[\]/)
  s = replaceOnce(s,
    /    this\.imageLayer = new Konva\.Layer\(\)\n    this\.polyLayer = new Konva\.Layer\(\)\n    this\.previewLayer = new Konva\.Layer\(\)\n\n    this\.stage\.add\(this\.imageLayer\)\n    this\.stage\.add\(this\.polyLayer\)\n    this\.stage\.add\(this\.previewLayer\)\n/,
    "    this.imageLayer = new Konva.Layer()\n    this.aiMaskLayer = new Konva.Layer()\n    this.polyLayer = new Konva.Layer()\n    this.previewLayer = new Konva.Layer()\n\n    this.stage.add(this.imageLayer)\n    this.stage.add(this.aiMaskLayer)\n    this.stage.add(this.polyLayer)\n    this.stage.add(this.previewLayer)\n",
    'annotator ai mask layer', /this\.aiMaskLayer = new Konva\.Layer\(\)/)
  s = replaceOnce(s,
    /        \/\/ 기존 이미지 제거\n        this\.imageLayer\.destroyChildren\(\)\n/,
    "        // 기존 이미지/AI 오버레이 제거\n        this.imageLayer.destroyChildren()\n        this.clearAiMasks()\n",
    'annotator clear ai masks on image load', /this\.clearAiMasks\(\)/)

  const methods = `

  // ============================================================
  // 오버레이 표시 / AI mask
  // ============================================================
  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = !!visible
    if (this.polyLayer) this.polyLayer.visible(this.labelOverlayVisible)
    if (this.previewLayer) this.previewLayer.visible(this.labelOverlayVisible)
    this.stage.batchDraw()
  }

  setAiMaskVisible(visible) {
    this.aiMaskOverlayVisible = !!visible
    if (this.aiMaskLayer) this.aiMaskLayer.visible(this.aiMaskOverlayVisible)
    this.stage.batchDraw()
  }

  setAiMaskOpacity(percent) {
    const value = Math.max(0, Math.min(100, Number(percent))) / 100
    this.aiMaskOpacity = value
    if (this.aiMaskLayer) this.aiMaskLayer.opacity(value)
    this.stage.batchDraw()
  }

  clearAiMasks() {
    this.aiMaskNodes = []
    if (this.aiMaskLayer) {
      this.aiMaskLayer.destroyChildren()
      this.aiMaskLayer.draw()
    }
  }

  async loadAiMasks(items = []) {
    this.clearAiMasks()
    if (!items.length || !this.imageWidth || !this.imageHeight) return
    const nodes = []
    for (const item of items) {
      try {
        const img = await this.loadMaskImage(item.url)
        const colored = this.colorizeMaskImage(img, item.color || '#58a6ff')
        const node = new Konva.Image({ image: colored, x: 0, y: 0, width: this.imageWidth, height: this.imageHeight, listening: false, opacity: 1 })
        node.setAttr('aiRegion', item.region || '')
        node.setAttr('aiModel', item.modelKey || item.model || '')
        this.aiMaskLayer.add(node)
        nodes.push(node)
      } catch (err) {
        console.warn('[AI mask] load failed:', item, err)
      }
    }
    this.aiMaskNodes = nodes
    this.aiMaskLayer.opacity(this.aiMaskOpacity)
    this.aiMaskLayer.visible(this.aiMaskOverlayVisible)
    this.aiMaskLayer.draw()
  }

  loadMaskImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  colorizeMaskImage(img, color) {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const rgb = this.hexToRgb(color)
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2], a = data.data[i + 3]
      const brightness = Math.max(r, g, b)
      if (a > 0 && brightness > 20) {
        data.data[i] = rgb.r
        data.data[i + 1] = rgb.g
        data.data[i + 2] = rgb.b
        data.data[i + 3] = Math.min(230, Math.max(90, brightness))
      } else {
        data.data[i + 3] = 0
      }
    }
    ctx.putImageData(data, 0, 0)
    return canvas
  }

  hexToRgb(hex) {
    const m = String(hex).replace('#', '').match(/^([0-9a-f]{6})$/i)
    if (!m) return { r: 88, g: 166, b: 255 }
    const n = parseInt(m[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
`
  s = insertAfter(s, "  setImageFilter(opts) {\n    this.imageFilters = { ...this.imageFilters, ...opts }\n    this.applyImageFilters()\n  }", methods, 'annotator overlay methods', /async loadAiMasks\(items = \[\]\)/)
  write(file, s)
}

// app.js
{
  const file = 'public/static/app.js'
  let s = read(file)
  s = replaceOnce(s,
    /  fileSearch: '',\s*\/\/ 검색어 \(lowercase\)\n  currentObjectUrl: null,\s*\/\/ 현재 캔버스에 로드된 ObjectURL \(해제용\)\n\}/,
    "  fileSearch: '',            // 검색어 (lowercase)\n  currentObjectUrl: null,    // 현재 캔버스에 로드된 ObjectURL (해제용)\n\n  // AI mask 오버레이\n  aiFolderHandle: null,\n  aiFolderName: '',\n  aiFiles: [],\n  aiByBase: new Map(),\n  aiSelectedModel: { cervical: '', thoracic: '', lumbar: '' },\n  aiRegionVisible: { cervical: true, thoracic: true, lumbar: true },\n  aiMaskVisible: true,\n  aiOpacity: 45,\n  aiObjectUrls: [],\n  aiLoadToken: 0,\n  labelOverlayVisible: true,\n  originalOnly: false,\n}",
    'app ai state', /aiFolderHandle: null/)
  s = insertAfter(s, "  // 폴더 연결\n  document.getElementById('connectFolderBtn').addEventListener('click', handleConnectFolder)", "\n\n  // 보기 / AI mask 오버레이\n  bindOverlayControls()", 'app bind overlay controls', /bindOverlayControls\(\)/)
  s = insertAfter(s, "    const normalized = normalizeKey(e)\n    if (!normalized) return", "\n\n    if (normalized === 'h') {\n      state.annotator.setLabelOverlayVisible(false)\n      e.preventDefault()\n      return\n    }", 'app H hold hide keydown', /setLabelOverlayVisible\(false\)/)
  s = insertAfter(s, "    const normalized = normalizeKey(e)\n    if (!normalized) return\n\n    // holdable 액션의 해제", "\n    if (normalized === 'h') {\n      state.annotator.setLabelOverlayVisible(state.labelOverlayVisible && !state.originalOnly)\n      e.preventDefault()\n      return\n    }\n", 'app H hold hide keyup', /state\.labelOverlayVisible && !state\.originalOnly/)
  s = insertAfter(s, "  state.annotator.loadImage(url).then(() => {\n    updateFileInfo()\n    document.getElementById('canvasPlaceholder').classList.add('hidden')", "\n    applyAiOverlayForCurrentFile().catch(() => {})", 'app single file ai overlay', /applyAiOverlayForCurrentFile\(\)\.catch\(\(\) => \{\}\)/)
  s = insertAfter(s, "    // 저장된 라벨 불러오기 (서버에서)\n    await loadLabelsFromStorage(fileEntry.name)", "\n\n    // 현재 이미지에 맞는 AI mask가 있으면 겹쳐 표시\n    await applyAiOverlayForCurrentFile()", 'app folder file ai overlay', /현재 이미지에 맞는 AI mask/)
  s = replaceOnce(s, /    const files = await listImageFiles\(state\.folderHandle\)\n    state\.files = files\n/, "    const allFiles = await listImageFiles(state.folderHandle)\n    const files = allFiles.filter(f => !parseAiMaskFile(f.name, f.name))\n    state.files = files\n", 'app filter ai masks from image list', /const allFiles = await listImageFiles\(state\.folderHandle\)/)
  s = insertAfter(s, "  state.imageWidth = state.annotator.imageWidth\n  state.imageHeight = state.annotator.imageHeight", "\n  renderAiRegionControls()", 'app rerender ai controls on file change', /renderAiRegionControls\(\)\n\}/)

  const overlayFunctions = `// ================================================================
// 보기 / AI mask 오버레이
// ================================================================
const AI_REGIONS = [
  { id: 'cervical', label: 'Cervical', color: '#bc8cff' },
  { id: 'thoracic', label: 'Thoracic', color: '#58a6ff' },
  { id: 'lumbar', label: 'Lumbar', color: '#3fb950' },
]

function bindOverlayControls() {
  const labelToggle = document.getElementById('toggleLabelOverlay')
  if (labelToggle) {
    labelToggle.checked = state.labelOverlayVisible
    labelToggle.addEventListener('change', (e) => {
      state.labelOverlayVisible = e.target.checked
      state.originalOnly = false
      updateOriginalOnlyButton()
      state.annotator.setLabelOverlayVisible(state.labelOverlayVisible)
    })
  }
  const aiToggle = document.getElementById('toggleAiOverlay')
  if (aiToggle) {
    aiToggle.checked = state.aiMaskVisible
    aiToggle.addEventListener('change', (e) => {
      state.aiMaskVisible = e.target.checked
      state.originalOnly = false
      updateOriginalOnlyButton()
      state.annotator.setAiMaskVisible(state.aiMaskVisible)
      applyAiOverlayForCurrentFile().catch(() => {})
    })
  }
  const opacity = document.getElementById('aiOpacity')
  if (opacity) {
    opacity.value = String(state.aiOpacity)
    const value = document.getElementById('aiOpacityValue')
    if (value) value.textContent = String(state.aiOpacity)
    opacity.addEventListener('input', (e) => {
      state.aiOpacity = Number(e.target.value)
      if (value) value.textContent = String(state.aiOpacity)
      state.annotator.setAiMaskOpacity(state.aiOpacity)
    })
  }
  const originalOnlyBtn = document.getElementById('originalOnlyBtn')
  if (originalOnlyBtn) originalOnlyBtn.addEventListener('click', toggleOriginalOnly)
  const connectAiBtn = document.getElementById('connectAiFolderBtn')
  if (connectAiBtn) connectAiBtn.addEventListener('click', handleConnectAiFolder)
  const refreshAiBtn = document.getElementById('refreshAiFolderBtn')
  if (refreshAiBtn) refreshAiBtn.addEventListener('click', () => scanAiFolder().catch(err => alert('AI 폴더 새로고침 실패: ' + err.message)))
  renderAiRegionControls()
  updateAiFolderStatus()
}

function toggleOriginalOnly() {
  state.originalOnly = !state.originalOnly
  updateOriginalOnlyButton()
  state.annotator.setLabelOverlayVisible(state.originalOnly ? false : state.labelOverlayVisible)
  state.annotator.setAiMaskVisible(state.originalOnly ? false : state.aiMaskVisible)
}
function updateOriginalOnlyButton() {
  const btn = document.getElementById('originalOnlyBtn')
  if (!btn) return
  btn.classList.toggle('active', state.originalOnly)
  btn.innerHTML = state.originalOnly ? '<i class="fas fa-eye"></i> 원본만 보는 중' : '<i class="fas fa-eye-slash"></i> 원본만 보기'
}
async function handleConnectAiFolder() {
  if (!window.showDirectoryPicker) { alert('이 브라우저는 AI 폴더 연결을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.'); return }
  try {
    const handle = await window.showDirectoryPicker({ id: 'spine-annotator-ai-results', mode: 'read', startIn: 'pictures' })
    state.aiFolderHandle = handle
    state.aiFolderName = handle.name
    await scanAiFolder()
  } catch (err) {
    if (err.name === 'AbortError') return
    alert('AI 폴더 연결 실패: ' + err.message)
  }
}
async function scanAiFolder() {
  if (!state.aiFolderHandle) { updateAiFolderStatus('AI 폴더가 연결되지 않았습니다', 'empty'); return }
  const files = await listAiMaskFilesRecursive(state.aiFolderHandle)
  state.aiFiles = files
  state.aiByBase = new Map()
  for (const item of files) {
    const arr = state.aiByBase.get(item.base) || []
    arr.push(item)
    state.aiByBase.set(item.base, arr)
  }
  updateAiFolderStatus(files.length + '개 AI mask 연결됨', 'connected')
  renderAiRegionControls()
  await applyAiOverlayForCurrentFile()
}
async function listAiMaskFilesRecursive(dirHandle, prefix = '') {
  const out = []
  for await (const [name, entry] of dirHandle.entries()) {
    const relPath = prefix ? prefix + '/' + name : name
    if (entry.kind === 'directory') { out.push(...await listAiMaskFilesRecursive(entry, relPath)); continue }
    const ext = name.split('.').pop()?.toLowerCase()
    if (!['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) continue
    const parsed = parseAiMaskFile(name, relPath)
    if (parsed) out.push({ ...parsed, name, path: relPath, handle: entry })
  }
  out.sort((a, b) => (a.base + '_' + a.region + '_' + a.modelKey).localeCompare(b.base + '_' + b.region + '_' + b.modelKey, undefined, { numeric: true }))
  return out
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
  return null
}
function normalizeAiMeta(base, region, model, version) {
  const normalizedModel = slugAiName(model)
  const normalizedVersion = String(version || 'v0').toLowerCase()
  return { base, region: String(region).toLowerCase(), model: normalizedModel, version: normalizedVersion, modelKey: normalizedModel + '_' + normalizedVersion }
}
function slugAiName(name) {
  return String(name).normalize('NFKC').replace(/^[A-Z]_/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase()
}
function imageBaseName(filename) { return String(filename || '').replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '') }
function getAiCandidatesForCurrentFile() { return state.aiByBase.get(imageBaseName(state.filename)) || [] }
function renderAiRegionControls() {
  const container = document.getElementById('aiRegionControls')
  if (!container) return
  const candidates = getAiCandidatesForCurrentFile()
  container.innerHTML = ''
  if (!state.aiFolderHandle) { container.innerHTML = '<div class="ai-empty">AI mask 폴더를 연결하면 부위별 모델을 선택할 수 있습니다.</div>'; return }
  for (const region of AI_REGIONS) {
    const items = candidates.filter(x => x.region === region.id)
    const modelKeys = [...new Set(items.map(x => x.modelKey))]
    if (!state.aiSelectedModel[region.id] && modelKeys.length > 0) state.aiSelectedModel[region.id] = preferDefaultModel(modelKeys)
    if (state.aiSelectedModel[region.id] && !modelKeys.includes(state.aiSelectedModel[region.id]) && modelKeys.length > 0) state.aiSelectedModel[region.id] = preferDefaultModel(modelKeys)
    const row = document.createElement('div')
    row.className = 'ai-region-row'
    const options = items.length === 0 ? '<option>결과 없음</option>' : modelKeys.map(k => '<option value="' + escapeHtml(k) + '" ' + (k === state.aiSelectedModel[region.id] ? 'selected' : '') + '>' + escapeHtml(k) + '</option>').join('')
    row.innerHTML = '<label class="checkbox-label ai-region-check"><input type="checkbox" ' + (state.aiRegionVisible[region.id] ? 'checked' : '') + ' ' + (items.length === 0 ? 'disabled' : '') + ' /><span class="ai-color-dot" style="background:' + region.color + '"></span><span>' + region.label + '</span></label><select class="select-input ai-model-select" ' + (items.length === 0 ? 'disabled' : '') + '>' + options + '</select>'
    row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => { state.aiRegionVisible[region.id] = e.target.checked; applyAiOverlayForCurrentFile().catch(() => {}) })
    row.querySelector('select').addEventListener('change', (e) => { state.aiSelectedModel[region.id] = e.target.value; applyAiOverlayForCurrentFile().catch(() => {}) })
    container.appendChild(row)
  }
}
function preferDefaultModel(modelKeys) { return modelKeys.find(k => k.includes('weighted_ensemble')) || modelKeys[0] || '' }
async function applyAiOverlayForCurrentFile() {
  const token = ++state.aiLoadToken
  revokeAiObjectUrls()
  if (!state.annotator || !state.aiMaskVisible || state.originalOnly) { state.annotator?.clearAiMasks(); return }
  renderAiRegionControls()
  const candidates = getAiCandidatesForCurrentFile()
  const selected = []
  for (const region of AI_REGIONS) {
    if (!state.aiRegionVisible[region.id]) continue
    const item = candidates.find(x => x.region === region.id && x.modelKey === state.aiSelectedModel[region.id])
    if (item) selected.push({ ...item, color: region.color })
  }
  const maskItems = []
  for (const item of selected) {
    const obj = await fileHandleToUrl(item.handle)
    state.aiObjectUrls.push(obj.url)
    maskItems.push({ ...item, url: obj.url })
  }
  if (token !== state.aiLoadToken) { revokeAiObjectUrls(); return }
  state.annotator.setAiMaskOpacity(state.aiOpacity)
  state.annotator.setAiMaskVisible(state.aiMaskVisible && !state.originalOnly)
  await state.annotator.loadAiMasks(maskItems)
}
function revokeAiObjectUrls() { for (const url of state.aiObjectUrls) URL.revokeObjectURL(url); state.aiObjectUrls = [] }
function updateAiFolderStatus(message, type = null) {
  const el = document.getElementById('aiFolderStatus')
  if (!el) return
  if (!message) {
    if (state.aiFolderHandle) { message = (state.aiFolderName || 'AI 폴더') + ' · ' + state.aiFiles.length + '개 mask'; type = 'connected' }
    else { message = 'AI mask 폴더가 연결되지 않았습니다'; type = 'empty' }
  }
  el.className = 'ai-folder-status ' + (type || 'empty')
  el.textContent = message
}

`
  s = insertBefore(s, "// ================================================================\n// 키보드 단축키\n// ================================================================", overlayFunctions, 'app overlay functions', /const AI_REGIONS = \[/)
  write(file, s)
}

// src/index.tsx
{
  const file = 'src/index.tsx'
  let s = read(file)
  const aiPanel = `          <div class="panel">
            <h3 class="panel-title">
              <i class="fas fa-layer-group"></i> 보기 / AI 결과
            </h3>
            <div class="control-group">
              <label class="checkbox-label">
                <input type="checkbox" id="toggleLabelOverlay" checked />
                <span>사람 라벨 보기</span>
              </label>
            </div>
            <button class="btn-secondary btn-full" id="originalOnlyBtn" title="원본 이미지만 보기. H를 누르고 있는 동안에도 사람 라벨이 숨겨집니다.">
              <i class="fas fa-eye-slash"></i> 원본만 보기
            </button>
            <div class="ai-panel-divider"></div>
            <div class="ai-folder-row">
              <button class="btn-secondary btn-full" id="connectAiFolderBtn" title="표준화된 AI mask PNG 폴더 연결">
                <i class="fas fa-robot"></i> AI 폴더 연결
              </button>
              <button class="btn-icon" id="refreshAiFolderBtn" title="AI 폴더 다시 스캔">
                <i class="fas fa-sync"></i>
              </button>
            </div>
            <div id="aiFolderStatus" class="ai-folder-status empty">AI mask 폴더가 연결되지 않았습니다</div>
            <div class="control-group">
              <label class="checkbox-label">
                <input type="checkbox" id="toggleAiOverlay" checked />
                <span>AI 결과 보기</span>
              </label>
            </div>
            <div class="control-group">
              <label>
                AI 투명도 <span id="aiOpacityValue">45</span>
              </label>
              <input type="range" id="aiOpacity" min="0" max="100" value="45" step="1" />
            </div>
            <div id="aiRegionControls" class="ai-region-controls"></div>
            <p class="panel-desc" style="margin-top:8px">
              파일명 규칙: 원본_AIresult_부위_모델_v0.png
            </p>
          </div>
`
  const needle = "          <div class=\"sidebar-scroll\">\n          <div class=\"panel panel-full\">"
  if (!/connectAiFolderBtn/.test(s)) {
    if (!s.includes(needle)) fail('index ai panel')
    s = s.replace(needle, "          <div class=\"sidebar-scroll\">\n" + aiPanel + "          <div class=\"panel panel-full\">")
    console.log('PATCH index ai panel')
  } else {
    console.log('OK index ai panel already patched')
  }
  // Repair an earlier broken patch that inserted a second sidebar-scroll before the label list.
  const broken = "          </div>\n          <div class=\"sidebar-scroll\">\n          <div class=\"panel panel-full\">"
  if (s.includes(broken)) {
    s = s.replace(broken, "          </div>\n          <div class=\"panel panel-full\">")
    console.log('PATCH index duplicate sidebar-scroll repair')
  }
  write(file, s)
}

// style.css
{
  const file = 'public/static/style.css'
  let s = read(file)
  if (!/ai-region-controls/.test(s)) {
    console.log('PATCH ai overlay styles')
    s += `

/* ============================================
   보기 / AI 결과 패널
   ============================================ */
.ai-panel-divider { height: 1px; background: var(--border-color); margin: 10px 0; }
.ai-folder-row { display: grid; grid-template-columns: 1fr 34px; gap: 6px; align-items: center; margin-bottom: 8px; }
.ai-folder-row .btn-full { margin-top: 0; }
.ai-folder-status { font-size: 11px; color: var(--text-muted); background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 8px; margin-bottom: 10px; line-height: 1.35; }
.ai-folder-status.connected { color: var(--accent-green); border-color: rgba(63, 185, 80, 0.35); }
.ai-region-controls { display: flex; flex-direction: column; gap: 8px; }
.ai-region-row { display: grid; grid-template-columns: minmax(88px, 0.9fr) minmax(0, 1.1fr); gap: 8px; align-items: center; }
.ai-region-check { margin-bottom: 0 !important; min-width: 0; }
.ai-color-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,0.08); flex-shrink: 0; }
.ai-model-select { padding: 6px 8px; font-size: 12px; }
.ai-empty { font-size: 12px; color: var(--text-muted); line-height: 1.35; background: rgba(88, 166, 255, 0.08); border: 1px solid rgba(88, 166, 255, 0.18); border-radius: 6px; padding: 8px; }
#originalOnlyBtn.active { background: var(--accent-blue); color: white; border-color: var(--accent-blue); }
`
  } else console.log('OK ai overlay styles already patched')
  write(file, s)
}

console.log('OK AI overlay patch installed')
