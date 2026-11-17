// Both analysis pages use wheel for zoom and an explicit drag for pan.
export function bindViewerControls(container,canvases,state,draw){
  container.addEventListener('wheel',e=>{
    e.preventDefault()
    e.stopPropagation()
    if(!state.image)return
    let dy=e.deltaY
    if(e.deltaMode===1)dy*=16
    else if(e.deltaMode===2)dy*=100
    if(!Number.isFinite(dy)||dy===0)return
    dy=Math.max(-200,Math.min(200,dy))
    // Include panel titles and the gap; use the closest image pane as anchor.
    const rect=canvases.map(c=>c.getBoundingClientRect()).reduce((a,b)=>
      Math.abs(e.clientX-(a.left+a.width/2))<=Math.abs(e.clientX-(b.left+b.width/2))?a:b)
    const x=Math.max(0,Math.min(rect.width,e.clientX-rect.left))-rect.width/2
    const y=Math.max(0,Math.min(rect.height,e.clientY-rect.top))-rect.height/2
    const zoom=Math.max(.4,Math.min(12,state.zoom*Math.exp(-dy*.0005)))
    const ratio=zoom/state.zoom
    state.panX=x-(x-state.panX)*ratio
    state.panY=y-(y-state.panY)*ratio
    state.zoom=zoom
    draw()
  },{passive:false})
  for(const canvas of canvases){
    let drag=null
    canvas.onpointerdown=e=>{
      if(e.button!==0)return
      e.preventDefault()
      drag={id:e.pointerId,x:e.clientX,y:e.clientY}
      canvas.setPointerCapture(e.pointerId)
    }
    canvas.onpointermove=e=>{
      if(!drag||drag.id!==e.pointerId)return
      if(!(e.buttons&1)){drag=null;return}
      state.panX+=e.clientX-drag.x;state.panY+=e.clientY-drag.y
      drag.x=e.clientX;drag.y=e.clientY;draw()
    }
    canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null}
  }
}
