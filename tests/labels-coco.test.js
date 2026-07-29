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

// ---- S1 상종판(endplate) ----
test('exportToCOCO: S1 상종판은 keypoints 로 나가고 segmentation 이 아니다', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 100, height: 200,
    polygons: [
      { id: 1, label: 'L5', points: square(0, 0, 5) },
      { id: 2, label: 'S1_SUP', points: [10, 50, 40, 55], shape: 'endplate' },
    ],
  })
  // 종판 카테고리(id 30) 가 추가됨
  const epCat = coco.categories.find(c => c.name === 'S1_endplate')
  assert.ok(epCat, 'S1_endplate 카테고리 존재')
  assert.equal(epCat.id, 30)
  assert.deepEqual(epCat.keypoints, ['SUP_ANT', 'SUP_POST'])

  // 종판 annotation 은 keypoints 를 갖고 segmentation 은 비어있다
  const ep = coco.annotations.find(a => a.category_id === 30)
  assert.ok(ep, '종판 annotation 존재')
  assert.deepEqual(ep.keypoints, [10, 50, 2, 40, 55, 2])
  assert.equal(ep.num_keypoints, 2)
  assert.deepEqual(ep.segmentation, [])
  assert.equal(ep.area, 0)

  // L5 는 정상 segmentation 유지
  const l5 = coco.annotations.find(a => a.category_id === 24)
  assert.ok(l5 && Array.isArray(l5.segmentation) && l5.segmentation[0].length === 8)
})

test('exportToCOCO: 종판이 없으면 S1_endplate 카테고리는 추가되지 않는다', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [{ id: 1, label: 'C1', points: square(0, 0, 5) }],
  })
  assert.ok(!coco.categories.some(c => c.name === 'S1_endplate'))
})

test('exportToCOCO: 종판 좌표가 깨지면(2점 아님) 제외', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [{ id: 1, label: 'S1_SUP', points: [1, 2, 3], shape: 'endplate' }],
  })
  assert.ok(!coco.annotations.some(a => a.category_id === 30))
})
