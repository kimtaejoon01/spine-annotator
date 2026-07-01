#!/usr/bin/env node

import fs from 'node:fs'
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const write = (f, s) => fs.writeFileSync(f, s)
const save = (f, a, b, label) => { if (a === b) console.log('OK ' + label + ' already patched'); else { write(f, b); console.log('PATCH ' + label) } }

function findMethod(source, name) {
  const re = new RegExp('\\n  ' + name + '\\s*\\([^)]*\\)\\s*\\{')
  const m = source.match(re)
  if (!m || m.index == null) return null
  const start = m.index + 1
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
      if (depth === 0) {
        let end = i + 1
        while (source[end] === '\n' || source[end] === '\r') end++
        return { start, end }
      }
    }
  }
  return null
}

function replaceMethod(source, name, replacement) {
  const block = findMethod(source, name)
  if (!block) return source
  return source.slice(0, block.start) + replacement + source.slice(block.end)
}

{
  const file = 'public/static/annotator.js'
  const before = read(file)
  let s = before

  // constructor defaults
  if (!s.includes('this.humanLabelVisible = true')) {
    s = s.replace(
      '    this.imageFilters = { brightness: 0, contrast: 0, invert: false }',
      '    this.imageFilters = { brightness: 0, contrast: 0, invert: false }\n    this.humanLabelVisible = true\n    this.labelOverlayVisible = true'
    )
  }

  const humanMethod = `  setHumanLabelVisible(visible) {
    this.humanLabelVisible = visible !== false
    window.__spineHumanLabelVisible = this.humanLabelVisible
    if (this.polyLayer) this.polyLayer.visible(this.humanLabelVisible !== false)
    this.renderPolygons()
    if (this.polyLayer) {
      this.polyLayer.visible(this.humanLabelVisible !== false)
      this.polyLayer.batchDraw()
    }
  }

  getHumanLabelVisible() {
    return this.humanLabelVisible !== false
  }

  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    window.__spineLineNameVisible = this.labelOverlayVisible
    this.renderPolygons()
  }

  getLabelOverlayVisible() {
    return this.labelOverlayVisible !== false
  }
`

  if (findMethod(s, 'setHumanLabelVisible')) {
    const start = findMethod(s, 'setHumanLabelVisible').start
    const endBlock = findMethod(s, 'getLabelOverlayVisible') || findMethod(s, 'setLabelOverlayVisible')
    if (endBlock) {
      const end = endBlock.end
      s = s.slice(0, start) + humanMethod + s.slice(end)
    }
  } else if (findMethod(s, 'setLabelOverlayVisible')) {
    const start = findMethod(s, 'setLabelOverlayVisible').start
    const end = findMethod(s, 'getLabelOverlayVisible')?.end || findMethod(s, 'setLabelOverlayVisible').end
    s = s.slice(0, start) + humanMethod + s.slice(end)
  } else {
    const needle = `  setImageFilter(opts) {
    this.imageFilters = { ...this.imageFilters, ...opts }
    this.applyImageFilters()
  }
`
    if (!s.includes(needle)) throw new Error('setImageFilter insertion point not found')
    s = s.replace(needle, needle + '\n' + humanMethod)
  }

  const yOrderMethods = `  normalizeVertebraLabelsByY(opts = {}) {
    if (!Array.isArray(this.polygons) || this.polygons.length === 0) return false
    const anchorId = opts.anchorId
    const anchorLabel = opts.anchorLabel
    const force = opts.force === true
    const vertebrae = this.polygons.filter(p => LABELS.includes(p.label) || !p.label || p.label === '?')
    if (vertebrae.length === 0) return false
    vertebrae.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    vertebrae.sort((a, b) => a._centroidY - b._centroidY)

    let baseIdx = -1
    if (anchorId != null && LABELS.includes(anchorLabel)) {
      const yIdx = vertebrae.findIndex(p => p.id === anchorId)
      if (yIdx >= 0) baseIdx = LABELS.indexOf(anchorLabel) - yIdx
    }

    if (baseIdx < 0) {
      const counts = new Map()
      for (let i = 0; i < vertebrae.length; i++) {
        const idx = LABELS.indexOf(vertebrae[i].label)
        if (idx < 0) continue
        const candidate = idx - i
        if (candidate < 0 || candidate >= LABELS.length) continue
        counts.set(candidate, (counts.get(candidate) || 0) + 1)
      }
      let bestCount = -1
      for (const [candidate, count] of counts.entries()) {
        if (count > bestCount) { baseIdx = candidate; bestCount = count }
      }
    }

    if (baseIdx < 0) baseIdx = Math.max(0, LABELS.indexOf(this.startLabel || 'C2'))
    baseIdx = Math.max(0, Math.min(baseIdx, LABELS.length - 1))

    let changed = false
    for (let i = 0; i < vertebrae.length; i++) {
      const next = LABELS[baseIdx + i]
      if (!next) break
      const idx = LABELS.indexOf(vertebrae[i].label)
      if (force || idx !== baseIdx + i) {
        vertebrae[i].label = next
        changed = true
      }
    }
    if (LABELS[baseIdx]) this.startLabel = LABELS[baseIdx]

    // Keep internal order consistent with visual top-to-bottom order while preserving non-vertebra polygons.
    const nonVertebrae = this.polygons.filter(p => !vertebrae.includes(p))
    this.polygons = [...vertebrae, ...nonVertebrae]
    return changed
  }

  setLabelForPolygon(id, newLabel, opts = {}) {
    const poly = this.polygons.find(p => p.id === id)
    if (!poly) return
    if (!LABELS.includes(newLabel)) {
      poly.label = newLabel
      this.renderPolygons()
      this.pushHistory()
      this.notifyPolygons()
      return
    }
    poly.label = newLabel
    this.normalizeVertebraLabelsByY({ anchorId: id, anchorLabel: newLabel, force: true })
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }

  relabelFromPolygon(id, startLabel) {
    this.setLabelForPolygon(id, startLabel)
  }
`

  if (findMethod(s, 'normalizeVertebraLabelsByY')) s = replaceMethod(s, 'normalizeVertebraLabelsByY', yOrderMethods.split('\n\n  setLabelForPolygon')[0])
  if (findMethod(s, 'setLabelForPolygon') && findMethod(s, 'relabelFromPolygon')) {
    const a = findMethod(s, 'setLabelForPolygon')
    const b = findMethod(s, 'relabelFromPolygon')
    const start = Math.min(a.start, b.start)
    const end = Math.max(a.end, b.end)
    s = s.slice(0, start) + yOrderMethods + s.slice(end)
  } else if (findMethod(s, 'setLabelForPolygon')) {
    s = replaceMethod(s, 'setLabelForPolygon', yOrderMethods)
  }

  // Render obeys both visibility toggles. If 사람 라벨 보기 is off, no label nodes are created either.
  s = s.replace(
    /    this\.polyLayer\.destroyChildren\(\)\n(?:    this\.polyLayer\.visible\([^\n]+\)\n)*/,
    '    this.polyLayer.destroyChildren()\n    this.polyLayer.visible(this.humanLabelVisible !== false)\n'
  )
  s = s.replace(/      const showLabel = .*polyScreenMin.*isSelected.*\n/g,
    '      const showLabel = (this.humanLabelVisible !== false) && (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)\n')

  const loadBlock = findMethod(s, 'loadPolygons')
  if (loadBlock) {
    let text = s.slice(loadBlock.start, loadBlock.end)
    if (!text.includes('normalizeVertebraLabelsByY({ force: false })')) {
      text = text.replace(
        '    this.selectedId = null\n',
        '    this.selectedId = null\n    this.normalizeVertebraLabelsByY({ force: false })\n'
      )
      text = text.replace(
        '    this.renderPolygons()\n',
        '    this.normalizeVertebraLabelsByY({ force: false })\n    this.renderPolygons()\n'
      )
      s = s.slice(0, loadBlock.start) + text + s.slice(loadBlock.end)
    }
  }

  save(file, before, s, 'polygon visibility and Y-order labels')
}

{
  const file = 'public/static/modules/visibility.js'
  const before = read(file)
  let s = before
  if (!s.includes('annotator.renderPolygons?.()')) {
    s = s.replace(
      `  if (typeof annotator.setHumanLabelVisible === 'function') {
    annotator.setHumanLabelVisible(state.humanLabelVisible !== false)
  }

  if (typeof annotator.setLabelOverlayVisible === 'function') {
    annotator.setLabelOverlayVisible(state.lineNameVisible !== false)
  }`,
      `  if (typeof annotator.setHumanLabelVisible === 'function') {
    annotator.setHumanLabelVisible(state.humanLabelVisible !== false)
  } else {
    annotator.humanLabelVisible = state.humanLabelVisible !== false
  }

  if (typeof annotator.setLabelOverlayVisible === 'function') {
    annotator.setLabelOverlayVisible(state.lineNameVisible !== false)
  } else {
    annotator.labelOverlayVisible = state.lineNameVisible !== false
  }

  annotator.renderPolygons?.()
  if (annotator.polyLayer) {
    annotator.polyLayer.visible(state.humanLabelVisible !== false)
    annotator.polyLayer.batchDraw?.()
  }`
    )
  }
  save(file, before, s, 'visibility module hard apply')
}

console.log('OK polygon visibility and Y-order final fix installed')
