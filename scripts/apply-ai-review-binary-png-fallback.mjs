#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/ai-review.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

const oldBlock = `  m = noExt.match(/^(?<base>.+?)_(?<region>cervical|thoracic|lumbar)_(?<model>.+)_mask$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, 'v0')
  return null
}`

const newBlock = `  m = noExt.match(/^(?<base>.+?)_(?<region>cervical|thoracic|lumbar)_(?<model>.+)_mask$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, 'v0')

  // Generic binary PNG fallback:
  // AI result folders often contain binary mask PNGs named exactly like the source image,
  // or with simple suffixes such as _mask, _binary, _binary_full, _seg.
  // Treat those as valid masks and match them to the original image base name.
  let genericBase = noExt
    .replace(/_(mask|binary|binary_full|seg|segmentation|label|labels)$/i, '')
    .replace(/_AIresult.*$/i, '')
  if (genericBase && genericBase !== noExt) {
    return normalizeAiMeta(genericBase, 'mask', 'binary_png', 'v0')
  }

  // Same filename as original image, inside an AI folder.
  return normalizeAiMeta(noExt, 'mask', 'binary_png', 'v0')
}`

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock)
} else if (!s.includes('Generic binary PNG fallback')) {
  throw new Error('AI review parseAiMaskFile patch point not found')
}

// Make original image folder scanner less aggressive: only exclude obvious AI masks.
s = s.replace(
  "    if (parseAiMaskFile(name, name)) continue\n    out.push({ name, handle: entry, base: imageBase(name) })",
  "    if (/_mask\\.|_binary\\.|_binary_full\\.|_seg\\.|_segmentation\\.|_label\\.|_labels\\./i.test(name)) continue\n    out.push({ name, handle: entry, base: imageBase(name) })"
)

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH AI review generic binary PNG mask fallback')
} else {
  console.log('OK AI review generic binary PNG mask fallback already patched')
}
