#!/usr/bin/env node

import fs from 'node:fs'
const file = 'public/static/app.js'
const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
let s = before

if (!s.includes('__landmarkYShiftCaptureFinal')) {
  s += `

// Final Y-axis landmark relabel handler.
// This runs before older dropdown listeners and mutates annotator.landmarks directly.
if (!window.__landmarkYShiftCaptureFinal) {
  window.__landmarkYShiftCaptureFinal = true
  document.addEventListener('change', (e) => {
    const sel = e.target?.closest?.('[data-slm-y-shift]')
    if (!sel) return
    const annotator = state?.annotator
    const panel = document.getElementById('standaloneLandmarkListPanel')
    const groups = panel?.__landmarkYGroups || []
    const row = Number(sel.dataset.slmYShift)
    const toTarget = String(sel.value || '').toUpperCase()
    const seq = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
    const start = seq.indexOf(toTarget)
    if (!annotator || !Array.isArray(annotator.landmarks) || row < 0 || start < 0 || row >= groups.length) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const targetOf = (label) => {
      const t = String(label || '').toUpperCase()
      return t === 'HC_LAT' ? 'HC_LAT' : t.split('_')[0]
    }
    const suffixOf = (label) => {
      const t = String(label || '').toUpperCase()
      const base = targetOf(t)
      return base === 'HC_LAT' ? '' : t.slice(base.length + 1)
    }
    const editable = groups.filter(g => seq.includes(g.target))
    const anchor = groups[row]
    const anchorIdx = editable.indexOf(anchor)
    if (anchorIdx < 0) return
    for (let i = anchorIdx; i < editable.length; i++) {
      const next = seq[start + i - anchorIdx]
      if (!next) break
      for (const lm of editable[i].items || []) {
        const suffix = suffixOf(lm.label)
        lm.label = suffix ? next + '_' + suffix : next
        lm.target = next
      }
      editable[i].target = next
    }
    window.__standaloneLmFreezeUntil = Date.now() + 1200
    window.__suppressRemoteLabelPromptUntil = Date.now() + 20000
    annotator.renderLandmarks?.()
    state.landmarkApi?.refresh?.()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
    if (typeof renderStandaloneLandmarkListPanel === 'function') renderStandaloneLandmarkListPanel(true)
  }, true)
}
`
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH final landmark Y shift relabeling')
} else {
  console.log('OK final landmark Y shift relabeling already patched')
}
console.log('OK final landmark Y shift relabeling installed')
