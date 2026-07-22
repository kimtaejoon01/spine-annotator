/* ================================================================
   검수 페이지 (/review)
   - 원본 폴더 + 예측 마스크 폴더를 연결하면 '마스크가 있는 이미지'(=테스트셋)만 목록에 표시
   - 사람 폴리곤 / AI 마스크 / 자동측정(사람) / 자동측정(AI)를 함께 보고 비교
   - 검수 모드에서 종판 코너 드래그 교정 + 추체별/이미지 메모 저장
   ================================================================ */
import { SpineAnnotator } from './annotator.js'
import { pickFolder, listImageFiles, fileHandleToUrl } from './fs.js'
import { computeSagittal, DEFAULT_RANGES } from './auto-endplate.js'
import { maskToPolygons } from './ai-measure.js'

const $ = (id) => document.getElementById(id)
const baseOf = (n) => String(n || '').replace(/\.[^.]+$/, '')
const predBase = (n) => baseOf(n).replace(/_(pred_mask|pred|mask|predmask)$/i, '')
const authHeaders = () => {
  try { const t = localStorage.getItem('spine-annotator:authToken'); return t ? { 'X-Auth-Token': t } : {} } catch { return {} }
}

const state = {
  annotator: null,
  images: new Map(),      // base -> {name, handle}
  masks: new Map(),       // base -> handle
  list: [],               // 테스트셋 목록 (교집합)
  current: null,          // {name, base}
  humanResult: null,
  aiResult: null,
  aiPolys: null,
  // 검수 데이터를 '사람 자동측정용'과 'AI 자동측정용'으로 분리 보관
  review: {
    human: { corners: {}, notes: {} },
    ai: { corners: {}, notes: {} },
    imageNote: '',
  },
  undo: [],
}

// ---------------- 초기화 ----------------
function init() {
  state.annotator = new SpineAnnotator({ container: 'rvStage' })
  window.__rvAnnotator = state.annotator

  $('rvConnectImages').addEventListener('click', () => connect('images'))
  $('rvConnectMasks').addEventListener('click', () => connect('masks'))
  $('rvSearch').addEventListener('input', renderList)
  $('rvMethod').addEventListener('change', () => { runMeasures() })

  for (const id of ['rvShowHuman', 'rvShowMask', 'rvShowHumanMeasure']) {
    $(id).addEventListener('change', applyVisibility)
  }
  // 측정 대상 전환 시 검수 데이터도 그쪽 것으로 전환
  $('rvShowAiMeasure').addEventListener('change', () => {
    applyVisibility(); refreshVsel()
    $('rvNoteV').value = bucket().notes[$('rvVsel').value] || ''
  })
  $('rvReview').addEventListener('change', pushReview)
  $('rvPrev').addEventListener('click', () => step(-1))
  $('rvNext').addEventListener('click', () => step(1))

  $('rvVsel').addEventListener('change', () => { $('rvNoteV').value = bucket().notes[$('rvVsel').value] || '' })
  $('rvNoteV').addEventListener('input', onNoteInput)
  $('rvNoteImg').addEventListener('input', () => { state.review.imageNote = $('rvNoteImg').value; dirty() })
  $('rvResetV').addEventListener('click', resetVertebra)
  $('rvSave').addEventListener('click', saveReview)
  $('rvExport').addEventListener('click', exportJson)

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
  })
}

// ---------------- 폴더 연결 ----------------
async function connect(kind) {
  try {
    const handle = await pickFolder()
    if (!handle) return
    const files = await listImageFiles(handle)
    if (kind === 'images') {
      state.images = new Map()
      for (const f of files) state.images.set(baseOf(f.name), f)
    } else {
      state.masks = new Map()
      for (const f of files) state.masks.set(predBase(f.name), f.handle || f)
    }
    buildTestSet()
  } catch (e) {
    alert('폴더 연결 실패: ' + (e && e.message || e))
  }
}

// 테스트셋 = 원본과 예측 마스크가 모두 있는 것
function buildTestSet() {
  state.list = []
  for (const [base, f] of state.images) {
    if (state.masks.has(base)) state.list.push({ base, name: f.name, handle: f.handle || f })
  }
  state.list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  $('rvCount').textContent = state.list.length
  renderList()
  if (!state.list.length) {
    $('rvFileName').textContent = state.images.size && state.masks.size
      ? '겹치는 파일이 없습니다 (파일명 규칙 확인)'
      : '원본 폴더와 예측 마스크 폴더를 모두 연결하세요'
  }
}

function renderList() {
  const q = ($('rvSearch').value || '').toLowerCase()
  const ul = $('rvFileList')
  ul.innerHTML = ''
  for (const item of state.list) {
    if (q && !item.name.toLowerCase().includes(q)) continue
    const li = document.createElement('li')
    li.className = 'rv-file-item' + (state.current && state.current.base === item.base ? ' active' : '')
    li.textContent = item.name
    li.addEventListener('click', () => openImage(item))
    ul.appendChild(li)
  }
}

function step(delta) {
  if (!state.list.length) return
  const i = state.current ? state.list.findIndex(x => x.base === state.current.base) : -1
  const next = state.list[Math.max(0, Math.min(state.list.length - 1, i + delta))]
  if (next) openImage(next)
}

// ---------------- 이미지 열기 ----------------
async function openImage(item) {
  state.current = item
  $('rvFileName').textContent = item.name
  renderList()
  state.humanResult = null; state.aiResult = null; state.aiPolys = null
  state.review = { human: { corners: {}, notes: {} }, ai: { corners: {}, notes: {} }, imageNote: '' }; state.undo = []
  $('rvNoteV').value = ''; $('rvNoteImg').value = ''; $('rvSaved').textContent = ''

  const res = await fileHandleToUrl(item.handle)
  await state.annotator.loadImage(res.url || res)

  await loadHumanLabels(item.name)
  await loadAiMask(item.base)
  await loadReview(item.name)
  runMeasures()
}

async function loadHumanLabels(filename) {
  try {
    const r = await fetch('/api/labels/' + encodeURIComponent(filename), { headers: authHeaders() })
    const j = await r.json()
    const polys = (j && j.ok && Array.isArray(j.polygons)) ? j.polygons : []
    if (j && j.start_label) state.annotator.startLabel = j.start_label
    state.annotator.loadPolygons(polys)
  } catch (e) { state.annotator.loadPolygons([]) }
}

async function loadAiMask(base) {
  const h = state.masks.get(base)
  if (!h) { state.aiPolys = null; return }
  try {
    const file = await (h.getFile ? h.getFile() : h)
    const startLabel = state.annotator.startLabel || 'C2'
    const { polygons } = await maskToPolygons(file, { startLabel })
    state.aiPolys = polygons
  } catch (e) {
    console.error('[review] mask', e)
    state.aiPolys = null
  }
}

// ---------------- 측정 ----------------
function runMeasures() {
  const method = $('rvMethod').value
  const humanPolys = (state.annotator.polygons || [])
    .filter(p => p && p.label && Array.isArray(p.points) && p.points.length >= 8)
  state.humanResult = humanPolys.length >= 2 ? computeSagittal(humanPolys, DEFAULT_RANGES, { method }) : null
  state.aiResult = (state.aiPolys && state.aiPolys.length >= 2) ? computeSagittal(state.aiPolys, DEFAULT_RANGES, { method }) : null
  renderAngles()
  refreshVsel()
  applyVisibility()
}

function fmt(v) { return (v == null || Number.isNaN(v)) ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '°' }

function renderAngles() {
  const H = state.humanResult, A = state.aiResult
  if (!H && !A) { $('rvAngles').textContent = '측정할 폴리곤이 없습니다'; return }
  const rows = [['LL', 'LL (요추전만)'], ['TK', 'TK (흉추후만)'], ['CL', 'CL (경추만곡)'], ['T1_slope', 'T1 slope']]
  let html = '<table class="rv-table"><tbody><tr><td></td><td class="rv-h">사람</td><td class="rv-h rv-ai">AI</td><td class="rv-h">차이</td></tr>'
  for (const [k, label] of rows) {
    const hv = H ? H.angles[k] : NaN, av = A ? A.angles[k] : NaN
    const d = (Number.isFinite(hv) && Number.isFinite(av)) ? Math.abs(hv - av) : NaN
    html += `<tr><td>${label}</td><td>${fmt(hv)}</td><td class="rv-ai">${fmt(av)}</td><td class="${Number.isFinite(d) && d > 5 ? 'rv-diff-big' : ''}">${fmt(d)}</td></tr>`
  }
  html += '</tbody></table>'
  const qsum = (r) => {
    if (!r || !r.quality) return '—'
    const c = { ok: 0, review: 0, fallback: 0 }
    for (const k in r.quality) c[r.quality[k].quality] = (c[r.quality[k].quality] || 0) + 1
    return `정상 ${c.ok} / 확인 ${c.review} / 보정 ${c.fallback}`
  }
  html += `<div class="rv-qual">사람: ${qsum(H)} · 추체 ${H ? H.present.length : 0}개<br>AI: ${qsum(A)} · 추체 ${A ? A.present.length : 0}개</div>`
  $('rvAngles').innerHTML = html
}

// ---------------- 표시 토글 ----------------
function applyVisibility() {
  const a = state.annotator
  // 사람 폴리곤
  if (a.polyLayer) { a.polyLayer.visible($('rvShowHuman').checked); a.polyLayer.batchDraw() }
  // AI 마스크(윤곽) 오버레이
  a.setAiMeasurePolygons?.($('rvShowMask').checked ? state.aiPolys : null)
  // 자동측정 오버레이 (사람/AI 중 선택. 둘 다면 AI 우선 표시)
  const useAi = $('rvShowAiMeasure').checked
  const useHuman = $('rvShowHumanMeasure').checked
  const src = useAi ? state.aiResult : (useHuman ? state.humanResult : null)
  if (src) {
    a.setEndplateQuality?.(src.quality)
    a.drawAutoEndplateOverlay(src.present.map(label => ({ label, ...src.corners[label] })))
  } else {
    a.clearAutoEndplateOverlay()
  }
  pushReview()
}

// ---------------- 검수 (드래그/메모) ----------------
function activeSource() { return $('rvShowAiMeasure').checked ? 'ai' : 'human' }
function bucket() { return state.review[activeSource()] }
function activeResult() {
  return $('rvShowAiMeasure').checked ? state.aiResult : state.humanResult
}
function pushReview() {
  const a = state.annotator
  const b = bucket()
  a.setEndplateNotes?.(b.notes, true)
  a.setEndplateReview?.(b.corners, $('rvReview').checked, onCornerMoved)
  const tag = activeSource() === 'ai' ? 'AI' : '사람'
  const el = $('rvReviewTag'); if (el) el.textContent = `검수 대상: ${tag} 자동측정`
}
function onCornerMoved(label, key, xy) {
  const src = activeSource(), b = bucket()
  state.undo.push({ src, corners: JSON.parse(JSON.stringify(b.corners)) })
  if (state.undo.length > 50) state.undo.shift()
  const r = activeResult()
  if (!b.corners[label]) {
    const c = r && r.corners[label]
    if (!c) return
    b.corners[label] = { SA: c.SA.slice(), SP: c.SP.slice(), IA: c.IA.slice(), IP: c.IP.slice() }
  }
  b.corners[label][key] = xy
  pushReview(); refreshVsel(); dirty()
}
function undo() {
  if (!state.undo.length) return
  const last = state.undo.pop()
  state.review[last.src].corners = last.corners
  pushReview(); refreshVsel(); dirty()
}
function resetVertebra() {
  const v = $('rvVsel').value; if (!v) return
  const src = activeSource(), b = bucket()
  state.undo.push({ src, corners: JSON.parse(JSON.stringify(b.corners)) })
  delete b.corners[v]
  pushReview(); refreshVsel(); dirty()
}
function onNoteInput() {
  const v = $('rvVsel').value
  if (!v) { $('rvSaved').textContent = '⚠ 추체를 먼저 선택하세요'; return }
  const t = $('rvNoteV').value
  const b = bucket()
  if (t.trim()) b.notes[v] = t; else delete b.notes[v]
  pushReview(); refreshVsel(); dirty()
}
function refreshVsel() {
  const sel = $('rvVsel'); const cur = sel.value
  const r = activeResult()
  sel.innerHTML = '<option value="">추체 선택…</option>'
  for (const v of (r ? r.present : [])) {
    const o = document.createElement('option')
    o.value = v
    const b = bucket()
    o.textContent = v + (b.corners[v] ? ' ✎' : '') + (b.notes[v] ? ' 💬' : '')
    sel.appendChild(o)
  }
  if (r && r.present.includes(cur)) sel.value = cur
}
function dirty() { $('rvSaved').textContent = '● 저장 안 됨'; $('rvSaved').className = 'rv-saved dirty' }

async function loadReview(filename) {
  try {
    const r = await fetch('/api/review/' + encodeURIComponent(filename), { headers: authHeaders() })
    const j = await r.json()
    if (j && j.ok && j.review) {
      const rv = j.review
      if (rv.human || rv.ai) {
        state.review = {
          human: { corners: (rv.human && rv.human.corners) || {}, notes: (rv.human && rv.human.notes) || {} },
          ai: { corners: (rv.ai && rv.ai.corners) || {}, notes: (rv.ai && rv.ai.notes) || {} },
          imageNote: rv.imageNote || '',
        }
      } else {
        // 예전 형식(구분 없음) → 사람용으로 이관
        state.review = {
          human: { corners: rv.corners || {}, notes: rv.notes || {} },
          ai: { corners: {}, notes: {} },
          imageNote: rv.imageNote || '',
        }
      }
      $('rvNoteImg').value = state.review.imageNote
      $('rvSaved').textContent = '저장됨'; $('rvSaved').className = 'rv-saved'
    }
  } catch (e) {}
}

async function saveReview() {
  if (!state.current) return
  const payload = {
    review: {
      human: state.review.human,
      ai: state.review.ai,
      imageNote: state.review.imageNote,
      method: $('rvMethod').value,
      auto: state.humanResult ? { angles: state.humanResult.angles } : null,
      ai: state.aiResult ? { angles: state.aiResult.angles } : null,
      savedAt: new Date().toISOString(),
    },
  }
  try {
    const r = await fetch('/api/review/' + encodeURIComponent(state.current.name), {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(payload),
    })
    const j = await r.json()
    $('rvSaved').textContent = j && j.ok ? '저장됨' : ('실패: ' + (j && j.error || ''))
    $('rvSaved').className = 'rv-saved'
  } catch (e) { $('rvSaved').textContent = '저장 실패' }
}

function exportJson() {
  const data = {
    file_name: state.current ? state.current.name : '',
    method: $('rvMethod').value,
    human: state.humanResult ? { angles: state.humanResult.angles, quality: state.humanResult.quality } : null,
    ai: state.aiResult ? { angles: state.aiResult.angles, quality: state.aiResult.quality } : null,
    review: state.review,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = (state.current ? baseOf(state.current.name) : 'review') + '_review.json'
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

document.addEventListener('DOMContentLoaded', init)
