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

s = s.replace(
  `      group.on('dragmove', () => {\n        const pos = group.position()\n        lm.x = pos.x\n        lm.y = pos.y\n        this.renderLandmarks()\n      })\n      group.on('dragend', () => {\n        onChange?.()`,
  `      group.on('dragmove', () => {\n        const pos = group.position()\n        lm.x = pos.x\n        lm.y = pos.y\n        this.landmarkLayer.batchDraw()\n      })\n      group.on('dragend', () => {\n        this.renderLandmarks()\n        onChange?.()`
)

save(file, before, s, 'LAT landmark drag runtime fix')
console.log('OK LAT landmark runtime fix installed')
