#!/usr/bin/env node

import fs from 'node:fs'

const file = 'scripts/apply-lat-4corner-centroid-mode-patch.mjs'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

s = s.replace(
  "  process.exit(0)\n",
  "  // Do not exit the whole build-patch runner. Later patches add toolbar controls.\n"
)

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH LAT 4-corner patch no longer exits build runner')
} else {
  console.log('OK LAT 4-corner patch no-exit guard already applied')
}
