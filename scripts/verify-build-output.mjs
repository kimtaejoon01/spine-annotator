#!/usr/bin/env node

import fs from 'node:fs'

const checks = [
  {
    file: 'public/static/annotator.js',
    required: [
      'async loadAiMasks(items = [])',
      'clearAiMasks()',
      "typeof this.clearAiMasks === 'function'",
      'setMeasurementDebugOverlay(result',
      'renderMeasurementDebugOverlay()',
      'measurementLayer.destroyChildren()',
    ],
  },
  {
    file: 'src/api.ts',
    required: [
      "api.put('/presence'",
      "api.delete('/presence'",
      'function parseStoredLabelData',
      'const landmarks = Array.isArray(body.landmarks) ? body.landmarks : []',
      'polygonsJson = landmarks.length > 0',
    ],
  },
  {
    file: 'public/static/app.js',
    required: [
      "from './measurements.js'",
      'function refreshSagittalMeasurements()',
      'landmarks: state.annotator.getLandmarks?.() || []',
      'async function persistCurrentLabelsNow(',
      'function normalizeLoadedLabelPayload(data)',
    ],
  },
  {
    file: 'public/static/measurements.js',
    required: [
      // Keep this token broad because later measurement patches can safely rewrite
      // the function signature while preserving the exported API and landmark merge.
      'export function calculateSagittalMeasurements',
      'function mergeLandmarksIntoMeasurementPolygons',
      'const landmarkPreferred = polys.find',
      'function syncMeasurementDebugOverlay(result)',
      "label: 'HC_LAT'",
    ],
  },
  {
    file: 'public/static/landmark-tools.js',
    required: [
      'export const LAT_5POINT_SEQUENCE',
      'export function installLat5PointLandmarks',
      'annotator.getLandmarks = function getLandmarks()',
      'annotator.loadLandmarks = function loadLandmarks(landmarks)',
    ],
  },
]

let failed = false
for (const check of checks) {
  if (!fs.existsSync(check.file)) {
    console.error(`VERIFY FAIL missing file: ${check.file}`)
    failed = true
    continue
  }
  const text = fs.readFileSync(check.file, 'utf8')
  for (const token of check.required) {
    if (!text.includes(token)) {
      console.error(`VERIFY FAIL ${check.file} missing: ${token}`)
      failed = true
    } else {
      console.log(`VERIFY OK ${check.file}: ${token}`)
    }
  }
}

if (failed) {
  console.error('\nBuild output verification failed. Do not deploy this build.')
  process.exit(1)
}

console.log('\nVERIFY OK build output looks deployable')
