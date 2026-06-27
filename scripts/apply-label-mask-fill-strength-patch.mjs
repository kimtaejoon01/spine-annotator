#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/annotator.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

s = s.replace(
  "        fill: color + '33', // 20% 투명",
  "        fill: color + ((this.labelOverlayVisible !== false) ? '33' : '66'), // 선/이름표 숨김 시 마스크 fill은 더 잘 보이게"
)

// If previous patch already changed comment but not expression, normalize it.
s = s.replace(
  "        fill: color + '33',",
  "        fill: color + ((this.labelOverlayVisible !== false) ? '33' : '66'),"
)

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH label mask fill stronger when outlines hidden')
} else {
  console.log('OK label mask fill strength already patched')
}
