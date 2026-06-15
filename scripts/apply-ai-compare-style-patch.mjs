#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/style.css'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

if (!s.includes('.ai-compare-panel')) {
  s += `

/* ============================================
   AI side-by-side comparison panel
   ============================================ */
.ai-compare-panel {
  position: absolute;
  top: 52px;
  right: 12px;
  bottom: 12px;
  width: min(42%, 520px);
  min-width: 320px;
  background: rgba(13, 17, 23, 0.96);
  border: 1px solid rgba(88, 166, 255, 0.28);
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(8px);
}
.ai-compare-panel.hidden { display: none; }
.ai-compare-header {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}
.ai-compare-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
}
.ai-compare-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}
.ai-compare-image-wrap {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  line-height: 0;
}
#aiCompareBase {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 180px);
  width: auto;
  height: auto;
  object-fit: contain;
}
#aiCompareOverlayStack,
.ai-compare-mask {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.ai-compare-caption {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.35;
  min-height: 30px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 7px;
  padding: 7px 8px;
  word-break: break-all;
}
@media (max-width: 1100px) {
  .ai-compare-panel {
    width: calc(100% - 24px);
    min-width: 0;
    top: auto;
    height: 42%;
  }
}
`
  console.log('PATCH AI compare styles')
} else {
  console.log('OK AI compare styles already patched')
}

fs.writeFileSync(file, s)
console.log('OK side-by-side AI compare styles installed')
