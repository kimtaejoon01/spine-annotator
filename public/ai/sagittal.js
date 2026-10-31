// Pixel-coordinate geometry shared by the measurement table and its drawing.
// X increases right, Y down. Endplate directions are posterior -> anterior.
export const METRICS=[
  ['CL','경추 전만','C2 하종판 ↔ C7 하종판'],
  ['TK','흉추 후만','T4 상종판 ↔ T12 하종판'],
  ['LL','요추 전만','L1 상종판 ↔ S1 상종판'],
  ['SS','천골 경사','S1 상종판 ↔ 수평선'],
  ['PT','골반 기울기','HC → S1 중심 ↔ 수직선'],
  ['PI','골반 입사각','S1 중심 → HC ↔ S1 수직선'],
  ['SVA','시상 수직축','C7 중심 수직선 ↔ S1 후상방점'],
  ['TPA','T1 골반각','T1 중심 → HC → S1 중심'],
]
export const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)
export const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]]
export const add=(a,b)=>[a[0]+b[0],a[1]+b[1]]
export const mul=(v,t)=>[v[0]*t,v[1]*t]
export const mid=(a,b)=>mul(add(a,b),.5)
export const norm=v=>Math.hypot(...v)
export const unit=v=>norm(v)>1e-8?mul(v,1/norm(v)):null
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0]
const deg=r=>r*180/Math.PI
export function angle(u,v){if(!unit(u)||!unit(v))throw Error('기준점이 겹쳐 각도를 구할 수 없습니다.');return deg(Math.atan2(Math.abs(cross(u,v)),u[0]*v[0]+u[1]*v[1]))}
export function intersection(line1,line2){
  const [p,q]=line1,[r,s]=line2,u=sub(q,p),v=sub(s,r),d=cross(u,v)
  if(Math.abs(d)<1e-8*norm(u)*norm(v))return null
  return add(p,mul(u,cross(sub(r,p),v)/d))
}
export function centroid(pts){
  let a=0,x=0,y=0
  pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length],c=cross(p,q);a+=c;x+=(p[0]+q[0])*c;y+=(p[1]+q[1])*c})
  return Math.abs(a)>1e-8?[x/(3*a),y/(3*a)]:null
}
export function calculateSagittal(input,{anteriorRight=false,mmPerPixel=null}={}){
  const a=anteriorRight?1:-1,scale=Number(mmPerPixel)>0&&Number.isFinite(Number(mmPerPixel))?Number(mmPerPixel):null
  const point=key=>{if(input.errors?.[key])throw Error(input.errors[key]);const p=input.points?.[key];if(!validPoint(p))throw Error('필요한 점: '+key);return p}
  const plate=(level,side)=>{const p=point(level+'_'+side+'_POST'),q=point(level+'_'+side+'_ANT');if(!unit(sub(q,p)))throw Error(level+' 종판 끝점이 겹칩니다.');return [p,q]}
  return METRICS.map(([id,name,definition])=>{
    const used=new Set(),get=key=>{used.add(key);return point(key)}
    const end=(level,side)=>{used.add(level+'_'+side+'_POST');used.add(level+'_'+side+'_ANT');return plate(level,side)}
    const lines=[],markers=[];let value,angular=null,unitLabel='°'
    const line=(points,label,reference=false)=>{lines.push({points,label,reference});return points}
    try{
      if(['CL','TK','LL'].includes(id)){
        const pairs={CL:[['C2','INF'],['C7','INF']],TK:[['T4','SUP'],['T12','INF']],LL:[['L1','SUP'],['S1','SUP']]}[id]
        const [l1,l2]=pairs.map(([l,k])=>line(end(l,k),l+(k==='SUP'?' 상종판':' 하종판')))
        const u=sub(l1[1],l1[0]),v=sub(l2[1],l2[0]);value=angle(u,v)
        angular={vertex:intersection(l1,l2),u,v,extend:true,lineIndices:[0,1]}
      }else{
        const s1=line(end('S1','SUP'),'S1 상종판'),center=mid(...s1),u=sub(s1[1],s1[0])
        markers.push({point:center,label:'S1 중심'})
        if(id==='SS'){
          value=deg(Math.atan2(u[1],a*u[0]));angular={vertex:center,u:[a,0],v:u,lineIndices:[1,0]}
          line([center,add(center,[a*norm(u),0])],'수평선',true)
        }else if(id==='SVA'){
          const c7=get('C7_CENTER'),post=s1[0],foot=[c7[0],post[1]]
          value=a*(c7[0]-post[0])*(scale??1);unitLabel=scale?'mm':'px'
          line([c7,foot],'C7 수직선',true);line([post,foot],'SVA');markers.push({point:c7,label:'C7 중심'},{point:post,label:'S1 후상방점'})
        }else{
          const hc=get('HC_LAT');markers.push({point:hc,label:'HC'})
          if(id==='PT'){
            const v=sub(center,hc);if(!unit(v))throw Error('HC와 S1 중심이 겹칩니다.')
            value=deg(Math.atan2(-a*v[0],-v[1]));angular={vertex:hc,u:[0,-1],v,lineIndices:[2,1]}
            line([hc,center],'HC–S1');line([hc,add(hc,[0,-norm(v)])],'수직선',true)
          }else if(id==='PI'){
            // Caudal normal: for a valid endplate its Y component is positive.
            const n=[-a*u[1],a*u[0]],v=sub(hc,center)
            value=angle(n,v);angular={vertex:center,u:n,v,lineIndices:[2,1]}
            line([center,hc],'S1–HC');line([center,add(center,mul(unit(n),norm(v)))],'S1 수직선',true)
          }else if(id==='TPA'){
            const t1=get('T1_CENTER'),v=sub(center,hc),u1=sub(t1,hc)
            value=angle(u1,v);angular={vertex:hc,u:u1,v,lineIndices:[1,2]};line([hc,t1],'HC–T1');line([hc,center],'HC–S1');markers.push({point:t1,label:'T1 중심'})
          }
        }
      }
      const notes=[...new Set([...used].flatMap(k=>input.notes?.[k]??[]))]
      return {id,name,definition,available:true,value,unit:unitLabel,lines,markers,angular,notes}
    }catch(e){return {id,name,definition,available:false,reason:e.message,lines:[],markers:[],notes:[]}}
  })
}
export function measurementText(m){return m?.available?(m.value<0?'−':'')+Math.abs(m.value).toFixed(1)+m.unit:'—'}
