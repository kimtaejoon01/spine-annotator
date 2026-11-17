const $=id=>document.getElementById(id);
const cv=$('canvas'),ctx=cv.getContext('2d'),stage=$('stage');
let files=[],selected=-1,url=null,image=null,original=[],polygon=[],endplate=[],draft=[],mode='polygon',zoom=1,ox=0,oy=0,drag=null,history=[],redoHistory=[],version=0,dirty=false,request=0,hover=null,spaceHeld=false,sHeld=false,freehandLast=null;
const isImage=f=>/\.(png|jpe?g|bmp|tiff?|webp)$/i.test(f.name);
const safePoints=p=>{if(Array.isArray(p)&&p.length&&Array.isArray(p[0]))return p.filter(q=>Array.isArray(q)&&q.length>=2&&q.slice(0,2).every(Number.isFinite)).map(q=>q.slice(0,2));if(Array.isArray(p)){const a=[];for(let i=0;i<p.length-1;i+=2)if(Number.isFinite(p[i])&&Number.isFinite(p[i+1]))a.push([p[i],p[i+1]]);return a}return []};
const status=t=>$('status').textContent=t;
const mark=()=>{dirty=true;$('saved').textContent='변경사항 미저장'};
const snapshot=()=>JSON.stringify({polygon,endplate,draft});
const remember=()=>{history.push(snapshot());if(history.length>100)history.shift();redoHistory=[];mark()};
const restore=x=>{({polygon,endplate,draft}=JSON.parse(x));draw()};
const fit=()=>{if(!image)return;const rect=stage.getBoundingClientRect();zoom=Math.min(rect.width/image.naturalWidth,rect.height/image.naturalHeight)*.95;ox=(rect.width-image.naturalWidth*zoom)/2;oy=(rect.height-image.naturalHeight*zoom)/2;draw()};
function resize(){const dpr=window.devicePixelRatio||1,r=stage.getBoundingClientRect();cv.width=Math.max(1,Math.floor(r.width*dpr));cv.height=Math.max(1,Math.floor(r.height*dpr));draw()}
function screen(p){return [ox+p[0]*zoom,oy+p[1]*zoom]}
function world(e){const r=cv.getBoundingClientRect();return [(e.clientX-r.left-ox)/zoom,(e.clientY-r.top-oy)/zoom]}
function valid(p){return image&&p[0]>=0&&p[1]>=0&&p[0]<image.naturalWidth&&p[1]<image.naturalHeight}
function drawLine(pts,color,close,dash=[],fill=false){if(!pts.length)return;ctx.beginPath();pts.forEach((p,i)=>{const [x,y]=screen(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});if(close&&pts.length>2)ctx.closePath();ctx.setLineDash(dash);ctx.lineWidth=2;ctx.strokeStyle=color;if(fill&&pts.length>2){ctx.fillStyle='rgba(29,211,161,.13)';ctx.fill()}ctx.stroke();ctx.setLineDash([])}
function circles(pts,color){for(const p of pts){const [x,y]=screen(p);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#0b111a';ctx.lineWidth=1;ctx.stroke()}}
function draw(){
const dpr=window.devicePixelRatio||1;ctx.setTransform(dpr,0,0,dpr,0,0);const r=stage.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);if(!image)return;
ctx.drawImage(image,ox,oy,image.naturalWidth*zoom,image.naturalHeight*zoom);
if($('showOriginal').checked)for(const p of original)drawLine(safePoints(p.points),'#b6c2cf',true,[6,4]);
if($('showExpert').checked){drawLine(polygon,'#2fe0b2',true,[],true);circles(polygon,'#2fe0b2');drawLine(draft,'#69e7c6',false,[4,3]);circles(draft,'#69e7c6')}
if($('showEndplate').checked){drawLine(endplate,'#f3c55c',false);circles(endplate,'#f3c55c')}
}
function setMode(m){mode=m;for(const id of ['polygon','endplate','edit','deleteTool','pan'])$(id).classList.toggle('active',id===(m==='delete'?'deleteTool':m));status({polygon:'S1 폴리곤: 점을 순서대로 클릭하고 Q로 완료. E: 마지막 점 취소.',endplate:'S1 상종판: 앞쪽 끝점 → 뒤쪽 끝점 두 곳을 클릭하세요.',edit:'편집: 꼭짓점 드래그 / 선 클릭: 점 추가 / R: 점 삭제.',delete:'삭제: 교수님 S1 꼭짓점 클릭해 삭제.',pan:'화면 이동: 영상을 드래그하세요.'}[m]);}
function renderFiles(){const q=$('search').value.trim().toLowerCase();$('fileList').replaceChildren();$('count').textContent=files.length+'개 영상';files.forEach((f,i)=>{if(!f.name.toLowerCase().includes(q))return;const b=document.createElement('button');b.textContent=f.name;b.className=i===selected?'chosen':'';b.onclick=()=>select(i);$('fileList').append(b)})}
async function jsonFetch(path,opts){const r=await fetch(path,{cache:'no-store',...opts});let data;try{data=await r.json()}catch{throw Error('서버 응답 오류: '+r.status)}if(!r.ok||data.ok===false)throw Error(data.error||'서버 오류 '+r.status);return data}
function imageLoad(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('영상 디코딩 실패'));im.src=src})}
async function select(i){if(i<0||i>=files.length)return;if(dirty&&!confirm('저장하지 않은 변경사항이 있습니다. 다른 영상으로 이동할까요?'))return;
const token=++request;selected=i;image=null;original=[];polygon=[];endplate=[];draft=[];version=0;history=[];redoHistory=[];dirty=false;renderFiles();
const file=files[i],next=URL.createObjectURL(file);if(url)URL.revokeObjectURL(url);url=next;$('filename').textContent=file.name;$('position').textContent=(i+1)+' / '+files.length;$('saved').textContent='불러오는 중';draw();
try{image=await imageLoad(next);if(token!==request)return;fit();const name=encodeURIComponent(file.name);
const [old,expert]=await Promise.all([jsonFetch('/api/labels/'+name).catch(e=>({error:e.message})),jsonFetch('/api/s1-expert/'+name)]);
if(token!==request)return;
if(old.exists){if(old.image_width&&old.image_height&&(old.image_width!==image.naturalWidth||old.image_height!==image.naturalHeight))status('원본 라벨 영상 크기가 다릅니다. 원본 폴리곤을 숨겼습니다.');else original=Array.isArray(old.polygons)?old.polygons:[]}
if(expert.exists){if(expert.image_width!==image.naturalWidth||expert.image_height!==image.naturalHeight)throw Error('저장된 교수님 라벨과 영상 크기가 다릅니다. 편집을 중단하고 원본 파일을 확인하세요.');
polygon=expert.polygon;endplate=expert.endplate;version=expert.version;$('decision').value=expert.decision;$('notes').value=expert.notes;$('reviewer').value=expert.reviewer;$('saved').textContent='저장된 검수본 로드: '+expert.updated_at}else{$('decision').value='pending';$('notes').value='';$('saved').textContent='새 검수 대상'}
if(old.error)status('기존 폴리곤 조회 실패: '+old.error);else status('기존 폴리곤 '+original.length+'개 · 표시 스위치로 켜기/끄기 가능');draw();
}catch(e){if(token===request){status(e.message);$('saved').textContent='불러오기 실패';image=null;draw()}}}
function setFiles(fl){const seen=new Set();files=Array.from(fl).filter(isImage).filter(f=>{const key=f.name;if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>a.name.localeCompare(b.name));selected=-1;dirty=false;renderFiles();if(files.length)select(0)}
$('folder').onchange=e=>setFiles(e.target.files);$('files').onchange=e=>setFiles(e.target.files);$('search').oninput=renderFiles;
$('prev').onclick=()=>select(selected-1);$('next').onclick=()=>select(selected+1);
for(const m of ['polygon','endplate','edit','pan'])$(m).onclick=()=>setMode(m);$('deleteTool').onclick=()=>setMode('delete');
$('finish').onclick=()=>{if(draft.length<3){status('폴리곤에는 3개 이상의 점이 필요합니다.');return}remember();polygon=draft;draft=[];draw();status('S1 폴리곤을 완성했습니다.')};
$('reset').onclick=()=>{if(!image||!confirm('교수님 S1 폴리곤과 상종판을 모두 지울까요? (아직 서버에는 저장되지 않습니다)'))return;remember();polygon=[];endplate=[];draft=[];draw()};
$('undo').onclick=()=>{if(history.length){redoHistory.push(snapshot());restore(history.pop());mark()}};
$('redo').onclick=()=>{if(redoHistory.length){history.push(snapshot());restore(redoHistory.pop());mark()}};
$('fit').onclick=fit;
for(const id of ['showOriginal','showExpert','showEndplate'])$(id).onchange=draw;
function nearest(p){let best=null,dmin=12;for(const [group,pts] of [['polygon',polygon],['endplate',endplate]])for(let i=0;i<pts.length;i++){const a=screen(pts[i]),b=screen(p),d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(d<dmin){dmin=d;best={group,i}}}return best}
function nearestEdge(p){if(polygon.length<2)return null;const q=screen(p);let best=null,min=11;for(let i=0;i<polygon.length;i++){const a=screen(polygon[i]),b=screen(polygon[(i+1)%polygon.length]);const vx=b[0]-a[0],vy=b[1]-a[1],t=Math.max(0,Math.min(1,((q[0]-a[0])*vx+(q[1]-a[1])*vy)/(vx*vx+vy*vy||1)));const d=Math.hypot(q[0]-a[0]-t*vx,q[1]-a[1]-t*vy);if(d<min){min=d;best=i}}return best}
function removeVertex(hit){if(!hit)return false;const arr=hit.group==='polygon'?polygon:endplate;if(!arr[hit.i])return false;remember();arr.splice(hit.i,1);if(hit.group==='polygon'&&arr.length<3)polygon=[];draw();return true}
function eraseLast(){
  if(draft.length){remember();draft.pop();draw();return}
  if(mode==='endplate' && endplate.length===1){remember();endplate.pop();draw();return}
  status('취소할 마지막 점이 없습니다. E는 완성된 폴리곤을 삭제하지 않습니다.');
}
function zoomBy(v){if(!image)return;const r=stage.getBoundingClientRect(),x=r.width/2,y=r.height/2,p=[(x-ox)/zoom,(y-oy)/zoom];zoom=Math.max(.05,Math.min(15,zoom*v));ox=x-p[0]*zoom;oy=y-p[1]*zoom;draw()}
function keyName(e){if(e.code==='Space')return 'Space';if(e.code==='Equal'||e.code==='NumpadAdd')return '+';if(e.code==='Minus'||e.code==='NumpadSubtract')return '-';if(/^Key[A-Z]$/.test(e.code))return e.code.slice(3);return e.key}

cv.onpointerdown=e=>{if(!image||e.button!==0)return;const p=world(e);if(mode==='pan'||spaceHeld){drag={type:'pan',x:e.clientX,y:e.clientY,ox,oy};cv.setPointerCapture(e.pointerId);return}
if(mode==='delete'){removeVertex(nearest(p));return}
if(mode==='edit'){const hit=nearest(p);if(hit){remember();drag={type:'point',...hit};cv.setPointerCapture(e.pointerId);return}const edge=nearestEdge(p);if(edge!==null&&valid(p)){remember();polygon.splice(edge+1,0,p);draw()}return}
if(!valid(p))return;
if(mode==='polygon'){remember();draft.push(p);draw()}
if(mode==='endplate'){remember();if(endplate.length===2)endplate=[];endplate.push(p);draw()}};
cv.onpointermove=e=>{const p=world(e);hover=nearest(p);if(sHeld&&mode==='polygon'&&image&&valid(p)&&(e.buttons===1||e.buttons===0)){if(!freehandLast||Math.hypot(...[p[0]-freehandLast[0],p[1]-freehandLast[1]])>=Math.max(2,4/zoom)){if(!freehandLast)remember();draft.push(p);freehandLast=p;draw()}}
if(!drag)return;if(drag.type==='pan'){ox=drag.ox+(e.clientX-drag.x);oy=drag.oy+(e.clientY-drag.y)}else{if(valid(p))({polygon,endplate}[drag.group])[drag.i]=p}draw()};
cv.onpointerup=()=>{drag=null};cv.onpointercancel=()=>{drag=null};
cv.ondblclick=e=>{if(mode==='polygon'&&draft.length>=3){e.preventDefault();if(draft.length>3&&Math.hypot(draft.at(-1)[0]-draft.at(-2)[0],draft.at(-1)[1]-draft.at(-2)[1])<4/zoom)draft.pop();$('finish').click()}else if(mode==='edit'){e.preventDefault();removeVertex(nearest(world(e)))}};cv.oncontextmenu=e=>{if(mode==='edit'){e.preventDefault();removeVertex(nearest(world(e)))}};
cv.onwheel=e=>{if(!image)return;e.preventDefault();const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const before=[(x-ox)/zoom,(y-oy)/zoom];zoom=Math.max(.05,Math.min(15,zoom*(e.deltaY<0?1.12:1/1.12)));ox=x-before[0]*zoom;oy=y-before[1]*zoom;draw()};
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;const k=keyName(e),mod=e.ctrlKey||e.metaKey;
if(mod&&(k==='Z'||k==='z')){e.preventDefault();if(e.shiftKey)$('redo').click();else $('undo').click();return}
if(mod&&(k==='Y'||k==='y')){e.preventDefault();$('redo').click();return}
if(mod||e.altKey)return;
const actions={I:()=>setMode('polygon'),O:()=>setMode('edit'),P:()=>setMode('delete'),Q:()=>$('finish').click(),E:eraseLast,Escape:()=>{if(draft.length){remember();draft=[];draw()}else setMode('edit')},R:()=>removeVertex(hover),Delete:()=>{if(polygon.length){remember();polygon=[];draw()}},'0':fit,'+':()=>zoomBy(1.2),'-':()=>zoomBy(1/1.2)};
if(k==='Space'){e.preventDefault();spaceHeld=true;return}if(k==='S'){e.preventDefault();sHeld=true;return}if(actions[k]){e.preventDefault();if(!e.repeat)actions[k]()}}
);
window.addEventListener('keyup',e=>{const k=keyName(e);if(k==='Space')spaceHeld=false;if(k==='S'){sHeld=false;freehandLast=null}});
window.addEventListener('blur',()=>{spaceHeld=false;sHeld=false;freehandLast=null});

$('notes').oninput=mark;$('decision').onchange=mark;$('reviewer').oninput=mark;
function payload(){if(!image||selected<0)throw Error('영상을 선택하세요');if(draft.length)throw Error('완료하지 않은 폴리곤이 있습니다. 폴리곤 완료를 먼저 누르세요.');return {image_width:image.naturalWidth,image_height:image.naturalHeight,polygon,endplate,decision:$('decision').value,notes:$('notes').value,reviewer:$('reviewer').value.trim(),version}}
$('save').onclick=async()=>{try{const p=payload();if(p.decision!=='unreadable'&&p.polygon.length<3&&p.endplate.length!==2)throw Error('S1 폴리곤 또는 상종판 2점을 지정하세요.');$('save').disabled=true;const d=await jsonFetch('/api/s1-expert/'+encodeURIComponent(files[selected].name),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});version=d.version;dirty=false;$('saved').textContent='저장 완료: '+d.updated_at;status('교수님 S1 검수본 별도 저장 완료. 기존 라벨은 유지됩니다.')}catch(e){status('저장 실패: '+e.message)}finally{$('save').disabled=false}};
$('download').onclick=()=>{try{const p=payload();const b=new Blob([JSON.stringify({schema:'s1-expert-v1',filename:files[selected].name,...p},null,2)],{type:'application/json'});const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=files[selected].name.replace(/\.[^.]+$/,'')+'_S1_expert.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}catch(e){status(e.message)}};
new ResizeObserver(resize).observe(stage);setMode('polygon');resize();
