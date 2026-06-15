#!/usr/bin/env node

import fs from 'node:fs'

const file = 'public/static/app.js'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

const start = s.indexOf('async function scanAiFolder()')
const end = s.indexOf('function normalizeAiMeta', start)
if (start < 0 || end < 0) {
  throw new Error('AI overlay functions were not found in app.js')
}

const replacement = `async function scanAiFolder() {
  if (!state.aiFolderHandle) {
    updateAiFolderStatus('AI 폴더가 연결되지 않았습니다', 'empty')
    return
  }

  let result
  try {
    result = await listAiMaskFilesRecursive(state.aiFolderHandle)
  } catch (err) {
    updateAiFolderStatus('AI 폴더 읽기 실패: ' + err.message, 'warning')
    throw err
  }

  const files = result.masks
  state.aiFiles = files
  state.aiScanStats = result
  state.aiByBase = new Map()
  for (const item of files) {
    const arr = state.aiByBase.get(item.base) || []
    arr.push(item)
    state.aiByBase.set(item.base, arr)
  }

  if (files.length === 0) {
    const samples = result.unknownSamples.length
      ? ' / 인식 실패 예: ' + result.unknownSamples.slice(0, 2).join(' | ')
      : ''
    const errors = result.errors.length
      ? ' / 읽기 오류 ' + result.errors.length + '개'
      : ''
    updateAiFolderStatus('0개 AI mask 인식됨 (폴더 안 이미지 ' + result.imageCount + '개)' + samples + errors, result.imageCount > 0 ? 'warning' : 'empty')
  } else {
    updateAiFolderStatus(files.length + '개 AI mask 연결됨 (폴더 안 이미지 ' + result.imageCount + '개)', 'connected')
  }

  renderAiRegionControls()
  await applyAiOverlayForCurrentFile()
}

async function listAiMaskFilesRecursive(dirHandle, prefix = '') {
  const masks = []
  const unknownSamples = []
  const errors = []
  let imageCount = 0
  const imageExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp'])

  async function walk(dir, dirPrefix) {
    try {
      for await (const [name, entry] of dir.entries()) {
        const relPath = dirPrefix ? dirPrefix + '/' + name : name
        if (entry.kind === 'directory') {
          await walk(entry, relPath)
          continue
        }

        const ext = name.split('.').pop()?.toLowerCase()
        if (!imageExts.has(ext)) continue
        imageCount += 1

        const parsed = parseAiMaskFile(name, relPath)
        if (parsed) {
          masks.push({ ...parsed, name, path: relPath, handle: entry })
        } else if (unknownSamples.length < 8) {
          unknownSamples.push(relPath)
        }
      }
    } catch (err) {
      errors.push({ path: dirPrefix || '/', message: err.message || String(err) })
    }
  }

  await walk(dirHandle, prefix)
  masks.sort((a, b) => (a.base + '_' + a.region + '_' + a.modelKey).localeCompare(b.base + '_' + b.region + '_' + b.modelKey, undefined, { numeric: true }))
  return { masks, imageCount, unknownSamples, errors }
}

function parseAiMaskFile(name, relPath = name) {
  const noExt = name.replace(/\.(png|jpg|jpeg|webp|bmp)$/i, '')

  // 표준 규칙: {원본}_AIresult_{region}_{model}_{v0}.png
  let m = noExt.match(/^(?<base>.+)_AIresult_(?<region>cervical|thoracic|lumbar)_(?<rest>.+)$/i)
  if (m) {
    let rest = m.groups.rest
    let version = 'v0'
    const vm = rest.match(/^(?<model>.+)_(?<version>v\d+)$/i)
    if (vm) {
      rest = vm.groups.model
      version = vm.groups.version
    }
    return normalizeAiMeta(m.groups.base, m.groups.region, rest, version)
  }

  // 기존 cervical/lumbar binary_full 파일명 지원
  m = noExt.match(/^(?<base>.+?)_(?<region>cervical|lumbar)_(?<model>.+)_binary_full$/i)
  if (m) return normalizeAiMeta(m.groups.base, m.groups.region, m.groups.model, 'v0')

  // thoracic 기존 결과 폴더 구조 지원:
  // {case}/{model}/{case}_{model}_mask.png
  const parts = relPath.split('/')
  if (/_mask$/i.test(noExt) && parts.length >= 3) {
    return normalizeAiMeta(parts[parts.length - 3], 'thoracic', parts[parts.length - 2], 'v0')
  }

  // thoracic 파일명만 보고 추정
  m = noExt.match(/^(?<base>.+?)_(?<model>Weighted_Ensemble|Majority_Vote|U_Net|Coordconv_UNet|Center_plus_Coordconv)_mask$/i)
  if (m) return normalizeAiMeta(m.groups.base, 'thoracic', m.groups.model, 'v0')

  return null
}

`

s = s.slice(0, start) + replacement + s.slice(end)
fs.writeFileSync(file, s)
console.log('OK AI mask scanner diagnostics installed')
