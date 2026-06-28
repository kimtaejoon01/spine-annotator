#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

if (!s.includes('function initPelvisLabelControls()')) {
  throw new Error('initPelvisLabelControls helper missing; run apply-pelvis-labels-patch first')
}

function hasRealCall(source) {
  return /(^|\n)\s*(?:setTimeout\(initPelvisLabelControls|initPelvisLabelControls\(\))/m.test(source)
}

if (!hasRealCall(s)) {
  const needle = '  bindUIEvents()\n'
  if (!s.includes(needle)) throw new Error('bindUIEvents call not found')
  s = s.replace(needle, needle + '  setTimeout(initPelvisLabelControls, 0)\n')
  console.log('PATCH pelvis label controls init call after bindUIEvents')
} else {
  console.log('OK pelvis label controls init call already present')
}

const readyNeedle = "  console.log('[App] Ready.')\n"
if (s.includes(readyNeedle) && !s.includes("initPelvisLabelControls()\n  console.log('[App] Ready.')")) {
  s = s.replace(readyNeedle, "  initPelvisLabelControls()\n" + readyNeedle)
  console.log('PATCH pelvis label controls init call after postAuthInit')
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('OK pelvis label controls call fix installed')
} else {
  console.log('OK pelvis label controls call fix already installed')
}
