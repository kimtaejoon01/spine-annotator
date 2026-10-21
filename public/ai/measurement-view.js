import {METRICS,measurementText,sub,add,mul,unit} from './sagittal.js'
const palette=['#ffd34d','#67caff','#e7a5ff','#ffffff']
function sweep(u,v){const start=Math.atan2(u[1],u[0]);let delta=Math.atan2(v[1],v[0])-start;while(delta>Math.PI)delta-=2*Math.PI;while(delta<-Math.PI)delta+=2*Math.PI;return {start,delta}}
export function paintMeasurement(c,m,{scale,width,height}){
  if(!m?.available)return
  c.save();c.beginPath();c.rect(0,0,width,height);c.clip();c.lineWidth=2/scale;c.font=`12px sans-serif`;c.lineJoin='round'
  const tag=(p,text,color)=>{c.save();c.translate(...p);c.scale(1/scale,1/scale);c.font='12px sans-serif';const w=c.measureText(text).width;c.fillStyle='#07121ee8';c.fillRect(4,-17,w+10,20);c.fillStyle=color;c.fillText(text,9,-3);c.restore()}
  const line=(points,color,dash=[])=>{c.strokeStyle=color;c.setLineDash(dash.map(x=>x/scale));c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke()}
  m.lines.forEach((l,i)=>{
    const color=palette[i%palette.length],u=unit(sub(l.points[1],l.points[0]))
    if(m.angular?.extend&&u){const span=Math.hypot(width,height)*4;line([add(l.points[0],mul(u,-span)),add(l.points[0],mul(u,span))],color,[6,5])}
    line(l.points,color,l.reference?[6,5]:[])
    c.setLineDash([]);for(const p of l.points){c.beginPath();c.arc(...p,3/scale,0,Math.PI*2);c.fillStyle=color;c.fill()}
  })
  const g=m.angular,p=g?.vertex
  if(p&&p[0]>=0&&p[0]<=width&&p[1]>=0&&p[1]<=height){
    const {start,delta}=sweep(g.u,g.v),r=32/scale
    // Rays at the actual intersection identify the same directed angle as the table.
    for(const v of [g.u,g.v])line([p,add(p,mul(unit(v),r*1.5))],'#ffffff',[3,3])
    c.setLineDash([]);c.beginPath();c.arc(...p,r,start,start+delta,delta<0);c.strokeStyle='#ffffff';c.stroke();tag(add(p,[r,r]),measurementText(m),'#ffffff')
  }else if(m.id==='SVA')tag(m.lines.at(-1).points[0],measurementText(m),'#ffffff')
  c.restore()
}
function diagram(m){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 250 170');svg.setAttribute('role','img');svg.setAttribute('aria-label',m.id+' 기준선 방향 도식')
  const el=(name,attrs)=>{const n=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));svg.append(n);return n}
  if(m.angular){
    const {u,v}=m.angular,o=[125,85],r=32,{start,delta}=sweep(u,v)
    for(const [i,d] of [u,v].entries()){const p=add(o,mul(unit(d),70));el('line',{x1:o[0],y1:o[1],x2:p[0],y2:p[1],stroke:palette[m.angular.lineIndices[i]],'stroke-width':3})}
    const p=add(o,[r*Math.cos(start),r*Math.sin(start)]),q=add(o,[r*Math.cos(start+delta),r*Math.sin(start+delta)])
    if(Math.abs(delta)>1e-8)el('path',{d:`M ${p} A ${r} ${r} 0 0 ${delta>=0?1:0} ${q}`,fill:'none',stroke:'white','stroke-width':2})
    el('circle',{cx:125,cy:85,r:3,fill:'white'})
  }else{
    for(const x of [70,180])el('line',{x1:x,y1:20,x2:x,y2:110,stroke:palette[x===70?0:1],'stroke-dasharray':'5 4'})
    el('path',{d:'M 70 100 L 70 120 M 70 110 L 180 110 M 180 100 L 180 120',fill:'none',stroke:'white','stroke-width':2})
    el('text',{x:125,y:48,fill:'white','text-anchor':'middle','font-size':12}).textContent='C7 수직선 ↔ S1 후상방점'
  }
  el('text',{x:125,y:155,fill:'white','text-anchor':'middle','font-size':16}).textContent=m.id+' '+measurementText(m)
  return svg
}
export function mountMeasurements({cards,detail,description,onSelect}){
  let selected='LL',data={ai:[],gt:[]};const buttons=new Map()
  for(const [id,name] of METRICS){
    const b=document.createElement('button');b.type='button';b.className='metric-card';b.setAttribute('aria-pressed',String(id===selected))
    const title=document.createElement('strong');title.textContent=id+' · '+name
    const values=document.createElement('span');values.className='metric-values';b.append(title,values)
    b.onclick=()=>{selected=id;render();onSelect(id)};cards.append(b);buttons.set(id,b)
  }
  function render(){
    for(const [id,b] of buttons){b.setAttribute('aria-pressed',String(id===selected));const a=data.ai.find(m=>m.id===id),g=data.gt.find(m=>m.id===id);b.lastChild.textContent='AI '+measurementText(a)+'   /   GT '+measurementText(g)}
    description.textContent=METRICS.find(x=>x[0]===selected)[2]+(selected==='SVA'?' · + 전방 / − 후방':selected==='PT'?' · + 후방 기울기 / − 전방 기울기':selected==='SS'?' · 전방 끝점이 낮으면 +':'')
    detail.replaceChildren()
    for(const [source,rows] of [['AI',data.ai],['GT',data.gt]]){
      const m=rows.find(x=>x.id===selected),box=document.createElement('div');box.className='metric-explanation'
      const title=document.createElement('h3');title.textContent=source+' · '+selected+' '+measurementText(m);box.append(title)
      if(m?.available){
        box.append(diagram(m));
        if(m.angular){const legend=document.createElement('div');legend.className='metric-legend';for(const i of m.angular.lineIndices){const item=document.createElement('span');item.style.color=palette[i];item.textContent='━ '+m.lines[i].label;legend.append(item)}box.append(legend)}
        const note=document.createElement('p');note.className='muted'
        note.textContent=(m.angular?.extend?'기준선을 평행 이동한 방향 비교 도식입니다. 영상에는 실제 연장선과 교점을 표시합니다. ':m.angular?'각도 방향 도식 · 위치·길이는 축척과 무관합니다. ':'거리 도식 · 길이는 축척과 무관합니다. ')+(m.notes??[]).join(' · ');box.append(note)
      }else{const note=document.createElement('p');note.className='muted';note.textContent=m?.reason??'분석 결과 또는 GT 기준점이 필요합니다.';box.append(note)}
      detail.append(box)
    }
  }
  render()
  return {selected:()=>selected,set(next){data=next;render()}}
}
