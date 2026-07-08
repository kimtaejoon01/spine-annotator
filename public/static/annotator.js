/* ================================================================
   SpineAnnotator - Konva.js 기반 폴리곤 라벨링 엔진
   ================================================================ */

import { LABELS, getRegionColor, generateLabels, isSpineLabel, isExtraLabel, isPelvisPointLabel } from './labels.js'

const MIN_POINTS = 3
const POINT_RADIUS = 5
const POINT_RADIUS_HOVER = 7

let polyIdCounter = 1

export class SpineAnnotator {
  /**
   * @param {Object} opts
   * @param {string} opts.container - 컨테이너 element ID
   * @param {Function} opts.onPolygonsChange
   * @param {Function} opts.onZoomChange
   * @param {Function} opts.onStatusChange
   */
  constructor(opts) {
    this.opts = opts
    this.containerEl = document.getElementById(opts.container)

    // 상태
    this.tool = 'draw' // 'draw' | 'edit' | 'delete'
    this.polygons = [] // [{ id, label, points: [x,y,...], shape, vertexShapes }]
    this.selectedId = null
    this.startLabel = 'C2'
    this.pendingLabel = null
    this.pendingLabelMode = 'polygon'
    this.imageWidth = 0
    this.imageHeight = 0
    this.imageNode = null
    this.imageFilters = { brightness: 0, contrast: 0, invert: false }
    this.measurementDebug = { enabled: false, showLabels: true, showPoints: true, result: null }

    // 오버레이 표시 상태
    this.aiMaskNodes = []
    this.aiMaskOpacity = 0.45
    this.humanLabelVisible = true
    this.labelOverlayVisible = true
    this.aiMaskOverlayVisible = true

    // 그리기 중 상태
    this.drawing = false
    this.currentPoints = []
    this.previewLine = null
    this.previewClosing = null
    this.currentVertices = []

    // 편집 모드: 변 위 호버 미리보기 (점 추가용)
    this.editHover = null      // {polyId, x, y, insertIdx, edgeIdx} | null
    this.editHoverNode = null  // 미리보기 점(Konva.Circle)
    this.hoveringVertex = null // {polyId, vertexIdx} | null - 현재 마우스가 올라간 점

    // 팬 모드 (스페이스바)
    this.panMode = false

    // 자유곡선 드로잉 모드 (S키 + 드래그)
    // S 누른 상태에서 드래그하면 일정 간격마다 점이 자동 추가됨
    this.freehandMode = false      // S키 눌림 (드래그 안 해도 활성화)
    // 자유곡선 점 간격 (화면 픽셀 기준) — 작을수록 부드럽고 점 많아짐
    this.FREEHAND_SPACING_PX = 8

    // Undo/Redo
    this.history = []
    this.historyIdx = -1

    this.initStage()
  }

  // ============================================================
  // Stage 초기화
  // ============================================================
  initStage() {
    const rect = this.containerEl.getBoundingClientRect()

    this.stage = new Konva.Stage({
      container: this.opts.container,
      width: rect.width || 800,
      height: rect.height || 600,
      draggable: false,
    })

    this.imageLayer = new Konva.Layer()
    this.aiMaskLayer = new Konva.Layer()
    this.polyLayer = new Konva.Layer()
    this.previewLayer = new Konva.Layer()
    this.measurementLayer = new Konva.Layer({ listening: false })
    this.autoEndplateLayer = new Konva.Layer({ listening: false }) // 자동측정 종판선 전용 (다른 시스템이 못 지우게)

    this.stage.add(this.imageLayer)
    this.stage.add(this.aiMaskLayer)
    this.stage.add(this.polyLayer)
    this.stage.add(this.previewLayer)
    this.stage.add(this.measurementLayer)
    this.stage.add(this.autoEndplateLayer)

    // 리사이즈 대응
    window.addEventListener('resize', () => this.resize())

    // 마우스 이벤트
    this.stage.on('mousedown', (e) => this.onMouseDown(e))
    this.stage.on('mousemove', (e) => this.onMouseMove(e))
    this.stage.on('mouseup', (e) => this.onMouseUp(e))
    this.stage.on('dblclick', (e) => this.onDoubleClick(e))
    this.stage.on('wheel', (e) => this.onWheel(e))

    // 빈 영역 클릭 시 선택 해제
    // 단, 편집 모드에서 미리보기 점 클릭으로 점을 추가한 직후엔 선택 유지
    this.stage.on('click', (e) => {
      if (e.target === this.stage || e.target === this.imageNode) {
        if (this.tool === 'edit') {
          // 방금 점을 추가했다면 선택 유지 (방금 추가 플래그)
          if (this._justInsertedPoint) {
            this._justInsertedPoint = false
            return
          }
          this.selectPolygon(null)
        }
      }
    })
  }

  resize() {
    const rect = this.containerEl.getBoundingClientRect()
    this.stage.width(rect.width)
    this.stage.height(rect.height)
    this.refreshPolygonVisualScale()
  }

  // ============================================================
  // 이미지 로드
  // ============================================================
  loadImage(src) {
    return new Promise((resolve, reject) => {
      const imgObj = new Image()
      imgObj.crossOrigin = 'anonymous'
      imgObj.onload = () => {
        this.imageWidth = imgObj.width
        this.imageHeight = imgObj.height
        this.baseImageEl = imgObj  // 전처리 뷰의 원본 소스 (원본은 절대 변경 안 함)

        // 기존 이미지/AI 오버레이 제거
        this.imageLayer.destroyChildren()
        if (typeof this.clearAiMasks === 'function') this.clearAiMasks()

        this.imageNode = new Konva.Image({
          image: imgObj,
          x: 0,
          y: 0,
          width: imgObj.width,
          height: imgObj.height,
        })
        this.imageNode.cache()
        this.imageNode.filters([Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.Invert])
        this.applyImageFilters()

        this.imageLayer.add(this.imageNode)
        this.imageLayer.draw()

        // 화면 맞춤
        this.zoomToFit()

        // 폴리곤도 초기화
        this.clearAll(false)
        this.pushHistory()

        // 전처리 뷰 UI에 새 이미지 알림 (현재 뷰 재적용용)
        try { window.dispatchEvent(new CustomEvent('spine:image-loaded')) } catch (e) {}

        resolve()
      }
      imgObj.onerror = (err) => reject(err)
      imgObj.src = src
    })
  }

  applyImageFilters() {
    if (!this.imageNode) return
    // brightness: -1 ~ 1
    this.imageNode.brightness(this.imageFilters.brightness / 100)
    // contrast: -100 ~ 100
    this.imageNode.contrast(this.imageFilters.contrast)

    // invert 적용을 위해 필터 배열 동적 조정
    const filters = [Konva.Filters.Brighten, Konva.Filters.Contrast]
    if (this.imageFilters.invert) filters.push(Konva.Filters.Invert)
    this.imageNode.filters(filters)

    this.imageNode.cache()
    this.imageLayer.batchDraw()
  }

  setImageFilter(opts) {
    this.imageFilters = { ...this.imageFilters, ...opts }
    this.applyImageFilters()
  }

  // ============================================================
  // 전처리 뷰 (표시 전용) — 처리된 캔버스를 이미지 노드에 얹는다.
  // 노드 크기는 원본 그대로라 폴리곤 좌표계는 보존된다.
  // canvasOrNull === null 이면 원본으로 되돌린다.
  // ============================================================
  getBaseImageEl() {
    return this.baseImageEl || null
  }

  applyPreprocessCanvas(canvasOrNull) {
    if (!this.imageNode) return
    const src = canvasOrNull || this.baseImageEl
    if (!src) return
    this.imageNode.image(src)
    // brightness/contrast/invert 필터 재적용 + cache + redraw
    this.applyImageFilters()
  }

  // ============================================================
  // 폴리곤 자동 측정 오버레이 (상/하 종판선 + 4코너)
  // 이미지 좌표로 그리며 stage 변환(줌/팬)을 그대로 따라간다.
  // ============================================================
  clearAutoEndplateOverlay() {
    this._autoEndplateItems = null
    if (this._autoEndplateGroup) { this._autoEndplateGroup.destroy(); this._autoEndplateGroup = null }
    if (this.autoEndplateLayer) this.autoEndplateLayer.batchDraw()
  }

  drawAutoEndplateOverlay(items) {
    this._autoEndplateItems = items || null
    this._renderAutoEndplate()
  }

  // 줌 후 등 다시 그릴 때 (저장된 items로 재렌더)
  redrawAutoEndplate() {
    if (this._autoEndplateItems) this._renderAutoEndplate()
  }

  _renderAutoEndplate() {
    if (!this.autoEndplateLayer || !window.Konva) return
    if (this._autoEndplateGroup) { this._autoEndplateGroup.destroy(); this._autoEndplateGroup = null }
    const items = this._autoEndplateItems
    if (!items) { this.autoEndplateLayer.batchDraw(); return }
    const K = window.Konva
    const g = new K.Group({ listening: false })
    const s = (this.stage && this.stage.scaleX()) || 1
    const dotR = 3.5 / s   // 화면상 항상 ~3.5px (줌마다 재계산되어 커지지 않음)
    const fontPx = 12 / s
    // 선 두께는 줌에 따라 함께 스케일되는 기본값(처음 버전)
    const line = (a, b, color) => new K.Line({ points: [a[0], a[1], b[0], b[1]], stroke: color, strokeWidth: 2, listening: false })
    const dot = (p, color) => new K.Circle({ x: p[0], y: p[1], radius: dotR, fill: color, listening: false })
    for (const it of items) {
      const { SA, SP, IA, IP } = it
      if (SA && SP) g.add(line(SA, SP, '#39d353'))   // 상종판(초록)
      if (IA && IP) g.add(line(IA, IP, '#e3a008'))   // 하종판(주황)
      if (SA) g.add(dot(SA, '#f85149'))
      if (SP) g.add(dot(SP, '#f0e442'))
      if (IA) g.add(dot(IA, '#d946ef'))
      if (IP) g.add(dot(IP, '#ffffff'))
      const corners = [SA, SP, IA, IP].filter(Boolean)
      if (it.label && corners.length) {
        const cx = corners.reduce((a, p) => a + p[0], 0) / corners.length
        const cy = corners.reduce((a, p) => a + p[1], 0) / corners.length
        g.add(new K.Text({ x: cx, y: cy, text: it.label, fontSize: fontPx, fill: '#ffd43b', listening: false }))
      }
    }
    this._autoEndplateGroup = g
    this.autoEndplateLayer.add(g)
    this.autoEndplateLayer.batchDraw()
  }

  // ============================================================
  // 오버레이 표시 / AI mask
  // ============================================================
  setHumanLabelVisible(visible) {
    this.humanLabelVisible = visible !== false
    window.__spineHumanLabelVisible = this.humanLabelVisible
    if (this.polyLayer) this.polyLayer.visible(this.humanLabelVisible !== false)
    this.renderPolygons()
    if (this.polyLayer) {
      this.polyLayer.visible(this.humanLabelVisible !== false)
      this.polyLayer.batchDraw()
    }
  }

  getHumanLabelVisible() {
    return this.humanLabelVisible !== false
  }

  setLabelOverlayVisible(visible) {
    this.labelOverlayVisible = visible !== false
    window.__spineLineNameVisible = this.labelOverlayVisible
    this.renderPolygons()
  }

  getLabelOverlayVisible() {
    return this.labelOverlayVisible !== false
  }
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

  // ============================================================
  // 줌 / 팬
  // ============================================================
  zoomToFit() {
    if (!this.imageWidth) return
    const sw = this.stage.width()
    const sh = this.stage.height()
    const scaleX = sw / this.imageWidth
    const scaleY = sh / this.imageHeight
    const scale = Math.min(scaleX, scaleY) * 0.95

    this.stage.scale({ x: scale, y: scale })
    this.stage.position({
      x: (sw - this.imageWidth * scale) / 2,
      y: (sh - this.imageHeight * scale) / 2,
    })
    this.stage.batchDraw()
    this.renderMeasurementDebugOverlay?.()
    this.notifyZoom()
    this.refreshPolygonVisualScale()
  }

  zoomTo(scale) {
    const sw = this.stage.width()
    const sh = this.stage.height()
    const center = { x: sw / 2, y: sh / 2 }
    this.zoomAtPoint(scale, center)
  }

  zoomBy(factor) {
    const current = this.stage.scaleX()
    const sw = this.stage.width()
    const sh = this.stage.height()
    const center = { x: sw / 2, y: sh / 2 }
    this.zoomAtPoint(current * factor, center)
  }

  zoomAtPoint(newScale, point) {
    newScale = Math.max(0.05, Math.min(20, newScale))
    const oldScale = this.stage.scaleX()
    const stagePos = this.stage.position()

    const mousePointTo = {
      x: (point.x - stagePos.x) / oldScale,
      y: (point.y - stagePos.y) / oldScale,
    }

    this.stage.scale({ x: newScale, y: newScale })
    this.stage.position({
      x: point.x - mousePointTo.x * newScale,
      y: point.y - mousePointTo.y * newScale,
    })
    this.stage.batchDraw()
    this.renderMeasurementDebugOverlay?.()
    this.notifyZoom()
    this.refreshPolygonVisualScale()
  }

  onWheel(e) {
    e.evt.preventDefault()
    const pointer = this.stage.getPointerPosition()
    if (!pointer) return

    // deltaY를 픽셀 단위로 정규화 (deltaMode: 0=픽셀, 1=라인, 2=페이지)
    let dy = e.evt.deltaY
    if (e.evt.deltaMode === 1) dy *= 16      // 라인 → 픽셀 근사
    else if (e.evt.deltaMode === 2) dy *= 100 // 페이지 → 픽셀 근사

    // 한 번의 deltaY가 너무 크면 클램프 (마우스 휠 한 칸이 100~120 정도)
    // 트랙패드는 보통 1~30, 부드러운 마우스는 30~80
    dy = Math.max(-200, Math.min(200, dy))

    // 줌 감도: dy=100(마우스 휠 한 칸)일 때 약 5% 줌
    // factor = exp(-dy * sensitivity)로 양방향 대칭 부드러운 줌
    const sensitivity = 0.0005   // 값이 작을수록 부드러움 (0.001=빠름, 0.0005=중간, 0.0003=느림)
    const factor = Math.exp(-dy * sensitivity)

    const newScale = this.stage.scaleX() * factor
    // 스케일 범위 제한 (너무 작거나 큰 줌 방지)
    const clamped = Math.max(0.05, Math.min(20, newScale))
    this.zoomAtPoint(clamped, pointer)
  }

  notifyZoom() {
    this.renderLandmarks?.()
    if (this.opts.onZoomChange) this.opts.onZoomChange(this.stage.scaleX())
  }

  setPanMode(enabled) {
    this.panMode = enabled
    this.stage.draggable(enabled)
    if (enabled) this.clearEditHover()
    this.containerEl.style.cursor = enabled ? 'grab' : (
      this.tool === 'draw' ? 'crosshair' :
      this.tool === 'delete' ? 'not-allowed' : 'default'
    )
  }

  /**
   * 자유 곡선 모드 (S키 누름)
   * - 활성화 시: 마우스를 움직이면 일정 간격마다 점 자동 추가됨
   * - 그리기 도구일 때만 의미 있음
   * - 비활성화 시: 일반 클릭 모드로 복귀
   */
  setFreehandMode(enabled) {
    this.freehandMode = enabled
    // 그리기 모드에서만 시각 피드백
    if (this.tool === 'draw' && !this.panMode) {
      this.containerEl.style.cursor = enabled ? 'cell' : 'crosshair'
    }
    this.updateStatus()
  }

  // ============================================================
  // 도구 변경
  // ============================================================
  setTool(tool) {
    // 그리는 중이면 → draw/edit 사이 전환은 상태 유지, 그 외엔 취소
    if (this.drawing) {
      if (tool === 'draw' || tool === 'edit') {
        // 점들 그대로 유지. 편집 모드에선 점 드래그로 위치 조정 가능
        this.tool = tool
        this.clearEditHover()
        this.selectPolygon(null)
        this.setPanMode(this.panMode)
        this.updateDraftVerticesDraggable() // 그리던 점들의 드래그 가능 상태 토글
        this.updateStatus()
        return
      }
      // delete 모드 등으로 가면 그리던 거 취소
      this.cancelDrawing()
    }

    this.tool = tool
    this.clearEditHover()
    this.selectPolygon(null)
    this.setPanMode(this.panMode) // 커서 갱신
    this.updateStatus()
  }

  /**
   * 그리는 중인 점들(currentVertices)의 draggable 상태를 현재 도구에 맞게 갱신
   * - edit 모드: 드래그로 위치 조정 가능
   * - draw 모드: 드래그 불가 (원래대로)
   */
  updateDraftVerticesDraggable() {
    if (!this.drawing) return
    const draggable = (this.tool === 'edit')
    for (let i = 0; i < this.currentVertices.length; i++) {
      const v = this.currentVertices[i]
      if (!v) continue
      v.draggable(draggable)
      // 편집 모드일 때 드래그 이벤트 (한 번만 바인딩되도록 attr로 체크)
      if (draggable && !v.getAttr('_draftDragBound')) {
        v.setAttr('_draftDragBound', true)
        const idx = i * 2 // currentPoints 인덱스
        v.on('dragmove.draft', () => {
          const pos = v.position()
          this.currentPoints[idx] = pos.x
          this.currentPoints[idx + 1] = pos.y
          // 미리보기 라인 갱신
          if (this.previewLine) {
            this.previewLine.points(this.currentPoints.slice())
            this.previewLayer.batchDraw()
          }
        })
        v.on('mouseenter.draft', () => {
          if (this.tool === 'edit') this.containerEl.style.cursor = 'grab'
        })
        v.on('mouseleave.draft', () => {
          if (this.tool === 'edit') this.containerEl.style.cursor = 'default'
        })
      }
    }
    this.previewLayer.batchDraw()
  }



  updateStatus() {
    let text = ''
    if (this.panMode) {
      text = '팬 모드 - 드래그하여 화면 이동'
    } else if (this.freehandMode && this.tool === 'draw') {
      const n = this.currentPoints.length / 2
      if (this.freehandDragging) {
        text = `🖊️ 자유곡선 모드 — 마우스를 움직이면 점 추가 (현재 ${n}개) / S 떼면 일시 정지 / Q: 완성`
      } else if (this.drawing) {
        text = `🖊️ 자유곡선 모드 — 마우스를 움직이면 점 추가 (현재 ${n}개) / S 떼면 일시 정지 / Q: 완성`
      } else {
        text = '🖊️ 자유곡선 모드 — 마우스를 움직이면 바로 점이 찍힙니다 (S 떼면 일반 클릭 모드)'
      }
    } else if (this.tool === 'draw') {
      if (this.drawing) {
        const n = this.currentPoints.length / 2
        text = `점 ${n}개 — Q: 순서대로 완성 / W: 각도순 정렬 완성 / E: 마지막 점 취소 / S+마우스 이동: 자유곡선`
      } else {
        text = '그리기 모드 — 클릭으로 점 추가 / S 누른 채 마우스 이동: 자유곡선'
      }
    } else if (this.tool === 'edit') {
      if (this.drawing) {
        const n = this.currentPoints.length / 2
        text = `편집 중 (그리던 폴리곤 점 ${n}개) — 점 드래그로 조정 / Enter: 순서대로 완성 / Shift+Enter: 각도순 완성 / Esc: 취소`
      } else {
        text = '편집 모드 — 점 드래그로 이동 / 변 위 클릭으로 점 추가 / 점 위에서 R: 점 삭제 (우클릭/더블클릭도 가능)'
      }
    } else if (this.tool === 'delete') {
      text = '삭제 모드 - 삭제할 폴리곤을 클릭하세요'
    }
    if (this.opts.onStatusChange) this.opts.onStatusChange(text)
  }

  // ============================================================
  // 마우스 이벤트 핸들러
  // ============================================================
  onMouseDown(e) {
    if (this.panMode) return // 스페이스+드래그 모드는 stage가 처리

    // 캔버스 좌표 → 이미지 좌표 변환
    const pos = this.getImagePos()
    if (!pos) return

    if (this.tool === 'draw') {
      // 클릭이 점/선/이미지 어디에서 발생했든 점 추가
      if (e.evt.button !== 0) return // 좌클릭만

      // 이미 만든 폴리곤의 점/선을 클릭하면 무시 (편집은 edit 모드에서)
      if (e.target.getAttr('polyId') && !this.drawing) {
        // 그릴 때는 본인 점 클릭으로 닫기 가능 (시작점)
        return
      }
      // 자유곡선 모드에서는 클릭이 아니라 마우스 이동으로 점을 추가합니다.
      // 마우스를 누르고 있을 필요가 없도록 여기서는 일반 클릭 점 추가를 막습니다.
      if (this.freehandMode) return

      this.addPoint(pos.x, pos.y)
    } else if (this.tool === 'edit') {
      // 좌클릭만 처리 (우클릭은 점 삭제용 contextmenu)
      if (e.evt.button !== 0) return

      // 그리는 중인 폴리곤이 있으면 점 추가 X (드래그로 점 조정에 집중)
      if (this.drawing) return

      // 변 위 호버 미리보기가 있고 점이 아닌 곳을 클릭 → 점 삽입
      if (this.editHover && this.hoveringVertex == null) {
        const polyId = this.editHover.polyId
        const insertIdx = this.editHover.insertIdx
        const { x, y } = this.editHover
        const poly = this.polygons.find(p => p.id === polyId)
        if (poly) {
          poly.points.splice(insertIdx, 0, x, y)
          this.clearEditHover()
          this._justInsertedPoint = true // stage click의 선택 해제 방지
          this.renderPolygons()
          this.pushHistory()
          this.notifyPolygons()
        }
      }
    }
  }

  onMouseUp(e) {
    // 자유곡선은 이제 마우스 버튼을 누르고 있을 필요가 없으므로 별도 처리 없음
  }

  onMouseMove(e) {
    const pos = this.getImagePos()

    // S 자유곡선 모드: 마우스 버튼을 누르지 않고 이동만 해도 일정 간격마다 점 추가
    if (this.tool === 'draw' && this.freehandMode && !this.panMode) {
      if (!pos) return

      const n = this.currentPoints.length
      if (!this.drawing || n < 2) {
        this.addPoint(pos.x, pos.y)
        return
      }

      const lastX = this.currentPoints[n - 2]
      const lastY = this.currentPoints[n - 1]
      const dx = pos.x - lastX
      const dy = pos.y - lastY
      const screenDist = Math.sqrt(dx * dx + dy * dy) * this.stage.scaleX()
      if (screenDist >= this.FREEHAND_SPACING_PX) {
        this.addPoint(pos.x, pos.y)
        return
      }

      this.updatePreview(pos.x, pos.y)
      return
    }

    // 그리기 중 + 그리기 모드: 기존 미리보기 동작
    if (this.drawing && this.tool === 'draw') {
      if (!pos) return
      this.updatePreview(pos.x, pos.y)
      return
    }

    // 편집 모드 + 그리기 아님: 선택된 폴리곤의 변 호버 미리보기
    if (this.tool === 'edit' && !this.drawing && this.selectedId != null && !this.panMode) {
      this.updateEditHover()
    } else if (this.editHover) {
      this.clearEditHover()
    }
  }

  /**
   * 마우스 위치에서 가장 가까운 변을 찾아 미리보기 점 표시
   * 변과의 거리가 일정 임계값 이내일 때만 표시
   */
  updateEditHover() {
    // 점 위에 있을 땐 변 미리보기 끄기 (드래그/단축키 삭제가 우선)
    if (this.hoveringVertex) {
      this.clearEditHover()
      return
    }
    const pos = this.getImagePos()
    if (!pos) return

    const poly = this.polygons.find(p => p.id === this.selectedId)
    if (!poly) return

    // 화면 기준 임계값 (스케일 보정 → 이미지 좌표계)
    const scale = this.stage.scaleX()
    const threshold = 15 / scale // 화면상 15px 이내

    const n = poly.points.length / 2
    let best = null
    for (let i = 0; i < n; i++) {
      const x1 = poly.points[i * 2]
      const y1 = poly.points[i * 2 + 1]
      const x2 = poly.points[((i + 1) % n) * 2]
      const y2 = poly.points[((i + 1) % n) * 2 + 1]
      const info = pointToSegmentInfo(pos.x, pos.y, x1, y1, x2, y2)
      if (info.dist <= threshold && (!best || info.dist < best.dist)) {
        best = { ...info, insertIdx: (i + 1) * 2, edgeIdx: i }
      }
    }

    if (best) {
      this.editHover = {
        polyId: poly.id,
        x: best.x,
        y: best.y,
        insertIdx: best.insertIdx,
        edgeIdx: best.edgeIdx,
      }
      this.renderEditHover(poly)
      this.containerEl.style.cursor = 'copy'
    } else {
      this.clearEditHover()
    }
  }

  /** 호버 미리보기 점 그리기 (없으면 생성, 있으면 위치만 업데이트) */
  renderEditHover(poly) {
    if (!this.editHover) return
    const scale = this.stage.scaleX()
    const color = getRegionColor(poly.label)

    if (!this.editHoverNode) {
      this.editHoverNode = new Konva.Circle({
        x: this.editHover.x,
        y: this.editHover.y,
        radius: (POINT_RADIUS + 1) / scale,
        fill: '#ffffff',
        stroke: color,
        strokeWidth: 2 / scale,
        opacity: 0.85,
        dash: [3 / scale, 3 / scale],
        listening: false,
      })
      this.previewLayer.add(this.editHoverNode)
    } else {
      this.editHoverNode.position({ x: this.editHover.x, y: this.editHover.y })
      this.editHoverNode.radius((POINT_RADIUS + 1) / scale)
      this.editHoverNode.strokeWidth(2 / scale)
      this.editHoverNode.stroke(color)
      this.editHoverNode.dash([3 / scale, 3 / scale])
    }
    this.previewLayer.batchDraw()
  }

  /** 호버 미리보기 제거 */
  clearEditHover() {
    if (this.editHoverNode) {
      this.editHoverNode.destroy()
      this.editHoverNode = null
      this.previewLayer.batchDraw()
    }
    this.editHover = null
    // 커서 복귀 (그리기/삭제 모드면 그쪽으로)
    if (this.tool === 'edit' && !this.panMode) {
      this.containerEl.style.cursor = 'default'
    }
  }

  onDoubleClick(e) {
    if (this.tool === 'draw' && this.drawing) {
      e.evt.preventDefault()
      this.finishDrawing()
    }
  }

  /** 스테이지 마우스 좌표 → 이미지 좌표 */
  getImagePos() {
    const pointer = this.stage.getPointerPosition()
    if (!pointer) return null
    const transform = this.stage.getAbsoluteTransform().copy().invert()
    return transform.point(pointer)
  }

  // ============================================================
  // 폴리곤 그리기
  // ============================================================
  setPendingLabel(label, mode = '') {
    this.pendingLabel = label || null
    this.pendingLabelMode = mode || (isPelvisPointLabel(label) ? 'point' : 'polygon')
    this.updateStatus()
  }

  addLandmarkPoint(x, y, label) {
    if (!label) return
    const r = 5 / Math.max(0.1, this.stage.scaleX())
    const points = [x, y - r, x + r, y, x, y + r, x - r, y]
    const newPoly = {
      id: polyIdCounter++,
      label,
      points,
      manualLabel: true,
      landmark: true,
    }
    this.polygons.push(newPoly)
    this.pendingLabel = null
    this.pendingLabelMode = 'polygon'
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
    this.updateStatus()
  }

  addPoint(x, y) {
    // PELVIS_POINT_LABEL_ONE_SHOT
    if (!this.drawing && this.pendingLabel && this.pendingLabelMode === 'point') {
      this.addLandmarkPoint(x, y, this.pendingLabel)
      return
    }
    if (!this.drawing && this.pendingLabel && this.pendingLabelMode === 'point') {
      this.addLandmarkPoint(x, y, this.pendingLabel)
      return
    }
    if (!this.drawing) {
      this.drawing = true
      this.currentPoints = []
      this.currentVertices = []

      // 미리보기 라인
      this.previewLine = new Konva.Line({
        points: [],
        stroke: '#ffffff',
        strokeWidth: 2 / this.stage.scaleX(),
        dash: [],
      })
      this.previewLayer.add(this.previewLine)

      // 마우스 따라가는 닫힘 미리보기
      this.previewClosing = new Konva.Line({
        points: [],
        stroke: '#ffffff',
        strokeWidth: 1.5 / this.stage.scaleX(),
        dash: [5 / this.stage.scaleX(), 5 / this.stage.scaleX()],
        opacity: 0.6,
      })
      this.previewLayer.add(this.previewClosing)
    }

    // 같은 자리 더블클릭으로 점이 중복 찍히는 것 방지 (화면상 1px 이내)
    // 폴리곤 자동 닫힘은 더 이상 하지 않음 - 사용자가 명시적으로 종료해야 함
    // (척추체 변형/압박골절의 경우 점을 빽빽하게 찍어야 하므로)
    const n = this.currentPoints.length
    if (n >= 2) {
      const lastX = this.currentPoints[n - 2]
      const lastY = this.currentPoints[n - 1]
      const dx = x - lastX
      const dy = y - lastY
      const screenDist = Math.sqrt(dx * dx + dy * dy) * this.stage.scaleX()
      if (screenDist < 1) {
        // 너무 가까운 점은 무시 (더블클릭의 첫 클릭이 점 추가, 두번째 클릭은 종료)
        return
      }
    }

    this.currentPoints.push(x, y)

    // 점 표시 (첫 점은 시작점 표시를 위해 약간만 크게)
    const isFirst = this.currentVertices.length === 0
    const vertex = new Konva.Circle({
      x,
      y,
      radius: (isFirst ? POINT_RADIUS + 1 : POINT_RADIUS) / this.stage.scaleX(),
      fill: '#ffffff',
      stroke: '#ffffff',
      strokeWidth: 1 / this.stage.scaleX(),
    })
    this.previewLayer.add(vertex)
    this.currentVertices.push(vertex)

    this.previewLine.points(this.currentPoints.slice())
    this.previewLayer.batchDraw()
    this.updateStatus()
  }

  updatePreview(x, y) {
    if (!this.drawing) return
    const n = this.currentPoints.length
    if (n === 0) return

    const lastX = this.currentPoints[n - 2]
    const lastY = this.currentPoints[n - 1]
    const firstX = this.currentPoints[0]
    const firstY = this.currentPoints[1]

    // 마지막 점 → 마우스 라인
    const linePts = this.currentPoints.slice()
    linePts.push(x, y)
    this.previewLine.points(linePts)

    // 닫힘 미리보기: 마우스 → 첫 점
    if (this.currentPoints.length >= MIN_POINTS * 2) {
      this.previewClosing.points([x, y, firstX, firstY])
    }

    this.previewLayer.batchDraw()
  }

  /**
   * 폴리곤 완성
   * @param {Object} [opts]
   * @param {boolean} [opts.angularSort=false] - true면 점들을 각도순으로 자동 정렬
   */
  finishDrawing(opts = {}) {
    if (!this.drawing) return

    // 더블클릭으로 종료한 경우, 마지막 두 점이 같은 위치일 수 있어서 중복 제거
    const pts = this.currentPoints
    if (pts.length >= 4) {
      const dx = pts[pts.length - 2] - pts[pts.length - 4]
      const dy = pts[pts.length - 1] - pts[pts.length - 3]
      const screenDist = Math.sqrt(dx * dx + dy * dy) * this.stage.scaleX()
      if (screenDist < 3) {
        pts.pop()
        pts.pop()
      }
    }

    if (this.currentPoints.length < MIN_POINTS * 2) {
      this.cancelDrawing()
      return
    }

    let points = this.currentPoints.slice()

    // 각도순 자동 정렬 (자유 완성)
    if (opts.angularSort) {
      points = sortPointsByAngle(points)
    }

    // 폴리곤 추가
    const newPoly = {
      id: polyIdCounter++,
      label: this.pendingLabel || null,
      points,
      manualLabel: !!this.pendingLabel,
      landmark: false,
    }
    this.polygons.push(newPoly)

    // 정리
    this.cleanupPreview()
    this.drawing = false

    // 라벨 자동 할당 (Y좌표 정렬)
    this.relabelAll()

    // 렌더링
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
    this.updateStatus()
  }

  cancelDrawing() {
    if (!this.drawing) return
    this.cleanupPreview()
    this.drawing = false
    this.updateStatus()
  }

  /** 그리는 중 마지막 점 하나 취소 (Backspace) */
  removeLastPoint() {
    if (!this.drawing) return false
    if (this.currentPoints.length === 0) return false

    this.currentPoints.pop()
    this.currentPoints.pop()

    const lastVertex = this.currentVertices.pop()
    if (lastVertex) lastVertex.destroy()

    if (this.currentPoints.length === 0) {
      this.cancelDrawing()
      return true
    }

    this.previewLine.points(this.currentPoints.slice())
    // 닫힘 미리보기 갱신은 mousemove 때 일어남
    if (this.currentPoints.length < MIN_POINTS * 2) {
      this.previewClosing.points([])
    }
    this.previewLayer.batchDraw()
    this.updateStatus()
    return true
  }

  cleanupPreview() {
    if (this.previewLine) {
      this.previewLine.destroy()
      this.previewLine = null
    }
    if (this.previewClosing) {
      this.previewClosing.destroy()
      this.previewClosing = null
    }
    this.currentVertices.forEach(v => v.destroy())
    this.currentVertices = []
    this.currentPoints = []
    this.previewLayer.batchDraw()
  }

  // ============================================================
  // 자동 라벨 할당 (Y좌표 위→아래)
  // ============================================================
  relabelAll() {
    const autoPolygons = this.polygons.filter(p => !p.manualLabel && (!p.label || isSpineLabel(p.label) || String(p.label).startsWith('?')))
    autoPolygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    autoPolygons.sort((a, b) => a._centroidY - b._centroidY)
    const labels = generateLabels(this.startLabel, autoPolygons.length)
    autoPolygons.forEach((p, i) => { p.label = labels[i] })

    this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    this.polygons.sort((a, b) => a._centroidY - b._centroidY)
  }
  setStartLabel(label) {
    this.startLabel = label
    this.relabelAll()
    this.renderPolygons()
    this.notifyPolygons()
  }

  normalizeVertebraLabelsByY(opts = {}) {
    if (!Array.isArray(this.polygons) || this.polygons.length === 0) return false
    const anchorId = opts.anchorId
    const anchorLabel = opts.anchorLabel
    const force = opts.force === true
    const vertebrae = this.polygons.filter(p => LABELS.includes(p.label) || !p.label || p.label === '?')
    if (vertebrae.length === 0) return false
    vertebrae.forEach(p => { p._centroidY = computeCentroidY(p.points) })
    vertebrae.sort((a, b) => a._centroidY - b._centroidY)

    let baseIdx = -1
    if (anchorId != null && LABELS.includes(anchorLabel)) {
      const yIdx = vertebrae.findIndex(p => p.id === anchorId)
      if (yIdx >= 0) baseIdx = LABELS.indexOf(anchorLabel) - yIdx
    }

    if (baseIdx < 0) {
      const counts = new Map()
      for (let i = 0; i < vertebrae.length; i++) {
        const idx = LABELS.indexOf(vertebrae[i].label)
        if (idx < 0) continue
        const candidate = idx - i
        if (candidate < 0 || candidate >= LABELS.length) continue
        counts.set(candidate, (counts.get(candidate) || 0) + 1)
      }
      let bestCount = -1
      for (const [candidate, count] of counts.entries()) {
        if (count > bestCount) { baseIdx = candidate; bestCount = count }
      }
    }

    if (baseIdx < 0) baseIdx = Math.max(0, LABELS.indexOf(this.startLabel || 'C2'))
    baseIdx = Math.max(0, Math.min(baseIdx, LABELS.length - 1))

    let changed = false
    for (let i = 0; i < vertebrae.length; i++) {
      const next = LABELS[baseIdx + i]
      if (!next) break
      const idx = LABELS.indexOf(vertebrae[i].label)
      if (force || idx !== baseIdx + i) {
        vertebrae[i].label = next
        changed = true
      }
    }
    if (LABELS[baseIdx]) this.startLabel = LABELS[baseIdx]

    // Keep internal order consistent with visual top-to-bottom order while preserving non-vertebra polygons.
    const nonVertebrae = this.polygons.filter(p => !vertebrae.includes(p))
    this.polygons = [...vertebrae, ...nonVertebrae]
    return changed
  }

  setLabelForPolygon(id, newLabel, opts = {}) {
    const poly = this.polygons.find(p => p.id === id)
    if (!poly) return
    if (!LABELS.includes(newLabel)) {
      poly.label = newLabel
      this.renderPolygons()
      this.pushHistory()
      this.notifyPolygons()
      return
    }
    poly.label = newLabel
    this.normalizeVertebraLabelsByY({ anchorId: id, anchorLabel: newLabel, force: true })
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }

  relabelFromPolygon(id, startLabel) {
    this.setLabelForPolygon(id, startLabel)
  }
  isPolygonAnnotationMode() {
    return (this.__activeAnnotationMode || 'polygon') === 'polygon'
  }

  enforceAnnotationModeVisibility() {
    const polygonMode = this.isPolygonAnnotationMode?.() !== false
    const hideLayer = (layer) => { layer?.hide?.(); layer?.visible?.(false); layer?.batchDraw?.() }
    const showLayer = (layer) => { layer?.show?.(); layer?.visible?.(true); layer?.batchDraw?.() }
    const showMeasurements = !!(this.measurementDebug?.enabled && this.measurementDebug?.result?.debug)
    if (polygonMode) {
      showLayer(this.polyLayer)
      showLayer(this.previewLayer)
      if (showMeasurements) showLayer(this.measurementLayer)
      else hideLayer(this.measurementLayer)
      hideLayer(this.landmarkLayer)
    } else {
      hideLayer(this.polyLayer)
      hideLayer(this.previewLayer)
      if (showMeasurements) showLayer(this.measurementLayer)
      else hideLayer(this.measurementLayer)
      showLayer(this.landmarkLayer)
      this.landmarkLayer?.moveToTop?.()
    }
    this.renderMeasurementDebugOverlay?.()
    this.stage?.batchDraw?.()
  }

  // ============================================================
  // 폴리곤 렌더링
  // ============================================================
  renderPolygons() {
    // 옛 vertex node들이 destroy되면 mouseleave가 호출되지 않을 수 있어
    // hoveringVertex가 stale 상태로 남으면 변-호버 미리보기가 차단됨.
    // → 매 렌더 직전에 호버 상태를 비워서 새 vertex의 mouseenter가 다시 잡도록 한다.
    this.hoveringVertex = null
    this.polyLayer.destroyChildren()
    this.polyLayer.visible(this.humanLabelVisible !== false)

    this.polygons.forEach(poly => {
      const color = getRegionColor(poly.label)
      const isSelected = poly.id === this.selectedId

      const group = new Konva.Group({ polyId: poly.id })

      // 폴리곤 채움
      const shape = new Konva.Line({
        points: poly.points,
        fill: color + '33', // 20% 투명
        stroke: color,
        strokeWidth: (isSelected ? 3 : 2) / this.stage.scaleX(),
        closed: true,
        polyId: poly.id,
      })
      // VISIBILITY_MODULE_FINAL_OUTLINE: line/name toggle hides outline only.
      // Mask fill stays visible until humanLabelVisible hides the full polyLayer.
      if (this.labelOverlayVisible === false) {
        shape.strokeEnabled(false)
        shape.strokeWidth(0)
      } else {
        shape.strokeEnabled(true)
        shape.stroke(color)
        shape.strokeWidth((isSelected ? 3 : 2) / this.stage.scaleX())
      }
            group.add(shape)

      // 라벨 텍스트 — 폴리곤 크기에 비례
      // 1) 폴리곤 bounding box로 라벨 크기 결정
      // 2) 너무 작은 폴리곤은 라벨 숨김 (선택된 것만 표시)
      // 3) 배경은 반투명, 줌과 무관하게 일정한 시각적 크기 유지
      const centroid = computeCentroid(poly.points)
      const bbox = computeBBox(poly.points)
      const polyMinDim = Math.min(bbox.w, bbox.h) // 이미지 픽셀 기준

      // 화면 픽셀 기준 폰트 크기: 폴리곤 짧은 변의 약 22% (최소 7, 최대 13)
      // scaleX 곱하면 화면 픽셀 → 이미지 픽셀로 환산
      const screenScale = this.stage.scaleX()
      const polyScreenMin = polyMinDim * screenScale // 화면 픽셀 환산
      const fontScreenPx = Math.max(7, Math.min(13, polyScreenMin * 0.22))

      // 폴리곤이 화면에서 너무 작으면 (16px 이하) 라벨 숨김. 단 선택된 것은 항상 표시
                  const showLabel = (this.humanLabelVisible !== false) && (this.labelOverlayVisible !== false) && (polyScreenMin >= 16 || isSelected)

      // 라벨 노드는 dragmove에서 위치 갱신해야 하므로 outer-scope에 선언
      // (showLabel=false면 null로 남고, dragmove는 null 체크 후 스킵)
      let labelText = null
      let labelBg = null
      let labelPadX = 0
      let labelPadY = 0

      if (showLabel) {
        const fontSize = fontScreenPx / screenScale
        labelPadX = (fontScreenPx * 0.35) / screenScale
        labelPadY = (fontScreenPx * 0.15) / screenScale

        const label = poly.label || '?'
        labelText = new Konva.Text({
          x: centroid.x,
          y: centroid.y,
          text: label,
          fontSize,
          fontStyle: 'bold',
          fill: '#ffffff',
          align: 'center',
          verticalAlign: 'middle',
          listening: false,
        })
        labelText.offsetX(labelText.width() / 2)
        labelText.offsetY(labelText.height() / 2)

        labelBg = new Konva.Rect({
          x: centroid.x - labelText.width() / 2 - labelPadX,
          y: centroid.y - labelText.height() / 2 - labelPadY,
          width: labelText.width() + labelPadX * 2,
          height: labelText.height() + labelPadY * 2,
          fill: color,
          opacity: isSelected ? 0.92 : 0.7, // 반투명: X-ray 가독성 확보
          cornerRadius: 3 / screenScale,
          listening: false,
        })

        group.add(labelBg)
        group.add(labelText)
      }

      // 편집 모드: 점 핸들
      if (this.tool === 'edit' && isSelected) {
        for (let i = 0; i < poly.points.length; i += 2) {
          const vertex = new Konva.Circle({
            x: poly.points[i],
            y: poly.points[i + 1],
            radius: POINT_RADIUS / this.stage.scaleX(),
            fill: '#ffffff',
            stroke: color,
            strokeWidth: 2 / this.stage.scaleX(),
            draggable: true,
            polyId: poly.id,
            vertexIdx: i,
          })

          vertex.on('mouseenter', () => {
            this.containerEl.style.cursor = 'grab'
            vertex.radius(POINT_RADIUS_HOVER / this.stage.scaleX())
            this.polyLayer.batchDraw()
            // 점 위에선 변 미리보기 끄기
            this.hoveringVertex = { polyId: poly.id, vertexIdx: i }
            this.clearEditHover()
          })
          vertex.on('mouseleave', () => {
            this.containerEl.style.cursor = 'default'
            vertex.radius(POINT_RADIUS / this.stage.scaleX())
            this.polyLayer.batchDraw()
            // 같은 점에서 떠날 때만 해제 (혹시 모를 race condition 방지)
            if (this.hoveringVertex &&
                this.hoveringVertex.polyId === poly.id &&
                this.hoveringVertex.vertexIdx === i) {
              this.hoveringVertex = null
            }
          })

          vertex.on('dragstart', () => {
            this.containerEl.style.cursor = 'grabbing'
          })

          vertex.on('dragmove', () => {
            const pos = vertex.position()
            poly.points[i] = pos.x
            poly.points[i + 1] = pos.y
            shape.points(poly.points)
            // 라벨이 표시 중일 때만 위치 갱신 (작은 폴리곤은 라벨이 없음)
            if (labelText && labelBg) {
              const c = computeCentroid(poly.points)
              labelText.position(c)
              labelBg.x(c.x - labelText.width() / 2 - labelPadX)
              labelBg.y(c.y - labelText.height() / 2 - labelPadY)
            }
            this.polyLayer.batchDraw()
          })

          vertex.on('dragend', () => {
            this.containerEl.style.cursor = 'grab'
            this.pushHistory()
            this.notifyPolygons()
          })

          // 우클릭으로 점 삭제
          vertex.on('contextmenu', (e) => {
            e.evt.preventDefault()
            e.cancelBubble = true
            this.removeVertex(poly.id, i)
          })

          // 더블클릭으로도 점 삭제 (우클릭 어려운 환경 대비)
          vertex.on('dblclick', (e) => {
            e.cancelBubble = true
            this.removeVertex(poly.id, i)
          })

          group.add(vertex)
        }
      }

      // 클릭 → 선택 / 삭제
      group.on('click', (e) => {
        e.cancelBubble = true
        if (this.tool === 'delete') {
          this.deletePolygon(poly.id)
        } else if (this.tool === 'edit') {
          this.selectPolygon(poly.id)
        }
      })

      // 편집 모드: shape 영역 더블클릭은 비활성화
      // (점 추가는 변 호버 + 클릭으로 처리, 더블클릭은 점 삭제 전용)

      this.polyLayer.add(group)
    })

    this.polyLayer.batchDraw()
    this.enforceAnnotationModeVisibility?.()
  }

  /**
   * 현재 마우스가 올라간 점을 삭제 (단축키용)
   * @returns {boolean} 실제로 삭제했으면 true
   */
  removeHoveredVertex() {
    if (!this.hoveringVertex) return false
    const { polyId, vertexIdx } = this.hoveringVertex
    this.removeVertex(polyId, vertexIdx)
    // 해당 점이 사라졌으므로 호버 상태도 정리 (mouseleave가 호출 안 될 수 있음)
    this.hoveringVertex = null
    return true
  }

  /**
   * 폴리곤에서 특정 점 제거
   * @param {number} polyId
   * @param {number} vertexIdx points 배열의 인덱스 (x좌표 위치, i와 i+1이 한 점)
   */
  removeVertex(polyId, vertexIdx) {
    const poly = this.polygons.find(p => p.id === polyId)
    if (!poly) return
    if (poly.points.length / 2 <= MIN_POINTS) {
      // 최소 3개는 유지
      if (this.opts.onStatusChange) {
        this.opts.onStatusChange(`최소 ${MIN_POINTS}개 점은 유지해야 합니다 (폴리곤 자체를 지우려면 X 도구 사용)`)
        setTimeout(() => this.updateStatus(), 2500)
      }
      return
    }
    poly.points.splice(vertexIdx, 2) // x, y 두 개 제거
    this.clearEditHover() // 미리보기 점도 정리
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }

  /** 가장 가까운 변에 점 추가 */
  insertPointAt(polyId, x, y) {
    const poly = this.polygons.find(p => p.id === polyId)
    if (!poly) return

    let minDist = Infinity
    let insertIdx = 0
    const n = poly.points.length / 2
    for (let i = 0; i < n; i++) {
      const x1 = poly.points[i * 2]
      const y1 = poly.points[i * 2 + 1]
      const x2 = poly.points[((i + 1) % n) * 2]
      const y2 = poly.points[((i + 1) % n) * 2 + 1]
      const d = pointToSegmentDist(x, y, x1, y1, x2, y2)
      if (d < minDist) {
        minDist = d
        insertIdx = (i + 1) * 2
      }
    }
    poly.points.splice(insertIdx, 0, x, y)
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }

  // ============================================================
  // 폴리곤 선택/삭제
  // ============================================================
  selectPolygon(id) {
    if (this.selectedId !== id) this.clearEditHover()
    this.selectedId = id
    // notifyPolygons에 selected 상태도 함께 전달하기 위해
    this.renderPolygons()
    this.notifyPolygons()
  }

  deletePolygon(id) {
    this.polygons = this.polygons.filter(p => p.id !== id)
    if (this.selectedId === id) this.selectedId = null
    this.relabelAll()
    this.renderPolygons()
    this.pushHistory()
    this.notifyPolygons()
  }

  deleteSelected() {
    if (this.selectedId != null) {
      this.deletePolygon(this.selectedId)
    }
  }

  clearAll(pushHistory = true) {
    this.polygons = []
    this.selectedId = null
    this.polyLayer.destroyChildren()
    this.polyLayer.batchDraw()
    if (pushHistory) {
      this.pushHistory()
      this.notifyPolygons()
    }
  }

  // ============================================================
  // Measurement debug overlay
  // ============================================================
  setMeasurementDebugOverlay(result = null, options = {}) {
    this.measurementDebug = {
      ...(this.measurementDebug || {}),
      ...(options || {}),
      result: result || null,
    }
    this.renderMeasurementDebugOverlay()
  }

  renderMeasurementDebugOverlay() {
    if (!this.measurementLayer) return
    this.measurementLayer.destroyChildren()

    const cfg = this.measurementDebug || {}
    const debug = cfg.result?.debug
    if (!cfg.enabled || !debug) {
      this.measurementLayer.batchDraw()
      return
    }

    const scale = Math.max(0.001, this.stage?.scaleX?.() || 1)

    for (const seg of debug.lineSegments || []) {
      const pts = measurementOverlaySegmentPoints(seg.a, seg.b, seg.extend || 0)
      if (!pts) continue
      this.measurementLayer.add(new Konva.Line({
        points: pts,
        stroke: seg.color || '#fbbf24',
        strokeWidth: 2.5 / scale,
        dash: seg.dashed ? [8 / scale, 5 / scale] : undefined,
        opacity: 0.95,
        listening: false,
      }))
      if (cfg.showLabels !== false && seg.label) {
        this.addMeasurementDebugLabel(seg.label, {
          x: (pts[0] + pts[2]) / 2,
          y: (pts[1] + pts[3]) / 2,
        }, seg.color || '#fbbf24', scale)
      }
    }

    if (cfg.showPoints !== false) {
      for (const pt of debug.points || []) {
        if (!measurementOverlayValidPoint(pt.p)) continue
        this.measurementLayer.add(new Konva.Circle({
          x: pt.p.x,
          y: pt.p.y,
          radius: 5 / scale,
          fill: pt.color || '#ffffff',
          stroke: '#0f172a',
          strokeWidth: 1.5 / scale,
          opacity: 0.98,
          listening: false,
        }))
        if (cfg.showLabels !== false && pt.label) {
          this.addMeasurementDebugLabel(pt.label, { x: pt.p.x + 8 / scale, y: pt.p.y - 8 / scale }, pt.color || '#ffffff', scale)
        }
      }
    }

    this.measurementLayer.batchDraw()
  }

  addMeasurementDebugLabel(text, point, color, scale) {
    const label = new Konva.Label({ x: point.x, y: point.y, listening: false })
    label.add(new Konva.Tag({
      fill: 'rgba(15, 23, 42, 0.86)',
      stroke: color,
      strokeWidth: 1 / scale,
      cornerRadius: 4 / scale,
      listening: false,
    }))
    label.add(new Konva.Text({
      text,
      fontSize: 12 / scale,
      fontStyle: 'bold',
      fill: '#ffffff',
      padding: 4 / scale,
      listening: false,
    }))
    this.measurementLayer.add(label)
  }

  // ============================================================
  // 외부 접근용
  // ============================================================
  getPolygons() {
    return this.polygons.map(p => ({
      id: p.id,
      label: p.label,
      points: p.points.slice(),
      manualLabel: p.manualLabel === true,
      landmark: p.landmark === true,
      selected: p.id === this.selectedId,
    }))
  }

  /**
   * 외부에서 폴리곤 배열을 주입 (저장된 라벨 복원용)
   * @param {Array<{id?, label, points}>} polygons
   */
  loadPolygons(polygons) {
    if (!Array.isArray(polygons)) return
    this.polygons = polygons.map((p, i) => ({
      id: p.id != null ? p.id : (Date.now() + i),
      label: p.label || '',
      points: Array.isArray(p.points) ? p.points.slice() : [],
      manualLabel: p.manualLabel === true || isExtraLabel(p.label),
      landmark: p.landmark === true || isPelvisPointLabel(p.label),
    }))
    this.selectedId = null
    this.normalizeVertebraLabelsByY({ force: false })
    // Keep manually saved labels if they exist. Only auto-label imported/legacy
    // polygons that do not have labels yet.
    const hasMissingLabel = this.polygons.some(p => !p.label || p.label === '?')
    if (hasMissingLabel) {
      this.relabelAll()
    } else {
      this.polygons.forEach(p => { p._centroidY = computeCentroidY(p.points) })
      this.polygons.sort((a, b) => a._centroidY - b._centroidY)
    }
    this.normalizeVertebraLabelsByY({ force: false })
    this.renderPolygons()
    this.refreshPolygonVisualScale({ delayed: true })
    // 새 이미지에 대한 히스토리는 깨끗하게 시작
    this.history = [this.snapshot()]
    this.historyIdx = 0
    this.notifyPolygons()
  }

  refreshPolygonVisualScale(opts = {}) {
    if (!this.stage || !Array.isArray(this.polygons) || this.polygons.length === 0) return
    const run = () => {
      if (!this.stage || !this.polyLayer) return
      this.renderPolygons()
      this.polyLayer.batchDraw()
      this.redrawAutoEndplate?.()  // 줌 등으로 재렌더될 때 종판선 오버레이도 다시 그림
    }
    if (opts.delayed && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        run()
        requestAnimationFrame(run)
      })
    } else {
      run()
    }
  }

  notifyPolygons() {
    if (this.opts.onPolygonsChange) {
      this.opts.onPolygonsChange(this.getPolygons())
    }
  }

  // ============================================================
  // Undo / Redo
  // ============================================================
  pushHistory() {
    // 현재 위치 이후 잘라내기
    this.history = this.history.slice(0, this.historyIdx + 1)
    this.history.push(this.snapshot())
    this.historyIdx = this.history.length - 1
    // 최대 50개로 제한
    if (this.history.length > 50) {
      this.history.shift()
      this.historyIdx--
    }
  }

  snapshot() {
    return JSON.stringify(this.polygons.map(p => ({
      id: p.id,
      label: p.label,
      points: p.points.slice(),
      manualLabel: p.manualLabel === true,
      landmark: p.landmark === true,
    })))
  }

  restore(snapshot) {
    this.polygons = JSON.parse(snapshot)
    this.selectedId = null
    this.renderPolygons()
    this.notifyPolygons()
  }

  undo() {
    if (this.historyIdx > 0) {
      this.historyIdx--
      this.restore(this.history[this.historyIdx])
    }
  }

  redo() {
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++
      this.restore(this.history[this.historyIdx])
    }
  }
}

function measurementOverlayValidPoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y)
}

function measurementOverlaySegmentPoints(a, b, extend = 0) {
  if (!measurementOverlayValidPoint(a) || !measurementOverlayValidPoint(b)) return null
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (!len) return null
  const ex = extend ? (dx / len) * extend : 0
  const ey = extend ? (dy / len) * extend : 0
  return [a.x - ex, a.y - ey, b.x + ex, b.y + ey]
}

// ================================================================
// 기하학 유틸
// ================================================================
function computeCentroid(pts) {
  let cx = 0, cy = 0
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2]
    cy += pts[i * 2 + 1]
  }
  return { x: cx / n, y: cy / n }
}

function computeCentroidY(pts) {
  let cy = 0
  const n = pts.length / 2
  for (let i = 0; i < n; i++) cy += pts[i * 2 + 1]
  return cy / n
}

function computeBBox(pts) {
  if (pts.length < 2) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = pts[0], minY = pts[1], maxX = pts[0], maxY = pts[1]
  for (let i = 2; i < pts.length; i += 2) {
    if (pts[i] < minX) minX = pts[i]
    else if (pts[i] > maxX) maxX = pts[i]
    if (pts[i + 1] < minY) minY = pts[i + 1]
    else if (pts[i + 1] > maxY) maxY = pts[i + 1]
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

/**
 * 점에서 선분에 가장 가까운 점 좌표와 거리, 매개변수 t 반환
 * @returns {{dist:number, x:number, y:number, t:number}}
 */
function pointToSegmentInfo(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    return { dist: Math.hypot(px - x1, py - y1), x: x1, y: y1, t: 0 }
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return { dist: Math.hypot(px - cx, py - cy), x: cx, y: cy, t }
}

/**
 * 점들을 무게중심 기준 시계방향 각도순으로 정렬
 * 척추체처럼 볼록한 도형에 적합 (Angular Sort)
 *
 * @param {number[]} pts [x1,y1,x2,y2,...]
 * @returns {number[]} 각도순으로 재정렬된 [x1,y1,x2,y2,...]
 */
function sortPointsByAngle(pts) {
  const n = pts.length / 2
  if (n < 3) return pts

  // 무게중심 계산
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2]
    cy += pts[i * 2 + 1]
  }
  cx /= n
  cy /= n

  // 각 점에 각도 부여 (이미지 좌표계: Y가 아래로 증가하므로 시계방향)
  // atan2(dy, dx) → -π ~ π
  // 12시 방향(위)부터 시작하도록 보정: 위(-y 방향)가 시작점
  const indexed = []
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 2] - cx
    const dy = pts[i * 2 + 1] - cy
    // 12시 방향을 0, 시계방향(이미지에서 시계방향)으로 증가
    let angle = Math.atan2(dx, -dy)
    if (angle < 0) angle += Math.PI * 2
    indexed.push({ x: pts[i * 2], y: pts[i * 2 + 1], angle })
  }

  indexed.sort((a, b) => a.angle - b.angle)

  const result = []
  for (const p of indexed) {
    result.push(p.x, p.y)
  }
  return result
}
