import { LABELERS } from './labelers.js'

const STORAGE_KEY = 'spine-annotator:file-labeler-filter'
let metaMap = new Map()
let observer = null
let refreshTimer = null

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function selectedFilter() {
  return document.getElementById('fileLabelerFilter')?.value || 'all'
}

async function refreshMeta() {
  try {
    const res = await fetch('/api/labels', { headers: { 'X-Auth-Token': 'public-access' } })
    if (!res.ok) return
    const data = await res.json()
    metaMap = new Map((data.items || []).map(item => [item.filename, item]))
    applyFilter()
  } catch {}
}

function applyFilter() {
  const list = document.getElementById('fileList')
  if (!list) return
  const filter = selectedFilter()
  let visible = 0
  let total = 0
  list.querySelectorAll('li.file-list-item').forEach(li => {
    total++
    const name = li.dataset.name || ''
    const meta = metaMap.get(name)
    const show = filter === 'all' || (meta && meta.labeler_id === filter)
    li.style.display = show ? '' : 'none'
    if (show) visible++
  })
  const count = document.getElementById('fileLabelerFilterCount')
  if (count) count.textContent = filter === 'all' ? `${visible}` : `${visible}/${total}`
}

function installFilter() {
  const list = document.getElementById('fileList')
  const controls = document.getElementById('folderControls')
  if (!list || !controls || document.getElementById('fileLabelerFilter')) return false

  const wrap = document.createElement('div')
  wrap.className = 'control-group'
  wrap.style.marginTop = '8px'
  wrap.innerHTML = `
    <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:#8b949e;margin-bottom:5px">
      <i class="fas fa-user-tag"></i>
      <span>라벨러</span>
      <span id="fileLabelerFilterCount" style="margin-left:auto"></span>
    </label>
    <select id="fileLabelerFilter" class="select-input">
      <option value="all">전체 라벨러</option>
      ${LABELERS.map(l => `<option value="${esc(l.id)}">${esc(l.name)}${l.title ? ' · ' + esc(l.title) : ''}</option>`).join('')}
    </select>
  `
  controls.appendChild(wrap)

  const select = wrap.querySelector('select')
  try { select.value = localStorage.getItem(STORAGE_KEY) || 'all' } catch {}
  select.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, select.value) } catch {}
    applyFilter()
  })

  observer = new MutationObserver(() => applyFilter())
  observer.observe(list, { childList: true })
  refreshMeta()
  refreshTimer = setInterval(refreshMeta, 5000)
  applyFilter()
  return true
}

function installReviewLink() {
  if (document.getElementById('labelReviewLink')) return
  const header = document.querySelector('.app-header .header-right')
  if (!header) return
  const link = document.createElement('a')
  link.id = 'labelReviewLink'
  link.className = 'btn-secondary'
  link.href = '/label-review/index.html'
  link.title = '특정 라벨러 작업 검토 페이지'
  link.innerHTML = '<i class="fas fa-clipboard-check"></i> 검토'
  header.insertBefore(link, header.firstChild)
}

function init() {
  installReviewLink()
  if (installFilter()) return
  let tries = 0
  const timer = setInterval(() => {
    tries++
    installReviewLink()
    if (installFilter() || tries > 40) clearInterval(timer)
  }, 250)
}

window.addEventListener('beforeunload', () => {
  if (observer) observer.disconnect()
  if (refreshTimer) clearInterval(refreshTimer)
})

document.addEventListener('DOMContentLoaded', init)
