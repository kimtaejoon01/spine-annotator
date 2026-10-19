import {sameImage,toAnnotations,validateResult} from '../ai/result.js'

export function initIntegratedAI({state,onApplied}){
  const button=document.createElement('button');button.className='btn-primary';button.id='integratedAiBtn';button.textContent='AI 자동 분석'
  button.title='브라우저에서 현재 X-ray의 척추 · S1 · 대퇴골두를 분석합니다.'
  document.querySelector('.header-right')?.prepend(button)
  let active=null
  const current=()=>({filename:state.filename,url:state.currentImageUrl,width:state.annotator.imageWidth,height:state.annotator.imageHeight})
  button.onclick=async()=>{
    if(!state.currentImageUrl){window.open('/ai-web/','spine-ai-analysis');return}
    if(state.viewType!=='LAT'&&!confirm('이 모델은 LAT 전용입니다. 현재 영상이 LAT인지 확인했나요?'))return
    const url=new URL('/ai-web/',location.origin)
    url.searchParams.set('opener',location.origin)
    const snapshot=current(),requestId=crypto.randomUUID(),win=window.open(url.toString(),'spine-ai-analysis')
    if(!win){alert('분석 창이 차단되었습니다. 팝업을 허용해 주세요.');return}
    active={...snapshot,requestId,win,origin:url.origin,blob:null,sha256:null,ready:false,sent:false}
    const task=active
    button.disabled=true
    try{
      const response=await fetch(snapshot.url);if(!response.ok)throw Error('현재 영상 파일을 읽을 수 없습니다.')
      task.blob=await response.blob();task.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await task.blob.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('')
      if(active===task)send()
    }catch(e){alert(e.message);if(active===task)active=null}finally{button.disabled=false}
  }
  function send(){
    if(!active?.ready||!active.blob||active.sent)return
    active.win.postMessage({type:'spine-ai:image',requestId:active.requestId,filename:active.filename,blob:active.blob},active.origin);active.sent=true
  }
  window.addEventListener('message',e=>{
    if(!active||e.source!==active.win||e.origin!==active.origin)return
    if(e.data?.type==='spine-ai:ready'){active.ready=true;send();return}
    if(e.data?.type!=='spine-ai:result'||e.data.requestId!==active.requestId)return
    try{
      const result=validateResult(e.data.result)
      if(!sameImage(active,current(),result))throw Error('현재 영상이 분석을 요청한 영상과 다릅니다. 원래 영상을 열고 다시 분석해 주세요.')
      const converted=toAnnotations(result,e.data.method)
      const existing=state.annotator.getPolygons().length+(state.annotator.getLandmarks?.().length||0)
      if(existing&&!confirm(`현재 영상의 편집 라벨 ${existing}개를 AI 결과로 교체할까요? Ctrl+Z로 되돌릴 수 있습니다.`))return
      // Human labels are untouched until this explicit application step.
      state.annotator.applyAiPrediction(converted.polygons,converted.landmarks)
      onApplied?.();window.dispatchEvent(new CustomEvent('spine:labels-loaded',{detail:{filename:state.filename,count:converted.polygons.length,source:'integrated_ai'}}))
      if(converted.warnings.length)alert(converted.warnings.join('\n'))
    }catch(err){alert(err.message)}
  })
}
