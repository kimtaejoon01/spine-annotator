#!/usr/bin/env node

import fs from 'node:fs'
const r = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const w = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { w(f, b); console.log('PATCH ' + label) } }

{
  const f = 'public/static/app.js'
  const before = r(f)
  let s = before
  if (!s.includes('function renderStandaloneLandmarkListPanel')) {
    s += `

// Standalone LAT landmark list panel. This intentionally lives in app.js so it
// does not depend on landmark-tools.js panel internals.
function renderStandaloneLandmarkListPanel() {
  const annotator = state.annotator
  const isLat = String(state.viewType || '').toUpperCase() === 'LAT'
  const sidebar = document.getElementById('sidebarRight')
  const scroll = sidebar?.querySelector('.sidebar-scroll') || sidebar
  if (!scroll) return
  let panel = document.getElementById('standaloneLandmarkListPanel')
  if (!panel) {
    panel = document.createElement('div')
    panel.id = 'standaloneLandmarkListPanel'
    panel.className = 'panel standalone-landmark-list-panel'
    const lmPanel = document.getElementById('latLandmarkPanel')
    if (lmPanel?.parentNode) lmPanel.insertAdjacentElement('afterend', panel)
    else scroll.appendChild(panel)
  }
  if (!annotator || !isLat || !annotator.getLandmarks) {
    panel.innerHTML = '<h3 class="panel-title"><i class="fas fa-list"></i> LAT landmark 목록</h3><p class="landmark-empty">LAT 파일에서 landmark 목록이 표시됩니다.</p>'
    return
  }

  const vertebrae = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5']
  const allTargets = [...vertebrae, 'S1', 'HC_LAT']
  const point5 = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT','CENTER']
  const labelsFor = (target) => target === 'HC_LAT' ? ['HC_LAT'] : target === 'S1' ? ['S1_SUP_ANT','S1_SUP_POST','S1_CENTER'] : point5.map(p => target + '_' + p)
  const esc = (x) => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const targetOf = (label) => String(label || '').toUpperCase() === 'HC_LAT' ? 'HC_LAT' : String(label || '').toUpperCase().split('_')[0]
  const options = (selected) => allTargets.map(t => '<option value="' + esc(t) + '"' + (t === selected ? ' selected' : '') + '>' + esc(t) + '</option>').join('')
  const landmarks = annotator.getLandmarks?.() || []
  const done = new Set(landmarks.map(l => l.label))
  const activeTarget = targetOf(annotator.pendingLandmark || '') || 'C2'

  panel.innerHTML = '<h3 class="panel-title"><i class="fas fa-list"></i> LAT landmark 목록</h3>' +
    '<div class="standalone-lm-current"><span>현재 vertebra</span><select data-slm-current>' + options(activeTarget) + '</select></div>' +
    '<div class="standalone-lm-list">' + allTargets.map(target => {
      const labels = labelsFor(target)
      const n = labels.filter(label => done.has(label)).length
      const active = target === activeTarget
      return '<div class="standalone-lm-row' + (active ? ' active' : '') + (n ? ' has-points' : '') + '">' +
        '<select data-slm-shift="' + esc(target) + '">' + options(target) + '</select>' +
        '<span class="standalone-lm-count">' + n + '/' + labels.length + '</span>' +
        '<button type="button" data-slm-jump="' + esc(target) + '">찍기</button>' +
        '<button type="button" data-slm-delete="' + esc(target) + '">삭제</button>' +
      '</div>'
    }).join('') + '</div>'

  const firstMissing = (target) => {
    const labels = labelsFor(target)
    return labels.find(label => !done.has(label)) || labels[0]
  }
  const setPending = (label) => {
    if (!label) return
    annotator.setPendingLandmark?.(label)
    renderStandaloneLandmarkListPanel()
  }
  const relabelShift = (fromTarget, toTarget) => {
    fromTarget = String(fromTarget || '').toUpperCase()
    toTarget = String(toTarget || '').toUpperCase()
    const fromIdx = vertebrae.indexOf(fromTarget)
    const toIdx = vertebrae.indexOf(toTarget)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return
    const delta = toIdx - fromIdx
    const items = annotator.landmarks || []
    const ordered = [...items].sort((a, b) => {
      const ai = vertebrae.indexOf(targetOf(a.label))
      const bi = vertebrae.indexOf(targetOf(b.label))
      return delta > 0 ? bi - ai : ai - bi
    })
    for (const lm of ordered) {
      const t = targetOf(lm.label)
      const idx = vertebrae.indexOf(t)
      if (idx < fromIdx) continue
      const next = vertebrae[idx + delta]
      if (!next) continue
      lm.label = String(lm.label).replace(t + '_', next + '_')
      lm.target = next
    }
    const pending = annotator.pendingLandmark || ''
    const pt = targetOf(pending)
    const pi = vertebrae.indexOf(pt)
    if (pi >= fromIdx) {
      const nt = vertebrae[pi + delta]
      if (nt) annotator.pendingLandmark = String(pending).replace(pt + '_', nt + '_')
    }
    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    if (typeof refreshSagittalMeasurements === 'function') refreshSagittalMeasurements()
    if (typeof autoSave === 'function') autoSave()
    renderStandaloneLandmarkListPanel()
  }

  panel.querySelector('[data-slm-current]')?.addEventListener('change', e => setPending(firstMissing(e.target.value)))
  panel.querySelectorAll('[data-slm-jump]').forEach(btn => btn.addEventListener('click', () => setPending(firstMissing(btn.dataset.slmJump))))
  panel.querySelectorAll('[data-slm-delete]').forEach(btn => btn.addEventListener('click', () => {
    const kill = new Set(labelsFor(btn.dataset.slmDelete))
    annotator.landmarks = (annotator.landmarks || []).filter(l => !kill.has(l.label))
    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    if (typeof refreshSagittalMeasurements === 'function') refreshSagittalMeasurements()
    if (typeof autoSave === 'function') autoSave()
    renderStandaloneLandmarkListPanel()
  }))
  panel.querySelectorAll('[data-slm-shift]').forEach(sel => sel.addEventListener('change', e => relabelShift(e.target.dataset.slmShift, e.target.value)))
}

if (!window.__standaloneLandmarkListTimer) {
  window.__standaloneLandmarkListTimer = setInterval(() => {
    try { renderStandaloneLandmarkListPanel() } catch (err) { console.warn('[LandmarkList] render failed', err) }
  }, 800)
}
`
  }
  save(f, before, s, 'standalone app landmark list panel')
}

{
  const f = 'public/static/style.css'
  const before = r(f)
  let s = before
  if (!s.includes('standalone-landmark-list-panel')) {
    s += `

/* Standalone LAT landmark list panel */
.standalone-landmark-list-panel { margin-top: 8px; }
.standalone-lm-current { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 6px; margin: 6px 0; font-size: 11px; color: var(--text-muted); }
.standalone-lm-current select, .standalone-lm-row select { min-width: 0; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-tertiary); color: var(--text-primary); font-size: 12px; padding: 4px 6px; }
.standalone-lm-list { display: grid; gap: 4px; max-height: 310px; overflow: auto; padding-right: 2px; }
.standalone-lm-row { display: grid; grid-template-columns: minmax(60px, 1fr) auto auto auto; align-items: center; gap: 4px; padding: 5px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-tertiary); opacity: .74; }
.standalone-lm-row.has-points { opacity: 1; }
.standalone-lm-row.active { border-color: var(--accent-blue); box-shadow: 0 0 0 1px rgba(88,166,255,.25) inset; }
.standalone-lm-count { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.standalone-lm-row button { border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); font-size: 10px; padding: 4px 5px; }
.standalone-lm-row button:hover { border-color: var(--accent-blue); }
`
  }
  save(f, before, s, 'standalone landmark list styles')
}

console.log('OK standalone landmark list panel installed')
