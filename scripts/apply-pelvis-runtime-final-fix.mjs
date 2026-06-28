#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

const helper = `
// ================================================================
// Final pelvis label runtime guard
// ================================================================
const PELVIS_EXTRA_LABELS_FINAL = ['FH_L', 'FH_R', 'HC_L', 'HC_R', 'FH_LAT', 'HC_LAT']
const PELVIS_POINT_LABELS_FINAL = ['HC_L', 'HC_R', 'HC_LAT']

function isFinalPelvisLabel(label) {
  return PELVIS_EXTRA_LABELS_FINAL.includes(label)
}

function clearPelvisLabelActiveButtonsFinal() {
  document.querySelectorAll('.pelvis-label-btn.active').forEach(btn => btn.classList.remove('active'))
}

function makePelvisPanelCollapsibleFinal() {
  const panel = document.getElementById('pelvisLabelPanel')
  if (!panel || panel.dataset.finalCollapsibleReady === '1') return
  panel.dataset.finalCollapsibleReady = '1'

  const title = panel.querySelector(':scope > .panel-title') || panel.querySelector('.panel-title')
  if (!title) return

  let body = panel.querySelector(':scope > .panel-body')
  if (!body) {
    body = document.createElement('div')
    body.className = 'panel-body pelvis-label-body'
    ;[...panel.children].forEach(child => {
      if (child !== title) body.appendChild(child)
    })
    panel.appendChild(body)
  }

  if (!title.querySelector('.panel-collapse-toggle')) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'panel-collapse-toggle'
    btn.title = '섹션 접기/펼치기'
    btn.innerHTML = '<i class="fas fa-chevron-up"></i>'
    title.appendChild(btn)
  }

  const applyCollapsed = (value) => {
    panel.classList.toggle('panel-collapsed', !!value)
    const icon = title.querySelector('.panel-collapse-toggle i')
    if (icon) {
      icon.classList.toggle('fa-chevron-up', !value)
      icon.classList.toggle('fa-chevron-down', !!value)
    }
    try { localStorage.setItem('spine-annotator:pelvis-panel-collapsed', String(!!value)) } catch {}
  }

  let collapsed = false
  try { collapsed = localStorage.getItem('spine-annotator:pelvis-panel-collapsed') === 'true' } catch {}
  applyCollapsed(collapsed)

  title.addEventListener('click', (e) => {
    if (e.target.closest('button:not(.panel-collapse-toggle), input, select, textarea, a')) return
    applyCollapsed(!panel.classList.contains('panel-collapsed'))
  })
}

function installPelvisRuntimeFinalFixes() {
  const a = state.annotator
  if (!a || a._pelvisRuntimeFinalFixed === true) return
  a._pelvisRuntimeFinalFixed = true

  if (!('pendingLabel' in a)) a.pendingLabel = null
  if (!('pendingLabelMode' in a)) a.pendingLabelMode = 'polygon'

  a.setPendingLabel = function(label, mode = '') {
    this.pendingLabel = label || null
    this.pendingLabelMode = mode || (PELVIS_POINT_LABELS_FINAL.includes(label) ? 'point' : 'polygon')
    if (typeof this.updateStatus === 'function') this.updateStatus()
  }

  const originalRelabelAll = typeof a.relabelAll === 'function' ? a.relabelAll.bind(a) : null
  a.relabelAll = function() {
    try {
      const startIdx = Math.max(0, LABELS.indexOf(this.startLabel || 'C2'))
      const autoPolygons = (this.polygons || []).filter(p => {
        if (!p) return false
        if (p.manualLabel === true) return false
        if (isFinalPelvisLabel(p.label)) return false
        return true
      })
      autoPolygons.forEach(p => { p._centroidY = computeSimpleCentroidYFinal(p.points) })
      autoPolygons.sort((x, y) => x._centroidY - y._centroidY)
      autoPolygons.forEach((p, i) => {
        p.label = LABELS[startIdx + i] || '?'
      })
      ;(this.polygons || []).forEach(p => { p._centroidY = computeSimpleCentroidYFinal(p.points) })
      ;(this.polygons || []).sort((x, y) => x._centroidY - y._centroidY)
    } catch (err) {
      if (originalRelabelAll) originalRelabelAll()
    }
  }

  const originalAddPoint = typeof a.addPoint === 'function' ? a.addPoint.bind(a) : null
  if (originalAddPoint) {
    a.addPoint = function(x, y) {
      const pending = this.pendingLabel
      if (!this.drawing && PELVIS_POINT_LABELS_FINAL.includes(pending)) {
        const scale = Math.max(0.1, this.stage?.scaleX?.() || 1)
        const r = 5 / scale
        const maxId = (this.polygons || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0)
        this.polygons.push({
          id: Math.max(Date.now(), maxId + 1),
          label: pending,
          points: [x, y - r, x + r, y, x, y + r, x - r, y],
          manualLabel: true,
          landmark: true,
        })
        this.pendingLabel = null
        this.pendingLabelMode = 'polygon'
        if (typeof this.renderPolygons === 'function') this.renderPolygons()
        if (typeof this.pushHistory === 'function') this.pushHistory()
        if (typeof this.notifyPolygons === 'function') this.notifyPolygons()
        if (typeof this.updateStatus === 'function') this.updateStatus()
        clearPelvisLabelActiveButtonsFinal()
        return
      }
      return originalAddPoint(x, y)
    }
  }

  const originalFinishDrawing = typeof a.finishDrawing === 'function' ? a.finishDrawing.bind(a) : null
  if (originalFinishDrawing) {
    a.finishDrawing = function(opts = {}) {
      const pending = this.pendingLabel
      const shouldUsePending = isFinalPelvisLabel(pending) && !PELVIS_POINT_LABELS_FINAL.includes(pending)
      const beforeIds = new Set((this.polygons || []).map(p => p.id))
      const result = originalFinishDrawing(opts)
      if (shouldUsePending) {
        const created = (this.polygons || []).find(p => !beforeIds.has(p.id))
        if (created) {
          created.label = pending
          created.manualLabel = true
          created.landmark = false
          this.pendingLabel = null
          this.pendingLabelMode = 'polygon'
          if (typeof this.relabelAll === 'function') this.relabelAll()
          if (typeof this.renderPolygons === 'function') this.renderPolygons()
          if (typeof this.pushHistory === 'function') this.pushHistory()
          if (typeof this.notifyPolygons === 'function') this.notifyPolygons()
          if (typeof this.updateStatus === 'function') this.updateStatus()
          clearPelvisLabelActiveButtonsFinal()
        }
      }
      return result
    }
  }
}

function computeSimpleCentroidYFinal(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return 0
  let cy = 0
  let n = 0
  for (let i = 1; i < pts.length; i += 2) {
    cy += Number(pts[i]) || 0
    n++
  }
  return n ? cy / n : 0
}
`

if (!s.includes('Final pelvis label runtime guard')) {
  const insertBefore = '// ================================================================\n// 키보드 단축키'
  if (s.includes(insertBefore)) s = s.replace(insertBefore, helper + '\n' + insertBefore)
  else s += helper
}

if (!s.includes('installPelvisRuntimeFinalFixes()\n\n  // UI 이벤트 바인딩')) {
  const needle = '  // UI 이벤트 바인딩\n'
  if (!s.includes(needle)) throw new Error('UI event binding marker not found')
  s = s.replace(needle, '  installPelvisRuntimeFinalFixes()\n\n' + needle)
}

if (s.includes('function initPelvisLabelControls()') && !s.includes('makePelvisPanelCollapsibleFinal()')) {
  s = s.replace(
    "  panel.querySelectorAll('.pelvis-label-btn').forEach(btn => {",
    "  makePelvisPanelCollapsibleFinal()\n\n  panel.querySelectorAll('.pelvis-label-btn').forEach(btn => {"
  )
}

if (!s.includes('clearPelvisLabelActiveButtonsFinal()\n    })')) {
  s = s.replace(
    "      state.annotator.setPendingLabel(btn.dataset.label, btn.dataset.mode)\n    })",
    "      state.annotator.setPendingLabel(btn.dataset.label, btn.dataset.mode)\n      if (btn.dataset.mode === 'point') {\n        // point mode clears after the next canvas click from runtime guard\n      }\n    })"
  )
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH final pelvis runtime behavior guard')
} else {
  console.log('OK final pelvis runtime behavior guard already patched')
}
