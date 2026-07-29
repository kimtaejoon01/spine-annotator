/* ================================================================
   폴리곤 id 유일성 회귀 테스트
   버그: 로드된 폴리곤 id 와 새 그리기 카운터가 겹쳐,
        하나를 지우면 인접 폴리곤(예: L5 삭제 시 L4)도 같이 삭제됨.
   ================================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'
import { assignUniqueIds } from '../public/static/polyid.js'

test('카운터가 로드된 최대 id 뒤로 밀린다', () => {
  const loaded = [{ id: 1 }, { id: 2 }, { id: 25 }]
  const { polygons, nextCounter } = assignUniqueIds(loaded, 1)
  // 기존 유일 id 는 유지
  assert.deepEqual(polygons.map(p => p.id), [1, 2, 25])
  // 다음 카운터는 최대 id 뒤
  assert.equal(nextCounter, 26)
})

test('핵심 버그 재현: 로드 후 새로 그린 폴리곤이 기존 id 와 겹치지 않는다', () => {
  // 파일 로드 → id 1..3
  const loaded = [{ id: 1, label: 'L3' }, { id: 2, label: 'L4' }, { id: 3, label: 'L5' }]
  let counter = 1 // 그리기 카운터는 아직 1 (동기화 전이라면 버그)
  const res = assignUniqueIds(loaded, counter)
  counter = res.nextCounter

  // 새 폴리곤 그리기 = counter 사용
  const newId = counter // 4 여야 함 (1이면 L3 와 충돌 → 버그)
  assert.equal(newId, 4)

  const all = [...res.polygons, { id: newId, label: '새폴리곤' }]
  const ids = all.map(p => p.id)
  assert.equal(new Set(ids).size, ids.length) // 전부 유일

  // L5(id 3) 삭제 시 L4(id 2)가 살아있는지
  const afterDelete = all.filter(p => p.id !== 3)
  assert.ok(afterDelete.some(p => p.label === 'L4'))
  assert.ok(!afterDelete.some(p => p.label === 'L5'))
})

test('중복 id 는 새 값으로 교체되어 유일해진다', () => {
  const dup = [{ id: 5, label: 'a' }, { id: 5, label: 'b' }, { id: 5, label: 'c' }]
  const { polygons } = assignUniqueIds(dup, 1)
  const ids = polygons.map(p => p.id)
  assert.equal(new Set(ids).size, 3)
  // 라벨(내용)은 보존
  assert.deepEqual(polygons.map(p => p.label), ['a', 'b', 'c'])
})

test('id 누락(null/undefined/NaN)도 채워진다', () => {
  const missing = [{ label: 'a' }, { id: null, label: 'b' }, { id: 'x', label: 'c' }]
  const { polygons } = assignUniqueIds(missing, 10)
  const ids = polygons.map(p => p.id)
  assert.ok(ids.every(id => Number.isFinite(id)))
  assert.equal(new Set(ids).size, 3)
})

test('원본 필드는 보존된다 (points 등)', () => {
  const src = [{ id: 1, label: 'C1', points: [0, 0, 1, 1, 2, 2], manualLabel: true }]
  const { polygons } = assignUniqueIds(src, 1)
  assert.deepEqual(polygons[0].points, [0, 0, 1, 1, 2, 2])
  assert.equal(polygons[0].manualLabel, true)
  assert.equal(polygons[0].label, 'C1')
})

test('빈 입력 / 비배열 방어', () => {
  assert.deepEqual(assignUniqueIds([], 3), { polygons: [], nextCounter: 3 })
  assert.deepEqual(assignUniqueIds(null, 7), { polygons: [], nextCounter: 7 })
})
