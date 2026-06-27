#!/usr/bin/env node

import fs from 'node:fs'

const files = ['public/static/app.js']

function findFunctionBlock(source, start) {
  const open = source.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  let quote = null
  let templateDepth = 0
  let escape = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    const prev = source[i - 1]

    if (quote) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (quote === '`') {
        // Keep this simple: template interpolation braces are rare in the generated
        // top-level helper functions. They do not appear in the blocks we dedupe.
        if (ch === '`') quote = null
        continue
      }
      if (ch === quote) quote = null
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }

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

for (const file of files) {
  if (!fs.existsSync(file)) continue
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const before = source

  const matches = []
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm
  let m
  while ((m = re.exec(source))) {
    const name = m[1]
    const block = findFunctionBlock(source, m.index)
    if (block) matches.push({ name, ...block })
  }

  const byName = new Map()
  for (const item of matches) {
    const arr = byName.get(item.name) || []
    arr.push(item)
    byName.set(item.name, arr)
  }

  const remove = []
  for (const [name, arr] of byName) {
    if (arr.length <= 1) continue
    // Keep the last generated definition. Later build patches are intended to
    // override earlier helpers. This prevents ES module SyntaxError from duplicate
    // top-level function declarations.
    for (const item of arr.slice(0, -1)) remove.push(item)
    console.log(`DEDUP ${file}: ${name} x${arr.length} -> keep last`)
  }

  remove.sort((a, b) => b.start - a.start)
  for (const item of remove) {
    source = source.slice(0, item.start) + source.slice(item.end)
  }

  if (source !== before) {
    fs.writeFileSync(file, source)
    console.log('PATCH duplicate top-level functions removed from ' + file)
  } else {
    console.log('OK no duplicate top-level functions in ' + file)
  }
}
