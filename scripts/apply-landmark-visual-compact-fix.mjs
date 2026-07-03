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

// The 4-corner patch rewrites landmark-tools.js before this runs, so normalize
// both the original large values and the previous compact values.
s = s.replaceAll('radius: (isPending ? 6 : 5) / scale,', 'radius: (isPending ? 2.0 : 1.4) / scale,')
s = s.replaceAll('radius: (isPending ? 3.2 : 2.4) / scale,', 'radius: (isPending ? 2.0 : 1.4) / scale,')
s = s.replaceAll('strokeWidth: 1.5 / scale,', 'strokeWidth: 0.45 / scale,')
s = s.replaceAll('strokeWidth: 0.7 / scale,', 'strokeWidth: 0.45 / scale,')
s = s.replaceAll('x: 7 / scale,', 'x: 2.4 / scale,')
s = s.replaceAll('x: 3.8 / scale,', 'x: 2.4 / scale,')
s = s.replaceAll('y: -7 / scale,', 'y: -2.8 / scale,')
s = s.replaceAll('y: -4.2 / scale,', 'y: -2.8 / scale,')
s = s.replaceAll('fontSize: 10 / scale,', 'fontSize: 2.8 / scale,')
s = s.replaceAll('fontSize: 4.5 / scale,', 'fontSize: 2.8 / scale,')
s = s.replaceAll('strokeWidth: 2 / scale,', 'strokeWidth: 0.45 / scale,')
s = s.replaceAll('strokeWidth: 0.8 / scale,', 'strokeWidth: 0.45 / scale,')
s = s.replaceAll('strokeWidth: 1 / scale,\n    opacity,', 'strokeWidth: 0.55 / scale,\n    opacity,')

save(file, before, s, 'extra compact landmark marker/label size')
console.log('OK extra compact landmark marker/label size fix installed')
