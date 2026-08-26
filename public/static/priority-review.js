const PRIORITY_PREFIX = 'PRIORITY_REVIEW::'
const POLL_MS = 5000

let priorityMap = new Map()
let listObserver = null
let nameObserver = null
let pollTimer = null
let saveBusy = false

function authHeaders(extra = {}) {
  return { 'X-Auth-Token': 'public-access', ...extra }
}

function isImageName(name) {
  return /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(String(name || '').trim())
}

function currentFilename() {
  const el = document.getElementById('lrFileName') || document.getElementById('fileName')
  const name = String(el?.textContent || '').trim()
  return isImageName(name) ? name : ''
}

function isPriority(name) {
  return priorityMap.get(name)?.priority === true
}

function injectStyle() {
  if (document.getElementById('priorityReviewStyle')) return
  const style = document.createElement('style')
  style.id = 'priorityReviewStyle'
  style.textContent = `
    .priority-review-btn.is-priority {
      border-color: #d29922 !important;
      color: #f2cc60 !important;
      background: rgba(210,153,34,.12) !important;
    }
    .priority-star {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      min-width: 16px;
      margin-right: 5px;
      color: #f2cc60;
      font-size: 13px;
      line-height: 1;
      filter: drop-shadow(0 0 3px rgba(242,204,96,.28));
    }
    li.priority-review-item > button {
      border-color: rgba(210,153,34,.38) !important;
      background-image: linear-gradient(90deg, rgba(210,153,34,.10), transparent 46%) !important;
    }
    li.priority-review-item .lr-file-name,
    li.priority-review-item .file-name {
      color: #f2cc60 !important;
    }
  `
  document.head.appendChild(style)
}

function itemFilename(li) {
  if (li?.dataset?.name) return li.dataset.name
  const nameEl = li?.querySelector?.('.lr-file-name, .file-name')
  return String(nameEl?.textContent || '').trim()
}

function markListItem(li) {
  const name = itemFilename(li)
  if (!name) return
  const active = isPriority(name)
  li.classList.toggle('priority-review-item', active)

  let star = li.querySelector(':scope > button > .priority-star')
  const button = li.querySelector(':scope > button')
  if (active && button && !star) {
    star = document.createElement('span')
    star.className = 'priority-star'
    star.textContent = '★'
    star.title = '우선 검토'
    button.prepend(star)
  } else if (!active && star) {
    star.remove()
  }
}

function applyListMarks() {
  document.querySelectorAll('#fileList li.file-list-item, #lrFileList li.lr-file').forEach(markListItem)
}

function updateButton() {
  const btn = document.getElementById('priorityReviewBtn')
  if (!btn) return
  const name = currentFilename()
  btn.disabled = !name || saveBusy
  const active = !!name && isPriority(name)
  btn.classList.toggle('is-priority', active)
  btn.setAttribute('aria-pressed', active ? 'true' : 'false')
  btn.title = name ? (active ? '우선 검토 표시 해제' : '우선 검토로 표시') : '이미지를 선택하세요'
  btn.innerHTML = active
    ? '<i class="fas fa-star"></i> 우선 검토'
    : '<i class="far fa-star"></i> 우선 검토'
}

async function refreshPriorityMap() {
  try {
    const res = await fetch('/api/review', { headers: authHeaders() })
    if (!res.ok) return
    const data = await res.json()
    const next = new Map()
    for (const item of data.items || []) {
      const key = String(item.filename || '')
      if (!key.startsWith(PRIORITY_PREFIX)) continue
      const source = item.review?.source_filename || key.slice(PRIORITY_PREFIX.length)
      if (!source) continue
      next.set(source, item.review || {})
    }
    priorityMap = next
    applyListMarks()
    updateButton()
  } catch (err) {
    console.warn('[priority-review] refresh failed', err)
  }
}

async function toggleCurrentPriority() {
  const name = currentFilename()
  if (!name || saveBusy) return
  const nextValue = !isPriority(name)
  saveBusy = true
  updateButton()

  const review = {
    type: 'priority-review-v1',
    source_filename: name,
    priority: nextValue,
    updated_at: new Date().toISOString(),
  }

  try {
    const res = await fetch('/api/review/' + encodeURIComponent(PRIORITY_PREFIX + name), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ review, reviewer: '' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `저장 실패 (${res.status})`)
    priorityMap.set(name, review)
    applyListMarks()
  } catch (err) {
    console.error('[priority-review] save failed', err)
    const toast = document.getElementById('lrToast')
    if (toast) {
      toast.textContent = '우선 검토 표시 저장에 실패했습니다.'
      toast.classList.add('show')
      setTimeout(() => toast.classList.remove('show'), 3000)
    } else {
      alert('우선 검토 표시 저장에 실패했습니다.')
    }
  } finally {
    saveBusy = false
    updateButton()
  }
}

function installButton() {
  if (document.getElementById('priorityReviewBtn')) return true

  const lrActions = document.querySelector('.lr-head-actions')
  if (lrActions) {
    const btn = document.createElement('button')
    btn.id = 'priorityReviewBtn'
    btn.type = 'button'
    btn.className = 'lr-btn priority-review-btn'
    btn.addEventListener('click', toggleCurrentPriority)
    const anchor = document.getElementById('lrPrev')
    lrActions.insertBefore(btn, anchor || lrActions.firstChild)
    updateButton()
    return true
  }

  const annotateHeader = document.querySelector('.app-header .header-right')
  if (annotateHeader && document.getElementById('fileName')) {
    const btn = document.createElement('button')
    btn.id = 'priorityReviewBtn'
    btn.type = 'button'
    btn.className = 'btn-secondary priority-review-btn'
    btn.addEventListener('click', toggleCurrentPriority)
    const reviewLink = document.getElementById('labelReviewLink')
    if (reviewLink?.nextSibling) annotateHeader.insertBefore(btn, reviewLink.nextSibling)
    else if (reviewLink) annotateHeader.appendChild(btn)
    else annotateHeader.insertBefore(btn, annotateHeader.firstChild)
    updateButton()
    return true
  }
  return false
}

function observeUi() {
  const list = document.getElementById('lrFileList') || document.getElementById('fileList')
  if (list && !listObserver) {
    listObserver = new MutationObserver(() => applyListMarks())
    listObserver.observe(list, { childList: true, subtree: true })
  }

  const nameEl = document.getElementById('lrFileName') || document.getElementById('fileName')
  if (nameEl && !nameObserver) {
    nameObserver = new MutationObserver(() => updateButton())
    nameObserver.observe(nameEl, { childList: true, characterData: true, subtree: true })
  }
}

function init() {
  injectStyle()
  installButton()
  observeUi()
  refreshPriorityMap()

  let tries = 0
  const installTimer = setInterval(() => {
    tries++
    installButton()
    observeUi()
    applyListMarks()
    if (document.getElementById('priorityReviewBtn') || tries > 40) clearInterval(installTimer)
  }, 250)

  pollTimer = setInterval(refreshPriorityMap, POLL_MS)
}

window.addEventListener('beforeunload', () => {
  listObserver?.disconnect()
  nameObserver?.disconnect()
  if (pollTimer) clearInterval(pollTimer)
})

document.addEventListener('DOMContentLoaded', init)
