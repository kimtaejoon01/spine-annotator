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
  let depth = 0
  let quote = null
  let escape = false
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

{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  const newColorFn = `function landmarkColor(label) {
  const text = String(label || '').toUpperCase()
  if (text === 'HC_LAT' || text === 'FH_LAT') return '#ec4899'
  const target = landmarkTarget(text)
  const c = target[0]
  if (c === 'C') return '#f87171'
  if (c === 'T') return '#fbbf24'
  if (c === 'L') return '#60a5fa'
  if (c === 'S') return '#c084fc'
  return '#ffffff'
}`
  s = replaceFunction(s, 'landmarkColor', newColorFn)

  // Landmark connecting lines should follow the vertebra region color, not SUP/INF type color.
  s = s.replace(
    "      addLandmarkLine(this.landmarkLayer, byLabel.get(`${v}_SUP_POST`), byLabel.get(`${v}_SUP_ANT`), '#f59e0b', scale)\n      addLandmarkLine(this.landmarkLayer, byLabel.get(`${v}_INF_POST`), byLabel.get(`${v}_INF_ANT`), '#38bdf8', scale)",
    "      addLandmarkLine(this.landmarkLayer, byLabel.get(`${v}_SUP_POST`), byLabel.get(`${v}_SUP_ANT`), landmarkColor(v), scale)\n      addLandmarkLine(this.landmarkLayer, byLabel.get(`${v}_INF_POST`), byLabel.get(`${v}_INF_ANT`), landmarkColor(v), scale)"
  )
  s = s.replace(
    "    addLandmarkLine(this.landmarkLayer, byLabel.get('S1_SUP_POST'), byLabel.get('S1_SUP_ANT'), '#f97316', scale)",
    "    addLandmarkLine(this.landmarkLayer, byLabel.get('S1_SUP_POST'), byLabel.get('S1_SUP_ANT'), landmarkColor('S1'), scale)"
  )

  // If the non-crossing fill patch added polygon fills, recolor them by target too.
  s = s.replaceAll("landmarkColor(lm.label)", "landmarkColor(lm.label)")
  s = s.replaceAll("'#f59e0b'", "landmarkColor(v || lm?.label || '')")
  s = s.replaceAll("'#38bdf8'", "landmarkColor(v || lm?.label || '')")

  save(file, before, s, 'landmark C/T/L/S region colors')
}

{
  const file = 'public/static/style.css'
  const before = read(file)
  let s = before
  if (!s.includes('landmark-region-color-note')) {
    s += `

/* Landmark region colors match polygon mode: C red, T yellow, L blue, S purple. */
.landmark-region-color-note { color: var(--text-muted); font-size: 11px; }
`
  }
  save(file, before, s, 'landmark region color note style')
}

console.log('OK landmark region colors installed')
