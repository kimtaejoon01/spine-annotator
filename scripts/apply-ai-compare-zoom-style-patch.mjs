#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/style.css'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

if (!s.includes('.ai-compare-actions')) {
  s += `

/* AI compare zoom / pan */
.ai-compare-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.ai-compare-actions .btn-icon {
  width: 28px;
  height: 26px;
  min-width: 28px;
  padding: 0;
  font-size: 11px;
}
#aiCompareZoomReset {
  width: 38px;
  min-width: 38px;
  font-size: 10px;
}
.ai-compare-stage {
  touch-action: none;
  user-select: none;
}
.ai-compare-stage.dragging,
.ai-compare-image-wrap.zoomed {
  cursor: grab;
}
.ai-compare-stage.dragging .ai-compare-image-wrap,
.ai-compare-image-wrap.dragging {
  cursor: grabbing !important;
}
.ai-compare-image-wrap {
  transform-origin: center center;
  will-change: transform;
}
`
  fs.writeFileSync(file, s)
  console.log('PATCH AI compare zoom styles')
} else {
  console.log('OK AI compare zoom styles already patched')
}
