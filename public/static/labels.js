/* ================================================================
   척추 라벨 정의 & 유틸
   ================================================================ */

// 척추 라벨 (위→아래 순서, 총 25개)
export const LABELS = [
  // 경추 Cervical (7)
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  // 흉추 Thoracic (12)
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
  // 요추 Lumbar (5)
  'L1', 'L2', 'L3', 'L4', 'L5',
  // 천추 Sacrum (1)
  'S1',
]

// 추가 골반/고관절 라벨: 자동 척추 라벨링 순서에는 포함하지 않음
export const EXTRA_LABELS = ['FH_L', 'FH_R', 'HC_L', 'HC_R', 'FH_LAT', 'HC_LAT']
export const ALL_LABELS = [...LABELS, ...EXTRA_LABELS]

// 척추 영역별 색상
const COLOR_CERVICAL = '#f87171' // 빨강
const COLOR_THORACIC = '#fbbf24' // 노랑
const COLOR_LUMBAR = '#60a5fa'   // 파랑
const COLOR_SACRAL = '#c084fc'   // 보라
const COLOR_FEMORAL_HEAD = '#34d399'
const COLOR_HIP_CENTER = '#fb7185'

/**
 * 라벨 이름으로 색상 반환
 */
export function isSpineLabel(label) {
  return LABELS.includes(label)
}

export function isExtraLabel(label) {
  return EXTRA_LABELS.includes(label)
}

export function isPelvisPointLabel(label) {
  return label === 'HC_L' || label === 'HC_R' || label === 'HC_LAT'
}

export function getRegionColor(label) {
  if (!label) return '#888888'
  if (label === 'FH_L' || label === 'FH_R' || label === 'FH_LAT') return COLOR_FEMORAL_HEAD
  if (label === 'HC_L' || label === 'HC_R' || label === 'HC_LAT') return COLOR_HIP_CENTER
  const c = label[0]
  if (c === 'C') return COLOR_CERVICAL
  if (c === 'T') return COLOR_THORACIC
  if (c === 'L') return COLOR_LUMBAR
  if (c === 'S') return COLOR_SACRAL
  return '#888888'
}

/**
 * 라벨 이름으로 supercategory 반환 (COCO용)
 */
export function getSupercategory(label) {
  if (!label) return 'unknown'
  const c = label[0]
  if (c === 'C') return 'cervical'
  if (c === 'T') return 'thoracic'
  if (c === 'L') return 'lumbar'
  if (c === 'S') return 'sacrum'
  if (label === 'FH_L' || label === 'FH_R' || label === 'FH_LAT') return 'femoral_head'
  if (label === 'HC_L' || label === 'HC_R' || label === 'HC_LAT') return 'hip_center'
  return 'unknown'
}

/**
 * 파일명 파싱: "02066135_20260121_AP.png" 형식
 * → { patientId, studyDate, viewType }
 */
export function parseFilename(filename) {
  const base = filename.replace(/\.(png|jpg|jpeg)$/i, '')
  const match = base.match(/^(.+?)_(\d{8})_(AP|LAT|ap|lat)$/i)
  if (match) {
    return {
      patientId: match[1],
      studyDate: match[2],
      viewType: match[3].toUpperCase(),
    }
  }

  // AP/LAT만 파일명에 있는 경우
  const viewMatch = base.match(/(AP|LAT)/i)
  return {
    patientId: base,
    studyDate: '',
    viewType: viewMatch ? viewMatch[1].toUpperCase() : 'AP',
  }
}

/**
 * 시작 라벨로부터 N개의 연속 라벨 생성
 * 예: startLabel='C2', count=5 → ['C2','C3','C4','C5','C6']
 */
export function generateLabels(startLabel, count) {
  const startIdx = LABELS.indexOf(startLabel)
  if (startIdx === -1) return Array(count).fill('?')

  const result = []
  for (let i = 0; i < count; i++) {
    const idx = startIdx + i
    result.push(idx < LABELS.length ? LABELS[idx] : `?${idx - LABELS.length + 1}`)
  }
  return result
}
