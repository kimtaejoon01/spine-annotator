#!/usr/bin/env node

// The original notes patch was too strict when rerun after other build patches.
// Delegate to the idempotent implementation, then repair generated TypeScript SQL
// strings that contain SQL single quotes.
import './apply-notes-patch-safe.mjs'
import fs from 'node:fs'

const file = 'src/api.ts'
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
let changed = false

const brokenCreate = "  await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS notes (filename TEXT PRIMARY KEY, note_text TEXT NOT NULL DEFAULT '', labeler_id TEXT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL)').run()"
const fixedCreate = "  await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS notes (filename TEXT PRIMARY KEY, note_text TEXT NOT NULL DEFAULT '', labeler_id TEXT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL)`).run()"
if (s.includes(brokenCreate)) {
  s = s.replace(brokenCreate, fixedCreate)
  changed = true
}

const brokenExport = "    const result = await c.env.DB.prepare('SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE note_text <> '' ORDER BY filename').all<any>()"
const fixedExport = "    const result = await c.env.DB.prepare(`SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE note_text <> '' ORDER BY filename`).all<any>()"
if (s.includes(brokenExport)) {
  s = s.replace(brokenExport, fixedExport)
  changed = true
}

if (changed) {
  fs.writeFileSync(file, s)
  console.log('PATCH notes SQL string quoting repair')
} else {
  console.log('OK notes SQL string quoting already safe')
}
