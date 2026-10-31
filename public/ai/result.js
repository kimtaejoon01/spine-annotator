// Shared by the upload app and the existing editor. No network or DOM side effects.
const LEVELS=new Set(['C2','C3','C4','C5','C6','C7',...Array.from({length:12},(_,i)=>'T'+(i+1)),...Array.from({length:5},(_,i)=>'L'+(i+1))])
const KEYS={SA:'SUP_ANT',SP:'SUP_POST',IA:'INF_ANT',IP:'INF_POST'}
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)
export function validateResult(r){
  if(!r||r.schema_version!=='spine-unified-ui-1'||!Number.isInteger(r.image?.width)||!Number.isInteger(r.image?.height)||r.image.width<1||r.image.height<1)throw Error('분석 결과 형식이 올바르지 않습니다.')
  const polys=r.spine?.polygons,rows=r.spine?.numbering
  if(!Array.isArray(polys)||!Array.isArray(rows)||polys.length!==rows.length)throw Error('척추 후보와 번호 개수가 다릅니다.')
  const ids=new Set()
  for(const row of rows){
    const i=row.input_index
    if(!Number.isInteger(i)||i<0||i>=polys.length||ids.has(i)||!LEVELS.has(row.final_level))throw Error('유효하지 않은 척추 번호 결과')
    ids.add(i)
    if(!Array.isArray(polys[i].points)||polys[i].points.length<3||!polys[i].points.every(point))throw Error('유효하지 않은 척추 윤곽')
  }
  return r
}
function centroid(pts){
  let a=0,x=0,y=0
  pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length],c=p[0]*q[1]-q[0]*p[1];a+=c;x+=(p[0]+q[0])*c;y+=(p[1]+q[1])*c})
  return Math.abs(a)>1e-8?[x/(3*a),y/(3*a)]:pts.reduce((s,p)=>[s[0]+p[0]/pts.length,s[1]+p[1]/pts.length],[0,0])
}
export function toAnnotations(raw,method='v2'){
  const r=validateResult(raw);if(!['v1','v2'].includes(method))throw Error('꼭지점 방법 오류')
  const counts={};r.spine.numbering.forEach(x=>counts[x.final_level]=(counts[x.final_level]||0)+1)
  const rows=new Map(r.spine.numbering.map(x=>[x.input_index,x])),warnings=[]
  const polygons=r.spine.polygons.map((p,i)=>({label:rows.get(i).final_level,points:p.points.flat(),manualLabel:true,source:'integrated_ai',candidate_index:i}))
  const landmarks=[];const add=(label,p)=>{
    if(point(p)&&p[0]>=0&&p[1]>=0&&p[0]<r.image.width&&p[1]<r.image.height)landmarks.push({label,x:p[0],y:p[1],kind:'point',visibility:'visible'})
    else warnings.push(label+': 영상 밖이거나 유효하지 않은 좌표를 적용하지 않았습니다.')
  }
  for(const c of r.spine.corners||[]){
    if(rows.get(c.candidate_index)?.final_level!==c.label)throw Error('꼭지점과 번호 결과가 일치하지 않습니다.')
    if(counts[c.label]!==1)continue
    for(const [k,suffix] of Object.entries(KEYS))add(c.label+'_'+suffix,c[method]?.[k])
  }
  for(const row of r.spine.numbering)if(counts[row.final_level]===1)add(row.final_level+'_CENTER',centroid(r.spine.polygons[row.input_index].points))
  const duplicates=Object.keys(counts).filter(k=>counts[k]>1)
  if(duplicates.length)warnings.push('중복 번호의 꼭지점·중심은 적용하지 않았습니다: '+duplicates.join(', '))
  if(r.s1?.status==='predicted'&&r.s1.points?.length===2&&r.s1.points.every(point)){
    const p=[...r.s1.points].sort((a,b)=>a[0]-b[0]),ant=r.anterior_right?p[1]:p[0],post=r.anterior_right?p[0]:p[1]
    add('S1_SUP_ANT',ant);add('S1_SUP_POST',post)
    polygons.push({label:'S1_SUP',shape:'endplate',points:[...ant,...post],manualLabel:true,source:'integrated_ai'})
  }
  for(const c of r.femoral?.annotator_polygons||[])if(c.shape==='circle'&&Array.isArray(c.points)&&c.points.length>=6&&c.points.length%2===0&&c.points.every(Number.isFinite))polygons.push({label:'FH_LAT',shape:'circle',points:c.points.slice(),manualLabel:true,source:'integrated_ai'})
  const hc=r.femoral?.HC_LAT
  if(hc)add('HC_LAT',[hc.x,hc.y])
  return {polygons,landmarks,warnings}
}
export function sameImage(expected,current,result){
  return expected.filename===current.filename&&expected.url===current.url&&expected.width===current.width&&expected.height===current.height&&result.image.width===expected.width&&result.image.height===expected.height&&result.image.sha256===expected.sha256
}
