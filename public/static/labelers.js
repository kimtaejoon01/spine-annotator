/* ================================================================
   라벨러 (작업자) 관리 모듈
   - 누가 작업 중인지 추적
   - 라벨 데이터의 마지막 수정자 기록
   - 색상 구분
   ================================================================ */

/**
 * 등록된 라벨러 목록
 * id: 내부 식별자 (저장용)
 * name: 화면 표시 이름
 * color: 점/뱃지 색상
 */
export const LABELERS = [
  {
    id: 'park',
    name: '박성배',
    title: '교수님',
    color: '#f0b35e', // 골드 (교수님이라 강조)
    colorDim: 'rgba(240, 179, 94, 0.18)',
  },
  {
    id: 'kim',
    name: '김태준',
    title: '',
    color: '#4f9ef8', // 블루
    colorDim: 'rgba(79, 158, 248, 0.18)',
  },
  {
    id: 'hwang',
    name: '황회진',
    title: '',
    color: '#d18ce8', // 보라/핑크
    colorDim: 'rgba(209, 140, 232, 0.18)',
  },
]

const LABELER_MAP = new Map(LABELERS.map(l => [l.id, l]))

const STORAGE_KEY = 'spine-annotator:currentLabeler'

/**
 * 현재 라벨러 ID 가져오기 (없으면 null)
 */
export function getCurrentLabelerId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}

/**
 * 현재 라벨러 객체 가져오기 (없으면 null)
 */
export function getCurrentLabeler() {
  const id = getCurrentLabelerId()
  if (!id) return null
  return LABELER_MAP.get(id) || null
}

/**
 * 현재 라벨러 설정 저장
 */
export function setCurrentLabeler(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    console.warn('Labeler save failed:', e)
  }
}

/**
 * ID로 라벨러 조회 (없으면 null)
 */
export function getLabelerById(id) {
  if (!id) return null
  return LABELER_MAP.get(id) || null
}

/**
 * 라벨러 표시명 (이름 + 직책)
 */
export function labelerDisplay(labeler) {
  if (!labeler) return '미지정'
  return labeler.title
    ? `${labeler.name} (${labeler.title})`
    : labeler.name
}
