#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/style.css'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

const css = `

/* Right sidebar layout repair */
.sidebar-right .sidebar-scroll {
  overflow: hidden !important;
  min-height: 0;
}
.sidebar-right .panel {
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
}
.sidebar-right .panel-full {
  flex: 1 1 auto;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sidebar-right .panel-full > .panel-title {
  flex: 0 0 auto;
}
.sidebar-right .panel-full > .panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sidebar-right .panel-full .label-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 6px;
}
.sidebar-right .panel-collapsed {
  flex: 0 0 auto !important;
  min-height: 0 !important;
  overflow: visible;
}
.sidebar-right .panel-collapsed .panel-body {
  display: none !important;
}
.sidebar-right.right-sidebar-compact .panel-full {
  min-height: 100px;
}
`

if (!s.includes('Right sidebar layout repair')) {
  s += css
  fs.writeFileSync(file, s)
  console.log('PATCH right sidebar layout repair')
} else {
  console.log('OK right sidebar layout repair already patched')
}
