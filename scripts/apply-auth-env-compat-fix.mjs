#!/usr/bin/env node

import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function write(file, s) { fs.writeFileSync(file, s) }
function save(file, before, after, label) {
  if (before === after) console.log('OK ' + label + ' already patched')
  else { write(file, after); console.log('PATCH ' + label) }
}

{
  const file = 'src/api.ts'
  const before = read(file)
  let s = before
  const oldBlock = `function getAuthPassword(c: any) {
  const password = c.env.AUTH_PASSWORD
  if (typeof password !== 'string') return ''
  const trimmed = password.trim()
  if (trimmed === '') return ''
  return trimmed
}`
  const newBlock = `function getAuthPassword(c: any) {
  const env = c.env || {}
  const values = [env.AUTH_PASSWORD, env.SPINE_AUTH_PASSWORD, env.APP_PASSWORD]
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim().replace(/^['\"]|['\"]$/g, '').trim()
    if (trimmed) return trimmed
  }
  return ''
}`
  if (s.includes(oldBlock)) s = s.replace(oldBlock, newBlock)
  save(file, before, s, 'auth secret compatibility')
}

{
  const file = 'public/static/api.js'
  const before = read(file)
  let s = before
  s = s.replace("throw new Error(data.error || '비밀번호가 틀렸습니다')", "throw new Error(data.message || data.error || '비밀번호가 틀렸습니다')")
  save(file, before, s, 'auth error message')
}

console.log('OK auth env compatibility fix installed')
