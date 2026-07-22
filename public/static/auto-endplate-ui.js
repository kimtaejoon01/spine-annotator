/* ================================================================
   폴리곤 자동 측정 UI
   - "자동 측정" 버튼 → 폴리곤에서 종판/각도 계산 + 오버레이 + 결과표 + CSV
   - 랜드마크 불필요. 랜드마크 기반 측정 패널과는 독립.
   ================================================================ */

import { computeSagittal, toCSV, DEFAULT_RANGES, cobbAngle } from './auto-endplate.js'

function currentFileName() {
  // 앱 상태(state.filename)가 가장 정확. 없으면 전역/DOM 폴백.
  try { if (window.__spineState && window.__spineState.filename) return window.__spineState.filename } catch (e) {}
  if (window.__spineCurrentFile) return window.__spineCurrentFile
  const el = document.querySelector('[data-current-file]') || document.getElementById('currentFileName')
  return el ? el.textContent.trim() : ''
}

export function initAutoEndplateUI(annotator) {
  if (!annotator) return
  const mount = ensurePanel()
  const btnRun = mount.querySelector('.ae-run')
  const btnCsv = mount.querySelector('.ae-csv')
  const chkOverlay = mount.querySelector('.ae-overlay')
  const body = mount.querySelector('.ae-body')
  const statusEl = mount.querySelector('.ae-status')
  let lastResult = null
  // ---- 검수(리뷰) 상태 ----
  const chkReview = mount.querySelector('.ae-review')
  const vsel = mount.querySelector('.ae-vsel')
  const noteV = mount.querySelector('.ae-note-v')
  const noteImg = mount.querySelector('.ae-note-img')
  const btnSave = mount.querySelector('.ae-save')
  const btnExport = mount.querySelector('.ae-export')
  const btnResetV = mount.querySelector('.ae-reset-v')
  const savedEl = mount.querySelector('.ae-saved')
  let review = { corners: {}, notes: {}, imageNote: '' }
  // ---- 전역 설정(이미지 바뀌어도 유지) ----
  const SETTINGS_KEY = 'spine-annotator:autoEndplateSettings'
  const chkAutoRun = mount.querySelector('.ae-autorun')
  function loadSettings() {
    try {
      const j = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
      chkReview.checked = !!j.reviewMode
      chkAutoRun.checked = j.autoRun !== false   // 기본 켬
      if (typeof j.overlay === 'boolean') chkOverlay.checked = j.overlay
      if (typeof j.notesShow === 'boolean') chkNotes.checked = j.notesShow
      if (j.method === 'v1' || j.method === 'v2') selMethod.value = j.method
    } catch (e) { chkAutoRun.checked = true }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        reviewMode: chkReview.checked, autoRun: chkAutoRun.checked, overlay: chkOverlay.checked, notesShow: chkNotes.checked, method: selMethod.value,
      }))
    } catch (e) {}
  }
  const undoStack = []   // 검수 코너 교정 되돌리기(Ctrl+Z)용
  const snapshot = () => JSON.parse(JSON.stringify(review.corners))
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 50) undoStack.shift() }

  const chkNotes = mount.querySelector('.ae-notes-show')
  const selMethod = mount.querySelector('.ae-method')
  function pushReviewToCanvas() {
    annotator.setEndplateNotes?.(review.notes, chkNotes.checked)
    annotator.setEndplateQuality?.(lastResult ? lastResult.quality : null)
    annotator.setEndplateReview?.(review.corners, chkReview.checked, onCornerMoved)
  }
  function onCornerMoved(label, key, xy) {
    pushUndo()
    // 자동값을 기준으로 복사한 뒤 해당 코너만 갱신
    if (!review.corners[label]) {
      const a = lastResult && lastResult.corners[label]
      if (!a) return
      review.corners[label] = { SA: a.SA.slice(), SP: a.SP.slice(), IA: a.IA.slice(), IP: a.IP.slice() }
    }
    review.corners[label][key] = xy
    pushReviewToCanvas()
    if (lastResult) renderResults(lastResult)
    markDirty()
  }
  function markDirty() { savedEl.textContent = '● 저장 안 됨'; savedEl.className = 'ae-saved dirty' }
  function markSaved(t) { savedEl.textContent = t || '저장됨'; savedEl.className = 'ae-saved' }

  function refreshVertebraSelect() {
    const cur = vsel.value
    vsel.innerHTML = '<option value="">추체 선택…</option>'
    const list = lastResult ? lastResult.present : []
    for (const v of list) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = v + (review.corners[v] ? ' ✎' : '') + (review.notes[v] ? ' 💬' : '')
      vsel.appendChild(o)
    }
    if (list.includes(cur)) vsel.value = cur
  }

  // Ctrl+Z — 검수 모드일 때 코너 교정 되돌리기 (app.js가 호출)
  window.__spineReviewUndo = () => {
    if (!chkReview.checked || undoStack.length === 0) return false
    review.corners = undoStack.pop()
    pushReviewToCanvas()
    refreshVertebraSelect()
    if (lastResult) renderResults(lastResult)
    markDirty()
    statusEl.textContent = '검수 되돌리기 (남은 단계: ' + undoStack.length + ')'
    return true
  }

  chkAutoRun.addEventListener('change', saveSettings)
  selMethod.addEventListener('change', () => { saveSettings(); run() })
  chkNotes.addEventListener('change', () => { saveSettings(); pushReviewToCanvas() })
  chkOverlay.addEventListener('change', saveSettings)
  chkReview.addEventListener('change', () => {
    saveSettings()
    pushReviewToCanvas()
    statusEl.textContent = chkReview.checked ? '검수 모드: 코너 점을 드래그해 수정하세요.' : ''
  })
  vsel.addEventListener('change', () => { noteV.value = review.notes[vsel.value] || '' })
  noteV.addEventListener('input', () => {
    if (!vsel.value) {
      statusEl.textContent = '⚠ 먼저 위에서 추체를 선택하세요 (메모가 저장되지 않습니다)'
      statusEl.classList.add('ae-warn')
      return
    }
    statusEl.classList.remove('ae-warn')
    if (noteV.value.trim()) review.notes[vsel.value] = noteV.value; else delete review.notes[vsel.value]
    refreshVertebraSelect(); pushReviewToCanvas(); markDirty()
  })
  noteImg.addEventListener('input', () => { review.imageNote = noteImg.value; markDirty() })
  btnResetV.addEventListener('click', () => {
    const v = vsel.value; if (!v) return
    pushUndo()
    delete review.corners[v]
    pushReviewToCanvas(); refreshVertebraSelect()
    if (lastResult) renderResults(lastResult)
    markDirty()
  })

  async function loadReview() {
    const fn = currentFileName(); if (!fn) return
    try {
      const r = await fetch('/api/review/' + encodeURIComponent(fn), { headers: authHeaders() })
      const j = await r.json()
      if (j && j.ok && j.review) {
        review = { corners: j.review.corners || {}, notes: j.review.notes || {}, imageNote: j.review.imageNote || '' }
        noteImg.value = review.imageNote
        markSaved('저장됨 ' + (j.updated_at ? j.updated_at.slice(0, 16).replace('T', ' ') : ''))
      } else {
        review = { corners: {}, notes: {}, imageNote: '' }; noteImg.value = ''; savedEl.textContent = ''
      }
    } catch (e) { console.warn('review load', e) }
    pushReviewToCanvas(); refreshVertebraSelect()
  }

  btnSave.addEventListener('click', async () => {
    const fn = currentFileName()
    if (!fn) { statusEl.textContent = '이미지를 먼저 선택하세요.'; return }
    const payload = {
      review: {
        corners: review.corners, notes: review.notes, imageNote: review.imageNote,
        auto: lastResult ? { angles: lastResult.angles, present: lastResult.present } : null,
        savedAt: new Date().toISOString(),
      },
      reviewer: (window.__spineLabeler || ''),
    }
    try {
      const r = await fetch('/api/review/' + encodeURIComponent(fn), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (j && j.ok) markSaved('저장됨'); else { statusEl.textContent = '저장 실패: ' + (j && j.error || ''); }
    } catch (e) { statusEl.textContent = '저장 실패: ' + (e && e.message || e) }
  })

  btnExport.addEventListener('click', () => {
    const data = {
      file_name: currentFileName(),
      auto: lastResult ? { angles: lastResult.angles, segmental: lastResult.segmental, wedge: lastResult.wedge, corners: lastResult.corners } : null,
      review,
      reviewed_angles: lastResult ? reviewedAngles(lastResult) : null,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = (currentFileName() || 'spine').replace(/\.[^.]+$/, '') + '_review.json'
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  function authHeaders() {
    try { const t = localStorage.getItem('spine-annotator:authToken'); return t ? { 'X-Auth-Token': t } : {} } catch { return {} }
  }

  // 검수본 기준으로 다시 계산한 주요 각도
  function reviewedAngles(result) {
    const get = (label) => review.corners[label] || result.corners[label]
    const SUP = n => { const c = get(n); return c ? [c.SP[0] - c.SA[0], c.SP[1] - c.SA[1]] : null }
    const INF = n => { const c = get(n); return c ? [c.IP[0] - c.IA[0], c.IP[1] - c.IA[1]] : null }
    return {
      LL: cobbAngle(SUP(DEFAULT_RANGES.LL[0]), INF(DEFAULT_RANGES.LL[1])),
      TK: cobbAngle(SUP(DEFAULT_RANGES.TK[0]), INF(DEFAULT_RANGES.TK[1])),
      CL: cobbAngle(INF(DEFAULT_RANGES.CL[0]), INF(DEFAULT_RANGES.CL[1])),
    }
  }

  function run() {
    const polys = (annotator.polygons || []).filter(p => p && p.label && Array.isArray(p.points) && p.points.length >= 8)
    if (polys.length < 2) {
      statusEl.textContent = '라벨된 폴리곤이 2개 이상 필요합니다.'
      return
    }
    let result
    try {
      result = computeSagittal(polys, DEFAULT_RANGES, { method: selMethod.value })
    } catch (e) {
      console.error('[auto-endplate]', e)
      statusEl.textContent = '계산 실패: ' + (e && e.message || e)
      return
    }
    lastResult = result
    statusEl.textContent = `${result.present.length}개 추체 측정됨`
    renderResults(result)
    if (chkOverlay.checked) drawOverlay(result)
    btnCsv.disabled = false
    refreshVertebraSelect()
    if (!vsel.value && result.present.length) { vsel.value = result.present[0]; noteV.value = review.notes[vsel.value] || '' }
    pushReviewToCanvas()
  }

  function drawOverlay(result) {
    const items = result.present.map(label => ({ label, ...result.corners[label] }))
    annotator.drawAutoEndplateOverlay(items)
  }

  function renderResults(result) {
    const A = result.angles
    const main = [
      ['LL (요추전만)', A.LL, `${DEFAULT_RANGES.LL[0]}–${DEFAULT_RANGES.LL[1]}`],
      ['TK (흉추후만)', A.TK, `${DEFAULT_RANGES.TK[0]}–${DEFAULT_RANGES.TK[1]}`],
      ['CL (경추만곡)', A.CL, `${DEFAULT_RANGES.CL[0]}–${DEFAULT_RANGES.CL[1]}`],
      ['T1 slope', A.T1_slope, ''],
    ]
    const fmt = v => (v == null || Number.isNaN(v)) ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '°'
    const hasReview = Object.keys(review.corners).length > 0
    const rv = hasReview ? reviewedAngles(result) : null
    let html = '<table class="ae-table"><tbody>'
    if (hasReview) html += '<tr><td></td><td class="ae-val ae-hdr">자동</td><td class="ae-val ae-hdr ae-rev">검수</td></tr>'
    for (const [name, val, range] of main) {
      const label = `${name}${range ? ` <span class="ae-range">${range}</span>` : ''}`
      if (hasReview) {
        const r = rv[name.startsWith('LL') ? 'LL' : name.startsWith('TK') ? 'TK' : name.startsWith('CL') ? 'CL' : null]
        html += `<tr><td>${label}</td><td class="ae-val">${fmt(val)}</td><td class="ae-val ae-rev">${r == null ? '—' : fmt(r)}</td></tr>`
      } else {
        html += `<tr><td>${label}</td><td class="ae-val">${fmt(val)}</td></tr>`
      }
    }
    html += '</tbody></table>'
    if (hasReview) html += `<div class="ae-hint2">✎ 수정된 추체: ${Object.keys(review.corners).join(', ')}</div>`
    // 품질 요약 (검증 알고리즘 결과)
    if (result.quality) {
      const cnt = { ok: 0, review: 0, fallback: 0 }
      const flagged = []
      for (const k in result.quality) {
        const q = result.quality[k].quality
        cnt[q] = (cnt[q] || 0) + 1
        if (q !== 'ok') flagged.push(`${k}(${q === 'fallback' ? '축보정' : '확인'}: ${result.quality[k].reasons.join(', ')})`)
      }
      html += `<div class="ae-quality">정상 ${cnt.ok} · <span class="q-review">확인필요 ${cnt.review}</span> · <span class="q-fb">축보정 ${cnt.fallback}</span> <span class="ae-range">(${result.method})</span></div>`
      if (flagged.length) html += `<details class="ae-details"><summary>의심 추체 ${flagged.length}</summary><div class="ae-flagged">${flagged.join('<br>')}</div></details>`
    }

    const segKeys = Object.keys(result.segmental)
    const wedgeKeys = Object.keys(result.wedge)
    html += `<details class="ae-details"><summary>분절 각도 (${segKeys.length})</summary><table class="ae-table"><tbody>`
    for (const k of segKeys) html += `<tr><td>${k.replace('_', '–')}</td><td class="ae-val">${fmt(result.segmental[k])}</td></tr>`
    html += '</tbody></table></details>'
    html += `<details class="ae-details"><summary>추체 쐐기각 (${wedgeKeys.length})</summary><table class="ae-table"><tbody>`
    for (const k of wedgeKeys) html += `<tr><td>${k}</td><td class="ae-val">${fmt(result.wedge[k])}</td></tr>`
    html += '</tbody></table></details>'
    body.innerHTML = html
  }

  btnRun.addEventListener('click', run)
  chkOverlay.addEventListener('change', () => {
    if (!lastResult) return
    if (chkOverlay.checked) drawOverlay(lastResult)
    else annotator.clearAutoEndplateOverlay()
  })
  btnCsv.addEventListener('click', () => {
    if (!lastResult) return
    const csv = toCSV(lastResult, { file_name: currentFileName() })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = (currentFileName() || 'spine').replace(/\.[^.]+$/, '')
    a.href = url; a.download = base + '_auto_angles.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  // 이미지 바뀌면 이전 오버레이/결과 정리
  // 라벨 로딩이 끝나면(새 이미지) 전역 설정에 따라 자동 측정 + 검수 모드 유지
  window.addEventListener('spine:labels-loaded', () => { scheduleAutoRun() })

  // 이벤트가 누락되는 경로가 있어도 동작하도록, 폴리곤이 준비될 때까지 잠깐 기다렸다 실행
  let autoRunTimer = null
  function scheduleAutoRun() {
    clearTimeout(autoRunTimer)
    let tries = 0
    const tick = () => {
      tries++
      const polys = (annotator.polygons || []).filter(p => p && p.label && Array.isArray(p.points) && p.points.length >= 8)
      if (polys.length >= 2) {
        loadReview().then(() => {
          if (chkAutoRun.checked) { run(); pushReviewToCanvas() }
        })
        return
      }
      if (tries < 12) autoRunTimer = setTimeout(tick, 250)   // 최대 3초 대기
    }
    autoRunTimer = setTimeout(tick, 120)
  }

  // 이미지가 바뀌면 화면/상태만 초기화 (검수 데이터 로드와 자동측정은
  // 라벨 로딩이 끝나는 'spine:labels-loaded' 시점에 처리한다)
  window.addEventListener('spine:image-loaded', () => {
    annotator.clearAutoEndplateOverlay()
    lastResult = null; btnCsv.disabled = true
    body.innerHTML = ''; statusEl.textContent = ''
    review = { corners: {}, notes: {}, imageNote: '' }
    undoStack.length = 0
    noteV.value = ''; noteImg.value = ''; savedEl.textContent = ''
    refreshVertebraSelect()
    scheduleAutoRun()   // 이미지 전환 후에도 자동 실행 시도
  })

  loadSettings()
  loadReview()
}

function ensurePanel() {
  let mount = document.getElementById('autoEndplateMount')
  if (!mount) {
    mount = document.createElement('div')
    mount.id = 'autoEndplateMount'
    const sb = document.querySelector('#sidebarLeft .sidebar-scroll') || document.getElementById('sidebarLeft') || document.body
    sb.appendChild(mount)
  }
  if (mount.dataset.ready === '1') return mount
  mount.dataset.ready = '1'
  mount.innerHTML =
    '<div class="panel ae-panel">' +
    '  <div class="panel-title"><i class="fas fa-ruler-combined"></i> 폴리곤 자동 측정</div>' +
    '  <div class="ae-controls">' +
    '    <select class="ae-method" title="측정 알고리즘"><option value="v1">v1 4코너</option><option value="v2">v2 종판피팅</option></select>' +
    '    <button type="button" class="ae-run">자동 측정 실행</button>' +
    '    <label class="ae-chk"><input type="checkbox" class="ae-overlay" checked> 종판선 표시</label>' +
    '    <button type="button" class="ae-csv" disabled>CSV</button>' +
    '  </div>' +
    '  <label class="ae-chk ae-auto-run-row"><input type="checkbox" class="ae-autorun"> 이미지 열면 자동 측정 (전역)</label>' +
    '  <label class="ae-chk ae-auto-run-row"><input type="checkbox" class="ae-notes-show" checked> 메모 말풍선 표시</label>' +
    '  <div class="ae-review-box">' +
    '    <label class="ae-chk ae-review-toggle"><input type="checkbox" class="ae-review"> 검수 모드 (코너 드래그)</label>' +
    '    <div class="ae-legend">' +
    '      <span><i style="background:#39d353"></i>자동 상종판</span><span><i style="background:#e3a008"></i>자동 하종판</span>' +
    '      <span><i style="background:#4dabf7"></i>검수 상종판</span><span><i style="background:#845ef7"></i>검수 하종판</span>' +
    '    </div>' +
    '    <div class="ae-vsel-row">' +
    '      <select class="ae-vsel"><option value="">추체 선택…</option></select>' +
    '      <button type="button" class="ae-reset-v" title="이 추체를 자동값으로 되돌리기">되돌리기</button>' +
    '    </div>' +
    '    <textarea class="ae-note-v" rows="2" placeholder="① 위에서 추체 선택 → ② 메모 입력 (예: 상종판 한 칸 위)"></textarea>' +
    '    <textarea class="ae-note-img" rows="2" placeholder="이미지 전체 메모"></textarea>' +
    '    <div class="ae-controls">' +
    '      <button type="button" class="ae-save">검수 저장</button>' +
    '      <button type="button" class="ae-export">JSON</button>' +
    '      <span class="ae-saved"></span>' +
    '    </div>' +
    '  </div>' +
    '  <div class="ae-status"></div>' +
    '  <div class="ae-body"></div>' +
    '</div>'
  return mount
}
