import {renderTimings} from './timing-view.js'
import {bindViewerControls} from './viewer-controls.js'
import {validateResult,toAnnotations} from './result.js'
const $=id=>document.getElementById(id),API=new URL('../api/',import.meta.url)
const s={ready:false,busy:false,file:null,image:null,result:null,job:null,panX:0,panY:0,zoom:1,request:null,previewUrl:null}
const colors={spine:'#48e0c6',corners:'#bc9cff',s1:'#ffd34d',fh_mask:'#ff77b7',fh_circle:'#ff9d61',hc:'#ffffff'}
const layers={spine:true,number:true,corners:true,s1:true,fh_mask:true,fh_circle:true,hc:true}
const names={spine:'척추 윤곽',number:'번호',corners:'꼭지점',s1:'S1',fh_mask:'골두 분할',fh_circle:'골두 원',hc:'HC'}
const modelNames={number:'척추 번호 모델',a:'A 척추 분할 모델',s1:'S1 final_bundle',fh:'대퇴골두 모델'}
let token=new URLSearchParams(location.hash.slice(1)).get('token')||localStorage.getItem('spine-ai:connection')||''
if(location.hash)history.replaceState(null,'',location.pathname+location.search)
$('token').value=token
function message(text){$('status').textContent=text}
function busy(value){s.busy=value;for(const id of ['upload','load','run','connect','anterior'])$(id).disabled=value;updateButtons()}
function updateButtons(){
  $('run').disabled=s.busy||!s.file||!s.ready
  for(const id of ['download','json','apply'])$(id).disabled=s.busy||!s.result
  $('s1').disabled=s.busy||!s.result||$('l5').value===''
}
async function request(path,options={},blob=false){
  const headers=new Headers(options.headers||{});headers.set('Authorization','Bearer '+token)
  const response=await fetch(new URL(path,API),{...options,headers})
  if(!response.ok){let text=`서버 오류 (${response.status})`;try{text=(await response.json()).detail||text}catch{};throw Error(typeof text==='string'?text:JSON.stringify(text))}
  return blob?response.blob():response.json()
}
const post=(path,body)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
function showSetup(){if(!$('setup').open)$('setup').showModal()}
$('setupToggle').onclick=showSetup;$('closeSetup').onclick=()=>$('setup').close()
for(const [key,name] of Object.entries(modelNames)){
  const label=document.createElement('label');label.className='field';label.textContent=name
  const input=document.createElement('input');input.id='model-'+key;input.placeholder='학습 결과 폴더의 전체 경로';input.setAttribute('list','list-'+key)
  const list=document.createElement('datalist');list.id='list-'+key;label.append(input,list);$('modelFields').append(label)
}
for(const [key,label] of Object.entries(names)){
  const el=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=true
  check.onchange=()=>{layers[key]=check.checked;draw()};el.append(check,document.createTextNode(label));$('layers').append(el)
}
async function connect(){
  token=$('token').value.trim()
  try{
    const h=await request('health');s.ready=h.ready;localStorage.setItem('spine-ai:connection',token)
    $('connection').textContent=h.ready?'모델 준비 완료 · '+(h.models.device||''):'서버 연결됨'
    const config=await request('models')
    for(const key of Object.keys(modelNames)){
      $('model-'+key).value=config.paths[key]||(config.found[key]?.length===1?config.found[key][0]:'')
      $('list-'+key).replaceChildren(...(config.found[key]||[]).map(p=>{const o=document.createElement('option');o.value=p;return o}))
    }
    $('device').value=config.paths.device||'auto';$('setupStatus').textContent='연결되었습니다. 사용할 모델 폴더를 확인하세요.'
    updateButtons();if(s.ready){message('준비 완료. X-ray를 업로드하세요.');$('setup').close()}
    notifyReady()
  }catch(e){s.ready=false;$('setupStatus').textContent=e.message;showSetup();updateButtons()}
}
$('connect').onclick=connect
async function poll(id){
  for(;;){const j=await request('jobs/'+id);$('bar').style.width=j.progress+'%';message(j.message);$('setupStatus').textContent=j.message
    if(j.state==='done')return j
    if(j.state==='failed')throw Error(j.message)
    await new Promise(r=>setTimeout(r,800))
  }
}
$('setupForm').onsubmit=async e=>{
  e.preventDefault();busy(true)
  try{
    const cfg=Object.fromEntries(Object.keys(modelNames).map(k=>[k,$('model-'+k).value.trim()]));cfg.device=$('device').value
    const j=await post('models/load',cfg);s.ready=false;await poll(j.id);s.ready=true
    $('connection').textContent='모델 준비 완료';$('setup').close();message('모델 준비 완료.')
  }catch(e){s.ready=false;message(e.message);$('setupStatus').textContent=e.message}
  finally{busy(false)}
  if(s.ready&&s.file)analyze()
}
async function loadBrowserImage(blob){
  const url=URL.createObjectURL(blob),im=new Image()
  try{await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=()=>reject(Error('미리보기 표시 실패'));im.src=url});return im}
  finally{URL.revokeObjectURL(url)}
}
async function setFile(file,bridge=null){
  if(s.busy)return
  if(!file)return
  if(file.size>32*1024*1024){message('32 MB 이하의 영상을 올려 주세요.');return}
  s.file=file;s.result=null;s.job=null;s.request=bridge;s.image=null;s.zoom=1;s.panX=0;s.panY=0
  $('filename').textContent=file.name;$('review').hidden=true;$('summary').replaceChildren();renderTimings($('timings'),null);$('table').replaceChildren();$('decoder').textContent=''
  $('apply').hidden=!bridge;$('empty').hidden=false;updateButtons()
  try{s.image=await loadBrowserImage(file);$('empty').hidden=true;draw()}catch{draw()}
  if(s.ready)analyze();else{message('영상이 준비되었습니다. 모델을 불러오면 자동 분석합니다.');showSetup()}
}
$('upload').onchange=e=>setFile(e.target.files[0])
for(const type of ['dragover','drop'])$('drop').addEventListener(type,e=>{e.preventDefault();if(type==='drop'){if(!s.busy)setFile(e.dataTransfer.files[0]);$('drop').classList.remove('drag')}else $('drop').classList.add('drag')})
$('drop').ondragleave=()=>$('drop').classList.remove('drag')
async function analyze(){
  if(s.busy||!s.ready||!s.file)return
  busy(true);s.result=null;s.job=null;$('review').hidden=true;$('summary').replaceChildren();renderTimings($('timings'),null);$('table').replaceChildren();$('decoder').textContent='';draw()
  try{
    const form=new FormData();form.append('image',s.file,s.file.name);form.append('anterior_right',String($('anterior').value==='right'))
    const j=await request('predict',{method:'POST',body:form});s.job=j.id;const done=await poll(j.id)
    s.result=validateResult(done.result)
    s.image=await loadBrowserImage(await request('jobs/'+j.id+'/preview',{},true));$('empty').hidden=true
    renderResult()
  }catch(e){s.result=null;message('분석 실패: '+e.message);draw()}
  finally{busy(false)}
}
$('run').onclick=analyze
$('anterior').onchange=()=>{if(s.result){s.result=null;renderTimings($('timings'),null);updateButtons();draw();message('전방 방향이 바뀌었습니다. 전체 분석을 다시 실행해 주세요.')}}
$('method').onchange=()=>{draw();if(s.result)renderTable()}
$('l5').onchange=updateButtons
$('s1').onclick=async()=>{
  if(s.busy||!s.result||$('l5').value==='')return
  busy(true)
  try{const j=await post('jobs/'+s.job+'/s1',{candidate_index:Number($('l5').value)});s.result=validateResult((await poll(j.id)).result);renderResult()}
  catch(e){message(e.message)}finally{busy(false)}
}
function renderTable(){
  const table=document.createElement('table'),thead=table.createTHead(),head=thead.insertRow()
  for(const text of ['후보','최종 번호','모델 점수','raw 번호']){const th=document.createElement('th');th.textContent=text;head.append(th)}
  for(const r of s.result.spine.numbering){const row=table.insertRow();for(const text of [r.input_index+1,r.final_level,Number(r.final_confidence).toFixed(3),r.raw_level])row.insertCell().textContent=text}
  $('table').replaceChildren(table)
}
function renderResult(){
  const r=s.result,sp=r.spine,fh=r.femoral||{},s1=r.s1||{}
  $('decoder').textContent=sp.decoder==='raw'?'raw · 보정 미적용':'Viterbi'
  const summary=[['척추 후보',sp.polygons.length],['S1',s1.status==='predicted'?'검출':'확인 필요'],['골두',(fh.instances||[]).length],['HC',fh.HC_LAT?'표시':'보류']]
  $('summary').replaceChildren(...summary.map(([title,value])=>{const el=document.createElement('div'),small=document.createElement('span'),b=document.createElement('b');small.textContent=title;b.textContent=value;el.append(small,b);return el}))
  renderTimings($('timings'),r.timings)
  const notes=[...(r.review_reasons||[]),...(r.errors||[]).map(x=>x.stage+': '+x.message),...(fh.review_reasons||[]).map(x=>'골두: '+x)]
  if(s1.reason)notes.push(s1.reason+' L5 후보를 선택해 S1을 재계산할 수 있습니다.')
  if(s1.in_bounds===false)notes.push('S1 끝점이 영상 경계를 벗어났습니다.')
  if(s1.l5_source==='user_selected_prediction')notes.push('S1 입력: 직접 선택한 후보 '+(s1.l5_candidate_index+1))
  for(const c of sp.corners||[])for(const m of ['v1','v2'])if(c[m]?.quality==='review')notes.push(`후보 ${c.candidate_index+1} ${m}: ${(c[m].reasons||[]).join(', ')}`)
  $('review').textContent=notes.join('\n');$('review').hidden=!notes.length
  const options=[new Option('L5 후보 선택',''),...sp.numbering.map(x=>new Option(`${x.input_index+1}: ${x.final_level}`,x.input_index))]
  $('l5').replaceChildren(...options);$('l5').value=s1.l5_candidate_index??''
  $('l5Panel').open=s1.status==='needs_l5_selection';renderTable();draw()
  message(r.status==='complete'?'분석 완료':'분석 완료 · 확인할 항목이 있습니다.');updateButtons()
}
function saveBlob(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('json').onclick=()=>saveBlob(new Blob([JSON.stringify(s.result,null,2)],{type:'application/json'}),'spine_ai_coordinates.json')
$('download').onclick=async()=>{busy(true);try{saveBlob(await request('jobs/'+s.job+'/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:$('method').value,layers})},true),'spine_ai_results.zip');message('ZIP 다운로드 완료')}catch(e){message(e.message)}finally{busy(false)}}

function draw(){for(const id of ['original','overlay'])paint($(id),id==='overlay')}
function paint(canvas,overlay){
  const dpr=Math.min(devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)
  const c=canvas.getContext('2d');c.scale(dpr,dpr);c.fillStyle='#080c12';c.fillRect(0,0,rect.width,rect.height)
  if(!s.image)return
  const w=s.result?.image.width||s.image.naturalWidth,h=s.result?.image.height||s.image.naturalHeight
  const scale=Math.min(rect.width/w,rect.height/h)*s.zoom;c.translate((rect.width-w*scale)/2+s.panX,(rect.height-h*scale)/2+s.panY);c.scale(scale,scale)
  c.drawImage(s.image,0,0,w,h);if(!overlay||!s.result)return
  const r=s.result,stroke=1.4/scale,dot=2.7/scale,fs=11/scale;c.lineWidth=stroke;c.lineJoin='round';c.font=`${fs}px sans-serif`
  const line=(p,color,closed=false,fill=false)=>{if(!p?.length)return;c.beginPath();p.forEach((pt,i)=>i?c.lineTo(...pt):c.moveTo(...pt));if(closed)c.closePath();if(fill){c.fillStyle=color+'38';c.fill()}c.strokeStyle=color;c.stroke()}
  const point=(p,color)=>{if(!p)return;c.fillStyle=color;c.beginPath();c.arc(p[0],p[1],dot,0,Math.PI*2);c.fill()}
  const tag=(p,text,color)=>{const width=c.measureText(text).width;c.fillStyle='#0b1421db';c.fillRect(p[0]-2/scale,p[1]-fs,width+4/scale,fs+4/scale);c.fillStyle=color;c.fillText(text,...p)}
  if(layers.fh_mask)for(const x of r.femoral?.segmentation_contours||[])line(x.points,x.slot?'#ff9d61':'#ff77b7',true,true)
  const byId=new Map(r.spine.numbering.map(x=>[x.input_index,x]))
  r.spine.polygons.forEach((p,i)=>{if(layers.spine)line(p.points,colors.spine,true);if(layers.number){const x=Math.max(...p.points.map(x=>x[0])),y=p.points.reduce((sum,p)=>sum+p[1],0)/p.points.length;tag([x+4/scale,y],`${i+1}: ${byId.get(i).final_level}`,colors.spine)}})
  if(layers.corners)for(const row of r.spine.corners||[]){const x=row[$('method').value]||{},color=$('method').value==='v1'?'#64b5ff':colors.corners;for(const [a,b] of [['SA','SP'],['IA','IP']])if(x[a]&&x[b])line([x[a],x[b]],color);for(const k of ['SA','SP','IA','IP'])point(x[k],color)}
  if(layers.s1&&r.s1?.points){line(r.s1.points,colors.s1);r.s1.points.forEach(p=>point(p,colors.s1));tag(r.s1.points[0],'S1',colors.s1)}
  if(layers.fh_circle)for(const x of r.femoral?.instances||[]){const color=x.slot?'#ff9d61':'#ff77b7';c.beginPath();c.arc(x.cx,x.cy,x.radius,0,Math.PI*2);c.strokeStyle=color;c.stroke();point([x.cx,x.cy],color);tag([x.cx+x.radius,x.cy],`FH${x.slot+1}`,color)}
  if(layers.hc&&r.femoral?.HC_LAT){const p=r.femoral.HC_LAT;point([p.x,p.y],'white');tag([p.x+7/scale,p.y+14/scale],'HC','white')}
}
bindViewerControls(document.querySelector('.viewers'),[$('original'),$('overlay')],s,draw)
$('fit').onclick=()=>{s.zoom=1;s.panX=s.panY=0;draw()};new ResizeObserver(draw).observe($('original'))

// Dedicated analysis window bridge: exact opener origin + source + per-request ID.
let openerOrigin=null
try{const x=new URL(new URLSearchParams(location.search).get('opener'));if(['http:','https:'].includes(x.protocol))openerOrigin=x.origin}catch{}
function notifyReady(){if(window.opener&&openerOrigin)window.opener.postMessage({type:'spine-ai:ready'},openerOrigin)}
window.addEventListener('message',e=>{
  if(!window.opener||e.source!==window.opener||e.origin!==openerOrigin||e.data?.type!=='spine-ai:image'||s.busy)return
  const m=e.data;if(!(m.blob instanceof Blob)||typeof m.filename!=='string'||typeof m.requestId!=='string')return
  setFile(new File([m.blob],m.filename,{type:m.blob.type}),{requestId:m.requestId,origin:e.origin})
})
$('apply').onclick=()=>{
  if(!s.result||!s.request||!window.opener)return
  try{const converted=toAnnotations(s.result,$('method').value);if(converted.warnings.length&&!confirm(converted.warnings.join('\n')+'\n\n유효한 결과를 적용할까요?'))return
    window.opener.postMessage({type:'spine-ai:result',requestId:s.request.requestId,result:s.result,method:$('method').value},s.request.origin);message('Annotator로 결과를 보냈습니다. 기존 창에서 적용 여부를 확인하세요.')
  }catch(e){message(e.message)}
}
if(token)connect();else{showSetup();notifyReady()}
