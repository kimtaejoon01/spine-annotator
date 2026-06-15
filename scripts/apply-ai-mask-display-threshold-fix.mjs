#!/usr/bin/env node

import fs from 'node:fs'

const files = ['public/static/annotator.js', 'public/static/app.js']
let changed = false

for (const file of files) {
  if (!fs.existsSync(file)) continue
  let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const before = s

  // Saved AI masks are expected to be binary 0/255 PNGs. A low display threshold
  // such as 20 can accidentally colorize faint probability-map/antialias/compression
  // pixels and make the app look different from the original postprocessed overlay.
  s = s.replaceAll('brightness > 20', 'brightness >= 128')
  s = s.replaceAll('bright > 20', 'bright >= 128')

  if (s !== before) {
    fs.writeFileSync(file, s)
    console.log('PATCH strict AI mask display threshold:', file)
    changed = true
  } else {
    console.log('OK strict AI mask display threshold already patched:', file)
  }
}

console.log(changed ? 'OK AI mask display threshold fixed' : 'OK AI mask display threshold already fixed')
