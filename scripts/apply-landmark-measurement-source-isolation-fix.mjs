#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, text) { fs.writeFileSync(file, text) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

// -----------------------------------------------------------------------------
// measurements.js
// In landmark/centroid modes, do not fall back to algorithm-estimated polygon
// endplate lines. Use only explicit landmark points. Polygon fallback remains only
// for polygon mode.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/measurements.js'
  const before = read(file)
  let s = before

  s = s.replace(
    `  const result = calculateSagittalMeasurements(polygons, context.landmarks || [])`,
    `  const annotationMode = String(context.annotationMode || context.activeAnnotationMode || 'polygon').toLowerCase()
  const landmarksOnly = annotationMode !== 'polygon'
  const result = calculateSagittalMeasurements(landmarksOnly ? [] : polygons, context.landmarks || [])`
  )
  s = s.replace(
    `  const result = calculateSagittalMeasurements(polygons)`,
    `  const annotationMode = String(context.annotationMode || context.activeAnnotationMode || 'polygon').toLowerCase()
  const landmarksOnly = annotationMode !== 'polygon'
  const result = calculateSagittalMeasurements(landmarksOnly ? [] : polygons, context.landmarks || [])`
  )

  // Add a small source marker so it is obvious which engine is active.
  if (!s.includes('measurement-source-note')) {
    s = s.replace(
      `    ${'${missingHtml(result.missing)}'}\n    <div class="measurement-actions">`,
      `    <p class="measurement-source-note">${'${landmarksOnly ? \'랜드마크 기준 측정\' : \'폴리곤 기준 측정\'}'}</p>\n    ${'${missingHtml(result.missing)}'}\n    <div class="measurement-actions">`
    )
    s = s.replace(
      `    ${'${missingHtml(result.missing)}'}\n    <div class="measurement-toggle-row">`,
      `    <p class="measurement-source-note">${'${landmarksOnly ? \'랜드마크 기준 측정\' : \'폴리곤 기준 측정\'}'}</p>\n    ${'${missingHtml(result.missing)}'}\n    <div class="measurement-toggle-row">`
    )
  }

  save(file, before, s, 'measurement source isolated by annotation mode')
}

// -----------------------------------------------------------------------------
// app.js
// Pass the active annotation mode into measurement rendering, and expose a refresh
// function so the landmark toolbar can force recalculation on mode switch.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/app.js'
  const before = read(file)
  let s = before

  if (s.includes('function refreshSagittalMeasurements()') && !s.includes('window.__refreshSagittalMeasurements = refreshSagittalMeasurements')) {
    s = s.replace(
      `function refreshSagittalMeasurements() {`,
      `window.__refreshSagittalMeasurements = refreshSagittalMeasurements\nfunction refreshSagittalMeasurements() {`
    )
  }

  s = s.replaceAll(
    `    landmarks: state.annotator?.getLandmarks?.() || [],\n  })`,
    `    landmarks: state.annotator?.getLandmarks?.() || [],\n    annotationMode: state.annotator?.__activeAnnotationMode || 'polygon',\n  })`
  )
  s = s.replaceAll(
    `    landmarks: state.annotator.getLandmarks?.() || [],\n  })`,
    `    landmarks: state.annotator.getLandmarks?.() || [],\n    annotationMode: state.annotator.__activeAnnotationMode || 'polygon',\n  })`
  )

  save(file, before, s, 'app passes annotation mode to measurements')
}

// -----------------------------------------------------------------------------
// landmark-tools.js
// Recalculate measurement guides immediately when switching between polygon,
// landmark, and centroid modes. This clears stale polygon-derived guide lines.
// -----------------------------------------------------------------------------
{
  const file = 'public/static/landmark-tools.js'
  const before = read(file)
  let s = before

  s = s.replaceAll(
    `renderModeToolbar(); updateModeVisibility(); return`,
    `renderModeToolbar(); updateModeVisibility(); window.__refreshSagittalMeasurements?.(); return`
  )
  s = s.replaceAll(
    `renderModeToolbar(); updateModeVisibility(); annotator.renderLandmarks?.()`,
    `renderModeToolbar(); updateModeVisibility(); annotator.renderLandmarks?.(); window.__refreshSagittalMeasurements?.()`
  )
  s = s.replaceAll(
    `renderModeToolbar()\n      updateModeVisibility()\n      return`,
    `renderModeToolbar()\n      updateModeVisibility()\n      window.__refreshSagittalMeasurements?.()\n      return`
  )
  s = s.replaceAll(
    `renderModeToolbar()\n    updateModeVisibility()\n    annotator.renderLandmarks?.()`,
    `renderModeToolbar()\n    updateModeVisibility()\n    annotator.renderLandmarks?.()\n    window.__refreshSagittalMeasurements?.()`
  )

  save(file, before, s, 'landmark mode refreshes measurement source')
}

console.log('OK landmark measurement source isolation fix installed')
