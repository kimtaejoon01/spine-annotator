#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
const s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const names = [
  'initAiCompareZoomControls',
  'zoomAiCompare',
  'zoomAiCompareAtCenter',
  'zoomAiCompareAtPoint',
  'resetAiCompareZoom',
  'applyAiCompareTransform',
]
let failed = false

for (const name of names) {
  const re = new RegExp('(^|\\n)[ \\t]*function\\s+' + name + '\\s*\\(', 'g')
  const matches = [...s.matchAll(re)]
  if (matches.length > 1) {
    console.error(`VERIFY FAIL duplicate app.js function ${name}: ${matches.length}`)
    failed = true
  } else {
    console.log(`VERIFY OK app.js ${name}: ${matches.length}`)
  }
}

if (failed) process.exit(1)
