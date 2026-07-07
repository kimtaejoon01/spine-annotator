/* ================================================================
   전처리 뷰 UI
   - 프리셋 토글 버튼(원본 + 6종) + 활성 프리셋의 파라미터 슬라이더
   - 슬라이더 조작 시 디바운스 후 실시간 반영
   - CLAHE/Canny 선택 시 opencv.js 지연 로딩 상태 표시
   - 원본 픽셀/라벨 좌표 불변 (표시 전용)
   ================================================================ */

import { PRESETS, presetById, DEFAULT_PARAMS, needsOpenCV, runPipeline } from './preprocess.js'

// 스텝별 슬라이더 정의 (명세서 조정 범위)
const SLIDERS = {
  normalize: [
    { key: 'low', label: '하위 clip(%)', min: 0, max: 5, step: 0.5 },
    { key: 'high', label: '상위 clip(%)', min: 95, max: 100, step: 0.5 },
  ],
  gamma: [{ key: 'gamma', label: 'γ (작을수록 밝아짐)', min: 0.3, max: 1.5, step: 0.05 }],
  clahe: [
    { key: 'clip', label: 'clipLimit', min: 1.0, max: 5.0, step: 0.1 },
    { key: 'tile', label: 'tileGrid', min: 4, max: 16, step: 1 },
  ],
  unsharp: [
    { key: 'radius', label: 'radius', min: 0.5, max: 5.0, step: 0.1 },
    { key: 'amount', label: 'amount (>3 halo 주의)', min: 0.5, max: 3.0, step: 0.1 },
  ],
  aniso: [
    { key: 'iterations', label: 'iterations', min: 5, max: 20, step: 1 },
    { key: 'kappa', label: 'kappa', min: 20, max: 100, step: 5 },
  ],
  canny: [
    { key: 'low', label: 'lowThreshold', min: 0, max: 200, step: 5 },
    { key: 'high', label: 'highThreshold', min: 0, max: 300, step: 5 },
  ],
  invert: [],
}

const STEP_NAMES = {
  normalize: '정규화', gamma: 'Gamma', clahe: 'CLAHE',
  unsharp: 'Unsharp', aniso: 'Aniso', canny: 'Canny', invert: '반전',
}

function deepDefaults() {
  const o = {}
  for (const k in DEFAULT_PARAMS) o[k] = { ...DEFAULT_PARAMS[k] }
  return o
}

export function initPreprocessUI(annotator) {
  if (!annotator) return
  const state = {
    presetId: 'original',
    params: deepDefaults(),
    lastKey: null,
    busy: false,
    timer: null,
  }
  // 메타데이터/외부 참조용 전역
  window.__spinePreprocess = { get view() { return state.presetId }, get params() { return state.params } }

  const toolbar = ensureToolbar()
  const panel = ensurePanel()
  const status = panel.querySelector('.pp-status')
  const paramsBox = panel.querySelector('.pp-params')

  // ---- 프리셋 버튼 ----
  PRESETS.forEach(p => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'pp-preset-btn'
    btn.dataset.id = p.id
    btn.textContent = p.name
    btn.addEventListener('click', () => selectPreset(p.id))
    toolbar.appendChild(btn)
  })

  function markActive() {
    toolbar.querySelectorAll('.pp-preset-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.id === state.presetId))
  }

  function buildSliders() {
    const preset = presetById(state.presetId)
    paramsBox.innerHTML = ''
    if (preset.steps.length === 0) {
      paramsBox.innerHTML = '<div class="pp-hint">원본 뷰 — 조정할 파라미터가 없습니다.</div>'
      return
    }
    preset.steps.forEach(step => {
      const defs = SLIDERS[step] || []
      if (!defs.length) return
      const group = document.createElement('div')
      group.className = 'pp-group'
      group.innerHTML = `<div class="pp-group-title">${STEP_NAMES[step] || step}</div>`
      defs.forEach(def => {
        const val = state.params[step][def.key]
        const row = document.createElement('label')
        row.className = 'pp-slider-row'
        row.innerHTML =
          `<span class="pp-slider-label">${def.label} <b data-v>${val}</b></span>` +
          `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}">`
        const input = row.querySelector('input')
        const out = row.querySelector('[data-v]')
        input.addEventListener('input', () => {
          const num = parseFloat(input.value)
          state.params[step][def.key] = num
          out.textContent = num
          scheduleApply()
        })
        group.appendChild(row)
      })
      paramsBox.appendChild(group)
    })
  }

  function selectPreset(id) {
    state.presetId = id
    markActive()
    buildSliders()
    scheduleApply()
  }

  function setStatus(text, kind) {
    if (!status) return
    status.textContent = text || ''
    status.className = 'pp-status' + (kind ? ' ' + kind : '')
  }

  function scheduleApply() {
    clearTimeout(state.timer)
    state.timer = setTimeout(apply, 160)
  }

  async function apply() {
    const preset = presetById(state.presetId)
    const base = annotator.getBaseImageEl && annotator.getBaseImageEl()
    if (!base) return
    const key = state.presetId + '|' + JSON.stringify(state.params) + '|' + (base.currentSrc || base.src || '')
    if (key === state.lastKey && !preset.steps.length) return

    if (preset.steps.length === 0) {
      annotator.applyPreprocessCanvas(null)
      state.lastKey = key
      setStatus('')
      return
    }
    if (state.busy) return
    state.busy = true
    try {
      if (needsOpenCV(preset.steps) && !(window.cv && window.cv.Mat)) {
        setStatus('OpenCV 로딩 중… (최초 1회, 잠시만요)', 'loading')
      } else {
        setStatus('적용 중…', 'loading')
      }
      const canvas = await runPipeline(base, preset.steps, state.params, { maxDim: 1400 })
      annotator.applyPreprocessCanvas(canvas)
      state.lastKey = key
      setStatus('')
    } catch (e) {
      console.error('[preprocess]', e)
      setStatus('전처리 실패: ' + (e && e.message || e) + ' — 원본으로 되돌립니다.', 'error')
      annotator.applyPreprocessCanvas(null)
      state.presetId = 'original'
      markActive(); buildSliders()
    } finally {
      state.busy = false
    }
  }

  // 리셋: 현재 프리셋 파라미터를 기본값으로
  panel.querySelector('.pp-reset').addEventListener('click', () => {
    const preset = presetById(state.presetId)
    preset.steps.forEach(s => { state.params[s] = { ...DEFAULT_PARAMS[s] } })
    buildSliders()
    scheduleApply()
  })

  // 새 이미지 로드되면 현재 뷰 다시 적용
  window.addEventListener('spine:image-loaded', () => { state.lastKey = null; apply() })

  markActive()
  buildSliders()
}

// ---- DOM 마운트 (index.tsx에 마운트 지점이 있으면 사용, 없으면 생성) ----
function ensureToolbar() {
  let el = document.getElementById('preprocessToolbarMount')
  if (!el) {
    el = document.createElement('div')
    el.id = 'preprocessToolbarMount'
    const tb = document.querySelector('.canvas-toolbar') || document.getElementById('canvasContainer')
    if (tb) tb.insertBefore(el, tb.firstChild); else document.body.appendChild(el)
  }
  el.classList.add('pp-toolbar')
  return el
}

function ensurePanel() {
  let mount = document.getElementById('preprocessPanelMount')
  if (!mount) {
    mount = document.createElement('div')
    mount.id = 'preprocessPanelMount'
    const sb = document.getElementById('sidebarLeft') || document.body
    sb.appendChild(mount)
  }
  if (mount.dataset.ready === '1') return mount
  mount.dataset.ready = '1'
  mount.innerHTML =
    '<div class="panel pp-panel">' +
    '  <div class="panel-title"><i class="fas fa-wand-magic-sparkles"></i> 전처리 뷰' +
    '    <button type="button" class="pp-reset" title="기본값으로">리셋</button>' +
    '  </div>' +
    '  <div class="pp-status"></div>' +
    '  <div class="pp-params"></div>' +
    '</div>'
  return mount
}
