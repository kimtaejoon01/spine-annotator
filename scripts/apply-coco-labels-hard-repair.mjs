#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/coco.js'
const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
let s = before

s = s.replace(/ALL_(?:ALL_)+LABELS/g, 'ALL_LABELS')
s = s.replace("import { LABELS, getSupercategory } from './labels.js'", "import { ALL_LABELS, getSupercategory } from './labels.js'")
s = s.replace(/\bLABELS\s*\n\s*\.filter/g, 'ALL_LABELS\n    .filter')
s = s.replace(/\bLABELS\.indexOf\(/g, 'ALL_LABELS.indexOf(')

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH COCO ALL_LABELS hard repair')
} else {
  console.log('OK COCO ALL_LABELS hard repair already patched')
}

await import('./apply-landmark-list-hard-v2.mjs')
await import('./apply-landmark-list-v2-wrapper-fix.mjs')
await import('./apply-standalone-landmark-list-panel.mjs')
await import('./apply-landmark-dropdown-and-delete-semantics-fix.mjs')
await import('./apply-landmark-region-colors-fix.mjs')
await import('./apply-landmark-y-axis-relabel-fix.mjs')
await import('./apply-landmark-y-sorted-list-hard-fix.mjs')
