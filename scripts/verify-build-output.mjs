#!/usr/bin/env node

import fs from 'node:fs'

const checks = [
  {
    file: 'public/static/annotator.js',
    required: [
      'async loadAiMasks(items = [])',
      'clearAiMasks()',
      "typeof this.clearAiMasks === 'function'",
    ],
  },
  {
    file: 'src/api.ts',
    required: [
      "api.put('/presence'",
      "api.delete('/presence'",
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
