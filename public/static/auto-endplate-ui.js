/* ================================================================
   폴리곤 자동 측정 UI
   - "자동 측정" 버튼 → 폴리곤에서 종판/각도 계산 + 오버레이 + 결과표 + CSV
   - 랜드마크 불필요. 랜드마크 기반 측정 패널과는 독립.
   ================================================================ */

import { computeSagittalFromPolygons, toCSV, DEFAULT_RANGES } from './auto-endplate.js'

function currentFileName() {
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

  function run() {
    const polys = (annotator.polygons || []).filter(p => p && p.label && Array.isArray(p.points) && p.points.length >= 8)
    if (polys.length < 2) {
      statusEl.textContent = '라벨된 폴리곤이 2개 이상 필요합니다.'
      return
    }
    let result
    try {
      result = computeSagittalFromPolygons(polys, DEFAULT_RANGES)
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
    let html = '<table class="ae-table"><tbody>'
    for (const [name, val, range] of main) {
      html += `<tr><td>${name}${range ? ` <span class="ae-range">${range}</span>` : ''}</td><td class="ae-val">${fmt(val)}</td></tr>`
    }
    html += '</tbody></table>'

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
  window.addEventListener('spine:image-loaded', () => {
    annotator.clearAutoEndplateOverlay()
    lastResult = null; btnCsv.disabled = true
    body.innerHTML = ''; statusEl.textContent = ''
  })
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
    '    <button type="button" class="ae-run">자동 측정 실행</button>' +
    '    <label class="ae-chk"><input type="checkbox" class="ae-overlay" checked> 종판선 표시</label>' +
    '    <button type="button" class="ae-csv" disabled>CSV</button>' +
    '  </div>' +
    '  <div class="ae-status"></div>' +
    '  <div class="ae-body"></div>' +
    '</div>'
  return mount
}
