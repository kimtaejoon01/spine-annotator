#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}
function replaceTopLevelFunction(source, name, replacement) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) return source
  const open = source.indexOf('{', start)
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

const landmarkTools = String.raw`const VERTEBRAE_FULL = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
const CORNER_POINTS_4 = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT']
export const LAT_4CORNER_SEQUENCE = VERTEBRAE_FULL.flatMap(v => CORNER_POINTS_4.map(p => v + '_' + p))
export const LAT_CENTROID_SEQUENCE = VERTEBRAE_FULL.map(v => v + '_CENTER').concat(['HC_LAT'])
export const LAT_5POINT_SEQUENCE = LAT_4CORNER_SEQUENCE
const ORDER_VERSION = 'lat-corner-centroid-v3'

export function installLat5PointLandmarks({ annotator, getViewType, onChange } = {}) {
  if (!annotator) return null
  if (annotator.__lat5PointLandmarksInstalled) return annotator.__lat5PointLandmarkApi
  annotator.__lat5PointLandmarksInstalled = true
  annotator.__activeAnnotationMode = annotator.__activeAnnotationMode || 'polygon'
  annotator.landmarks = []
  annotator.pendingLandmark = null
  annotator.landmarkLayer = new Konva.Layer()
  annotator.stage.add(annotator.landmarkLayer)

  let mode = 'corner'
  let sequenceIndex = 0
  let panel = null
  let modeToolbar = null
  const originalOnMouseDown = annotator.onMouseDown.bind(annotator)

  const isLat = () => String(getViewType?.() || '').toUpperCase() === 'LAT'
  const getActiveSequence = () => mode === 'centroid' ? LAT_CENTROID_SEQUENCE : LAT_4CORNER_SEQUENCE
  const getDisplayMode = () => annotator.__activeAnnotationMode || 'polygon'
  const hideLayer = (layer) => { layer?.hide?.(); layer?.visible?.(false); layer?.batchDraw?.() }
  const showLayer = (layer) => { layer?.show?.(); layer?.visible?.(true); layer?.batchDraw?.() }

  function updateModeVisibility() {
    const polygonMode = getDisplayMode() === 'polygon'
    if (polygonMode) {
      showLayer(annotator.polyLayer); showLayer(annotator.previewLayer); showLayer(annotator.measurementLayer); hideLayer(annotator.landmarkLayer)
    } else {
      hideLayer(annotator.polyLayer); hideLayer(annotator.previewLayer); hideLayer(annotator.measurementLayer); showLayer(annotator.landmarkLayer); annotator.landmarkLayer?.moveToTop?.()
    }
    annotator.stage?.batchDraw?.()
  }

  function activateToolbarMode(nextMode) {
    if (nextMode === 'polygon') {
      annotator.__activeAnnotationMode = 'polygon'
      annotator.setPendingLandmark(null)
      renderModeToolbar(); updateModeVisibility(); return
    }
    mode = nextMode === 'centroid' ? 'centroid' : 'corner'
    annotator.__activeAnnotationMode = mode
    sequenceIndex = findNextMissingIndex(annotator.landmarks, 0, getActiveSequence())
    annotator.setPendingLandmark(getActiveSequence()[sequenceIndex] || null)
    renderModeToolbar(); updateModeVisibility(); annotator.renderLandmarks?.()
  }

  function ensureModeToolbar() {
    if (modeToolbar?.isConnected) return modeToolbar
    const toolbar = document.querySelector('.canvas-toolbar')
    if (!toolbar) return null
    modeToolbar = document.getElementById('landmarkModeToolbar')
    if (!modeToolbar) {
      modeToolbar = document.createElement('div')
      modeToolbar.id = 'landmarkModeToolbar'
      modeToolbar.className = 'tool-group landmark-mode-toolbar'
      modeToolbar.innerHTML = '<button type="button" class="tool-btn landmark-mode-btn" data-landmark-toolbar-mode="polygon">폴리곤</button><button type="button" class="tool-btn landmark-mode-btn" data-landmark-toolbar-mode="corner">랜드마크</button><button type="button" class="tool-btn landmark-mode-btn" data-landmark-toolbar-mode="centroid">Centroid</button>'
      modeToolbar.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('[data-landmark-toolbar-mode]')
        if (btn) activateToolbarMode(btn.dataset.landmarkToolbarMode)
      })
      const statusGroup = toolbar.querySelector('.tool-info')
      if (statusGroup?.nextSibling) toolbar.insertBefore(modeToolbar, statusGroup.nextSibling)
      else toolbar.appendChild(modeToolbar)
    }
    return modeToolbar
  }
  function renderModeToolbar() {
    const el = ensureModeToolbar(); if (!el) return
    el.classList.toggle('hidden', !isLat())
    const active = getDisplayMode()
    el.querySelectorAll('[data-landmark-toolbar-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.landmarkToolbarMode === active))
  }

  function setPendingToNext(start = 0) {
    const seq = getActiveSequence()
    sequenceIndex = findNextMissingIndex(annotator.landmarks, start, seq)
    annotator.setPendingLandmark(seq[sequenceIndex] || null)
  }
  function deleteLabels(labels) {
    const remove = new Set((labels || []).map(x => String(x || '').toUpperCase()))
    const before = annotator.landmarks.length
    annotator.landmarks = annotator.landmarks.filter(l => !remove.has(String(l.label || '').toUpperCase()))
    if (annotator.landmarks.length === before) return false
    setPendingToNext(0); annotator.renderLandmarks(); renderPanel(); onChange?.(); return true
  }
  function nearestLandmark(pos, maxDist) {
    let best = null, bestD = Infinity
    for (const lm of annotator.landmarks || []) {
      const d = Math.hypot(Number(lm.x) - pos.x, Number(lm.y) - pos.y)
      if (d < bestD) { best = lm; bestD = d }
    }
    return best && bestD <= maxDist ? best : null
  }
  function sortPoints(points) {
    const pts = points.filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    const cx = pts.reduce((s,p)=>s+Number(p.x),0) / (pts.length || 1)
    const cy = pts.reduce((s,p)=>s+Number(p.y),0) / (pts.length || 1)
    return pts.sort((a,b) => Math.atan2(Number(a.y)-cy, Number(a.x)-cx) - Math.atan2(Number(b.y)-cy, Number(b.x)-cx))
  }

  annotator.onMouseDown = function patchedLandmarkMouseDown(e) {
    if (isLat() && getDisplayMode() !== 'polygon') {
      if (e.evt?.button != null && e.evt.button !== 0) return
      const pos = this.getImagePos(); if (!pos) return
      e.cancelBubble = true
      if (this.tool === 'delete') {
        const hit = nearestLandmark(pos, 14 / Math.max(0.001, this.stage.scaleX() || 1))
        if (hit) this.deleteLandmark(hit.label)
        return
      }
      if (this.tool === 'edit') return
      if (this.pendingLandmark) {
        const seq = getActiveSequence(); const current = seq.indexOf(this.pendingLandmark)
        this.setLandmark(this.pendingLandmark, pos.x, pos.y)
        setPendingToNext(current + 1); renderPanel(); onChange?.()
      }
      return
    }
    return originalOnMouseDown(e)
  }
  annotator.setPendingLandmark = function setPendingLandmark(label) { this.pendingLandmark = label || null; this.updateStatus?.(); renderModeToolbar(); updateModeVisibility(); renderPanel() }
  annotator.setLandmarkMode = function setLandmarkMode(nextMode) { mode = nextMode === 'centroid' ? 'centroid' : 'corner'; this.__activeAnnotationMode = mode; setPendingToNext(0); updateModeVisibility(); this.renderLandmarks?.() }
  annotator.setLandmark = function setLandmark(label, x, y, visibility = 'visible') {
    const clean = String(label || '').trim().toUpperCase(); if (!clean) return
    const existing = this.landmarks.find(l => l.label === clean)
    const item = { id: existing?.id || 'lm_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), label: clean, target: landmarkTarget(clean), kind: 'point', x: Number(x), y: Number(y), visibility, order_version: ORDER_VERSION }
    if (existing) Object.assign(existing, item); else this.landmarks.push(item)
    this.renderLandmarks()
  }
  annotator.deleteLandmark = label => deleteLabels([label])
  annotator.deleteLastLandmarkPoint = function deleteLastLandmarkPoint() {
    if (getDisplayMode() === 'polygon') return false
    const seq = getActiveSequence(); let start = this.pendingLandmark ? seq.indexOf(this.pendingLandmark) - 1 : sequenceIndex
    if (start < 0) start = seq.length - 1
    for (let i = Math.min(start, seq.length - 1); i >= 0; i--) if (this.landmarks.some(l => l.label === seq[i])) { const ok = deleteLabels([seq[i]]); if (ok) { sequenceIndex = i; this.setPendingLandmark(seq[i]) } return ok }
    return false
  }
  annotator.clearLandmarks = function clearLandmarks() { this.landmarks = []; this.pendingLandmark = null; this.renderLandmarks(); renderPanel(); onChange?.() }
  annotator.getLandmarks = function getLandmarks() { return (this.landmarks || []).map(l => ({ id: l.id, label: l.label, target: l.target || landmarkTarget(l.label), kind: l.kind || 'point', x: Number(l.x), y: Number(l.y), visibility: l.visibility || 'visible', order_version: l.order_version || ORDER_VERSION })).filter(l => l.label && Number.isFinite(l.x) && Number.isFinite(l.y)) }
  annotator.loadLandmarks = function loadLandmarks(landmarks) { this.landmarks = Array.isArray(landmarks) ? landmarks.map((l,i) => ({ id: l.id || 'lm_loaded_' + i, label: String(l.label || '').trim().toUpperCase(), target: l.target || landmarkTarget(l.label), kind: l.kind || 'point', x: Number(l.x), y: Number(l.y), visibility: l.visibility || 'visible', order_version: l.order_version || ORDER_VERSION })).filter(l => l.label && Number.isFinite(l.x) && Number.isFinite(l.y)) : []; setPendingToNext(0); this.renderLandmarks(); renderPanel() }
  annotator.renderLandmarks = function renderLandmarks() {
    if (!this.landmarkLayer) return
    this.landmarkLayer.destroyChildren()
    const displayMode = getDisplayMode()
    if (displayMode === 'polygon') { this.landmarkLayer.visible(false); this.landmarkLayer.batchDraw(); return }
    this.landmarkLayer.visible(true); this.landmarkLayer.moveToTop?.()
    const scale = Math.max(0.001, this.stage.scaleX() || 1)
    const byLabel = new Map((this.landmarks || []).map(l => [String(l.label || '').toUpperCase(), l]))
    if (displayMode === 'corner') {
      for (const v of VERTEBRAE_FULL) {
        const labels = CORNER_POINTS_4.map(p => v + '_' + p)
        const ptsRaw = labels.map(label => byLabel.get(label)).filter(Boolean)
        if (ptsRaw.length === 4) {
          const pts = sortPoints(ptsRaw); const flat = pts.flatMap(p => [Number(p.x), Number(p.y)]); const color = landmarkColor(labels[0])
          const poly = new Konva.Line({ points: flat, closed: true, fill: color + '42', stroke: color, strokeWidth: 1.2 / scale, opacity: 0.95, listening: true })
          poly.on('click tap', (e) => { e.cancelBubble = true; if (annotator.tool === 'delete') deleteLabels(labels) })
          this.landmarkLayer.add(poly)
          const cx = pts.reduce((s,p)=>s+Number(p.x),0)/4; const cy = pts.reduce((s,p)=>s+Number(p.y),0)/4
          const text = new Konva.Text({ x: cx, y: cy, text: v, fontSize: 6 / scale, fontStyle: 'bold', fill: '#fff', stroke: '#0f172a', strokeWidth: 0.8 / scale, listening: false })
          text.offsetX(text.width()/2); text.offsetY(text.height()/2); this.landmarkLayer.add(text)
          if (this.tool === 'edit' || this.tool === 'delete') for (const p of ptsRaw) addPoint(this.landmarkLayer, p, scale)
        } else for (const p of ptsRaw) addPoint(this.landmarkLayer, p, scale)
      }
    } else {
      for (const lm of this.landmarks || []) { const label = String(lm.label || '').toUpperCase(); if (label.includes('CENTER') || label === 'HC_LAT') addPoint(this.landmarkLayer, lm, scale, displayLandmarkLabel(label, true)) }
    }
    this.landmarkLayer.batchDraw()
  }
  function addPoint(layer, lm, scale, labelText = '') {
    if (!lm) return
    const label = String(lm.label || '').toUpperCase(); const r = (annotator.tool === 'edit' || annotator.tool === 'delete' ? 3.0 : 1.8) / scale
    const group = new Konva.Group({ x: Number(lm.x), y: Number(lm.y), draggable: annotator.tool === 'edit', landmarkLabel: label })
    group.add(new Konva.Circle({ radius: r, fill: landmarkColor(label), stroke: '#0f172a', strokeWidth: 0.55 / scale }))
    if (labelText) group.add(new Konva.Text({ x: 3 / scale, y: -3 / scale, text: labelText, fontSize: 4.5 / scale, fontStyle: 'bold', fill: '#fff', stroke: '#0f172a', strokeWidth: 0.6 / scale }))
    group.on('dragmove', () => { if (annotator.tool !== 'edit') return; const pos = group.position(); lm.x = pos.x; lm.y = pos.y; layer.batchDraw() })
    group.on('dragend', () => { if (annotator.tool !== 'edit') return; annotator.renderLandmarks(); onChange?.(); renderPanel() })
    group.on('click tap dblclick contextmenu', (e) => { if (e.type !== 'contextmenu' && e.type !== 'dblclick' && annotator.tool !== 'delete') return; e.evt?.preventDefault?.(); e.cancelBubble = true; annotator.deleteLandmark(label) })
    layer.add(group)
  }
  function ensurePanel() { if (panel) return panel; const scroll = document.getElementById('sidebarRight')?.querySelector('.sidebar-scroll') || document.getElementById('sidebarRight'); if (!scroll) return null; panel = document.createElement('div'); panel.className = 'panel landmark-panel'; panel.id = 'latLandmarkPanel'; scroll.appendChild(panel); return panel }
  function renderPanel() {
    const el = ensurePanel(); if (!el) return
    const seq = getActiveSequence(); const done = new Set(annotator.getLandmarks().map(l => l.label)); const current = seq[sequenceIndex] || seq[0]; const completed = seq.filter(label => done.has(label)).length
    el.innerHTML = '<h3 class="panel-title">LAT 랜드마크</h3><div class="landmark-progress"><strong>' + completed + '</strong> / ' + seq.length + '</div><div class="landmark-current ' + (annotator.pendingLandmark ? 'active' : '') + '"><span>현재 점</span><strong>' + escapeHtml(displayLandmarkLabel(annotator.pendingLandmark || current)) + '</strong></div><p class="landmark-help">I=찍기, O=수정, P=삭제, E=마지막 점 삭제</p>'
    renderModeToolbar(); updateModeVisibility()
  }
  const api = { refresh: () => { renderModeToolbar(); updateModeVisibility(); renderPanel() } }
  annotator.__lat5PointLandmarkApi = api
  renderModeToolbar(); updateModeVisibility(); renderPanel()
  return api
}
function findNextMissingIndex(landmarks, start = 0, sequence = LAT_4CORNER_SEQUENCE) { const done = new Set((landmarks || []).map(l => String(l.label || '').toUpperCase())); for (let i = Math.max(0, start || 0); i < sequence.length; i++) if (!done.has(sequence[i])) return i; return Math.min(Math.max(0, start || 0), sequence.length - 1) }
function landmarkTarget(label) { const text = String(label || '').toUpperCase(); if (text === 'HC_LAT') return 'pelvis'; return text.split('_')[0] || '' }
function landmarkColor(label) { const text = String(label || '').toUpperCase(); if (text.includes('CENTER')) return '#22c55e'; if (text.includes('SUP')) return '#f59e0b'; if (text.includes('INF')) return '#38bdf8'; if (text === 'HC_LAT') return '#ec4899'; return '#f59e0b' }
function displayLandmarkLabel(label, compact = false) { const text = String(label || '').toUpperCase(); if (!text) return ''; if (text === 'HC_LAT') return compact ? 'HC' : 'HC_LAT'; const parts = text.split('_'); const target = parts[0]; if (text.endsWith('_CENTER')) return compact ? target + ' C' : target + ' CENTER'; if (!compact) return text; const suffix = parts.slice(1).join('_'); const n = suffix === 'SUP_ANT' ? '1' : suffix === 'SUP_POST' ? '2' : suffix === 'INF_POST' ? '3' : suffix === 'INF_ANT' ? '4' : suffix; return target + ' ' + n }
function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;') }
`

{
  const file = 'public/static/landmark-tools.js'
  save(file, read(file), landmarkTools, 'safe clean landmark tools rewrite')
}

{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before
  s = replaceTopLevelFunction(s, 'setTool', `function setTool(tool) {
  state.annotator.setTool(tool)
  state.annotator.renderLandmarks?.()
  state.annotator.enforceAnnotationModeVisibility?.()
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tool' + tool[0].toUpperCase() + tool.slice(1)).classList.add('active')
}`)
  s = replaceTopLevelFunction(s, 'runAction', `function runAction(actionId) {
  const landmarkMode = state.annotator && (state.annotator.__activeAnnotationMode || 'polygon') !== 'polygon'
  switch (actionId) {
    case 'finishPolygon': state.annotator.finishDrawing(); return true
    case 'finishPolygonFree': state.annotator.finishDrawing({ angularSort: true }); return true
    case 'cancelDrawing': state.annotator.cancelDrawing(); return true
    case 'removeLastPoint': if (landmarkMode && state.annotator.deleteLastLandmarkPoint?.()) return true; if (!state.annotator.removeLastPoint()) state.annotator.deleteSelected(); return true
    case 'deleteSelected': if (landmarkMode && state.annotator.deleteLastLandmarkPoint?.()) return true; state.annotator.deleteSelected(); return true
    case 'removeHoveredVertex': return state.annotator.removeHoveredVertex()
    case 'toolDraw': setTool('draw'); return true
    case 'toolEdit': setTool('edit'); return true
    case 'toolDelete': setTool('delete'); return true
    case 'undo': state.annotator.undo(); return true
    case 'redo': state.annotator.redo(); return true
    case 'panMode': state.annotator.setPanMode(true); return true
    case 'freehandMode': state.annotator.setFreehandMode(true); return true
    case 'zoomIn': state.annotator.zoomBy(1.2); return true
    case 'zoomOut': state.annotator.zoomBy(1 / 1.2); return true
    case 'zoomFit': state.annotator.zoomToFit(); return true
    case 'openShortcuts': openShortcutsModal(); return true
  }
  return false
}`)
  save(file, before, s, 'safe app landmark shortcut handlers')
}
console.log('OK safe landmark tools rewrite installed')
