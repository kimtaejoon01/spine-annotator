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
  { id: 'freehandMode', label: '자유 곡선 (누르고 드래그)', defaultKey: 'S', category: '그리기', holdable: true },

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
function codeToLabel(code, shiftKey) {
  if (!code) return null

  // KeyA ~ KeyZ → A ~ Z
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3)
  }
  // Digit0 ~ Digit9 → 0 ~ 9 (numpad 별도)
  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5)
  }
  if (code.startsWith('Numpad')) {
    const rest = code.slice(6)
    // Numpad0~9는 그냥 숫자처럼 취급
    if (/^\d$/.test(rest)) return rest
    // NumpadAdd, Subtract 등은 일반 +, -와 통합
    if (rest === 'Add') return '+'
    if (rest === 'Subtract') return '-'
    if (rest === 'Multiply') return '*'
    if (rest === 'Divide') return '/'
    if (rest === 'Decimal') return '.'
    if (rest === 'Enter') return 'Enter'
    return 'Num' + rest
  }

  // 특수 키 매핑
  const map = {
    'Space': 'Space',
    'Enter': 'Enter',
    'Escape': 'Escape',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'Tab': 'Tab',
    'CapsLock': 'CapsLock',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
    'Insert': 'Insert',
    // 기호 키 (Shift 안 누른 기준의 라벨)
    'Minus': '-',
    'Equal': '+',     // = 키, 보통 줌인용으로 +로 표기
    'BracketLeft': '[',
    'BracketRight': ']',
    'Backslash': '\\',
    'Semicolon': ';',
    'Quote': "'",
    'Comma': ',',
    'Period': '.',
    'Slash': '/',
    'Backquote': '`',
  }
  if (map[code]) return map[code]

  // F1 ~ F12
  if (/^F\d+$/.test(code)) return code

  // 그 외 (예: ContextMenu 등) - 그대로
  return code
}

/**
 * 키 이벤트를 정규화된 키 문자열로 변환
 * 한/영 상태와 무관하게 물리적 키 위치로 정규화
 * 예: Ctrl+Z, Shift+Enter, A, Space, +
 */
export function normalizeKey(e) {
  // 수정자 키 자체는 무시
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' ||
      e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
      e.code === 'AltLeft' || e.code === 'AltRight' ||
      e.code === 'MetaLeft' || e.code === 'MetaRight') {
    return null
  }

  const label = codeToLabel(e.code, e.shiftKey)
  if (!label) return null

  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(label)
  return parts.join('+')
}

/**
 * 저장된 단축키 설정 로드 (기본값과 머지)
 */
export function loadShortcuts() {
  let saved = {}
  try {
    const storedVersion = parseInt(localStorage.getItem(VERSION_KEY) || '1', 10)
    // 스키마 버전이 다르면 옛 저장값 폐기 → 모두 새 기본값 사용
    if (storedVersion === SCHEMA_VERSION) {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw)
    } else {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
    }
  } catch (e) {
    console.warn('Shortcut load failed:', e)
  }
  const result = {}
  for (const action of ACTIONS) {
    result[action.id] = saved[action.id] || action.defaultKey
  }
  return result
}

/**
 * 단축키 설정 저장
 */
export function saveShortcuts(bindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
    localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
  } catch (e) {
    console.warn('Shortcut save failed:', e)
  }
}

/**
 * 기본값 복원
 */
export function resetShortcuts() {
  const result = {}
  for (const action of ACTIONS) {
    result[action.id] = action.defaultKey
  }
  saveShortcuts(result)
  return result
}

/**
 * 키 입력에서 액션 id 찾기
 * @returns {Object|null} { actionId, isHoldable }
 */
export function findAction(bindings, normalized) {
  if (!normalized) return null
  for (const [id, key] of Object.entries(bindings)) {
    if (key === normalized) {
      const action = ACTION_MAP.get(id)
      return { actionId: id, isHoldable: !!(action && action.holdable) }
    }
  }
  return null
}

/**
 * 표시용 키 라벨 (Mac/Win 자동 분기)
 */
export function displayKey(key) {
  if (!key) return ''
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  if (isMac) {
    return key
      .replace(/Ctrl/g, '⌘')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
  }
  return key
}

/**
 * 카테고리별로 액션 그룹화
 */
export function groupActionsByCategory() {
  const groups = {}
  for (const action of ACTIONS) {
    if (!groups[action.category]) groups[action.category] = []
    groups[action.category].push(action)
  }
  return groups
}

/** FORBIDDEN_KEYS 체크 */
export function isForbidden(key) {
  return FORBIDDEN_KEYS.includes(key)
}
