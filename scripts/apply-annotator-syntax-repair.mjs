#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/annotator.js'
const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
let s = before

// Some late build patches can leave the measurement overlay setter with only the
// trailing default-argument text, producing a literal class method line like:
//   }) {
// Recover it when the following block is clearly the measurement debug setter.
const lines = s.split('\n')
let repaired = false
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() !== '}) {') continue
  const lookahead = lines.slice(i + 1, i + 18).join('\n')
  const lookbehind = lines.slice(Math.max(0, i - 3), i).join('\n')
  if (lookahead.includes('this.measurementDebug = {')) {
    lines[i] = '  setMeasurementDebugOverlay(result = null, options = {}) {'
    repaired = true
  } else if (lookbehind.includes('setMeasurementDebugOverlay(result = null, options =')) {
    lines[i] = '  setMeasurementDebugOverlay(result = null, options = {}) {'
    // Remove the dangling partial line if it exists immediately above.
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (lines[j].includes('setMeasurementDebugOverlay(result = null, options =')) {
        lines.splice(j, 1)
        i--
        break
      }
    }
    repaired = true
  }
}
if (repaired) s = lines.join('\n')

// Guard against accidental duplicate/partial method headers left by repeated
// measurement overlay patches.
s = s.replace(
  /\n\s*setMeasurementDebugOverlay\(result = null, options =\s*\n\s*setMeasurementDebugOverlay\(result = null, options = \{\}\) \{/g,
  '\n  setMeasurementDebugOverlay(result = null, options = {}) {'
)

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH annotator syntax repair')
} else {
  console.log('OK annotator syntax repair not needed')
}
