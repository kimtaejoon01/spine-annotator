#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const call = "  loadNoteForCurrentFile().catch(err => console.warn('Note load failed:', err))"
const wrong = "  state.imageHeight = state.annotator.imageHeight\n}\n" + call
const right = "  state.imageHeight = state.annotator.imageHeight\n" + call + "\n}"

if (s.includes(wrong)) {
  s = s.replace(wrong, right)
  fs.writeFileSync(file, s)
  console.log('PATCH note load call moved inside updateFileInfo')
} else if (!s.includes(right)) {
  const base = "  state.imageHeight = state.annotator.imageHeight\n}"
  if (!s.includes(base)) throw new Error('updateFileInfo note insert point not found')
  s = s.replace(base, right)
  fs.writeFileSync(file, s)
  console.log('PATCH note load call inserted inside updateFileInfo')
} else {
  console.log('OK note load call already inside updateFileInfo')
}
