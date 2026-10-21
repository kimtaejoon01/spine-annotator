import {calculateSagittal} from '../ai/sagittal.js'
import {paintMeasurement,mountMeasurements} from '../ai/measurement-view.js'
import {aiMeasurementInput,gtMeasurementInput} from './measurement-input.js'
import {restoreSavedModels} from './startup.js'
import {createGroundTruthLoader} from '../ai/ground-truth-loader.js'
import {loadComparisonLabel,listComparisonLabelMeta} from '../static/api.js'
import {groundTruthView,prepareGroundTruth,paintGroundTruth} from '../ai/ground-truth.js'
import {renderTimings} from '../ai/timing-view.js'
import {bindViewerControls} from '../ai/viewer-controls.js'
import {validateResult,toAnnotations} from '../ai/result.js'
import {readBundle,validateManifest,STAGES} from './bundle.js'
import {savedBundle,saveBundle,clearBundle} from './storage.js'
const $=id=>document.getElementById(id)
const s={ready:false,busy:false,loadingModels:false,file:null,image:null,imageSize:null,result:null,job:null,panX:0,panY:0,zoom:1,request:null,previewUrl:null}
let gtData=null,gtSource='',gt=null,gtView=null,sizeConfirmedFor=null
let measurementData={ai:[],gt:[]},measurementCache=null
const measurementUI=mountMeasurements({cards:$('measurementCards'),detail:$('measurementDetail'),description:$('measurementDefinition'),onSelect:()=>draw()})
$('measurementLines').onchange=draw
$('pixelSpacing').oninput=()=>{measurementCache=null;draw()}
function refreshMeasurements(){
  const method=$('method').value,anteriorRight=$('anterior').value==='right',width=s.imageSize?.width
  const spacing=$('pixelSpacing').value
  const key=[s.result,gt,method,anteriorRight,width,spacing,$('pixelSpacing').validity.badInput]
  if(measurementCache?.every((x,i)=>x===key[i]))return
  measurementCache=key
  const invalid=spacing!==''&&(!(Number(spacing)>0)||!Number.isFinite(Number(spacing)))||$('pixelSpacing').validity.badInput
  $('measurementError').hidden=!invalid;$('measurementError').textContent=invalid?'길이 보정값은 0보다 큰 수여야 합니다. 현재 SVA는 px로 표시합니다.':''
  const options={anteriorRight,mmPerPixel:invalid?null:spacing}
  try{
    measurementData={ai:calculateSagittal(aiMeasurementInput(s.result,method),options),gt:calculateSagittal(gtMeasurementInput(gt,{width,anteriorRight,method}),options)}
  }catch(error){measurementData={ai:calculateSagittal({points:{}},options),gt:calculateSagittal({points:{}},options)};$('measurementError').hidden=false;$('measurementError').textContent='측정 기준점 확인 필요: '+error.message}
  measurementUI.set(measurementData)
}
let savedGT={status:'idle',data:null,error:null},gtUploadGeneration=0
const gtLoader=createGroundTruthLoader(loadComparisonLabel,listComparisonLabelMeta,state=>{savedGT=state;refreshGT();draw()})
function bridgeHasLabels(){const b=s.request?.groundTruth;return !!(b?.polygons?.length||b?.landmarks?.length)}
const colors={spine:'#48e0c6',corners:'#bc9cff',s1:'#ffd34d',fh_mask:'#ff77b7',fh_circle:'#ff9d61',hc:'#ffffff'}
const layers={spine:true,number:true,corners:true,s1:true,fh_mask:true,fh_circle:true,hc:true}
const names={spine:'척추 윤곽',number:'번호',corners:'꼭지점',s1:'S1',fh_mask:'골두 분할',fh_circle:'골두 원',hc:'HC'}
let worker=null,seq=0,pending=new Map(),modelFiles=null,cached=null,builtin=null
let modelChoice=0,startupPending=true,pendingBridge=null
function call(type,options={}){
  if(!worker){worker=new Worker(new URL('./worker.js',import.meta.url));worker.onmessage=({data:m})=>{
    if(m.type==='progress'){message(m.text);$('setupStatus').textContent=m.text;$('bar').style.width=m.value+'%';return}
    const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.type==='done'?p.resolve(m.data):p.reject(Error(m.message))
  };worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message||'브라우저 실행이 중단되었습니다.'));pending.clear();worker.terminate();worker=null;s.ready=false;updateButtons()}}
  const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({type,id,...options})})
}
function message(text){$('status').textContent=text}
function busy(value){s.busy=value;for(const id of ['gtUpload','gtClear','gtReload','gtUseCoordinates','upload','load','run','anterior','bundleFolder','bundleFiles','restore','builtin','forget','device','setupToggle'])$(id).disabled=value;updateButtons();$('cancel').hidden=!value}
function updateButtons(){
  $('load').disabled=s.busy||!modelFiles;$('restore').disabled=s.busy||!cached;$('builtin').disabled=s.busy||!builtin
  $('run').disabled=s.busy||!s.file||!s.ready
  for(const id of ['download','json','apply'])$(id).disabled=s.busy||!s.result
  $('s1').disabled=s.busy||!s.result||$('l5').value===''
}
function showSetup(){if(!$('setup').open)$('setup').showModal()}
$('setupToggle').onclick=()=>{modelChoice++;showSetup()};$('closeSetup').onclick=()=>$('setup').close()
async function selectBundle(files,{automatic=false}={}){
  if(automatic&&modelChoice)return false
  const choice=automatic?0:++modelChoice
  try{
    const b=await readBundle(files)
    if(choice!==modelChoice)return false
    modelFiles=b.files;$('bundleInfo').textContent=`모델 6개 · FH ${b.manifest.fh.version??'v2'} · ${(modelFiles.reduce((n,f)=>n+f.size,0)/1024**2).toFixed(0)} MB`
    $('load').disabled=s.busy;$('setupStatus').textContent=automatic?'저장된 모델을 자동으로 준비합니다.':'모델 불러오기를 누르면 이 컴퓨터에서 검증합니다.'
    return true
  }catch(e){if(choice===modelChoice){modelFiles=null;$('load').disabled=true;$('setupStatus').textContent=e.message}return false}
}
$('bundleFolder').onchange=e=>selectBundle(e.target.files)
$('bundleFiles').onchange=e=>selectBundle(e.target.files)
$('restore').onclick=async()=>{if(await selectBundle(cached))await loadSelectedModels({fromCache:true})}
$('forget').onclick=async()=>{modelChoice++;try{await clearBundle();cached=null;$('restore').disabled=true;$('setupStatus').textContent='저장된 모델을 지웠습니다. 선택한 원본 파일은 유지됩니다.'}catch(e){$('setupStatus').textContent=e.message}}
$('builtin').onclick=async()=>{
  if(!builtin)return;modelChoice++;busy(true)
  try{
    const selected=[new File([JSON.stringify(builtin)],'manifest.json',{type:'application/json'})]
    for(const name of STAGES){const d=builtin.models[name];for(const file of [d.file,d.check_file]){
      $('setupStatus').textContent='기본 모델 받는 중: '+file
      const r=await fetch('/ai-models/default/'+file);if(!r.ok)throw Error('기본 모델 파일 다운로드 실패: '+file)
      selected.push(new File([await r.blob()],file))
    }}
    await selectBundle(selected)
  }catch(e){$('setupStatus').textContent=e.message}finally{busy(false)}
}
$('cancel').onclick=()=>{
  worker?.terminate();worker=null;for(const p of pending.values())p.reject(Error('작업을 중단했습니다. 모델을 다시 불러오면 재실행할 수 있습니다.'));pending.clear();s.ready=false;s.result=null;updateButtons();draw()
}
for(const [key,label] of Object.entries(names)){
  const el=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=true
  check.onchange=()=>{layers[key]=check.checked;draw()};el.append(check,document.createTextNode(label));$('layers').append(el)
}
$('setupForm').onsubmit=async e=>{e.preventDefault();modelChoice++;await loadSelectedModels()}
async function loadSelectedModels({fromCache=false}={}){
  if(!modelFiles||s.busy)return false
  s.loadingModels=true;busy(true);s.ready=false;s.result=null;draw()
  message(fromCache?'저장된 모델을 자동으로 불러오는 중입니다.':'모델을 불러오는 중입니다.')
  try{
    const loaded=await call('load',{files:modelFiles,device:$('device').value});s.ready=true
    const gpu=Object.values(loaded.providers).some(x=>x==='webgpu')
    $('connection').textContent='이 컴퓨터 · '+(gpu?'GPU + CPU':'CPU')+' · FH '+loaded.fhVersion
    let cacheNote=''
    if(!fromCache&&$('remember').checked){try{await saveBundle(modelFiles);cached=modelFiles;cacheNote=' 다음 접속부터 자동으로 불러옵니다.'}catch{cacheNote=' 저장 공간이 부족해 모델을 기억하지 못했습니다. 이번 분석은 가능합니다.'}}
    $('setup').close();message('모델 검증 완료.'+cacheNote)
  }catch(e){s.ready=false;worker?.terminate();worker=null;message(e.message);$('setupStatus').textContent=e.message;showSetup()}
  finally{s.loadingModels=false;busy(false)}
  // An opener may send its image while automatic initialization is running.
  // Consume it before considering a previously selected image for inference.
  if(pendingBridge){const next=pendingBridge;pendingBridge=null;await setFile(next.file,next.bridge)}
  else if(s.ready&&s.file)void analyze()
  return s.ready
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
  gt=null;sizeConfirmedFor=null
  s.file=file;s.result=null;s.job=null;s.request=bridge;s.image=null;s.imageSize=null;s.zoom=1;s.panX=0;s.panY=0
  $('filename').textContent=file.name;$('review').hidden=true;$('summary').replaceChildren();renderTimings($('timings'),null);$('table').replaceChildren();$('decoder').textContent=''
  $('apply').hidden=!bridge;$('empty').hidden=true;$('pixelSpacing').value='';measurementCache=null;updateButtons();draw()
  gtLoader.clear()
  if(!bridgeHasLabels())void gtLoader.load(file.name)
  try{const image=await loadBrowserImage(file);if(s.file!==file)return;s.image=image;s.imageSize={width:image.naturalWidth,height:image.naturalHeight};$('empty').hidden=true;refreshGT();draw()}catch{if(s.file!==file)return;refreshGT();draw()}
  if(s.ready)analyze();else if(!startupPending){message('영상이 준비되었습니다. 모델을 불러오면 자동 분석합니다.');showSetup()}
}
function refreshGT(){
  gt=null;gtView=null;$('gtUseCoordinates').hidden=true
  if(!s.image){
    $('gtPaneStatus').textContent=savedGT.status==='loading'?'GT 조회 중':'GT 대기'
    $('gtStatus').textContent=s.file?'영상 준비 후 GT를 표시합니다.':'영상을 선택하면 서버 저장 라벨을 조회합니다. GT JSON도 선택할 수 있습니다.'
    return
  }
  const bridge=s.request?.groundTruth
  const snapshot={data:bridge,source:'Annotator 현재 라벨 (분석 시작 시점)'}
  const candidates=[{data:gtData,source:gtSource},bridgeHasLabels()?snapshot:null,
    {data:savedGT.data,source:'서버 저장 라벨'+(savedGT.data?.labeler_id?' · '+savedGT.data.labeler_id:'')},!bridgeHasLabels()?snapshot:null]
  const w=s.imageSize?.width||s.image.naturalWidth,h=s.imageSize?.height||s.image.naturalHeight
  gtView=groundTruthView(candidates,s.file.name,w,h,{acceptedSizeData:sizeConfirmedFor})
  if(gtView.code==='missing'){
    if(savedGT.status==='loading'){gtView.title='GT 조회 중';gtView.message='현재 파일명으로 서버 저장 라벨을 확인하고 있습니다.'}
    else if(savedGT.status==='error'){gtView.title='GT 조회 실패';gtView.message=savedGT.error+' · 서버 GT 다시 불러오기를 누르세요.'}
    else if(savedGT.status==='missing'){gtView.message+=' 이 사이트의 서버에도 저장 라벨이 없습니다. 학습 JSON의 GT는 GT JSON 불러오기로 연결하세요.'}
  }
  try{gt=prepareGroundTruth(gtView.gt,w,h)}
  catch(error){gt=null;gtView.title='GT 표시 오류';gtView.message=error.message}
  $('gtStatus').textContent=gtView.message
  $('gtPaneStatus').textContent=gtView.title
  $('gtUseCoordinates').hidden=gtView.code!=='GT_SIZE_MISSING'
}
$('gtUpload').onchange=async e=>{
  const file=e.target.files[0];if(!file)return
  const request=++gtUploadGeneration
  try{
    if(file.size>100*1024*1024)throw Error('GT JSON은 100 MB 이하로 선택해 주세요.')
    const parsed=JSON.parse((await file.text()).replace(/^\uFEFF/,''))
    if(request!==gtUploadGeneration)return
    gtData=parsed;gtSource=file.name;sizeConfirmedFor=null;refreshGT();draw()
  }catch(err){if(request===gtUploadGeneration){$('gtStatus').textContent='GT 불러오기 실패: '+err.message;$('gtPaneStatus').textContent='GT 읽기 오류'}}
}
$('gtClear').onclick=()=>{gtUploadGeneration++;gtData=null;gtSource='';sizeConfirmedFor=null;$('gtUpload').value='';refreshGT();draw()}
$('gtReload').onclick=()=>{if(s.file){sizeConfirmedFor=null;void gtLoader.load(s.file.name)}}
$('gtUseCoordinates').onclick=()=>{if(gtView?.code==='GT_SIZE_MISSING'){sizeConfirmedFor=gtView.sourceData;refreshGT();draw()}}
$('upload').onchange=e=>setFile(e.target.files[0])
for(const type of ['dragover','drop'])$('drop').addEventListener(type,e=>{e.preventDefault();if(type==='drop'){if(!s.busy)setFile(e.dataTransfer.files[0]);$('drop').classList.remove('drag')}else $('drop').classList.add('drag')})
$('drop').ondragleave=()=>$('drop').classList.remove('drag')
async function analyze(){
  if(s.busy||!s.ready||!s.file)return
  busy(true);s.result=null;s.job=null;$('review').hidden=true;$('summary').replaceChildren();renderTimings($('timings'),null);$('table').replaceChildren();$('decoder').textContent='';draw()
  try{
    const done=await call('predict',{file:s.file,anterior:$('anterior').value==='right'})
    s.result=validateResult(done.result)
    s.imageSize={width:s.result.image.width,height:s.result.image.height}
    s.image=await loadBrowserImage(done.preview);$('empty').hidden=true;refreshGT()
    renderResult()
  }catch(e){s.result=null;message('분석 실패: '+e.message);draw()}
  finally{busy(false)}
}
$('run').onclick=analyze
$('anterior').onchange=()=>{if(s.result){s.result=null;renderTimings($('timings'),null);updateButtons();message('전방 방향이 바뀌었습니다. 전체 분석을 다시 실행해 주세요.')}draw()}
$('method').onchange=()=>{draw();if(s.result)renderTable()}
$('l5').onchange=updateButtons
$('s1').onclick=async()=>{
  if(s.busy||!s.result||$('l5').value==='')return
  busy(true)
  try{const done=await call('s1',{index:Number($('l5').value)});s.result=validateResult(done.result);renderResult()}
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
$('download').onclick=async()=>{busy(true);try{const x=await call('export',{options:{method:$('method').value,layers}});saveBlob(x.blob,'spine_ai_results.zip');message('ZIP 다운로드 완료')}catch(e){message(e.message)}finally{busy(false)}}


function draw(){refreshMeasurements();for(const id of ['original','groundTruth','overlay'])paint($(id),id)}
function paint(canvas,mode){
  const dpr=Math.min(devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)
  const c=canvas.getContext('2d');c.scale(dpr,dpr);c.fillStyle='#080c12';c.fillRect(0,0,rect.width,rect.height)
  if(!s.image)return
  const w=s.imageSize?.width||s.image.naturalWidth,h=s.imageSize?.height||s.image.naturalHeight
  const scale=Math.min(rect.width/w,rect.height/h)*s.zoom;c.translate((rect.width-w*scale)/2+s.panX,(rect.height-h*scale)/2+s.panY);c.scale(scale,scale)
  c.drawImage(s.image,0,0,w,h)
  if(mode==='groundTruth'){paintGroundTruth(c,gt,scale);if($('measurementLines').checked)paintMeasurement(c,measurementData.gt.find(m=>m.id===measurementUI.selected()),{scale,width:w,height:h});return}
  if(mode!=='overlay'||!s.result)return
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
  if($('measurementLines').checked)paintMeasurement(c,measurementData.ai.find(m=>m.id===measurementUI.selected()),{scale,width:w,height:h})
}
bindViewerControls(document.querySelector('.viewers'),[$('original'),$('groundTruth'),$('overlay')],s,draw)
$('fit').onclick=()=>{s.zoom=1;s.panX=s.panY=0;draw()};new ResizeObserver(draw).observe($('original'))

// Dedicated analysis window bridge: exact opener origin + source + per-request ID.
let openerOrigin=null
try{const x=new URL(new URLSearchParams(location.search).get('opener'));if(x.origin===location.origin)openerOrigin=x.origin}catch{}
function notifyReady(){if(window.opener&&openerOrigin)window.opener.postMessage({type:'spine-ai:ready'},openerOrigin)}
window.addEventListener('message',e=>{
  if(!window.opener||e.source!==window.opener||e.origin!==openerOrigin||e.data?.type!=='spine-ai:image')return
  const m=e.data;if(!(m.blob instanceof Blob)||typeof m.filename!=='string'||typeof m.requestId!=='string')return
  const next={file:new File([m.blob],m.filename,{type:m.blob.type}),bridge:{requestId:m.requestId,origin:e.origin,groundTruth:m.groundTruth??null}}
  if(s.loadingModels){pendingBridge=next;return}
  if(s.busy)return
  void setFile(next.file,next.bridge)
})
$('apply').onclick=()=>{
  if(!s.result||!s.request||!window.opener)return
  try{const converted=toAnnotations(s.result,$('method').value);if(converted.warnings.length&&!confirm(converted.warnings.join('\n')+'\n\n유효한 결과를 적용할까요?'))return
    window.opener.postMessage({type:'spine-ai:result',requestId:s.request.requestId,result:s.result,method:$('method').value},s.request.origin);message('Annotator로 결과를 보냈습니다. 기존 창에서 적용 여부를 확인하세요.')
  }catch(e){message(e.message)}
}
notifyReady()
message('이 브라우저에 저장된 모델을 확인하는 중입니다.')
void restoreSavedModels({
  readSaved:savedBundle,
  onSaved:files=>{cached=files;updateButtons()},
  canRestore:()=>modelChoice===0&&!s.busy&&!s.ready,
  select:files=>selectBundle(files,{automatic:true}),
  load:()=>loadSelectedModels({fromCache:true}),
  onMissing:()=>{showSetup();message(modelFiles?'모델 설정을 확인하세요.':'처음 한 번 모델 폴더를 선택하고 불러오세요.')},
  onError:error=>{showSetup();message('저장된 모델을 읽지 못했습니다. 모델 폴더를 다시 선택해 주세요.');$('setupStatus').textContent=error.message}
}).finally(()=>{startupPending=false})
fetch('/ai-models/default/manifest.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(m=>{builtin=validateManifest(m);$('builtin').disabled=s.busy;$('builtin').textContent='기본 모델 불러오기'}).catch(()=>{$('builtin').textContent='기본 모델 준비 전'})
