/* ================================================================
   라벨 정의 + COCO export 회귀 테스트 (sagittal-measurements 브랜치)
   실행: npm test
   ================================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { LABELS, EXTRA_LABELS, ALL_LABELS, parseFilename } from '../public/static/labels.js'
import { exportToCOCO } from '../public/static/coco.js'

const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s]

// ---- 라벨 정의 ----
test('FH_L / FH_R 는 제거됨, 추가 라벨 4개', () => {
  assert.equal(LABELS.length, 25)
  assert.equal(EXTRA_LABELS.length, 4)
  assert.equal(ALL_LABELS.length, 29)
  assert.ok(!ALL_LABELS.includes('FH_L'))
  assert.ok(!ALL_LABELS.includes('FH_R'))
})

test('category_id 매핑 (척추 1~25 유지, 골반은 뒤에)', () => {
  assert.equal(ALL_LABELS.indexOf('C1') + 1, 1)
  assert.equal(ALL_LABELS.indexOf('S1') + 1, 25)
  assert.equal(ALL_LABELS.indexOf('HC_L') + 1, 26)
  assert.equal(ALL_LABELS.indexOf('HC_R') + 1, 27)
  assert.equal(ALL_LABELS.indexOf('FH_LAT') + 1, 28)
  assert.equal(ALL_LABELS.indexOf('HC_LAT') + 1, 29)
})

test('parseFilename 표준/폴백', () => {
  const r = parseFilename('02066135_20260121_AP.png')
  assert.equal(r.patientId, '02066135')
  assert.equal(r.viewType, 'AP')
  assert.equal(parseFilename('x_20260101_lat.jpg').viewType, 'LAT')
  assert.equal(parseFilename('weird.png').viewType, 'AP')
})

// ---- COCO export (이 브랜치는 '사용된 라벨만' categories 에 포함) ----
test('exportToCOCO: 기본 bbox/area/category_id', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 1000, height: 2000,
    polygons: [{ id: 1, label: 'T1', points: square(10, 20, 100) }],
  })
  assert.equal(coco.images[0].width, 1000)
  assert.equal(coco.annotations.length, 1)
  const ann = coco.annotations[0]
  assert.equal(ann.category_id, 8)      // T1
  assert.deepEqual(ann.bbox, [10, 20, 100, 100])
  assert.equal(ann.area, 10000)
})

test('exportToCOCO: 남은 골반 라벨(FH_LAT/HC_LAT)이 매핑된다', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [
      { id: 1, label: 'L5', points: square(0, 0, 5) },
      { id: 2, label: 'FH_LAT', points: square(5, 5, 4) },
      { id: 3, label: 'HC_LAT', points: square(8, 8, 4) },
    ],
  })
  const ids = coco.annotations.map(a => a.category_id).sort((a, b) => a - b)
  assert.deepEqual(ids, [24, 28, 29]) // L5=24, FH_LAT=28, HC_LAT=29
})

test('exportToCOCO: 제거된 FH_L/FH_R 은 category_id 0 을 만들지 않고 빠진다', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [
      { id: 1, label: 'C1', points: square(0, 0, 5) },
      { id: 2, label: 'FH_L', points: square(5, 5, 4) },  // 더 이상 유효하지 않음
      { id: 3, label: 'FH_R', points: square(6, 6, 4) },
    ],
  })
  assert.equal(coco.annotations.length, 1)
  assert.equal(coco.annotations[0].category_id, 1)
  assert.ok(coco.annotations.every(a => a.category_id > 0))
})
