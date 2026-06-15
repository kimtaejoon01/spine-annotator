#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

// Repeated build-time patches could insert this block multiple times inside
// `if (aiToggle) { ... }`, causing: Identifier 'labelSpan' has already been declared.
const labelBlock = "    const labelSpan = aiToggle.closest('label')?.querySelector('span')\n    if (labelSpan) labelSpan.textContent = '현재 화면에 AI 겹쳐보기'"
while (s.includes(labelBlock + '\n' + labelBlock)) {
  s = s.replace(labelBlock + '\n' + labelBlock, labelBlock)
}

// Also collapse accidental repeated compare-control initializers.
const ensureBlock = '  ensureAiComparePanel()\n  injectAiCompareControls()'
while (s.includes(ensureBlock + '\n' + ensureBlock)) {
  s = s.replace(ensureBlock + '\n' + ensureBlock, ensureBlock)
}

// Defensive cleanup if a duplicate labelSpan is separated only by whitespace.
s = s.replace(
  /    const labelSpan = aiToggle\.closest\('label'\)\?\.querySelector\('span'\)\n    if \(labelSpan\) labelSpan\.textContent = '현재 화면에 AI 겹쳐보기'\n\s*const labelSpan = aiToggle\.closest\('label'\)\?\.querySelector\('span'\)\n\s*if \(labelSpan\) labelSpan\.textContent = '현재 화면에 AI 겹쳐보기'/g,
  labelBlock
)

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH app.js duplicate AI compare binding syntax repair')
} else {
  console.log('OK app.js duplicate AI compare binding syntax repair not needed')
}
