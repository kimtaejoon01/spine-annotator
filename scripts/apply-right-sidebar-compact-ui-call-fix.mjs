#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

function hasActualInitCall(source) {
  return /(^|\n)\s*(?:setTimeout\(initRightSidebarCompactUI|initRightSidebarCompactUI\(\))/m.test(source)
}

if (!s.includes('function initRightSidebarCompactUI()')) {
  throw new Error('initRightSidebarCompactUI helper is missing; run apply-right-sidebar-compact-ui-patch first')
}

if (!hasActualInitCall(s)) {
  const bindNeedle = '  bindUIEvents()\n'
  if (!s.includes(bindNeedle)) throw new Error('bindUIEvents call not found')
  s = s.replace(bindNeedle, bindNeedle + '  setTimeout(initRightSidebarCompactUI, 0)\n')
  console.log('PATCH right sidebar compact UI init call after bindUIEvents')
} else {
  console.log('OK right sidebar compact UI init call already present')
}

// Also run once after authenticated init completes. This covers late DOM changes from
// previous patches and guarantees the button appears after login as well.
const readyNeedle = "  console.log('[App] Ready.')\n"
if (s.includes(readyNeedle) && !s.includes('initRightSidebarCompactUI()\n  console.log(\'[App] Ready.\')')) {
  s = s.replace(readyNeedle, "  initRightSidebarCompactUI()\n" + readyNeedle)
  console.log('PATCH right sidebar compact UI init call after postAuthInit')
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('OK right sidebar compact UI call fix installed')
} else {
  console.log('OK right sidebar compact UI call fix already installed')
}
