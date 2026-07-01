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

const renderFn = `function renderStandaloneLandmarkListPanel(force = false) {
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

  const esc = x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  if (!annotator || !isLat) {
    const empty = '<h3 class="panel-title"><i class="fas fa-list"></i> LAT landmark 목록</h3><p class="landmark-empty">LAT 파일에서 landmark 목록이 표시됩니다.</p>'
    if (panel.dataset.lmHtml !== empty) { panel.innerHTML = empty; panel.dataset.lmHtml = empty }
    return
  }

  const spineTargets = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
  const allTargets = [...spineTargets, 'HC_LAT']
  const point5 = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT','CENTER']
  const targetOf = label => {
    const text = String(label || '').toUpperCase()
    if (text === 'HC_LAT' || text === 'FH_LAT') return 'HC_LAT'
    return text.split('_')[0]
  }
  const suffixOf = label => {
    const text = String(label || '').toUpperCase()
    const target = targetOf(text)
    return target === 'HC_LAT' ? 'HC_LAT' : text.slice(target.length + 1)
  }
  const labelsFor = target => target === 'HC_LAT'
    ? ['HC_LAT']
    : target === 'S1'
      ? ['S1_SUP_ANT','S1_SUP_POST','S1_CENTER']
      : point5.map(p => target + '_' + p)
  const expectedCount = target => labelsFor(target).length
  const options = selected => allTargets.map(t => '<option value="' + esc(t) + '"' + (t === selected ? ' selected' : '') + '>' + esc(t) + '</option>').join('')

  // Use the actual mutable array. getLandmarks() returns copies in some rewrites,
  // so relabeling those copies never updates saved landmark labels.
  const landmarks = Array.isArray(annotator.landmarks) ? annotator.landmarks : (annotator.getLandmarks?.() || [])

  function splitTargetIntoYGroups(target, items) {
    if (target === 'HC_LAT') return items.map((lm, idx) => ({ target, items: [lm], y: Number(lm.y || 0), key: target + ':' + idx }))
    const counts = new Map()
    for (const lm of items) counts.set(suffixOf(lm.label), (counts.get(suffixOf(lm.label)) || 0) + 1)
    const anchorSuffix = ['CENTER','SUP_ANT','SUP_POST','INF_ANT','INF_POST'].find(s => (counts.get(s) || 0) > 1)
    if (!anchorSuffix) return [{ target, items, y: items.reduce((sum, lm) => sum + Number(lm.y || 0), 0) / Math.max(1, items.length), key: target + ':0' }]
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
  for (const [target, items] of byTarget.entries()) groups.push(...splitTargetIntoYGroups(target, items))
  groups.sort((a, b) => a.y - b.y)
  panel.__landmarkYGroups = groups

  const active = document.activeElement
  const freeze = Date.now() < (window.__standaloneLmFreezeUntil || 0)
  if (!force && (freeze || panel.matches(':hover') || panel.contains(active))) return

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
    return '<div class="standalone-lm-row' + (g.target === pendingTarget ? ' active' : '') + (n ? ' has-points' : '') + '" data-slm-row-idx="' + idx + '">' +
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
    list.addEventListener('scroll', () => { window.__standaloneLmFreezeUntil = Date.now() + 12000 }, { passive: true })
  }

  const firstMissing = target => {
    const used = new Set((Array.isArray(annotator.landmarks) ? annotator.landmarks : []).map(l => l.label))
    const labels = labelsFor(target)
    return labels.find(label => !used.has(label)) || labels[0]
  }
  const setPending = label => {
    if (!label) return
    window.__standaloneLmFreezeUntil = Date.now() + 800
    annotator.setPendingLandmark?.(label)
    renderStandaloneLandmarkListPanel(true)
  }
  const relabelFromYIndex = (anchorIdx, toTarget) => {
    window.__standaloneLmFreezeUntil = Date.now() + 800
    window.__suppressRemoteLabelPromptUntil = Date.now() + 20000
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
    window.__suppressRemoteLabelPromptUntil = Date.now() + 20000
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
  s = replaceFunction(s, 'renderStandaloneLandmarkListPanel', renderFn)

  if (s.includes('function handleRemoteUpdate(filename, remoteName, polygonCount) {\n  if (!state.annotator) return') && !s.includes('__suppressRemoteLabelPromptUntil')) {
    s = s.replace(
      'function handleRemoteUpdate(filename, remoteName, polygonCount) {\n  if (!state.annotator) return',
      'function handleRemoteUpdate(filename, remoteName, polygonCount) {\n  if (!state.annotator) return\n  if (Date.now() < (window.__suppressRemoteLabelPromptUntil || 0)) return'
    )
  } else if (s.includes('function handleRemoteUpdate(filename, remoteName, polygonCount) {\n  if (!state.annotator) return') && s.includes('__suppressRemoteLabelPromptUntil')) {
    // already guarded
  }

  if (!s.includes('__standaloneLandmarkListStableTimerV2')) {
    s += `

// Replace older auto-refresh timer with a stable one that does not redraw while the list is hovered, focused, or scrolling.
if (window.__standaloneLandmarkListTimer) {
  clearInterval(window.__standaloneLandmarkListTimer)
  window.__standaloneLandmarkListTimer = null
}
if (!window.__standaloneLandmarkListStableTimerV2) {
  window.__standaloneLandmarkListStableTimerV2 = setInterval(() => {
    try {
      const panel = document.getElementById('standaloneLandmarkListPanel')
      if (panel && (panel.matches(':hover') || panel.contains(document.activeElement) || Date.now() < (window.__standaloneLmFreezeUntil || 0))) return
      renderStandaloneLandmarkListPanel(false)
    } catch (err) { console.warn('[LandmarkList] stable render failed', err) }
  }, 2500)
}
`
  }

  save(file, before, s, 'actual landmark data Y relabel and quiet sync prompt')
}

console.log('OK actual landmark data Y relabel and quiet sync prompt installed')
