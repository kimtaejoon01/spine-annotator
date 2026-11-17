import {toAnnotations} from '../ai/result.js'
import {cornerCompare} from './corners.js'
import {validPoint,centroid} from '../ai/sagittal.js'
const suffix={SA:'SUP_ANT',SP:'SUP_POST',IA:'INF_ANT',IP:'INF_POST'}
const level=/^(C[2-7]|T([1-9]|1[0-2])|L[1-5])$/
function makeInput(landmarks){
  const out={points:{},errors:{},notes:{}}
  for(const p of landmarks??[]){if(!validPoint([p.x,p.y]))continue;const k=p.label
    if(k in out.points)out.errors[k]='중복 기준점: '+k
    else out.points[k]=[p.x,p.y]
  }
  return out
}
function noteLevel(out,label,note){for(const k of Object.keys(out.points))if(k.startsWith(label+'_'))out.notes[k]=[...(out.notes[k]??[]),note]}
export function aiMeasurementInput(result,method){
  if(!result)return {points:{}}
  const annotations=toAnnotations(result,method),out=makeInput(annotations.landmarks),counts={}
  for(const r of result.spine.numbering)counts[r.final_level]=(counts[r.final_level]??0)+1
  for(const [l,n] of Object.entries(counts))if(n>1)for(const k of [...Object.values(suffix),'CENTER'])out.errors[l+'_'+k]='중복 척추 번호: '+l
  for(const r of result.spine.corners??[]){noteLevel(out,r.label,'AI 윤곽 · '+method+' 꼭지점');if(r[method]?.quality==='review')noteLevel(out,r.label,'꼭지점 확인 필요: '+(r[method].reasons??[]).join(', '))}
  if(!result.femoral?.HC_LAT)out.errors.HC_LAT='골두 중심 HC 미검출 또는 검토 보류'
  if(result.s1?.status!=='predicted')for(const k of ['S1_SUP_ANT','S1_SUP_POST'])out.errors[k]='S1 종판 확인 필요'
  return out
}
// COCO exports retain the sampled FH circle coordinates but omit shape='circle'.
// Recover their centers from geometry; the radial residual check below still
// rejects non-circular/degenerate contours. This never changes AI review gating.
function circleCenter(p){
  if(!Array.isArray(p.points)||p.points.length<3||!p.points.every(validPoint))return null
  const pts=p.points,c=pts.reduce((v,p)=>[v[0]+p[0]/pts.length,v[1]+p[1]/pts.length],[0,0])
  let xx=0,xy=0,yy=0,bx=0,by=0
  for(const [px,py] of pts){const x=px-c[0],y=py-c[1],r=x*x+y*y;xx+=x*x;xy+=x*y;yy+=y*y;bx+=x*r/2;by+=y*r/2}
  const det=xx*yy-xy*xy;if(det<1e-10*Math.max(1,xx*yy))return null
  const center=[c[0]+(bx*yy-by*xy)/det,c[1]+(by*xx-bx*xy)/det]
  const radii=pts.map(p=>Math.hypot(p[0]-center[0],p[1]-center[1])),r=radii.reduce((a,b)=>a+b,0)/pts.length
  return r>0&&radii.every(x=>Math.abs(x-r)<Math.max(.05,.02*r))?center:null
}
export function gtMeasurementInput(gt,{width,anteriorRight=false,method='v2'}={}){
  if(!gt)return {points:{}}
  const polys=gt.polygons??[],counts={}
  for(const p of polys)if(level.test(p.label))counts[p.label]=(counts[p.label]??0)+1
  // Saved corner names can predate polygon relabeling. Never combine those
  // coordinates with the current labeled contour or mix two sources per plate.
  // Compare GT and AI using v1/v2 on their respective vertebral contours.
  const out=makeInput((gt.landmarks??[]).filter(p=>{
    const match=/^((?:C[2-7]|T(?:[1-9]|1[0-2])|L[1-5]))_(?:SUP_(?:ANT|POST)|INF_(?:ANT|POST)|CENTER)$/.exec(p.label)
    return !match||!counts[match[1]]
  }))
  const candidates=polys.filter(p=>level.test(p.label)&&counts[p.label]===1&&p.points.length>=4).map((p,i)=>({candidate_index:i,label:p.label,points:p.points.map(([x,y])=>[anteriorRight?x:width-1-x,y])}))
  const put=(key,p,note)=>{if(!(key in out.points)&&validPoint(p)){out.points[key]=p;out.notes[key]=[note]}}
  if(candidates.length){
    try{for(const r of JSON.parse(cornerCompare(JSON.stringify({candidates,validate:true})))){
      const fit=r[method]??{}
      for(const [k,v] of Object.entries(suffix))if(validPoint(fit[k]))put(r.label+'_'+v,[anteriorRight?fit[k][0]:width-1-fit[k][0],fit[k][1]],'GT 윤곽에서 '+method+' 꼭지점 추정'+(fit.quality==='review'?' · 확인 필요':''))
    }}catch{/* Landmark-only levels remain usable; never restore stale contour-level points. */}
  }
  for(const p of polys)if(level.test(p.label)&&counts[p.label]===1)put(p.label+'_CENTER',centroid(p.points),'GT 윤곽의 면적 중심')
  for(const [l,n] of Object.entries(counts))if(n>1)for(const k of [...Object.values(suffix),'CENTER'])out.errors[l+'_'+k]='중복 GT 척추: '+l
  const s1=polys.filter(p=>['S1_SUP','S1_endplate'].includes(p.label)&&p.points.length===2)
  if(s1.length===1){const sorted=[...s1[0].points].sort((a,b)=>a[0]-b[0]);put('S1_SUP_ANT',sorted[anteriorRight?1:0],'GT S1 종판');put('S1_SUP_POST',sorted[anteriorRight?0:1],'GT S1 종판')}
  else if(s1.length>1)for(const k of ['S1_SUP_ANT','S1_SUP_POST'])out.errors[k]='중복 GT S1 종판'
  const heads=polys.filter(p=>p.label==='FH_LAT')
  if(heads.length){
    // FH is the source of truth. HC_LAT is only the derived key consumed by
    // the metric engine, not an additional annotation required from the user.
    delete out.points.HC_LAT;delete out.errors.HC_LAT;delete out.notes.HC_LAT
    const centers=heads.map(circleCenter)
    if(heads.length===2&&centers.every(Boolean))put('HC_LAT',[(centers[0][0]+centers[1][0])/2,(centers[0][1]+centers[1][1])/2],'GT FH 원 2개에서 계산한 중심의 중점')
    else out.errors.HC_LAT=heads.length!==2?'GT FH 원 2개가 필요합니다. 현재 '+heads.length+'개':'GT FH 원의 좌표를 확인하세요. 중심을 복원할 수 없습니다.'
  }else if(!out.points.HC_LAT)out.errors.HC_LAT='GT FH 라벨이 필요합니다.'
  for(const k of Object.keys(out.points))out.notes[k]??=['GT 저장 기준점']
  return out
}
