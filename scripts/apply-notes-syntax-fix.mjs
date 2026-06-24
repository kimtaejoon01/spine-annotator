#!/usr/bin/env node

import fs from 'node:fs'

function fixFile(path, replacements) {
  let s = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  const before = s
  for (const [from, to] of replacements) s = s.split(from).join(to)
  if (s !== before) {
    fs.writeFileSync(path, s)
    console.log('PATCH ' + path + ' notes syntax fix')
  } else {
    console.log('OK ' + path + ' notes syntax fix')
  }
}

fixFile('src/api.ts', [
  ["DB.prepare('CREATE TABLE IF NOT EXISTS notes (filename TEXT PRIMARY KEY, note_text TEXT NOT NULL DEFAULT '', labeler_id TEXT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL)')", "DB.prepare(`CREATE TABLE IF NOT EXISTS notes (filename TEXT PRIMARY KEY, note_text TEXT NOT NULL DEFAULT '', labeler_id TEXT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL)` )"],
  ["DB.prepare('SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE note_text <> '' ORDER BY filename')", "DB.prepare(`SELECT filename, note_text, labeler_id, updated_at, created_at FROM notes WHERE note_text <> '' ORDER BY filename`)"],
])

fixFile('public/static/app.js', [
  ['noteLastSavedAt: null\n\n  // AI mask 오버레이\n  aiFolderHandle:', 'noteLastSavedAt: null,\n\n  // AI mask 오버레이\n  aiFolderHandle:'],
  ['noteLastSavedAt: null\n  aiFolderHandle:', 'noteLastSavedAt: null,\n  aiFolderHandle:'],
])
