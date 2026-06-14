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
 * holdable: true면 누르고 있는 동안 동작 (Space/S 같은 것)
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

const FORBIDDEN_KEYS = ['F5', 'F11', 'F12', 'Tab', 'Ctrl+R', 'Ctrl+W', 'Ctrl+T', 'Ctrl+N']
const ACTION_MAP = new Map(ACTIONS.map(a => [a.id, a]))

export function normalizeKey(e) {
  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = ''
  const code = e.code || ''

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
  else key = e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key

  if (!key || ['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return ''
  if (!['Ctrl', 'Alt', 'Shift'].includes(key)) parts.push(key)
  return parts.join('+')
}

// 새/옛 이름 모두 지원
export const normalizeKeyEvent = normalizeKey

export function displayKey(key) {
  if (!key) return ''
  return String(key).replace('Ctrl', 'Ctrl').replace('Space', 'Space')
}

export const formatKey = displayKey

export function getDefaultShortcuts() {
  const map = {}
  for (const action of ACTIONS) map[action.id] = action.defaultKey
  return map
}

export const getDefaultKeymap = getDefaultShortcuts

export function loadShortcuts() {
  try {
    const version = localStorage.getItem(VERSION_KEY)
    if (version !== String(SCHEMA_VERSION)) {
      const defaults = getDefaultShortcuts()
      localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults))
      return defaults
    }

    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultShortcuts()

    const saved = JSON.parse(raw)
    return { ...getDefaultShortcuts(), ...saved }
  } catch {
    return getDefaultShortcuts()
  }
}

export const loadKeymap = loadShortcuts

export function saveShortcuts(shortcuts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts))
  localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
}

export const saveKeymap = saveShortcuts

export function resetShortcuts() {
  const defaults = getDefaultShortcuts()
  saveShortcuts(defaults)
  return defaults
}

export function isForbidden(key) {
  return FORBIDDEN_KEYS.includes(key)
}

export const isForbiddenKey = isForbidden

/**
 * app.js 호환 반환 형식:
 *   { actionId: string, isHoldable: boolean, action: object }
 */
export function findAction(shortcuts, key) {
  for (const [actionId, boundKey] of Object.entries(shortcuts || {})) {
    if (boundKey === key) {
      const action = ACTION_MAP.get(actionId)
      if (!action) return null
      return {
        actionId,
        isHoldable: Boolean(action.holdable),
        action,
      }
    }
  }
  return null
}

export const findActionByKey = findAction

export function getAction(actionId) {
  return ACTION_MAP.get(actionId)
}

export function isHoldable(actionId) {
  return Boolean(ACTION_MAP.get(actionId)?.holdable)
}

export function groupActionsByCategory() {
  const grouped = {}
  for (const action of ACTIONS) {
    if (!grouped[action.category]) grouped[action.category] = []
    grouped[action.category].push(action)
  }
  return grouped
}
