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

s = s.replaceAll('radius: (isPending ? 6 : 5) / scale,', 'radius: (isPending ? 3.2 : 2.4) / scale,')
s = s.replaceAll('strokeWidth: 1.5 / scale,', 'strokeWidth: 0.7 / scale,')
s = s.replaceAll('x: 7 / scale,', 'x: 3.8 / scale,')
s = s.replaceAll('y: -7 / scale,', 'y: -4.2 / scale,')
s = s.replaceAll('fontSize: 10 / scale,', 'fontSize: 4.5 / scale,')
s = s.replaceAll('strokeWidth: 2 / scale,', 'strokeWidth: 0.8 / scale,')
s = s.replaceAll('strokeWidth: 2 / scale,\n    opacity,', 'strokeWidth: 1 / scale,\n    opacity,')

save(file, before, s, 'compact landmark marker/label size')
console.log('OK compact landmark marker/label size fix installed')
