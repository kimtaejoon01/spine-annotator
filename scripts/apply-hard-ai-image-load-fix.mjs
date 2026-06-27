#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/annotator.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s

// 1) Image load must never crash when optional AI methods are absent.
s = s.replaceAll(
  '        this.clearAiMasks()\n',
  "        if (typeof this.clearAiMasks === 'function') this.clearAiMasks()\n"
)
s = s.replaceAll(
  '        if (typeof this.clearAiMasks === \'function\') this.clearAiMasks()\n',
  "        if (typeof this.clearAiMasks === 'function') this.clearAiMasks()\n"
)

// 2) Ensure AI mask state and layer exist.
if (!s.includes('this.aiMaskNodes = []')) {
  s = s.replace(
    '    this.imageFilters = { brightness: 0, contrast: 0, invert: false }',
    `    this.imageFilters = { brightness: 0, contrast: 0, invert: false }

    // AI mask overlay state
    this.aiMaskNodes = []
    this.aiMaskOpacity = 0.45
    this.aiMaskOverlayVisible = true`
  )
}

if (!s.includes('this.aiMaskLayer = new Konva.Layer()')) {
  s = s.replace(
    `    this.imageLayer = new Konva.Layer()
    this.polyLayer = new Konva.Layer()
    this.previewLayer = new Konva.Layer()`,
    `    this.imageLayer = new Konva.Layer()
    this.aiMaskLayer = new Konva.Layer()
    this.polyLayer = new Konva.Layer()
    this.previewLayer = new Konva.Layer()`
  )
  s = s.replace(
    `    this.stage.add(this.imageLayer)
    this.stage.add(this.polyLayer)
    this.stage.add(this.previewLayer)`,
    `    this.stage.add(this.imageLayer)
    this.stage.add(this.aiMaskLayer)
    this.stage.add(this.polyLayer)
    this.stage.add(this.previewLayer)`
  )
}

// 3) Restore methods if visibility refactors deleted them.
if (!s.includes('async loadAiMasks(items = [])')) {
  const methods = `
  // ============================================================
  // AI mask overlay methods
  // ============================================================
  setAiMaskVisible(visible) {
    this.aiMaskOverlayVisible = visible !== false
    if (this.aiMaskLayer) {
      this.aiMaskLayer.visible(this.aiMaskOverlayVisible)
      this.aiMaskLayer.batchDraw()
    }
  }

  setAiMaskOpacity(percent) {
    const value = Math.max(0, Math.min(100, Number(percent))) / 100
    this.aiMaskOpacity = value
    if (this.aiMaskLayer) {
      this.aiMaskLayer.opacity(value)
      this.aiMaskLayer.batchDraw()
    }
  }

  clearAiMasks() {
    this.aiMaskNodes = []
    if (this.aiMaskLayer) {
      this.aiMaskLayer.destroyChildren()
      this.aiMaskLayer.draw()
    }
  }

  async loadAiMasks(items = []) {
    this.clearAiMasks()
    if (!items.length || !this.imageWidth || !this.imageHeight || !this.aiMaskLayer) return
    const nodes = []
    for (const item of items) {
      try {
        const img = await this.loadMaskImage(item.url)
        const colored = this.colorizeMaskImage(img, item.color || '#58a6ff')
        const node = new Konva.Image({
          image: colored,
          x: 0,
          y: 0,
          width: this.imageWidth,
          height: this.imageHeight,
          listening: false,
          opacity: 1,
        })
        node.setAttr('aiRegion', item.region || '')
        node.setAttr('aiModel', item.modelKey || item.model || '')
        this.aiMaskLayer.add(node)
        nodes.push(node)
      } catch (err) {
        console.warn('[AI mask] load failed:', item, err)
      }
    }
    this.aiMaskNodes = nodes
    this.aiMaskLayer.opacity(this.aiMaskOpacity)
    this.aiMaskLayer.visible(this.aiMaskOverlayVisible)
    this.aiMaskLayer.draw()
  }

  loadMaskImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  colorizeMaskImage(img, color) {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const rgb = this.hexToRgb(color)
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i]
      const g = data.data[i + 1]
      const b = data.data[i + 2]
      const a = data.data[i + 3]
      const brightness = Math.max(r, g, b)
      if (a > 0 && brightness >= 128) {
        data.data[i] = rgb.r
        data.data[i + 1] = rgb.g
        data.data[i + 2] = rgb.b
        data.data[i + 3] = 230
      } else {
        data.data[i + 3] = 0
      }
    }
    ctx.putImageData(data, 0, 0)
    return canvas
  }

  hexToRgb(hex) {
    const m = String(hex).replace('#', '').match(/^([0-9a-f]{6})$/i)
    if (!m) return { r: 88, g: 166, b: 255 }
    const n = parseInt(m[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }

`
  const insertBefore = '  // ============================================================\n  // 줌 / 팬\n  // ============================================================'
  if (!s.includes(insertBefore)) throw new Error('Cannot find insert point for hard AI mask methods fix')
  s = s.replace(insertBefore, methods + insertBefore)
}

if (s !== before) {
  fs.writeFileSync(file, s)
  console.log('PATCH hard AI image load fix')
} else {
  console.log('OK hard AI image load fix already applied')
}
