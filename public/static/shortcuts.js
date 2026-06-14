/* ================================================================
   단축키 관리 모듈
   - 키 바인딩 정의/저장/복원
   - 커스터마이징 UI 지원
   ================================================================ */

const STORAGE_KEY = 'spine-annotator:shortcuts'
// 키 매핑 스키마 버전 (기본 키 변경 시 증가시켜 옛 저장값 폐기)
const SCHEMA_VERSION = 3
const VERSION_KEY = 'spine-annotator:shortcuts:version'

/**
 * 단축키 액션 정의
 * id: 내부 식별자
 * label: 한국어 표시명
 * defaultKey: 기본 키 (string, 아래 normalizeKey 형식)
 * category: UI 분류
 * holdable: true면 누르고 있는 동안 동작 (Space 같은 것)
 */
export const ACTIONS = [
  // 그리기
  { id: 'finishPolygon', label: '완성 (순서대로 연결)', defaultKey: 'Q', category: '그리기' },
  { id: 'finishPolygonFree', label: '자유 완성 (각도순 자동 정렬)', defaultKey: 'W', category: '그리기' },
  { id: 'cancelDrawing', label: '그리기 취소', defaultKey: 'Escape', category: '그리기' },
  { id: 'removeLastPoint', label: '마지막 점 취소', defaultKey: 'E', category: '그리기' },
  { id: 'freehandMode', label: '자유 곡선 (누르고 이동)', defaultKey: 'S', category: '그리기', holdable: true },

  // 도구
  { id: 'toolDraw', label: '그리기 도구', defaultKey: 'I', category: '도구' },
  { id: 'toolEdit', label: '편집 도구', defaultKey: 'O', category: '도구' },
  { id: 'toolDelete', label: '삭제 도구', defaultKey: 'P', category: '도구' },

  // 선택/삭제
  { id: 'deleteSelected', label: '선택 폴리곤 삭제', defaultKey: 'Delete', category: '편집' },
  { id: 'removeHoveredVertex', label: '마우스 아래 점 삭제 (편집)', defaultKey: 'R', category: '편집' },
  { id: 'undo', label: '실행 취소', defaultKey: 'Ctrl+Z', category: '편집' },
  { id: 'redo', label: '다시 실행', defaultKey: 'Ctrl+Y', category: '편집' },

  // 뷰
  { id: 'panMode', label: '화면 이동 (누르고 있기)', defaultKey: 'Space', category: '보기', holdable: true },
  { id: 'zoomIn', label: '줌 인', defaultKey: '+', category: '보기' },
  { id: 'zoomOut', label: '줌 아웃', defaultKey: '-', category: '보기' },
  { id: 'zoomFit', label: '화면 맞춤', defaultKey: '0', category: '보기' },

  // 설정
  { id: 'openShortcuts', label: '단축키 설정 열기', defaultKey: 'Ctrl+K', category: '설정' },
]

/** 사용 불가 키 (브라우저 예약 등) */
const FORBIDDEN_KEYS = ['F5', 'F11', 'F12', 'Tab', 'Ctrl+R', 'Ctrl+W', 'Ctrl+T', 'Ctrl+N']

/** 액션 id로 빠르게 액션 찾기 */
const ACTION_MAP = new Map(ACTIONS.map(a => [a.id, a]))

/**
 * KeyboardEvent.code를 사람이 읽기 좋은 키 라벨로 변환
 * 한/영 키 상태와 무관하게 동작 (물리적 키 위치 기반)
 *
 * 예: 'KeyD' → 'D', 'Digit1' → '1', 'Equal' → '+',
 *     'Minus' → '-', 'Enter' → 'Enter', 'Space' → 'Space'
 */
export function normalizeKeyEvent(e) {
  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = ''
  const code = e.code

  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^Numpad[0-9]$/.test(code)) key = code.slice(6)
  else if (code === 'NumpadAdd') key = '+'
  else if (code === 'NumpadSubtract') key = '-'
  else if (code === 'Equal') key = '+'
  else if (code === 'Minus') key = '-'
  else if (code === 'BracketLeft') key = '['
  else if (code === 'BracketRight') key = ']'
  else if (code === 'Backslash') key = '\\'
  else if (code === 'Semicolon') key = ';'
  else if (code === 'Quote') key = "'"
  else if (code === 'Comma') key = ','
  else if (code === 'Period') key = '.'
  else if (code === 'Slash') key = '/'
  else if (code === 'Backquote') key = '`'
  else if (code === 'Space') key = 'Space'
  else if (code === 'Escape') key = 'Escape'
  else if (code === 'Enter') key = 'Enter'
  else if (code === 'Backspace') key = 'Backspace'
  else if (code === 'Delete') key = 'Delete'
  else if (code.startsWith('Arrow')) key = code.replace('Arrow', '')
  else if (/^F\d+$/.test(code)) key = code
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key

  // modifier 자체만 누른 경우는 무시
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return ''

  // key가 이미 Ctrl 등과 중복되지 않게
  if (!['Ctrl', 'Alt', 'Shift'].includes(key)) parts.push(key)
  return parts.join('+')
}

/** 기존 app.js 호환 이름 */
export const normalizeKey = normalizeKeyEvent

/** 문자열 키를 표시용으로 정리 */
export function formatKey(key) {
  if (!key) return ''
  return String(key).replace('Ctrl', 'Ctrl').replace('Space', 'Space')
}

/** 기존 app.js 호환 이름 */
export const displayKey = formatKey

/** 기본 키맵 */
export function getDefaultKeymap() {
  const map = {}
  for (const action of ACTIONS) map[action.id] = action.defaultKey
  return map
}

/** 저장된 키맵 로드 (없으면 기본값) */
export function loadKeymap() {
  try {
    const version = localStorage.getItem(VERSION_KEY)
    if (version !== String(SCHEMA_VERSION)) {
      localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getDefaultKeymap()))
      return getDefaultKeymap()
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultKeymap()
    const saved = JSON.parse(raw)
    return { ...getDefaultKeymap(), ...saved }
  } catch {
    return getDefaultKeymap()
  }
}

/** 기존 app.js 호환 이름 */
export const loadShortcuts = loadKeymap

/** 키맵 저장 */
export function saveKeymap(keymap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keymap))
  localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
}

/** 기존 app.js 호환 이름 */
export const saveShortcuts = saveKeymap

/** 기본 단축키로 초기화 */
export function resetShortcuts() {
  const defaults = getDefaultKeymap()
  saveKeymap(defaults)
  return defaults
}

/** 키가 사용 금지인지 */
export function isForbiddenKey(key) {
  return FORBIDDEN_KEYS.includes(key)
}

/** 기존 app.js 호환 이름 */
export const isForbidden = isForbiddenKey

/** 해당 key에 바인딩된 action id 찾기 */
export function findActionByKey(keymap, key) {
  for (const [actionId, boundKey] of Object.entries(keymap)) {
    if (boundKey === key) return actionId
  }
  return null
}

/** 기존 app.js 호환 이름 */
export const findAction = findActionByKey

/** action id → action 정보 */
export function getAction(actionId) {
  return ACTION_MAP.get(actionId)
}

/** holdable action인지 */
export function isHoldable(actionId) {
  return ACTION_MAP.get(actionId)?.holdable || false
}

/** 단축키 설정 UI용 category grouping */
export function groupActionsByCategory() {
  const grouped = {}
  for (const action of ACTIONS) {
    if (!grouped[action.category]) grouped[action.category] = []
    grouped[action.category].push(action)
  }
  return grouped
}
