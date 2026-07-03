#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

function findBlock(source, start) {
  const open = source.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  let quote = null
  let escape = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i + 2)
      i = nl < 0 ? source.length : nl
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 1
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        let end = i + 1
        while (source[end] === '\n' || source[end] === '\r') end++
        return { start, end }
      }
    }
  }
  return null
}

function removeDuplicateFunction(name) {
  const re = new RegExp('(^|\\n)([ \\t]*)function\\s+' + name + '\\s*\\(', 'g')
  const blocks = []
  let m
  while ((m = re.exec(s))) {
    const fnStart = m.index + m[1].length
    const block = findBlock(s, fnStart)
    if (block) blocks.push(block)
  }
  if (blocks.length <= 1) return
  for (const block of blocks.slice(0, -1).sort((a, b) => b.start - a.start)) {
    s = s.slice(0, block.start) + s.slice(block.end)
  }
  console.log(`DEDUP ${name}: ${blocks.length} -> keep last`)
}

for (const name of [
  'initAiCompareZoomControls',
  'zoomAiCompare',
  'zoomAiCompareAtCenter',
  'zoomAiCompareAtPoint',
  'resetAiCompareZoom',
  'applyAiCompareTransform',
]) {
  removeDuplicateFunction(name)
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH hard AI compare helper dedupe')
} else {
  console.log('OK no duplicate AI compare helpers')
}
