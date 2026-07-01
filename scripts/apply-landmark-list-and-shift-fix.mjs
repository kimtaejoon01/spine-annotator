#!/usr/bin/env node

import fs from 'node:fs'
const r = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const w = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { w(f, b); console.log('PATCH ' + label) } }

{
  const f = 'public/static/landmark-tools.js'
  const before = r(f)
  let s = before

  const marker = '      <div class="landmark-actions">'
  if (!s.includes('data-lm-current-target') && s.includes(marker)) {
    const insert = [
      '      <div class="landmark-current-select">',
      '        <span>현재 vertebra</span>',
      '        <select data-lm-current-target>${landmarkTargetOptions(landmarkTarget(annotator.pendingLandmark || current))}</select>',
      '      </div>',
      '      <div class="landmark-list" data-lm-list></div>',
      marker,
    ].join('\n')
    s = s.replace(marker, insert)
  }

  const clearBlock = `    el.querySelector('[data-lm-clear]')?.addEventListener('click', () => {
      if (confirm('현재 파일의 landmark를 모두 삭제할까요? polygon 라벨은 유지됩니다.')) annotator.clearLandmarks()
    })`
  if (!s.includes('bindLandmarkListControls(el, current)') && s.includes(clearBlock)) {
    s = s.replace(clearBlock, clearBlock + `
    const currentTargetSelect = el.querySelector('[data-lm-current-target]')
    currentTargetSelect?.addEventListener('change', (e) => {
      shiftLandmarkTarget(landmarkTarget(annotator.pendingLandmark || current), e.target.value)
    })
    renderLandmarkList(el, current)
    bindLandmarkListControls(el, current)`)
  }

  if (!s.includes('function renderLandmarkList(el, current)')) {
    const helper = `
  function targetLabels(target) {
    if (target === 'HC_LAT') return ['HC_LAT']
    if (target === 'S1') return ['S1_SUP_ANT', 'S1_SUP_POST', 'S1_CENTER']
    return POINTS_5.map(p => target + '_' + p)
  }

  function landmarkTargetOptions(selected) {
    const targets = [...VERTEBRAE_FULL, 'S1', 'HC_LAT']
    return targets.map(t => '<option value="' + escapeHtml(t) + '"' + (t === selected ? ' selected' : '') + '>' + escapeHtml(t) + '</option>').join('')
  }

  function firstMissingLabelForTarget(target) {
    const existing = new Set((annotator.landmarks || []).map(l => l.label))
    const labels = targetLabels(target)
    return labels.find(label => !existing.has(label)) || labels[0]
  }

  function renderLandmarkList(el, current) {
    const list = el.querySelector('[data-lm-list]')
    if (!list) return
    const activeTarget = landmarkTarget(annotator.pendingLandmark || current)
    const existing = new Set((annotator.landmarks || []).map(l => l.label))
    const targets = [...VERTEBRAE_FULL, 'S1', 'HC_LAT']
    list.innerHTML = targets.map(target => {
      const labels = targetLabels(target)
      const done = labels.filter(label => existing.has(label)).length
      const active = target === activeTarget
      const cls = 'landmark-list-item' + (active ? ' active' : '') + (done > 0 ? ' has-points' : '')
      return '<div class="' + cls + '" data-lm-target-row="' + escapeHtml(target) + '">' +
        '<div class="landmark-list-main">' +
          '<span class="landmark-list-dot"></span>' +
          '<select data-lm-row-target data-old-target="' + escapeHtml(target) + '">' + landmarkTargetOptions(target) + '</select>' +
          '<span class="landmark-list-count">' + done + '/' + labels.length + '</span>' +
        '</div>' +
        '<div class="landmark-list-actions">' +
          '<button type="button" data-lm-jump="' + escapeHtml(target) + '">찍기</button>' +
          '<button type="button" data-lm-delete-target="' + escapeHtml(target) + '">삭제</button>' +
        '</div>' +
      '</div>'
    }).join('')
  }

  function bindLandmarkListControls(el, current) {
    el.querySelectorAll('[data-lm-row-target]').forEach(select => {
      select.addEventListener('change', (e) => shiftLandmarkTarget(e.target.dataset.oldTarget, e.target.value))
    })
    el.querySelectorAll('[data-lm-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const label = firstMissingLabelForTarget(btn.dataset.lmJump)
        const idx = LAT_5POINT_SEQUENCE.indexOf(label)
        if (idx >= 0) sequenceIndex = idx
        annotator.setPendingLandmark(label)
      })
    })
    el.querySelectorAll('[data-lm-delete-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const labels = new Set(targetLabels(btn.dataset.lmDeleteTarget))
        annotator.landmarks = (annotator.landmarks || []).filter(l => !labels.has(l.label))
        sequenceIndex = findNextMissingIndex(annotator.landmarks, 0)
        annotator.setPendingLandmark(LAT_5POINT_SEQUENCE[sequenceIndex] || null)
        annotator.renderLandmarks()
        renderPanel()
        onChange?.()
      })
    })
  }

  function shiftLandmarkTarget(fromTarget, toTarget) {
    fromTarget = String(fromTarget || '').toUpperCase()
    toTarget = String(toTarget || '').toUpperCase()
    if (!fromTarget || !toTarget || fromTarget === toTarget) return
    const fromIdx = VERTEBRAE_FULL.indexOf(fromTarget)
    const toIdx = VERTEBRAE_FULL.indexOf(toTarget)
    if (fromIdx < 0 || toIdx < 0) return
    const delta = toIdx - fromIdx
    if (!delta) return
    const items = [...(annotator.landmarks || [])]
    items.sort((a, b) => {
      const ai = VERTEBRAE_FULL.indexOf(landmarkTarget(a.label))
      const bi = VERTEBRAE_FULL.indexOf(landmarkTarget(b.label))
      return delta > 0 ? bi - ai : ai - bi
    })
    for (const lm of items) {
      const target = landmarkTarget(lm.label)
      const idx = VERTEBRAE_FULL.indexOf(target)
      if (idx < fromIdx) continue
      const next = VERTEBRAE_FULL[idx + delta]
      if (!next) continue
      lm.label = lm.label.replace(target + '_', next + '_')
      lm.target = next
    }
    const pending = annotator.pendingLandmark || LAT_5POINT_SEQUENCE[sequenceIndex]
    const pendingTarget = landmarkTarget(pending)
    const pendingIdx = VERTEBRAE_FULL.indexOf(pendingTarget)
    if (pendingIdx >= fromIdx) {
      const nextTarget = VERTEBRAE_FULL[pendingIdx + delta]
      if (nextTarget) {
        const suffix = String(pending || '').slice(pendingTarget.length + 1)
        const nextLabel = nextTarget + '_' + suffix
        const nextIndex = LAT_5POINT_SEQUENCE.indexOf(nextLabel)
        if (nextIndex >= 0) sequenceIndex = nextIndex
        annotator.pendingLandmark = nextLabel
      }
    }
    annotator.renderLandmarks()
    renderPanel()
    window.__refreshSagittalMeasurements?.()
    onChange?.()
  }
`
    s = s.replace('  const api = { refresh: renderPanel }', helper + '\n  const api = { refresh: renderPanel }')
  }

  if (!s.includes('if (this.panMode) return originalOnMouseDown(e)')) {
    s = s.replace('annotator.onMouseDown = function patchedLandmarkMouseDown(e) {\n    if (this.pendingLandmark', 'annotator.onMouseDown = function patchedLandmarkMouseDown(e) {\n    if (this.panMode) return originalOnMouseDown(e)\n    if (this.pendingLandmark')
  }

  save(f, before, s, 'landmark list and shift controls')
}

{
  const f = 'public/static/style.css'
  const before = r(f)
  let s = before
  if (!s.includes('landmark-list-item')) {
    s += `

/* LAT landmark list */
.landmark-current-select { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 6px; margin: 6px 0; font-size: 11px; color: var(--text-muted); }
.landmark-current-select select, .landmark-list select { min-width: 0; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-tertiary); color: var(--text-primary); font-size: 12px; padding: 4px 6px; }
.landmark-list { display: grid; gap: 4px; max-height: 260px; overflow: auto; margin: 7px 0; padding-right: 2px; }
.landmark-list-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; padding: 5px 6px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-tertiary); opacity: .72; }
.landmark-list-item.has-points { opacity: 1; }
.landmark-list-item.active { border-color: var(--accent-blue); box-shadow: 0 0 0 1px rgba(88,166,255,.25) inset; }
.landmark-list-main { display: grid; grid-template-columns: 10px minmax(54px, 1fr) auto; align-items: center; gap: 5px; min-width: 0; }
.landmark-list-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent-blue); opacity: .85; }
.landmark-list-count { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.landmark-list-actions { display: flex; gap: 4px; }
.landmark-list-actions button { border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); font-size: 10px; padding: 4px 5px; }
.landmark-list-actions button:hover { border-color: var(--accent-blue); }
`
  }
  save(f, before, s, 'landmark list styles')
}

console.log('OK landmark list and shift controls installed')
