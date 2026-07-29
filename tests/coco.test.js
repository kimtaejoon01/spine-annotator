/* ================================================================
   COCO export / 라벨 유틸 회귀 테스트
   - 외부 의존성 없이 Node 내장 test runner 사용: `npm test`
   - 학습 데이터셋 생성기이므로 export 정확성이 가장 중요한 회귀 지점입니다.
   ================================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { exportToCOCO } from '../public/static/coco.js'
import {
  LABELS,
  EXTRA_LABELS,
  ALL_LABELS,
  parseFilename,
  generateLabels,
  getCocoSupercategory,
} from '../public/static/labels.js'

// ----------------------------------------------------------------
// 라벨 정의
// ----------------------------------------------------------------
test('척추 라벨은 25개, 추가 라벨 포함 29개 (FH_L/FH_R 제거됨)', () => {
  assert.equal(LABELS.length, 25)
  assert.equal(EXTRA_LABELS.length, 4)
  assert.equal(ALL_LABELS.length, 29)
  // FH_L / FH_R 은 더 이상 존재하지 않아야 함
  assert.ok(!ALL_LABELS.includes('FH_L'))
  assert.ok(!ALL_LABELS.includes('FH_R'))
})

test('category_id 매핑이 고정되어 있다 (기존 데이터셋 호환)', () => {
  assert.equal(ALL_LABELS.indexOf('C1') + 1, 1)
  assert.equal(ALL_LABELS.indexOf('T1') + 1, 8)
  assert.equal(ALL_LABELS.indexOf('L1') + 1, 20)
  assert.equal(ALL_LABELS.indexOf('S1') + 1, 25)
  // 골반/고관절은 척추 뒤에 붙어야 함 (기존 1~25 를 밀어내면 안 됨)
  assert.equal(ALL_LABELS.indexOf('HC_L') + 1, 26)
  assert.equal(ALL_LABELS.indexOf('HC_R') + 1, 27)
  assert.equal(ALL_LABELS.indexOf('FH_LAT') + 1, 28)
  assert.equal(ALL_LABELS.indexOf('HC_LAT') + 1, 29)
})

test('COCO supercategory 는 서버(src/api.ts)와 같은 값', () => {
  assert.equal(getCocoSupercategory('C1'), 'vertebra')
  assert.equal(getCocoSupercategory('S1'), 'vertebra')
  assert.equal(getCocoSupercategory('FH_LAT'), 'femoral_head')
  assert.equal(getCocoSupercategory('HC_R'), 'hip_center')
})

// ----------------------------------------------------------------
// 파일명 파싱
// ----------------------------------------------------------------
test('parseFilename: 표준 형식', () => {
  const r = parseFilename('02066135_20260121_AP.png')
  assert.equal(r.patientId, '02066135')
  assert.equal(r.studyDate, '20260121')
  assert.equal(r.viewType, 'AP')
})

test('parseFilename: 소문자 lat 도 대문자로', () => {
  assert.equal(parseFilename('abc_20260101_lat.jpg').viewType, 'LAT')
})

test('parseFilename: 형식에 안 맞으면 AP 로 폴백', () => {
  const r = parseFilename('random-name.png')
  assert.equal(r.viewType, 'AP')
  assert.equal(r.studyDate, '')
})

// ----------------------------------------------------------------
// 자동 순서 라벨링
// ----------------------------------------------------------------
test('generateLabels: 시작 라벨부터 연속 생성', () => {
  assert.deepEqual(generateLabels('C2', 5), ['C2', 'C3', 'C4', 'C5', 'C6'])
  assert.deepEqual(generateLabels('C7', 2), ['C7', 'T1'])
  assert.deepEqual(generateLabels('L5', 2), ['L5', 'S1'])
})

test('generateLabels: S1 을 넘어가면 ? 로 표시', () => {
  const r = generateLabels('S1', 2)
  assert.equal(r[0], 'S1')
  assert.match(r[1], /^\?/)
})

// ----------------------------------------------------------------
// COCO export
// ----------------------------------------------------------------
const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s]

test('exportToCOCO: 기본 구조와 면적/bbox', () => {
  const coco = exportToCOCO({
    filename: 'a.png',
    width: 1000,
    height: 2000,
    polygons: [{ id: 1, label: 'T1', points: square(10, 20, 100) }],
  })

  assert.equal(coco.images.length, 1)
  assert.equal(coco.images[0].width, 1000)
  assert.equal(coco.annotations.length, 1)

  const ann = coco.annotations[0]
  assert.equal(ann.category_id, 8)          // T1
  assert.deepEqual(ann.bbox, [10, 20, 100, 100])
  assert.equal(ann.area, 10000)
  assert.equal(ann.iscrowd, 0)
})

test('exportToCOCO: categories 는 항상 29개 전체 (파일 간 병합 가능해야 함)', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [{ id: 1, label: 'C1', points: square(0, 0, 5) }],
  })
  assert.equal(coco.categories.length, 29)
  assert.equal(coco.categories[0].id, 1)
  assert.equal(coco.categories[28].name, 'HC_LAT')
})

test('exportToCOCO: 골반/고관절 라벨이 누락되지 않는다', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [
      { id: 1, label: 'L5', points: square(0, 0, 5) },
      { id: 2, label: 'HC_L', points: square(5, 5, 4) },
      { id: 3, label: 'FH_LAT', points: square(7, 7, 4) },
      { id: 4, label: 'HC_LAT', points: square(9, 9, 4) },
    ],
  })
  const ids = coco.annotations.map(a => a.category_id).sort((a, b) => a - b)
  assert.deepEqual(ids, [24, 26, 28, 29]) // L5=24, HC_L=26, FH_LAT=28, HC_LAT=29
})

test('exportToCOCO: 제거된 FH_L/FH_R 은 미지 라벨로 처리되어 빠진다', () => {
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
})

test('exportToCOCO: 깨진 좌표/미지 라벨은 제외하고 category_id 0 을 만들지 않는다', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [
      { id: 1, label: 'C1', points: square(0, 0, 5) },
      { id: 2, label: 'NOT_A_LABEL', points: square(0, 0, 5) },
      { id: 3, label: 'C2', points: [1, 2, 3] },            // 홀수 개
      { id: 4, label: 'C3', points: [0, 0, 1, NaN, 2, 2] }, // NaN
      { id: 5, label: 'C4', points: [0, 0, 1, 1] },         // 점 2개
    ],
  })
  assert.equal(coco.annotations.length, 1)
  assert.equal(coco.annotations[0].category_id, 1)
  assert.ok(coco.annotations.every(a => a.category_id > 0))
})

test('exportToCOCO: annotation id 는 1부터 연속', () => {
  const coco = exportToCOCO({
    filename: 'a.png', width: 10, height: 10,
    polygons: [
      { id: 1, label: 'C1', points: square(0, 0, 5) },
      { id: 2, label: 'C2', points: square(1, 1, 5) },
      { id: 3, label: 'C3', points: square(2, 2, 5) },
    ],
  })
  assert.deepEqual(coco.annotations.map(a => a.id), [1, 2, 3])
})
