import { SpineAnnotator } from './annotator.js'
import { pickFolderAs, restoreFolderAs, ensurePermission, listImageFiles, fileHandleToUrl } from './fs.js'
import { LABELERS, getLabelerById } from './labelers.js'
import { parseFilename, getRegionColor } from './labels.js'

const $ = (id) => document.getElementById(id)
const REVIEW_PREFIX = 'LABEL_REVIEW::'
const FOLDER_KEY = 'lr:imagesFolder'
const MAX_IMAGE_CACHE = 8
const PREFETCH_AHEAD = 4
const VERTEBRAE = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
const CORNERS = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT']
const VERTEBRA_REVIEW_LABEL = 'VERTEBRA_REVIEW'
const TOOL_BUTTON_IDS = ['lrS1Sup', 'lrFhLat', 'lrBodyPoly', 'lrArmEndplate']

const state = {
  annotator: null,
  landmarkLayer: null,
  files: new Map(),
  meta: new Map(),
  reviewIndex: new Map(),
  list: [],
  current: null,
  currentMeta: null,
  originalPolygons: [],
  originalLandmarks: [],
  originalNote: null,
  review: emptyReview(),
  imageCache: new Map(),
  labelCache: new Map(),
  reviewCache: new Map(),
  noteCache: new Map(),
  openToken: 0,
  activeTool: null,
  suppressChanges: false,
  dirty: false,
  saveTimer: null,
  prefetchToken: 0,
  originalDashed: false,
}

function emptyReview() {
  return { type: 'label-review-v1', source_filename: '', target_labeler: '', reviewer: '', additions: [], memo: '', done: false, updated_at: '' }
}
function authHeaders(extra = {}) { return { 'X-Auth-Token': 'public-access', ...extra } }
function esc(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') }

function init() {
  state.annotator = new SpineAnnotator({
    container: 'lrStage',
    onPolygonsChange,
    onZoomChange: () => renderOriginalLandmarks(),
  })
  state.annotator.readOnly = true
  state.annotator.setTool('draw')
  installPersistentReviewRendering()

  state.landmarkLayer = new Konva.Layer({ listening: false })
  state.annotator.stage.add(state.landmarkLayer)
  installOriginalNotePanel()
  installReviewComparisonUi()
  populateLabelers(); populateVertebrae(); restorePreferences(); bindEvents()
  refreshServerState().catch(showError)
  restoreImageFolder().catch(showError)
}

function installPersistentReviewRendering() {
  if (!state.annotator || state.annotator.__labelReviewRenderWrapped) return
  const baseRender = state.annotator.renderPolygons.bind(state.annotator)
  state.annotator.renderPolygons = (...args) => {
    const result = baseRender(...args)
    // refreshPolygonVisualScale()가 줌/스크롤 뒤 다시 renderPolygons()를 호출하므로
    // 매 렌더 직후 검수 전용 스타일과 표시 토글을 다시 적용해야 디자인이 풀리지 않습니다.
    applyReviewVisualStyles()
    applyLabelVisibility(false)
    return result
  }
  state.annotator.__labelReviewRenderWrapped = true
}

function installOriginalNotePanel() {
  if ($('lrOriginalNotePanel')) return
  const reviewMemo = $('lrMemo')
  const reviewMemoSection = reviewMemo?.closest?.('.lr-section')
  if (!reviewMemoSection?.parentNode) return

  const section = document.createElement('section')
  section.id = 'lrOriginalNotePanel'
  section.className = 'lr-section'
  section.innerHTML = `
    <h3>원 라벨 메모</h3>
    <div id="lrOriginalNote" style="white-space:pre-wrap;word-break:break-word;min-height:56px;max-height:180px;overflow:auto;padding:9px 10px;border:1px solid #30363d;border-radius:7px;background:#0d1117;color:#c9d1d9;font-size:12px;line-height:1.5">파일을 선택하세요.</div>
    <div id="lrOriginalNoteMeta" class="lr-status" style="margin-top:5px"></div>
  `
  reviewMemoSection.parentNode.insertBefore(section, reviewMemoSection)
}

function installReviewComparisonUi() {
  // Label Review에서는 HC_LAT 검수가 필요하지 않습니다.
  $('lrHcLat')?.remove()

  // HTML에 S1 버튼만 primary가 박혀 있어 항상 선택된 것처럼 보이던 문제 제거.
  $('lrS1Sup')?.classList.remove('primary')

  const toolbar = document.querySelector('.lr-toolbar')
  if (!toolbar) return

  // 예전 버전에서 동적으로 만든 척추 번호 select가 남아 있으면 제거합니다.
  $('lrBodyVertebra')?.remove()

  if (!$('lrBodyPoly')) {
    const button = document.createElement('button')
    button.id = 'lrBodyPoly'
    button.type = 'button'
    button.className = 'lr-btn quick'
    button.innerHTML = '<i class="fas fa-draw-polygon"></i> 추체 검수'
    button.title = '척추 번호 구분 없이 검수자 추체 폴리곤을 추가합니다.'
    toolbar.insertBefore(button, $('lrCancelTool') || null)
  }

  // 기존 하나짜리 원 라벨 토글을 원본/검수본 표시 토글로 분리합니다.
  const oldToggle = $('lrToggleLabels')
  const oldLabel = oldToggle?.closest?.('label')
  if (oldLabel && !$('lrToggleOriginals')) {
    oldLabel.innerHTML = '<input id="lrToggleOriginals" type="checkbox" checked /> 원본'
    const reviewLabel = document.createElement('label')
    reviewLabel.className = 'lr-check'
    reviewLabel.innerHTML = '<input id="lrToggleReviews" type="checkbox" checked /> 검수본'
    oldLabel.insertAdjacentElement('afterend', reviewLabel)
  }

  // 원본을 항상 점선으로 강제하지 않고 필요할 때만 켜는 별도 토글 버튼.
  if (!$('lrToggleDashed')) {
    const dashed = document.createElement('button')
    dashed.id = 'lrToggleDashed'
    dashed.type = 'button'
    dashed.className = 'lr-btn'
    dashed.setAttribute('aria-pressed', 'false')
    dashed.innerHTML = '<i class="fas fa-border-style"></i> 원본 점선'
    dashed.title = '원본 마스크를 비교용 점선/무채움으로 전환합니다.'
    toolbar.appendChild(dashed)
  }
}

function renderOriginalNote(note) {
  const box = $('lrOriginalNote')
  const meta = $('lrOriginalNoteMeta')
  if (!box || !meta) return
  const text = String(note?.note_text || '').trim()
  box.textContent = text || '원 라벨 메모 없음'
  box.style.color = text ? '#c9d1d9' : '#8b949e'

  const bits = []
  if (note?.labeler_id) {
    const labeler = getLabelerById(note.labeler_id)
    bits.push(labeler ? `작성: ${labeler.name}${labeler.title ? ' · ' + labeler.title : ''}` : `작성: ${note.labeler_id}`)
  }
  if (note?.updated_at) {
    try { bits.push(`수정: ${new Date(note.updated_at).toLocaleString()}`) } catch {}
  }
  meta.textContent = bits.join(' · ')
}

function populateLabelers() {
  $('lrTargetLabeler').innerHTML = LABELERS.map(l => `<option value="${esc(l.id)}">${esc(l.name)}${l.title ? ' · ' + esc(l.title) : ''}</option>`).join('')
}
function populateVertebrae() {
  if (!$('lrVertebra')) return
  $('lrVertebra').innerHTML = VERTEBRAE.map(v => `<option value="${v}">${v}</option>`).join('')
  $('lrVertebra').value = 'S1'
}
function restorePreferences() {
  try {
    $('lrTargetLabeler').value = localStorage.getItem('lr:targetLabeler') || 'kim'
    $('lrViewFilter').value = localStorage.getItem('lr:viewFilter') || 'LAT'
    $('lrReviewFilter').value = localStorage.getItem('lr:reviewFilter') || 'pending'
    $('lrReviewer').value = localStorage.getItem('lr:reviewer') || ''
    state.originalDashed = localStorage.getItem('lr:originalDashed') === '1'
  } catch {}
  updateDashedToggleButton()
}

function bindEvents() {
  $('lrConnectFolder').addEventListener('click', connectImageFolder)
  $('lrRefresh').addEventListener('click', async () => { await refreshServerState(); if (state.files.size) rebuildList() })
  $('lrTargetLabeler').addEventListener('change', () => { try { localStorage.setItem('lr:targetLabeler', $('lrTargetLabeler').value) } catch {}; rebuildList(true) })
  $('lrViewFilter').addEventListener('change', () => { try { localStorage.setItem('lr:viewFilter', $('lrViewFilter').value) } catch {}; rebuildList(true) })
  $('lrReviewFilter').addEventListener('change', () => { try { localStorage.setItem('lr:reviewFilter', $('lrReviewFilter').value) } catch {}; rebuildList(true) })
  $('lrSearch').addEventListener('input', () => rebuildList(false))
  $('lrReviewer').addEventListener('input', () => { try { localStorage.setItem('lr:reviewer', $('lrReviewer').value.trim()) } catch {}; if (state.current) markDirty() })
  $('lrMemo').addEventListener('input', () => { state.review.memo = $('lrMemo').value; markDirty() })
  $('lrPrev').addEventListener('click', () => step(-1))
  $('lrNext').addEventListener('click', () => step(1))
  $('lrSave').addEventListener('click', () => saveReview())
  $('lrDoneNext').addEventListener('click', finishAndNext)

  $('lrToggleOriginals')?.addEventListener('change', () => applyLabelVisibility())
  $('lrToggleReviews')?.addEventListener('change', () => applyLabelVisibility())
  $('lrToggleDashed')?.addEventListener('click', toggleOriginalDashed)
  $('lrCancelTool').addEventListener('click', cancelTool)

  $('lrS1Sup').addEventListener('click', () => armTool('S1_SUP', 'endplate', 'S1 상종판', 'lrS1Sup', 'endplate'))
  $('lrFhLat').addEventListener('click', () => armTool('FH_LAT', 'circle', 'FH_LAT 원', 'lrFhLat', 'circle'))
  $('lrBodyPoly')?.addEventListener('click', () => armTool(VERTEBRA_REVIEW_LABEL, 'polygon', '추체 검수', 'lrBodyPoly', 'vertebra'))
  $('lrArmEndplate').addEventListener('click', () => {
    const v = $('lrVertebra').value
    const side = $('lrEndplateSide').value
    armTool(`${v}_${side}`, 'endplate', `${v} ${side === 'SUP' ? '상' : '하'}종판`, 'lrArmEndplate', 'endplate')
  })

  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)) return
    if (e.code === 'Space') { e.preventDefault(); state.annotator.setPanMode?.(true); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveReview(); return }

    if (e.code === 'KeyQ' && state.activeTool?.mode === 'polygon') {
      e.preventDefault()
      state.annotator?.finishDrawing?.()
      return
    }
    if (e.code === 'KeyW' && state.activeTool?.mode === 'polygon') {
      e.preventDefault()
      state.annotator?.finishDrawing?.({ angularSort: true })
      return
    }
    if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      // circle/endplate의 첫 점은 currentPoints가 아니라 _circleFirst/_endplateFirst에
      // 저장되므로 removeLastPoint()만 호출하면 E가 먹지 않습니다.
      const removedSpecial = state.annotator?.cancelOrDeleteLastCircle?.() === true
      const removed = removedSpecial || state.annotator?.removeLastPoint?.() === true
      if (removed) {
        const display = state.activeTool?.display || '표시'
        $('lrToolStatus').textContent = `${display}: 마지막 점 취소됨 · 다시 찍으세요`
        $('lrToolStatus').classList.add('active')
      }
      return
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
    if (e.key === 'Escape') cancelTool()
  })
  document.addEventListener('keyup', e => { if (e.code === 'Space') state.annotator.setPanMode?.(false) })
  window.addEventListener('beforeunload', cleanupUrls)
}

function setActiveToolButton(buttonId = '') {
  for (const id of TOOL_BUTTON_IDS) $(id)?.classList.remove('primary')
  if (buttonId) $(buttonId)?.classList.add('primary')
}

function toggleOriginalDashed() {
  state.originalDashed = !state.originalDashed
  try { localStorage.setItem('lr:originalDashed', state.originalDashed ? '1' : '0') } catch {}
  updateDashedToggleButton()
  // 이전 점선 스타일을 완전히 초기화한 뒤 현재 상태로 다시 렌더합니다.
  state.annotator?.renderPolygons?.()
  renderOriginalLandmarks()
}

function updateDashedToggleButton() {
  const btn = $('lrToggleDashed')
  if (!btn) return
  btn.classList.toggle('warning', state.originalDashed)
  btn.setAttribute('aria-pressed', state.originalDashed ? 'true' : 'false')
  btn.innerHTML = state.originalDashed
    ? '<i class="fas fa-border-style"></i> 원본 점선 ON'
    : '<i class="fas fa-border-style"></i> 원본 점선'
}

async function refreshServerState() {
  setConnectionStatus('서버 목록 불러오는 중…')
  const [labelsRes, reviewsRes] = await Promise.all([
    fetch('/api/labels', { headers: authHeaders() }),
    fetch('/api/review', { headers: authHeaders() }),
  ])
  const labelsJson = await labelsRes.json()
  const reviewsJson = await reviewsRes.json()
  state.meta.clear()
  for (const item of labelsJson.items || []) state.meta.set(item.filename, item)
  state.reviewIndex.clear()
  for (const item of reviewsJson.items || []) {
    if (!String(item.filename || '').startsWith(REVIEW_PREFIX)) continue
    const source = item.review?.source_filename || String(item.filename).slice(REVIEW_PREFIX.length)
    if (source) state.reviewIndex.set(source, item.review || {})
  }
  setConnectionStatus(`서버 라벨 ${state.meta.size}건`)
  rebuildList(false)
}
async function connectImageFolder() { try { const handle = await pickFolderAs(FOLDER_KEY); if (handle) await indexImageFolder(handle) } catch (e) { showError(e) } }
async function restoreImageFolder() {
  const r = await restoreFolderAs(FOLDER_KEY)
  if (!r) return
  if (r.needsPermission) {
    $('lrConnectFolder').classList.add('warning')
    $('lrConnectFolder').innerHTML = '<i class="fas fa-folder-open"></i> 폴더 권한 허용'
    $('lrConnectFolder').onclick = async () => {
      const ok = await ensurePermission(r.handle)
      if (ok) {
        $('lrConnectFolder').onclick = connectImageFolder
        await indexImageFolder(r.handle)
      } else await connectImageFolder()
    }
    return
  }
  await indexImageFolder(r)
}
async function indexImageFolder(handle) {
  setFolderStatus('이미지 목록 읽는 중…')
  const files = await listImageFiles(handle)
  state.files.clear()
  for (const f of files) state.files.set(f.name, { name: f.name, handle: f.handle || f })
  setFolderStatus(`${handle.name || '이미지 폴더'} · ${state.files.size}장`)
  $('lrConnectFolder').classList.remove('warning')
  $('lrConnectFolder').innerHTML = '<i class="fas fa-folder-open"></i> 이미지 폴더 변경'
  rebuildList(true)
}
function inferView(name) { try { return String(parseFilename(name)?.viewType || '').toUpperCase() } catch { return /(?:^|[_-])LAT(?:[_-]|\.)/i.test(name) ? 'LAT' : (/\bAP\b/i.test(name) ? 'AP' : '') } }
function isReviewed(name) { return state.reviewIndex.get(name)?.done === true }

function rebuildList(openFirst = false) {
  const target = $('lrTargetLabeler').value
  const view = $('lrViewFilter').value
  const rf = $('lrReviewFilter').value
  const q = ($('lrSearch').value || '').trim().toLowerCase()
  const list = []
  for (const file of state.files.values()) {
    const meta = state.meta.get(file.name)
    if (!meta || meta.labeler_id !== target) continue
    const fv = inferView(file.name)
    if (view !== 'all' && fv !== view) continue
    const done = isReviewed(file.name)
    if (rf === 'pending' && done) continue
    if (rf === 'done' && !done) continue
    if (q && !file.name.toLowerCase().includes(q)) continue
    list.push({ ...file, meta, view: fv, done })
  }
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  state.list = list
  $('lrCount').textContent = String(list.length)
  renderList(); updateProgress()
  if (openFirst && list.length && (!state.current || !list.some(x => x.name === state.current.name))) openImage(list[0])
  if (list.length) preloadAround(0)
}
function renderList() {
  const ul = $('lrFileList')
  ul.innerHTML = ''
  if (!state.list.length) { ul.innerHTML = '<li class="lr-empty">조건에 맞는 파일이 없습니다.</li>'; return }
  for (const item of state.list) {
    const li = document.createElement('li')
    li.className = 'lr-file' + (state.current?.name === item.name ? ' active' : '')
    li.innerHTML = `<button type="button"><span class="lr-file-name">${esc(item.name)}</span><span class="lr-file-meta"><span>${esc(item.view || '--')}</span>${item.done ? '<span class="done">검토완료</span>' : '<span>미검토</span>'}</span></button>`
    li.querySelector('button').addEventListener('click', () => openImage(item))
    ul.appendChild(li)
  }
}
function updateProgress() {
  const target = $('lrTargetLabeler').value
  let total = 0, done = 0
  for (const file of state.files.values()) {
    const meta = state.meta.get(file.name)
    if (!meta || meta.labeler_id !== target) continue
    total++
    if (isReviewed(file.name)) done++
  }
  $('lrProgress').textContent = total ? `${done} / ${total} 검토 완료` : '검토할 파일 없음'
}

async function openImage(item) {
  if (!item) return
  await flushPendingSave()
  cancelTool()
  const token = ++state.openToken
  state.current = item
  state.currentMeta = item.meta || state.meta.get(item.name) || null
  state.dirty = false
  updateHeaderForCurrent(); renderList(); setSavedStatus('불러오는 중…', ''); renderOriginalNote(null)
  try {
    const [imageUrl, labels, review, originalNote] = await Promise.all([
      ensureImageUrl(item),
      loadLabelData(item.name),
      loadReviewData(item.name),
      loadOriginalNoteData(item.name),
    ])
    if (token !== state.openToken) return
    await state.annotator.loadImage(imageUrl)
    if (token !== state.openToken) return
    state.originalPolygons = Array.isArray(labels.polygons) ? labels.polygons : []
    state.originalLandmarks = Array.isArray(labels.landmarks) ? labels.landmarks : []
    state.originalNote = originalNote
    if (labels.start_label) state.annotator.startLabel = labels.start_label
    state.review = normalizeReview(review, item)
    $('lrMemo').value = state.review.memo || ''
    renderOriginalNote(originalNote)
    renderCombined(); renderAdditionList(); renderOriginalLandmarks(); applyLabelVisibility()
    setSavedStatus(state.review.done ? '검토 완료' : '저장됨', state.review.done ? 'done' : '')
    updateHeaderForCurrent()
    preloadAround(state.list.findIndex(x => x.name === item.name))
  } catch (e) {
    if (token !== state.openToken) return
    showError(e)
    setSavedStatus('불러오기 실패', 'error')
  }
}
function normalizeReview(raw, item) {
  const src = raw && raw.type === 'label-review-v1' ? raw : emptyReview()
  return {
    ...emptyReview(),
    ...src,
    source_filename: item.name,
    target_labeler: item.meta?.labeler_id || $('lrTargetLabeler').value,
    additions: Array.isArray(src.additions) ? src.additions.map((p, i) => ({ ...p, _review_id: p._review_id || `rv_${Date.now()}_${i}` })) : [],
    memo: String(src.memo || ''),
    done: src.done === true,
  }
}
function updateHeaderForCurrent() {
  $('lrFileName').textContent = state.current?.name || '파일을 선택하세요'
  const l = getLabelerById(state.currentMeta?.labeler_id)
  $('lrSourceLabeler').textContent = l ? `${l.name}${l.title ? ' · ' + l.title : ''}` : '—'
  const idx = state.current ? state.list.findIndex(x => x.name === state.current.name) : -1
  $('lrPosition').textContent = idx >= 0 ? `${idx + 1} / ${state.list.length}` : `0 / ${state.list.length}`
}
async function loadLabelData(filename) {
  if (state.labelCache.has(filename)) return state.labelCache.get(filename)
  const r = await fetch('/api/labels/' + encodeURIComponent(filename), { headers: authHeaders() })
  if (!r.ok) throw new Error(`라벨 로드 실패 (${r.status})`)
  const j = await r.json()
  const data = j.exists
    ? { polygons: Array.isArray(j.polygons) ? j.polygons : [], landmarks: Array.isArray(j.landmarks) ? j.landmarks : [], start_label: j.start_label || 'C2' }
    : { polygons: [], landmarks: [], start_label: 'C2' }
  state.labelCache.set(filename, data)
  return data
}
async function loadReviewData(filename) {
  if (state.reviewCache.has(filename)) return state.reviewCache.get(filename)
  const r = await fetch('/api/review/' + encodeURIComponent(REVIEW_PREFIX + filename), { headers: authHeaders() })
  if (!r.ok) throw new Error(`검토 데이터 로드 실패 (${r.status})`)
  const j = await r.json()
  const review = j?.review || null
  state.reviewCache.set(filename, review)
  return review
}
async function loadOriginalNoteData(filename) {
  if (state.noteCache.has(filename)) return state.noteCache.get(filename)
  const r = await fetch('/api/notes/' + encodeURIComponent(filename), { headers: authHeaders() })
  if (!r.ok) throw new Error(`원 메모 로드 실패 (${r.status})`)
  const j = await r.json()
  const note = j?.ok === false ? null : { exists: j?.exists === true, note_text: String(j?.note_text || ''), labeler_id: j?.labeler_id || '', updated_at: j?.updated_at || '' }
  state.noteCache.set(filename, note)
  return note
}

function renderCombined() {
  state.suppressChanges = true
  const originals = state.originalPolygons.map(p => ({ ...p, _lr_original: true }))
  const additions = state.review.additions.map(p => ({ ...p, reviewOnly: true, manualLabel: true }))
  state.annotator.loadPolygons([...originals, ...additions])
  state.annotator.readOnly = true
  state.suppressChanges = false
  state.annotator.polyLayer?.moveToTop?.()
  applyReviewVisualStyles()
  applyLabelVisibility(false)
  state.annotator.stage?.batchDraw?.()
}

function polyFingerprint(poly) {
  const pts = Array.isArray(poly?.points) ? poly.points : []
  return `${String(poly?.label || '')}|${String(poly?.shape || '')}|${pts.map(v => Number(v).toFixed(3)).join(',')}`
}

function makePolyLookup() {
  const reviewById = new Map()
  const originalById = new Map()
  const reviewByFingerprint = new Map()
  const originalByFingerprint = new Map()

  for (const p of state.review.additions || []) {
    if (p?.id != null) reviewById.set(String(p.id), p)
    reviewByFingerprint.set(polyFingerprint(p), p)
  }
  for (const p of state.originalPolygons || []) {
    if (p?.id != null) originalById.set(String(p.id), p)
    originalByFingerprint.set(polyFingerprint(p), p)
  }
  return { reviewById, originalById, reviewByFingerprint, originalByFingerprint }
}

function classifyRenderedPoly(poly, lookup) {
  const id = poly?.id == null ? '' : String(poly.id)
  if (id && lookup.reviewById.has(id)) return { isReview: true, source: lookup.reviewById.get(id) }
  if (id && lookup.originalById.has(id)) return { isReview: false, source: lookup.originalById.get(id) }

  const fp = polyFingerprint(poly)
  const review = lookup.reviewByFingerprint.get(fp)
  const original = lookup.originalByFingerprint.get(fp)
  if (review && !original) return { isReview: true, source: review }
  return { isReview: false, source: original || poly }
}

function getGroupShape(group) {
  const children = group?.getChildren?.() || []
  for (const child of children) if (child?.getClassName?.() === 'Line') return child
  return null
}
function getGroupText(group) {
  const children = group?.getChildren?.() || []
  for (const child of children) if (child?.getClassName?.() === 'Text') return child
  return null
}
function getGroupLabelBg(group) {
  const children = group?.getChildren?.() || []
  for (const child of children) if (child?.getClassName?.() === 'Rect') return child
  return null
}

function isVertebraReview(source) {
  return source?._review_kind === 'vertebra-review' || String(source?.label || '') === VERTEBRA_REVIEW_LABEL
}

function applyReviewVisualStyles() {
  const layer = state.annotator?.polyLayer
  const polys = state.annotator?.polygons || []
  if (!layer || !polys.length) return
  const groups = layer.getChildren?.() || []
  const scale = Math.max(.001, state.annotator?.stage?.scaleX?.() || 1)
  const lookup = makePolyLookup()

  groups.forEach((group, index) => {
    const poly = polys[index]
    if (!poly) return
    const { isReview, source } = classifyRenderedPoly(poly, lookup)
    const shape = getGroupShape(group)
    const text = getGroupText(group)
    const bg = getGroupLabelBg(group)

    if (isReview) {
      const bodyReview = isVertebraReview(source)
      const reviewColor = bodyReview ? '#3fb950' : '#22d3ee'
      if (shape) {
        shape.fillEnabled?.(false)
        shape.strokeEnabled?.(true)
        shape.stroke?.(reviewColor)
        shape.strokeWidth?.((bodyReview ? 3.2 : 3.0) / scale)
        shape.dash?.([])
        shape.opacity?.(1)
      }
      if (bodyReview) {
        // 추체 검수는 번호/이름을 표시하지 않고 초록 윤곽만 보여줍니다.
        text?.opacity?.(0)
        bg?.opacity?.(0)
      } else {
        text?.fill?.('#ecfeff')
        text?.opacity?.(1)
        bg?.fill?.('#0891b2')
        bg?.opacity?.(.90)
      }
      return
    }

    // 원본 점선은 별도 토글을 켰을 때만 적용합니다.
    // OFF 상태에서는 renderPolygons()의 원래 마스크 디자인을 그대로 유지합니다.
    if (state.originalDashed && shape) {
      const color = getRegionColor(poly.label)
      shape.fillEnabled?.(false)
      shape.strokeEnabled?.(true)
      shape.stroke?.(color)
      shape.strokeWidth?.(1.35 / scale)
      shape.dash?.([7 / scale, 5 / scale])
      shape.opacity?.(.58)
      text?.opacity?.(.55)
      bg?.opacity?.(.26)
    }
  })
  layer.batchDraw?.()
}

function renderOriginalLandmarks() {
  const layer = state.landmarkLayer
  if (!layer || !state.annotator) return
  layer.destroyChildren()
  const by = new Map((state.originalLandmarks || []).map(l => [String(l.label || '').toUpperCase(), l]))
  const scale = Math.max(.001, state.annotator.stage?.scaleX?.() || 1)

  for (const v of VERTEBRAE) {
    const pts = CORNERS.map(s => by.get(`${v}_${s}`)).filter(Boolean)
    if (pts.length !== 4) continue
    const cx = pts.reduce((n, p) => n + Number(p.x), 0) / 4
    const cy = pts.reduce((n, p) => n + Number(p.y), 0) / 4
    const sorted = [...pts].sort((a, b) => Math.atan2(Number(a.y) - cy, Number(a.x) - cx) - Math.atan2(Number(b.y) - cy, Number(b.x) - cx))
    const color = getRegionColor(v)
    layer.add(new Konva.Line({
      points: sorted.flatMap(p => [Number(p.x), Number(p.y)]),
      closed: true,
      stroke: color,
      strokeWidth: (state.originalDashed ? 1.25 : 1.8) / scale,
      dash: state.originalDashed ? [6 / scale, 5 / scale] : undefined,
      fill: state.originalDashed ? undefined : color + '22',
      opacity: state.originalDashed ? .5 : 1,
      listening: false,
    }))
    layer.add(new Konva.Text({
      x: cx, y: cy, text: v,
      fontSize: (state.originalDashed ? 12 : 14) / scale,
      fill: '#fff',
      opacity: state.originalDashed ? .55 : 1,
      stroke: '#111827', strokeWidth: 1 / scale,
      listening: false,
      offsetX: 7 / scale, offsetY: 6 / scale,
    }))
  }

  const fh = by.get('FH_LAT')
  if (fh) {
    const color = getRegionColor('FH_LAT')
    layer.add(new Konva.Circle({
      x: Number(fh.x), y: Number(fh.y), radius: 5 / scale,
      fill: state.originalDashed ? undefined : color,
      stroke: color, strokeWidth: 1.4 / scale,
      opacity: state.originalDashed ? .6 : 1,
      listening: false,
    }))
  }
  layer.batchDraw()
  state.annotator.polyLayer?.moveToTop?.()
}

function applyLabelVisibility(restyle = true) {
  const showOriginal = $('lrToggleOriginals')?.checked !== false
  const showReview = $('lrToggleReviews')?.checked !== false
  const layer = state.annotator?.polyLayer
  const groups = layer?.getChildren?.() || []
  const polys = state.annotator?.polygons || []
  const lookup = makePolyLookup()

  groups.forEach((group, index) => {
    const poly = polys[index]
    if (!poly) return
    const { isReview } = classifyRenderedPoly(poly, lookup)
    group.visible?.(isReview ? showReview : showOriginal)
  })
  layer?.visible?.(showOriginal || showReview)
  state.landmarkLayer?.visible?.(showOriginal)
  if (restyle) applyReviewVisualStyles()
  state.annotator?.stage?.batchDraw?.()
}

function armTool(label, mode, display, buttonId = '', kind = '') {
  if (!state.current) return
  cancelTool(false)
  const beforeIds = new Set((state.annotator.polygons || []).map(p => String(p.id)))
  state.activeTool = { label, mode, display, beforeIds, buttonId, kind }
  setActiveToolButton(buttonId)
  state.annotator.readOnly = false
  state.annotator.setTool('draw')
  state.annotator.setPendingLabel(label, mode)

  if (mode === 'point') $('lrToolStatus').textContent = `${display}: 위치를 1번 클릭하세요 · Esc: 도구 취소`
  else if (mode === 'polygon') $('lrToolStatus').textContent = `${display}: 윤곽점을 찍고 Q로 완료 · E: 마지막 점 취소 · W: 각도순 완료 · Esc: 취소`
  else $('lrToolStatus').textContent = `${display}: 기준점을 2번 클릭하세요 · E: 첫 점 취소 · Esc: 도구 취소`

  $('lrToolStatus').classList.add('active')
  $('lrCancelTool').disabled = false
}
function cancelTool(resetText = true) {
  if (!state.annotator) return
  state.annotator.readOnly = true
  state.annotator.setPendingLabel?.(null, 'polygon')
  state.annotator.cancelDrawing?.()
  state.annotator.cancelOrDeleteLastCircle?.()
  state.activeTool = null
  setActiveToolButton('')
  $('lrCancelTool').disabled = true
  $('lrToolStatus').classList.remove('active')
  if (resetText) $('lrToolStatus').textContent = '도구를 누를 때만 캔버스 입력이 활성화됩니다.'
}
function onPolygonsChange() {
  if (state.suppressChanges || !state.activeTool || !state.annotator) return
  const tool = state.activeTool
  const fresh = (state.annotator.polygons || []).filter(p => !tool.beforeIds.has(String(p.id)))
  if (!fresh.length) return

  const clean = serializePolygon(fresh[fresh.length - 1])
  clean.reviewOnly = true
  clean.manualLabel = true
  clean._review_id = `rv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  if (tool.kind === 'vertebra') {
    // 검수 추체는 C/T/L 번호를 부여하지 않고 모두 같은 종류로 저장합니다.
    clean.label = VERTEBRA_REVIEW_LABEL
    clean._review_kind = 'vertebra-review'
  }

  state.review.additions.push(clean)
  cancelTool(false)
  renderCombined(); renderAdditionList()
  $('lrToolStatus').textContent = `${tool.display} 추가됨`
  markDirty()
}
function serializePolygon(p) {
  const out = { ...p, points: Array.isArray(p.points) ? p.points.map(Number) : [] }
  delete out._lr_original
  delete out._centroidY
  return out
}
function renderAdditionList() {
  const box = $('lrAdditions')
  const items = state.review.additions || []
  if (!items.length) { box.innerHTML = '<div class="lr-add-empty">추가한 표시가 없습니다.</div>'; return }
  box.innerHTML = items.map((p, i) => {
    const kind = isVertebraReview(p)
      ? '추체 검수'
      : (p.shape === 'endplate' ? '종판' : (p.landmark ? '점' : (p.shape || 'annotation')))
    const name = isVertebraReview(p) ? '추체' : (p.label || '표시')
    return `<div class="lr-add-row"><span><strong>${esc(name)}</strong><small>${esc(kind)}</small></span><button type="button" data-remove="${i}"><i class="fas fa-times"></i></button></div>`
  }).join('')
  box.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
    state.review.additions.splice(Number(btn.dataset.remove), 1)
    renderCombined(); renderAdditionList(); markDirty()
  }))
}
function markDirty() {
  if (!state.current) return
  state.dirty = true
  state.review.done = false
  setSavedStatus('저장 안 됨', 'dirty')
  clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(() => saveReview(), 900)
}
async function flushPendingSave() {
  if (!state.dirty || !state.current) return
  clearTimeout(state.saveTimer)
  state.saveTimer = null
  await saveReview()
}
async function saveReview(doneOverride = null) {
  if (!state.current) return false
  clearTimeout(state.saveTimer)
  state.saveTimer = null
  const filename = state.current.name
  const reviewer = $('lrReviewer').value.trim()
  if (doneOverride === true && !reviewer) {
    $('lrReviewer').focus()
    setSavedStatus('검토자 이름을 입력하세요', 'error')
    return false
  }
  const payloadReview = {
    ...state.review,
    type: 'label-review-v1',
    source_filename: filename,
    target_labeler: state.currentMeta?.labeler_id || $('lrTargetLabeler').value,
    reviewer,
    additions: (state.review.additions || []).map(serializePolygon),
    memo: $('lrMemo').value,
    done: doneOverride === null ? state.review.done === true : !!doneOverride,
    updated_at: new Date().toISOString(),
  }
  setSavedStatus('저장 중…', '')
  try {
    const r = await fetch('/api/review/' + encodeURIComponent(REVIEW_PREFIX + filename), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ review: payloadReview, reviewer }),
    })
    const j = await r.json()
    if (!r.ok || !j?.ok) throw new Error(j?.error || `저장 실패 (${r.status})`)
    if (state.current?.name === filename) { state.review = payloadReview; state.dirty = false }
    state.reviewCache.set(filename, payloadReview)
    state.reviewIndex.set(filename, payloadReview)
    setSavedStatus(payloadReview.done ? '검토 완료' : '저장됨', payloadReview.done ? 'done' : '')
    updateProgress(); renderList()
    return true
  } catch (e) {
    setSavedStatus('저장 실패', 'error')
    showError(e)
    return false
  }
}
async function finishAndNext() {
  if (!state.current) return
  const currentName = state.current.name
  if (!await saveReview(true)) return
  rebuildList(false)
  const next = state.list.find(x => x.name.localeCompare(currentName, undefined, { numeric: true }) > 0) || state.list[0]
  if (next && next.name !== currentName) await openImage(next)
}
function step(delta) {
  if (!state.list.length) return
  const i = state.current ? state.list.findIndex(x => x.name === state.current.name) : -1
  const ni = Math.max(0, Math.min(state.list.length - 1, (i < 0 ? 0 : i) + delta))
  const next = state.list[ni]
  if (next && next.name !== state.current?.name) openImage(next)
}

async function ensureImageUrl(item) {
  const cached = state.imageCache.get(item.name)
  if (cached) { cached.used = Date.now(); return cached.url }
  const result = await fileHandleToUrl(item.handle)
  const url = result.url || result
  state.imageCache.set(item.name, { url, used: Date.now() })
  evictImageCache()
  return url
}
function evictImageCache() {
  if (state.imageCache.size <= MAX_IMAGE_CACHE) return
  const protectedNames = new Set([state.current?.name].filter(Boolean))
  const victims = [...state.imageCache.entries()].filter(([n]) => !protectedNames.has(n)).sort((a, b) => a[1].used - b[1].used)
  while (state.imageCache.size > MAX_IMAGE_CACHE && victims.length) {
    const [name, entry] = victims.shift()
    URL.revokeObjectURL(entry.url)
    state.imageCache.delete(name)
  }
}
function preloadAround(index) {
  if (!state.list.length || index < 0) return
  const token = ++state.prefetchToken
  const items = []
  for (let n = 1; n <= PREFETCH_AHEAD; n++) if (state.list[index + n]) items.push(state.list[index + n])
  if (state.list[index - 1]) items.push(state.list[index - 1])
  if (!items.length) { $('lrPreload').textContent = ''; return }
  ;(async () => {
    let done = 0
    $('lrPreload').textContent = `다음 이미지 미리 읽기 0/${items.length}`
    for (const item of items) {
      if (token !== state.prefetchToken) return
      try { await Promise.all([ensureImageUrl(item), loadLabelData(item.name), loadReviewData(item.name), loadOriginalNoteData(item.name)]) } catch {}
      done++
      if (token === state.prefetchToken) $('lrPreload').textContent = `다음 이미지 미리 읽기 ${done}/${items.length}`
    }
    if (token === state.prefetchToken) $('lrPreload').textContent = '다음 이미지 준비됨'
  })()
}
function setSavedStatus(text, cls) { $('lrSaved').textContent = text; $('lrSaved').className = 'lr-saved' + (cls ? ' ' + cls : '') }
function setFolderStatus(text) { $('lrFolderStatus').textContent = text }
function setConnectionStatus(text) { $('lrServerStatus').textContent = text }
function showError(error) {
  console.error('[label-review]', error)
  $('lrToast').textContent = error?.message || String(error || '알 수 없는 오류')
  $('lrToast').classList.add('show')
  clearTimeout($('lrToast')._timer)
  $('lrToast')._timer = setTimeout(() => $('lrToast').classList.remove('show'), 4000)
}
function cleanupUrls() {
  for (const entry of state.imageCache.values()) try { URL.revokeObjectURL(entry.url) } catch {}
  state.imageCache.clear()
}

document.addEventListener('DOMContentLoaded', init)
