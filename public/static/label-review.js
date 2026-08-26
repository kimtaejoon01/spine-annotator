import { SpineAnnotator } from './annotator.js'
import { pickFolderAs, restoreFolderAs, ensurePermission, listImageFiles, fileHandleToUrl } from './fs.js'
import { LABELERS, getLabelerById } from './labelers.js'
import { parseFilename, getRegionColor } from './labels.js'

const $ = (id) => document.getElementById(id)
const REVIEW_PREFIX = 'LABEL_REVIEW::'
const FOLDER_KEY = 'lr:imagesFolder'
const MAX_IMAGE_CACHE = 8
const PREFETCH_AHEAD = 4
const VERTEBRAE = ['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5','S1']
const CORNERS = ['SUP_ANT','SUP_POST','INF_POST','INF_ANT']

const state = {
  annotator: null,
  landmarkLayer: null,
  files: new Map(),
  meta: new Map(),
  reviewIndex: new Map(),
  list: [],
  current: null,
  currentMeta: null,
  originalPolygons: [],
  originalLandmarks: [],
  originalNote: null,
  review: emptyReview(),
  imageCache: new Map(),
  labelCache: new Map(),
  reviewCache: new Map(),
  noteCache: new Map(),
  openToken: 0,
  activeTool: null,
  suppressChanges: false,
  dirty: false,
  saveTimer: null,
  prefetchToken: 0,
}

function emptyReview() {
  return { type: 'label-review-v1', source_filename: '', target_labeler: '', reviewer: '', additions: [], memo: '', done: false, updated_at: '' }
}
function authHeaders(extra = {}) { return { 'X-Auth-Token': 'public-access', ...extra } }
function esc(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') }

function init() {
  state.annotator = new SpineAnnotator({ container: 'lrStage', onPolygonsChange, onZoomChange: () => renderOriginalLandmarks() })
  state.annotator.readOnly = true
  state.annotator.setTool('draw')
  state.landmarkLayer = new Konva.Layer({ listening: false })
  state.annotator.stage.add(state.landmarkLayer)
  installOriginalNotePanel()
  populateLabelers(); populateVertebrae(); restorePreferences(); bindEvents()
  refreshServerState().catch(showError)
  restoreImageFolder().catch(showError)
}

function installOriginalNotePanel() {
  if ($('lrOriginalNotePanel')) return
  const reviewMemo = $('lrMemo')
  const reviewMemoSection = reviewMemo?.closest?.('.lr-section')
  if (!reviewMemoSection?.parentNode) return

  const section = document.createElement('section')
  section.id = 'lrOriginalNotePanel'
  section.className = 'lr-section'
  section.innerHTML = `
    <h3>원 라벨 메모</h3>
    <div id="lrOriginalNote" style="white-space:pre-wrap;word-break:break-word;min-height:56px;max-height:180px;overflow:auto;padding:9px 10px;border:1px solid #30363d;border-radius:7px;background:#0d1117;color:#c9d1d9;font-size:12px;line-height:1.5">파일을 선택하세요.</div>
    <div id="lrOriginalNoteMeta" class="lr-status" style="margin-top:5px"></div>
  `
  reviewMemoSection.parentNode.insertBefore(section, reviewMemoSection)
}

function renderOriginalNote(note) {
  const box = $('lrOriginalNote')
  const meta = $('lrOriginalNoteMeta')
  if (!box || !meta) return
  const text = String(note?.note_text || '').trim()
  box.textContent = text || '원 라벨 메모 없음'
  box.style.color = text ? '#c9d1d9' : '#8b949e'

  const bits = []
  if (note?.labeler_id) {
    const labeler = getLabelerById(note.labeler_id)
    bits.push(labeler ? `작성: ${labeler.name}${labeler.title ? ' · ' + labeler.title : ''}` : `작성: ${note.labeler_id}`)
  }
  if (note?.updated_at) {
    try { bits.push(`수정: ${new Date(note.updated_at).toLocaleString()}`) } catch {}
  }
  meta.textContent = bits.join(' · ')
}

function populateLabelers() {
  $('lrTargetLabeler').innerHTML = LABELERS.map(l => `<option value="${esc(l.id)}">${esc(l.name)}${l.title ? ' · ' + esc(l.title) : ''}</option>`).join('')
}
function populateVertebrae() { $('lrVertebra').innerHTML = VERTEBRAE.map(v => `<option value="${v}">${v}</option>`).join(''); $('lrVertebra').value = 'S1' }
function restorePreferences() { try { $('lrTargetLabeler').value = localStorage.getItem('lr:targetLabeler') || 'kim'; $('lrViewFilter').value = localStorage.getItem('lr:viewFilter') || 'LAT'; $('lrReviewFilter').value = localStorage.getItem('lr:reviewFilter') || 'pending'; $('lrReviewer').value = localStorage.getItem('lr:reviewer') || '' } catch {} }

function bindEvents() {
  $('lrConnectFolder').addEventListener('click', connectImageFolder)
  $('lrRefresh').addEventListener('click', async () => { await refreshServerState(); if (state.files.size) rebuildList() })
  $('lrTargetLabeler').addEventListener('change', () => { try { localStorage.setItem('lr:targetLabeler', $('lrTargetLabeler').value) } catch {}; rebuildList(true) })
  $('lrViewFilter').addEventListener('change', () => { try { localStorage.setItem('lr:viewFilter', $('lrViewFilter').value) } catch {}; rebuildList(true) })
  $('lrReviewFilter').addEventListener('change', () => { try { localStorage.setItem('lr:reviewFilter', $('lrReviewFilter').value) } catch {}; rebuildList(true) })
  $('lrSearch').addEventListener('input', () => rebuildList(false))
  $('lrReviewer').addEventListener('input', () => { try { localStorage.setItem('lr:reviewer', $('lrReviewer').value.trim()) } catch {}; if (state.current) markDirty() })
  $('lrMemo').addEventListener('input', () => { state.review.memo = $('lrMemo').value; markDirty() })
  $('lrPrev').addEventListener('click', () => step(-1)); $('lrNext').addEventListener('click', () => step(1)); $('lrSave').addEventListener('click', () => saveReview()); $('lrDoneNext').addEventListener('click', finishAndNext)
  $('lrToggleLabels').addEventListener('change', applyLabelVisibility); $('lrCancelTool').addEventListener('click', cancelTool)
  $('lrS1Sup').addEventListener('click', () => armTool('S1_SUP', 'endplate', 'S1 상종판'))
  $('lrHcLat').addEventListener('click', () => armTool('HC_LAT', 'point', 'HC_LAT 중심점'))
  $('lrFhLat').addEventListener('click', () => armTool('FH_LAT', 'circle', 'FH_LAT 원'))
  $('lrArmEndplate').addEventListener('click', () => { const v=$('lrVertebra').value, side=$('lrEndplateSide').value; armTool(`${v}_${side}`, 'endplate', `${v} ${side==='SUP'?'상':'하'}종판`) })
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)) return
    if (e.code==='Space') { e.preventDefault(); state.annotator.setPanMode?.(true); return }
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s') { e.preventDefault(); saveReview(); return }
    if (e.code==='KeyE' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const removed = state.annotator?.removeLastPoint?.()
      if (removed) {
        const display = state.activeTool?.display || '표시'
        $('lrToolStatus').textContent = `${display}: 마지막 점 취소됨 · 다시 찍으세요`
        $('lrToolStatus').classList.add('active')
      }
      return
    }
    if (e.key==='ArrowLeft') { e.preventDefault(); step(-1) }
    if (e.key==='ArrowRight') { e.preventDefault(); step(1) }
    if (e.key==='Escape') cancelTool()
  })
  document.addEventListener('keyup', e => { if (e.code==='Space') state.annotator.setPanMode?.(false) })
  window.addEventListener('beforeunload', cleanupUrls)
}

async function refreshServerState() {
  setConnectionStatus('서버 목록 불러오는 중…')
  const [labelsRes,reviewsRes] = await Promise.all([fetch('/api/labels',{headers:authHeaders()}), fetch('/api/review',{headers:authHeaders()})])
  const labelsJson=await labelsRes.json(), reviewsJson=await reviewsRes.json(); state.meta.clear(); for (const item of labelsJson.items||[]) state.meta.set(item.filename,item)
  state.reviewIndex.clear(); for (const item of reviewsJson.items||[]) { if (!String(item.filename||'').startsWith(REVIEW_PREFIX)) continue; const source=item.review?.source_filename||String(item.filename).slice(REVIEW_PREFIX.length); if (source) state.reviewIndex.set(source,item.review||{}) }
  setConnectionStatus(`서버 라벨 ${state.meta.size}건`); rebuildList(false)
}
async function connectImageFolder() { try { const handle=await pickFolderAs(FOLDER_KEY); if (handle) await indexImageFolder(handle) } catch(e){ showError(e) } }
async function restoreImageFolder() { const r=await restoreFolderAs(FOLDER_KEY); if (!r) return; if (r.needsPermission) { $('lrConnectFolder').classList.add('warning'); $('lrConnectFolder').innerHTML='<i class="fas fa-folder-open"></i> 폴더 권한 허용'; $('lrConnectFolder').onclick=async()=>{ const ok=await ensurePermission(r.handle); if(ok){$('lrConnectFolder').onclick=connectImageFolder; await indexImageFolder(r.handle)}else await connectImageFolder() }; return } await indexImageFolder(r) }
async function indexImageFolder(handle) { setFolderStatus('이미지 목록 읽는 중…'); const files=await listImageFiles(handle); state.files.clear(); for(const f of files) state.files.set(f.name,{name:f.name,handle:f.handle||f}); setFolderStatus(`${handle.name||'이미지 폴더'} · ${state.files.size}장`); $('lrConnectFolder').classList.remove('warning'); $('lrConnectFolder').innerHTML='<i class="fas fa-folder-open"></i> 이미지 폴더 변경'; rebuildList(true) }
function inferView(name){ try{return String(parseFilename(name)?.viewType||'').toUpperCase()}catch{return /(?:^|[_-])LAT(?:[_-]|\.)/i.test(name)?'LAT':(/\bAP\b/i.test(name)?'AP':'')} }
function isReviewed(name){ return state.reviewIndex.get(name)?.done===true }

function rebuildList(openFirst=false) {
  const target=$('lrTargetLabeler').value, view=$('lrViewFilter').value, rf=$('lrReviewFilter').value, q=($('lrSearch').value||'').trim().toLowerCase(), list=[]
  for(const file of state.files.values()){ const meta=state.meta.get(file.name); if(!meta||meta.labeler_id!==target) continue; const fv=inferView(file.name); if(view!=='all'&&fv!==view) continue; const done=isReviewed(file.name); if(rf==='pending'&&done) continue; if(rf==='done'&&!done) continue; if(q&&!file.name.toLowerCase().includes(q)) continue; list.push({...file,meta,view:fv,done}) }
  list.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})); state.list=list; $('lrCount').textContent=String(list.length); renderList(); updateProgress(); if(openFirst&&list.length&&(!state.current||!list.some(x=>x.name===state.current.name))) openImage(list[0]); if(list.length) preloadAround(0)
}
function renderList(){ const ul=$('lrFileList'); ul.innerHTML=''; if(!state.list.length){ul.innerHTML='<li class="lr-empty">조건에 맞는 파일이 없습니다.</li>';return} for(const item of state.list){ const li=document.createElement('li'); li.className='lr-file'+(state.current?.name===item.name?' active':''); li.innerHTML=`<button type="button"><span class="lr-file-name">${esc(item.name)}</span><span class="lr-file-meta"><span>${esc(item.view||'--')}</span>${item.done?'<span class="done">검토완료</span>':'<span>미검토</span>'}</span></button>`; li.querySelector('button').addEventListener('click',()=>openImage(item)); ul.appendChild(li) } }
function updateProgress(){ const target=$('lrTargetLabeler').value; let total=0,done=0; for(const file of state.files.values()){const meta=state.meta.get(file.name); if(!meta||meta.labeler_id!==target)continue; total++; if(isReviewed(file.name))done++} $('lrProgress').textContent=total?`${done} / ${total} 검토 완료`:'검토할 파일 없음' }

async function openImage(item){
  if(!item)return
  await flushPendingSave(); cancelTool(); const token=++state.openToken
  state.current=item; state.currentMeta=item.meta||state.meta.get(item.name)||null; state.dirty=false
  updateHeaderForCurrent(); renderList(); setSavedStatus('불러오는 중…',''); renderOriginalNote(null)
  try{
    const [imageUrl,labels,review,originalNote]=await Promise.all([
      ensureImageUrl(item),
      loadLabelData(item.name),
      loadReviewData(item.name),
      loadOriginalNoteData(item.name),
    ])
    if(token!==state.openToken)return
    await state.annotator.loadImage(imageUrl)
    if(token!==state.openToken)return
    state.originalPolygons=Array.isArray(labels.polygons)?labels.polygons:[]
    state.originalLandmarks=Array.isArray(labels.landmarks)?labels.landmarks:[]
    state.originalNote=originalNote
    if(labels.start_label)state.annotator.startLabel=labels.start_label
    state.review=normalizeReview(review,item)
    $('lrMemo').value=state.review.memo||''
    renderOriginalNote(originalNote)
    renderCombined(); renderAdditionList(); renderOriginalLandmarks(); applyLabelVisibility()
    setSavedStatus(state.review.done?'검토 완료':'저장됨',state.review.done?'done':'')
    updateHeaderForCurrent(); preloadAround(state.list.findIndex(x=>x.name===item.name))
  }catch(e){ if(token!==state.openToken)return; showError(e); setSavedStatus('불러오기 실패','error') }
}
function normalizeReview(raw,item){ const src=raw&&raw.type==='label-review-v1'?raw:emptyReview(); return {...emptyReview(),...src,source_filename:item.name,target_labeler:item.meta?.labeler_id||$('lrTargetLabeler').value,additions:Array.isArray(src.additions)?src.additions.map((p,i)=>({...p,_review_id:p._review_id||`rv_${Date.now()}_${i}`})):[],memo:String(src.memo||''),done:src.done===true} }
function updateHeaderForCurrent(){ $('lrFileName').textContent=state.current?.name||'파일을 선택하세요'; const l=getLabelerById(state.currentMeta?.labeler_id); $('lrSourceLabeler').textContent=l?`${l.name}${l.title?' · '+l.title:''}`:'—'; const idx=state.current?state.list.findIndex(x=>x.name===state.current.name):-1; $('lrPosition').textContent=idx>=0?`${idx+1} / ${state.list.length}`:`0 / ${state.list.length}` }
async function loadLabelData(filename){ if(state.labelCache.has(filename))return state.labelCache.get(filename); const r=await fetch('/api/labels/'+encodeURIComponent(filename),{headers:authHeaders()}); if(!r.ok)throw new Error(`라벨 로드 실패 (${r.status})`); const j=await r.json(); const data=j.exists?{polygons:Array.isArray(j.polygons)?j.polygons:[],landmarks:Array.isArray(j.landmarks)?j.landmarks:[],start_label:j.start_label||'C2'}:{polygons:[],landmarks:[],start_label:'C2'}; state.labelCache.set(filename,data); return data }
async function loadReviewData(filename){ if(state.reviewCache.has(filename))return state.reviewCache.get(filename); const r=await fetch('/api/review/'+encodeURIComponent(REVIEW_PREFIX+filename),{headers:authHeaders()}); if(!r.ok)throw new Error(`검토 데이터 로드 실패 (${r.status})`); const j=await r.json(), review=j?.review||null; state.reviewCache.set(filename,review); return review }
async function loadOriginalNoteData(filename){
  if(state.noteCache.has(filename))return state.noteCache.get(filename)
  const r=await fetch('/api/notes/'+encodeURIComponent(filename),{headers:authHeaders()})
  if(!r.ok)throw new Error(`원 메모 로드 실패 (${r.status})`)
  const j=await r.json()
  const note=j?.ok===false?null:{exists:j?.exists===true,note_text:String(j?.note_text||''),labeler_id:j?.labeler_id||'',updated_at:j?.updated_at||''}
  state.noteCache.set(filename,note)
  return note
}

function renderCombined(){ state.suppressChanges=true; const originals=state.originalPolygons.map(p=>({...p,_lr_original:true})), additions=state.review.additions.map(p=>({...p,reviewOnly:true,manualLabel:true})); state.annotator.loadPolygons([...originals,...additions]); state.annotator.readOnly=true; state.suppressChanges=false; state.annotator.polyLayer?.moveToTop?.(); state.annotator.stage?.batchDraw?.() }
function renderOriginalLandmarks(){ const layer=state.landmarkLayer; if(!layer||!state.annotator)return; layer.destroyChildren(); const by=new Map((state.originalLandmarks||[]).map(l=>[String(l.label||'').toUpperCase(),l])), scale=Math.max(.001,state.annotator.stage?.scaleX?.()||1); for(const v of VERTEBRAE){ const pts=CORNERS.map(s=>by.get(`${v}_${s}`)).filter(Boolean); if(pts.length===4){ const cx=pts.reduce((n,p)=>n+Number(p.x),0)/4, cy=pts.reduce((n,p)=>n+Number(p.y),0)/4, sorted=[...pts].sort((a,b)=>Math.atan2(Number(a.y)-cy,Number(a.x)-cx)-Math.atan2(Number(b.y)-cy,Number(b.x)-cx)), color=getRegionColor(v); layer.add(new Konva.Line({points:sorted.flatMap(p=>[Number(p.x),Number(p.y)]),closed:true,stroke:color,strokeWidth:1.8/scale,fill:color+'22',listening:false})); layer.add(new Konva.Text({x:cx,y:cy,text:v,fontSize:14/scale,fill:'#fff',stroke:'#111827',strokeWidth:1/scale,listening:false,offsetX:8/scale,offsetY:7/scale})) } } for(const label of ['HC_LAT','FH_LAT']){ const p=by.get(label); if(!p)continue; const color=getRegionColor(label); layer.add(new Konva.Circle({x:Number(p.x),y:Number(p.y),radius:5/scale,fill:color,stroke:'#fff',strokeWidth:1.2/scale,listening:false})) } layer.moveToTop(); layer.batchDraw() }
function applyLabelVisibility(){ const show=$('lrToggleLabels').checked; state.annotator?.polyLayer?.visible?.(show); state.landmarkLayer?.visible?.(show); state.annotator?.stage?.batchDraw?.() }

function armTool(label,mode,display){
  if(!state.current)return
  cancelTool(false)
  const beforeIds=new Set((state.annotator.polygons||[]).map(p=>String(p.id)))
  state.activeTool={label,mode,display,beforeIds}
  state.annotator.readOnly=false
  state.annotator.setTool('draw')
  state.annotator.setPendingLabel(label,mode)
  $('lrToolStatus').textContent=mode==='point'
    ? `${display}: 위치를 1번 클릭하세요 · Esc: 도구 취소`
    : `${display}: 기준점을 2번 클릭하세요 · E: 마지막 점 취소 · Esc: 도구 취소`
  $('lrToolStatus').classList.add('active')
  $('lrCancelTool').disabled=false
}
function cancelTool(resetText=true){ if(!state.annotator)return; state.annotator.readOnly=true; state.annotator.setPendingLabel?.(null,'polygon'); state.annotator.cancelDrawing?.(); state.activeTool=null; $('lrCancelTool').disabled=true; $('lrToolStatus').classList.remove('active'); if(resetText)$('lrToolStatus').textContent='도구를 누를 때만 캔버스 입력이 활성화됩니다.' }
function onPolygonsChange(){ if(state.suppressChanges||!state.activeTool||!state.annotator)return; const tool=state.activeTool, fresh=(state.annotator.polygons||[]).filter(p=>!tool.beforeIds.has(String(p.id))); if(!fresh.length)return; const clean=serializePolygon(fresh[fresh.length-1]); clean.reviewOnly=true; clean.manualLabel=true; clean._review_id=`rv_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; state.review.additions.push(clean); cancelTool(false); renderCombined(); renderAdditionList(); $('lrToolStatus').textContent=`${tool.display} 추가됨`; markDirty() }
function serializePolygon(p){ const out={...p,points:Array.isArray(p.points)?p.points.map(Number):[]}; delete out._lr_original; delete out._centroidY; return out }
function renderAdditionList(){ const box=$('lrAdditions'), items=state.review.additions||[]; if(!items.length){box.innerHTML='<div class="lr-add-empty">추가한 표시가 없습니다.</div>';return} box.innerHTML=items.map((p,i)=>`<div class="lr-add-row"><span><strong>${esc(p.label||'표시')}</strong><small>${esc(p.shape||(p.landmark?'point':'annotation'))}</small></span><button type="button" data-remove="${i}"><i class="fas fa-times"></i></button></div>`).join(''); box.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',()=>{state.review.additions.splice(Number(btn.dataset.remove),1);renderCombined();renderAdditionList();markDirty()})) }
function markDirty(){ if(!state.current)return; state.dirty=true; state.review.done=false; setSavedStatus('저장 안 됨','dirty'); clearTimeout(state.saveTimer); state.saveTimer=setTimeout(()=>saveReview(),900) }
async function flushPendingSave(){ if(!state.dirty||!state.current)return; clearTimeout(state.saveTimer); state.saveTimer=null; await saveReview() }
async function saveReview(doneOverride=null){ if(!state.current)return false; clearTimeout(state.saveTimer); state.saveTimer=null; const filename=state.current.name, reviewer=$('lrReviewer').value.trim(); if(doneOverride===true&&!reviewer){$('lrReviewer').focus();setSavedStatus('검토자 이름을 입력하세요','error');return false} const payloadReview={...state.review,type:'label-review-v1',source_filename:filename,target_labeler:state.currentMeta?.labeler_id||$('lrTargetLabeler').value,reviewer,additions:(state.review.additions||[]).map(serializePolygon),memo:$('lrMemo').value,done:doneOverride===null?state.review.done===true:!!doneOverride,updated_at:new Date().toISOString()}; setSavedStatus('저장 중…',''); try{ const r=await fetch('/api/review/'+encodeURIComponent(REVIEW_PREFIX+filename),{method:'PUT',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({review:payloadReview,reviewer})}), j=await r.json(); if(!r.ok||!j?.ok)throw new Error(j?.error||`저장 실패 (${r.status})`); if(state.current?.name===filename){state.review=payloadReview;state.dirty=false} state.reviewCache.set(filename,payloadReview); state.reviewIndex.set(filename,payloadReview); setSavedStatus(payloadReview.done?'검토 완료':'저장됨',payloadReview.done?'done':''); updateProgress(); renderList(); return true }catch(e){setSavedStatus('저장 실패','error');showError(e);return false} }
async function finishAndNext(){ if(!state.current)return; const currentName=state.current.name; if(!await saveReview(true))return; rebuildList(false); const next=state.list.find(x=>x.name.localeCompare(currentName,undefined,{numeric:true})>0)||state.list[0]; if(next&&next.name!==currentName)await openImage(next) }
function step(delta){ if(!state.list.length)return; const i=state.current?state.list.findIndex(x=>x.name===state.current.name):-1, ni=Math.max(0,Math.min(state.list.length-1,(i<0?0:i)+delta)), next=state.list[ni]; if(next&&next.name!==state.current?.name)openImage(next) }

async function ensureImageUrl(item){ const cached=state.imageCache.get(item.name); if(cached){cached.used=Date.now();return cached.url} const result=await fileHandleToUrl(item.handle), url=result.url||result; state.imageCache.set(item.name,{url,used:Date.now()}); evictImageCache(); return url }
function evictImageCache(){ if(state.imageCache.size<=MAX_IMAGE_CACHE)return; const protectedNames=new Set([state.current?.name].filter(Boolean)), victims=[...state.imageCache.entries()].filter(([n])=>!protectedNames.has(n)).sort((a,b)=>a[1].used-b[1].used); while(state.imageCache.size>MAX_IMAGE_CACHE&&victims.length){const [name,entry]=victims.shift();URL.revokeObjectURL(entry.url);state.imageCache.delete(name)} }
function preloadAround(index){ if(!state.list.length||index<0)return; const token=++state.prefetchToken, items=[]; for(let n=1;n<=PREFETCH_AHEAD;n++)if(state.list[index+n])items.push(state.list[index+n]); if(state.list[index-1])items.push(state.list[index-1]); if(!items.length){$('lrPreload').textContent='';return} ;(async()=>{let done=0;$('lrPreload').textContent=`다음 이미지 미리 읽기 0/${items.length}`; for(const item of items){if(token!==state.prefetchToken)return; try{await Promise.all([ensureImageUrl(item),loadLabelData(item.name),loadReviewData(item.name),loadOriginalNoteData(item.name)])}catch{} done++; if(token===state.prefetchToken)$('lrPreload').textContent=`다음 이미지 미리 읽기 ${done}/${items.length}` } if(token===state.prefetchToken)$('lrPreload').textContent='다음 이미지 준비됨'})() }
function setSavedStatus(text,cls){$('lrSaved').textContent=text;$('lrSaved').className='lr-saved'+(cls?' '+cls:'')}
function setFolderStatus(text){$('lrFolderStatus').textContent=text} function setConnectionStatus(text){$('lrServerStatus').textContent=text}
function showError(error){console.error('[label-review]',error);$('lrToast').textContent=error?.message||String(error||'알 수 없는 오류');$('lrToast').classList.add('show');clearTimeout($('lrToast')._timer);$('lrToast')._timer=setTimeout(()=>$('lrToast').classList.remove('show'),4000)}
function cleanupUrls(){for(const entry of state.imageCache.values())try{URL.revokeObjectURL(entry.url)}catch{} state.imageCache.clear()}

document.addEventListener('DOMContentLoaded', init)
