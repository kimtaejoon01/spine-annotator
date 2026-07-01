#!/usr/bin/env node

import fs from 'node:fs'
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const write = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { write(f, b); console.log('PATCH ' + label) } }

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  if (!s.includes('ensureLandmarkListV2(el, current)')) {
    const anchor = `    el.querySelector('[data-lm-clear]')?.addEventListener('click', () => {
      if (confirm('현재 파일의 landmark를 모두 삭제할까요? polygon 라벨은 유지됩니다.')) annotator.clearLandmarks()
    })`
    if (s.includes(anchor)) {
      s = s.replace(anchor, anchor + `
    ensureLandmarkListV2(el, current)`)
    }
  }

  if (!s.includes('function ensureLandmarkListV2')) {
    const helper = `
  function targetLabelsV2(target) {
    if (target === 'HC_LAT') return ['HC_LAT']
    if (target === 'S1') return ['S1_SUP_ANT', 'S1_SUP_POST', 'S1_CENTER']
    return POINTS_5.map(p => target + '_' + p)
  }

  function targetOptionsV2(selected) {
    return [...VERTEBRAE_FULL, 'S1', 'HC_LAT'].map(t => '<option value="' + escapeHtml(t) + '"' + (t === selected ? ' selected' : '') + '>' + escapeHtml(t) + '</option>').join('')
  }

  function firstMissingForTargetV2(target) {
    const done = new Set((annotator.landmarks || []).map(l => l.label))
    const labels = targetLabelsV2(target)
    return labels.find(label => !done.has(label)) || labels[0]
  }

  function ensureLandmarkListV2(el, current) {
    const activeTarget = landmarkTarget(annotator.pendingLandmark || current)
    let holder = el.querySelector('[data-lm-list-v2-wrap]')
    if (!holder) {
      holder = document.createElement('div')
      holder.dataset.lmListV2Wrap = '1'
      const currentBox = el.querySelector('.landmark-current')
      if (currentBox) currentBox.insertAdjacentElement('afterend', holder)
      else el.appendChild(holder)
    }
    const done = new Set((annotator.landmarks || []).map(l => l.label))
    const targets = [...VERTEBRAE_FULL, 'S1', 'HC_LAT']
    holder.innerHTML = '<div class="landmark-current-select"><span>현재 vertebra</span><select data-lm-v2-current>' + targetOptionsV2(activeTarget) + '</select></div>' +
      '<div class="landmark-list" data-lm-v2-list>' + targets.map(target => {
        const labels = targetLabelsV2(target)
        const n = labels.filter(label => done.has(label)).length
        const active = target === activeTarget
        const cls = 'landmark-list-item' + (active ? ' active' : '') + (n ? ' has-points' : '')
        return '<div class="' + cls + '">' +
          '<div class="landmark-list-main"><span class="landmark-list-dot"></span><select data-lm-v2-shift="' + escapeHtml(target) + '">' + targetOptionsV2(target) + '</select><span class="landmark-list-count">' + n + '/' + labels.length + '</span></div>' +
          '<div class="landmark-list-actions"><button type="button" data-lm-v2-jump="' + escapeHtml(target) + '">찍기</button><button type="button" data-lm-v2-delete="' + escapeHtml(target) + '">삭제</button></div>' +
        '</div>'
      }).join('') + '</div>'

    holder.querySelector('[data-lm-v2-current]')?.addEventListener('change', e => {
      const label = firstMissingForTargetV2(e.target.value)
      const idx = LAT_5POINT_SEQUENCE.indexOf(label)
      if (idx >= 0) sequenceIndex = idx
      annotator.setPendingLandmark(label)
    })
    holder.querySelectorAll('[data-lm-v2-jump]').forEach(btn => btn.addEventListener('click', () => {
      const label = firstMissingForTargetV2(btn.dataset.lmV2Jump)
      const idx = LAT_5POINT_SEQUENCE.indexOf(label)
      if (idx >= 0) sequenceIndex = idx
      annotator.setPendingLandmark(label)
    }))
    holder.querySelectorAll('[data-lm-v2-delete]').forEach(btn => btn.addEventListener('click', () => {
      const set = new Set(targetLabelsV2(btn.dataset.lmV2Delete))
      annotator.landmarks = (annotator.landmarks || []).filter(l => !set.has(l.label))
      sequenceIndex = findNextMissingIndex(annotator.landmarks, 0)
      annotator.setPendingLandmark(LAT_5POINT_SEQUENCE[sequenceIndex] || null)
      annotator.renderLandmarks()
      renderPanel()
      onChange?.()
    }))
    holder.querySelectorAll('[data-lm-v2-shift]').forEach(sel => sel.addEventListener('change', e => shiftTargetV2(e.target.dataset.lmV2Shift, e.target.value)))
  }

  function shiftTargetV2(fromTarget, toTarget) {
    fromTarget = String(fromTarget || '').toUpperCase()
    toTarget = String(toTarget || '').toUpperCase()
    if (!fromTarget || !toTarget || fromTarget === toTarget) return
    const fromIdx = VERTEBRAE_FULL.indexOf(fromTarget)
    const toIdx = VERTEBRAE_FULL.indexOf(toTarget)
    if (fromIdx < 0 || toIdx < 0) return
    const delta = toIdx - fromIdx
    if (!delta) return
    const items = [...(annotator.landmarks || [])].sort((a, b) => {
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
    const pt = landmarkTarget(pending)
    const pi = VERTEBRAE_FULL.indexOf(pt)
    if (pi >= fromIdx) {
      const nt = VERTEBRAE_FULL[pi + delta]
      if (nt) {
        const suffix = String(pending || '').slice(pt.length + 1)
        const nl = nt + '_' + suffix
        const ni = LAT_5POINT_SEQUENCE.indexOf(nl)
        if (ni >= 0) sequenceIndex = ni
        annotator.pendingLandmark = nl
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

  save(file, before, s, 'hard landmark list v2')
}

{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  if (!s.includes('data-lm-list-v2-wrap')) {
    s += `

/* LAT landmark list v2 */
[data-lm-list-v2-wrap] { margin: 6px 0; }
.landmark-current-select { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 6px; margin: 6px 0; font-size: 11px; color: var(--text-muted); }
.landmark-current-select select, .landmark-list select { min-width: 0; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-tertiary); color: var(--text-primary); font-size: 12px; padding: 4px 6px; }
.landmark-list { display: grid; gap: 4px; max-height: 280px; overflow: auto; margin: 7px 0; padding-right: 2px; }
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
  save(file, before, s, 'hard landmark list v2 styles')
}

console.log('OK hard landmark list v2 installed')
