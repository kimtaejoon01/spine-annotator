#!/usr/bin/env node

import fs from 'node:fs'
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const write = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { write(f, b); console.log('PATCH ' + label) } }

function replaceFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
  if (open < 0) return source
  let depth = 0, quote = null, escape = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(i + 1)
    }
  }
  return source
}

const fn = `function renderStandaloneLandmarkListPanel(force = false) {
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

  const esc = (x) => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  if (!annotator || !isLat || !annotator.getLandmarks) {
    const empty = '<h3 class="panel-title"><i class="fas fa-list"></i> LAT landmark 목록</h3><p class="landmark-empty">LAT 파일에서 landmark 목록이 표시됩니다.</p>'
    if (panel.dataset.lmHtml !== empty) { panel.innerHTML = empty; panel.dataset.lmHtml = empty }
    return
  }

  const spineTargets = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
  const allTargets = [...spineTargets, 'HC_LAT']
  const point5 = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT','CENTER']
  const targetOf = (label) => {
    const text = String(label || '').toUpperCase()
    if (text === 'HC_LAT' || text === 'FH_LAT') return 'HC_LAT'
    return text.split('_')[0]
  }
  const suffixOf = (label) => {
    const text = String(label || '').toUpperCase()
    const target = targetOf(text)
    return target === 'HC_LAT' ? 'HC_LAT' : text.slice(target.length + 1)
  }
  const labelsFor = (target) => target === 'HC_LAT'
    ? ['HC_LAT']
    : target === 'S1'
      ? ['S1_SUP_ANT','S1_SUP_POST','S1_CENTER']
      : point5.map(p => target + '_' + p)
  const expectedCount = (target) => labelsFor(target).length
  const options = (selected) => allTargets.map(t => '<option value="' + esc(t) + '"' + (t === selected ? ' selected' : '') + '>' + esc(t) + '</option>').join('')
  const landmarks = annotator.getLandmarks?.() || annotator.landmarks || []

  function splitTargetIntoYGoups(target, items) {
    if (target === 'HC_LAT') {
      return items.map((lm, idx) => ({ target, items: [lm], y: Number(lm.y || 0), key: target + ':' + idx }))
    }
    const counts = new Map()
    for (const lm of items) counts.set(suffixOf(lm.label), (counts.get(suffixOf(lm.label)) || 0) + 1)
    const anchorSuffix = ['CENTER','SUP_ANT','SUP_POST','INF_ANT','INF_POST'].find(s => (counts.get(s) || 0) > 1)
    if (!anchorSuffix) {
      return [{ target, items, y: items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, items.length), key: target + ':0' }]
    }
    const anchors = items.filter(lm => suffixOf(lm.label) === anchorSuffix).sort((a, b) => Number(a.y || 0) - Number(b.y || 0))
    const groups = anchors.map((a, idx) => ({ target, items: [], y: Number(a.y || 0), key: target + ':' + idx }))
    for (const lm of items) {
      let best = 0, bestDist = Infinity
      for (let i = 0; i < anchors.length; i++) {
        const d = Math.abs(Number(lm.y || 0) - Number(anchors[i].y || 0))
        if (d < bestDist) { bestDist = d; best = i }
      }
      groups[best].items.push(lm)
    }
    for (const g of groups) g.y = g.items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, g.items.length)
    return groups
  }

  const byTarget = new Map()
  for (const lm of landmarks) {
    const target = targetOf(lm.label)
    if (!allTargets.includes(target)) continue
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target).push(lm)
  }
  const groups = []
  for (const [target, items] of byTarget.entries()) groups.push(...splitTargetIntoYGoups(target, items))
  groups.sort((a, b) => a.y - b.y)
  panel.__landmarkYGroups = groups

  const active = document.activeElement
  if (!force && panel.contains(active)) return

  const signature = JSON.stringify({
    file: state.filename,
    pending: annotator.pendingLandmark || '',
    groups: groups.map(g => ({ t: g.target, n: g.items.length, y: Math.round(g.y), labels: g.items.map(l => l.label).sort() })),
  })
  if (!force && panel.dataset.lmSignature === signature) return

  const prevList = panel.querySelector('.standalone-lm-list')
  const prevScrollTop = prevList?.scrollTop || 0
  const pendingTarget = targetOf(annotator.pendingLandmark || '') || (groups[0]?.target || 'C2')
  const rows = groups.length ? groups.map((g, idx) => {
    const n = g.items.length
    const exp = expectedCount(g.target)
    const activeRow = g.target === pendingTarget
    return '<div class="standalone-lm-row' + (activeRow ? ' active' : '') + (n ? ' has-points' : '') + '" data-slm-row-idx="' + idx + '">' +
      '<span class="standalone-lm-order">' + (idx + 1) + '</span>' +
      '<select data-slm-y-shift="' + idx + '">' + options(g.target) + '</select>' +
      '<span class="standalone-lm-count">' + n + '/' + exp + '</span>' +
      '<button type="button" data-slm-jump="' + idx + '">찍기</button>' +
      '<button type="button" data-slm-delete="' + idx + '">삭제</button>' +
    '</div>'
  }).join('') : '<p class="landmark-empty">아직 찍힌 landmark가 없습니다.</p>'

  const html = '<h3 class="panel-title"><i class="fas fa-list"></i> LAT landmark 목록</h3>' +
    '<div class="landmark-region-color-note">실제 y축 위치 순서 기준. row dropdown을 바꾸면 그 row부터 아래 landmark가 순서대로 재라벨링됩니다.</div>' +
    '<div class="standalone-lm-current"><span>다음 찍기</span><select data-slm-current>' + options(pendingTarget) + '</select></div>' +
    '<div class="standalone-lm-list">' + rows + '</div>'

  panel.innerHTML = html
  panel.dataset.lmHtml = html
  panel.dataset.lmSignature = signature
  const list = panel.querySelector('.standalone-lm-list')
  if (list) {
    list.scrollTop = prevScrollTop
    list.addEventListener('scroll', () => { window.__standaloneLmFreezeUntil = Date.now() + 2500 }, { passive: true })
  }

  const firstMissing = (target) => {
    const used = new Set((annotator.getLandmarks?.() || annotator.landmarks || []).map(l => l.label))
    const labels = labelsFor(target)
    return labels.find(label => !used.has(label)) || labels[0]
  }
  const setPending = (label) => {
    if (!label) return
    annotator.setPendingLandmark?.(label)
    renderStandaloneLandmarkListPanel(true)
  }
  const relabelFromYIndex = (anchorIdx, toTarget) => {
    const freshGroups = panel.__landmarkYGroups || groups
    const startIdx = spineTargets.indexOf(String(toTarget || '').toUpperCase())
    if (!Number.isFinite(anchorIdx) || anchorIdx < 0 || anchorIdx >= freshGroups.length || startIdx < 0) return
    const editableGroups = freshGroups.filter(g => spineTargets.includes(g.target))
    const anchorGroup = freshGroups[anchorIdx]
    const editableAnchorIdx = editableGroups.indexOf(anchorGroup)
    if (editableAnchorIdx < 0) return

    for (let i = editableAnchorIdx; i < editableGroups.length; i++) {
      const nextTarget = spineTargets[startIdx + (i - editableAnchorIdx)]
      if (!nextTarget) break
      for (const lm of editableGroups[i].items) {
        const oldTarget = targetOf(lm.label)
        const suffix = suffixOf(lm.label)
        lm.label = suffix ? nextTarget + '_' + suffix : nextTarget
        lm.target = nextTarget
      }
      editableGroups[i].target = nextTarget
    }

    const pending = annotator.pendingLandmark || ''
    const pendingTargetNow = targetOf(pending)
    const suffix = suffixOf(pending)
    const pendingGroup = editableGroups.find(g => g.items.some(lm => targetOf(lm.label) === pendingTargetNow))
    if (pendingGroup && suffix) annotator.pendingLandmark = pendingGroup.target + '_' + suffix

    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
    renderStandaloneLandmarkListPanel(true)
  }

  panel.querySelector('[data-slm-current]')?.addEventListener('change', e => setPending(firstMissing(e.target.value)))
  panel.querySelectorAll('[data-slm-jump]').forEach(btn => btn.addEventListener('click', () => {
    const g = groups[Number(btn.dataset.slmJump)]
    if (g) setPending(firstMissing(g.target))
  }))
  panel.querySelectorAll('[data-slm-delete]').forEach(btn => btn.addEventListener('click', () => {
    const g = groups[Number(btn.dataset.slmDelete)]
    if (!g) return
    const kill = new Set(g.items)
    annotator.landmarks = (annotator.landmarks || []).filter(l => !kill.has(l))
    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
    renderStandaloneLandmarkListPanel(true)
  }))
  panel.querySelectorAll('[data-slm-y-shift]').forEach(sel => {
    sel.addEventListener('pointerdown', () => { window.__standaloneLmFreezeUntil = Date.now() + 15000 })
    sel.addEventListener('focus', () => { window.__standaloneLmFreezeUntil = Date.now() + 15000 })
    sel.addEventListener('change', e => relabelFromYIndex(Number(e.target.dataset.slmYShift), e.target.value))
  })
}`

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  s = replaceFunction(s, 'renderStandaloneLandmarkListPanel', fn)
  if (!s.includes('.standalone-lm-order')) {
    // styles are appended in style.css below; no-op marker for app.js
  }
  save(file, before, s, 'Y-sorted stable standalone landmark list')
}

{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  if (!s.includes('.standalone-lm-order')) {
    s += `

/* Y-sorted landmark list row order */
.standalone-lm-order { font-size: 10px; color: var(--text-muted); width: 18px; text-align: right; font-variant-numeric: tabular-nums; }
.standalone-lm-row { grid-template-columns: 18px minmax(60px, 1fr) auto auto auto; }
`
  }
  save(file, before, s, 'Y-sorted landmark list styles')
}

console.log('OK Y-sorted stable landmark list installed')
