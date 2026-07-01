#!/usr/bin/env node

import fs from 'node:fs'
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const write = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { write(f, b); console.log('PATCH ' + label) } }

{
  const f = 'public/static/app.js'
  const before = read(f)
  let s = before

  const oldTimer = `if (!window.__standaloneLandmarkListTimer) {
  window.__standaloneLandmarkListTimer = setInterval(() => {
    try { renderStandaloneLandmarkListPanel() } catch (err) { console.warn('[LandmarkList] render failed', err) }
  }, 800)
}`
  const newTimer = `if (!window.__standaloneLandmarkListTimer) {
  window.__standaloneLandmarkListTimer = setInterval(() => {
    try {
      const panel = document.getElementById('standaloneLandmarkListPanel')
      const active = document.activeElement
      if (panel && ((active && panel.contains(active)) || Date.now() < (window.__standaloneLmFreezeUntil || 0))) return
      renderStandaloneLandmarkListPanel()
    } catch (err) { console.warn('[LandmarkList] render failed', err) }
  }, 1200)
}
if (!window.__standaloneLandmarkListFreezeEvents) {
  window.__standaloneLandmarkListFreezeEvents = true
  const freezeLmPanel = (ms = 4000) => { window.__standaloneLmFreezeUntil = Date.now() + ms }
  document.addEventListener('pointerdown', (e) => { if (e.target?.closest?.('#standaloneLandmarkListPanel')) freezeLmPanel(5000) }, true)
  document.addEventListener('focusin', (e) => { if (e.target?.closest?.('#standaloneLandmarkListPanel')) freezeLmPanel(15000) }, true)
  document.addEventListener('change', (e) => { if (e.target?.closest?.('#standaloneLandmarkListPanel')) freezeLmPanel(300) }, true)
}`
  if (s.includes(oldTimer)) s = s.replace(oldTimer, newTimer)

  if (!s.includes('window.__landmarkSinglePointRDeleteInstalled')) {
    s += `

// Landmark edit-mode single point deletion: O/edit mode + hover landmark + R.
if (!window.__landmarkSinglePointRDeleteInstalled) {
  window.__landmarkSinglePointRDeleteInstalled = true
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    const isR = e.code === 'KeyR' || String(e.key || '').toLowerCase() === 'r'
    if (!isR) return
    const annotator = window.state?.annotator || state?.annotator
    if (!annotator || annotator.tool !== 'edit') return
    if (!annotator.deleteHoveredLandmarkPoint?.()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    window.__refreshSagittalMeasurements?.()
    if (typeof autoSave === 'function') autoSave()
  }, true)
}
`
  }

  save(f, before, s, 'standalone landmark dropdown persistence and R delete')
}

{
  const f = 'public/static/landmark-tools.js'
  const before = read(f)
  let s = before

  if (!s.includes('deleteHoveredLandmarkPoint = function')) {
    const anchor = `  annotator.deleteLandmark = function deleteLandmark(label) {
    const clean = String(label || '').trim().toUpperCase()
    const before = this.landmarks.length
    this.landmarks = this.landmarks.filter(l => l.label !== clean)
    if (this.landmarks.length !== before) {
      this.renderLandmarks()
      renderPanel()
      onChange?.()
    }
  }
`
    const insert = anchor + `
  annotator.deleteHoveredLandmarkPoint = function deleteHoveredLandmarkPoint() {
    const label = String(this.hoveringLandmarkLabel || '').trim().toUpperCase()
    if (!label) return false
    this.deleteLandmark(label)
    this.hoveringLandmarkLabel = null
    return true
  }

  annotator.deleteLandmarkTargetGroup = function deleteLandmarkTargetGroup(label) {
    const target = landmarkTarget(label)
    if (!target) return false
    const before = this.landmarks.length
    this.landmarks = (this.landmarks || []).filter(l => landmarkTarget(l.label) !== target)
    if (this.landmarks.length === before) return false
    this.hoveringLandmarkLabel = null
    this.renderLandmarks()
    renderPanel()
    window.__refreshSagittalMeasurements?.()
    onChange?.()
    return true
  }
`
    if (s.includes(anchor)) s = s.replace(anchor, insert)
  }

  if (!s.includes('this.hoveringLandmarkLabel = lm.label')) {
    const anchor = `      const group = new Konva.Group({ x: lm.x, y: lm.y, draggable: true, landmarkLabel: lm.label })
      const isPending = lm.label === this.pendingLandmark`
    const repl = `      const group = new Konva.Group({ x: lm.x, y: lm.y, draggable: true, landmarkLabel: lm.label })
      group.on('mouseenter', () => {
        this.hoveringLandmarkLabel = lm.label
        if (this.tool === 'delete') this.containerEl.style.cursor = 'not-allowed'
        else if (this.tool === 'edit') this.containerEl.style.cursor = 'grab'
      })
      group.on('mouseleave', () => {
        if (this.hoveringLandmarkLabel === lm.label) this.hoveringLandmarkLabel = null
        if (!this.panMode) this.containerEl.style.cursor = this.tool === 'draw' ? 'crosshair' : this.tool === 'delete' ? 'not-allowed' : 'default'
      })
      group.on('click tap', (e) => {
        if (this.tool !== 'delete') return
        e.cancelBubble = true
        this.deleteLandmarkTargetGroup?.(lm.label)
      })
      const isPending = lm.label === this.pendingLandmark`
    if (s.includes(anchor)) s = s.replace(anchor, repl)
  }

  save(f, before, s, 'landmark grouped delete and hover point delete')
}

console.log('OK landmark dropdown and delete semantics fix installed')
