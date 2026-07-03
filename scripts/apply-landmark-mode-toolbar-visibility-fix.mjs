#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

const file = 'public/static/landmark-tools.js'
const before = read(file)
let s = before

// The first toolbar patch hid the mode buttons when getViewType() was not LAT.
// During startup/file-folder loading, viewType can still be empty when the toolbar
// is first rendered, so the buttons stayed hidden even after a LAT file loaded.
// Keep the mode switcher always visible; landmark point placement itself still
// requires LAT in the mouse handler.
s = s.replace(
  `    const isLat = String(getViewType?.() || '').toUpperCase() === 'LAT'\n    el.classList.toggle('hidden', !isLat)\n    const active = annotator.pendingLandmark ? mode : 'polygon'`,
  `    el.classList.remove('hidden')\n    const active = annotator.pendingLandmark ? mode : 'polygon'`
)

// Prefer placing the mode switcher after the status text. If the previous patch
// inserted it but it was hidden, this keeps the same location and makes it visible.
if (!s.includes('modeToolbar.style.display =')) {
  s = s.replace(
    `    el.querySelectorAll('[data-landmark-toolbar-mode]').forEach(btn => {`,
    `    modeToolbar.style.display = 'inline-flex'\n    el.querySelectorAll('[data-landmark-toolbar-mode]').forEach(btn => {`
  )
}

save(file, before, s, 'landmark mode toolbar visibility')
console.log('OK landmark mode toolbar visibility fix installed')
