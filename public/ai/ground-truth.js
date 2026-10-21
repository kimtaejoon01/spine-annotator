// Read-only label display. These records never enter inference or AI application.
const normalized=s=>String(s??'').replaceAll('\\','/').normalize('NFC')
const basename=s=>normalized(s).split('/').pop()
export function selectGroundTruthRecord(records,filename){
  let matches=records.filter(r=>normalized(r.filename??r.file_name)===normalized(filename))
  if(!matches.length)matches=records.filter(r=>basename(r.filename??r.file_name)===basename(filename))
  if(!matches.length)matches=records.filter(r=>basename(r.filename??r.file_name).toLowerCase()===basename(filename).toLowerCase())
  if(matches.length>1)throw Error('같은 파일명의 GT가 여러 개입니다. 라벨러/데이터셋 하나만 내보내 주세요.')
  return matches[0]??null
}
function points(raw,min=1){
  if(!Array.isArray(raw))throw Error('GT 좌표 배열 오류')
  const flat=raw.flat()
  if(flat.length<min*2||flat.length%2||!flat.every(Number.isFinite))throw Error('GT 좌표 오류')
  return Array.from({length:flat.length/2},(_,i)=>[flat[2*i],flat[2*i+1]])
}
export function decodeRLE(rle,width,height){
  if(!Array.isArray(rle.size)||rle.size[0]!==height||rle.size[1]!==width)throw Error('GT RLE 크기 불일치')
  let counts=rle.counts
  if(typeof counts==='string'){
    const text=counts;counts=[];let pos=0
    while(pos<text.length){
      let x=0,shift=0,c
      do{
        if(pos>=text.length||shift>30)throw Error('GT RLE 인코딩 오류')
        c=text.charCodeAt(pos++)-48;if(c<0||c>63)throw Error('GT RLE 문자 오류')
        x+=(c&31)*2**shift;shift+=5
      }while(c&32)
      if(c&16)x-=2**shift
      if(counts.length>2)x+=counts[counts.length-2]
      counts.push(x)
    }
  }
  if(!Array.isArray(counts)||!counts.every(x=>Number.isSafeInteger(x)&&x>=0)||counts.reduce((a,b)=>a+b,0)!==width*height)throw Error('GT RLE 길이 오류')
  const mask=new Uint8Array(width*height);let offset=0
  counts.forEach((n,i)=>{if(i%2)for(let j=offset;j<offset+n;j++)mask[(j%height)*width+Math.floor(j/height)]=1;offset+=n})
  return mask
}
export function resolveGroundTruth(data,filename,width,height,source='GT JSON',options={}){
  if(!data)return null
  if(typeof data!=='object')throw Error('GT JSON 형식이 아닙니다. COCO 또는 Annotator raw 내보내기를 선택하세요.')
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>32_000_000)throw Error('영상 크기를 확인할 수 없습니다.')
  const coco=Array.isArray(data.images)&&Array.isArray(data.annotations)
  const records=coco?data.images:Array.isArray(data.items)?data.items:Array.isArray(data)?data:[data]
  if(records.some(r=>!r||typeof r!=='object'))throw Error('GT 영상 목록 형식 오류')
  const record=selectGroundTruthRecord(records,filename);if(!record)return null
  const rw=Number(record.width??record.image_width),rh=Number(record.height??record.image_height)
  const missingSize=!(rw>0)||!(rh>0)
  if((rw>0&&rw!==width)||(rh>0&&rh!==height)){
    const error=Error(`GT는 있습니다. 크기가 다릅니다: GT ${rw||'?'} × ${rh||'?'} / 영상 ${width} × ${height}. 자동 확대·축소하지 않습니다.`)
    error.code='GT_SIZE_MISMATCH';throw error
  }
  if(missingSize&&!options.allowMissingSize){
    const error=Error('GT는 있지만 저장된 원본 크기 정보가 없습니다. 같은 원본 영상의 좌표인지 확인한 뒤 아래 버튼으로 표시할 수 있습니다.')
    error.code='GT_SIZE_MISSING';throw error
  }
  const out={source,warnings:missingSize?['GT 크기 미기록 · 현재 영상에 원본 좌표 그대로 표시']:[],polygons:[],landmarks:[],masks:[]}
  const sameId=(a,b)=>a!=null&&b!=null&&String(a)===String(b)

  let rawPayload=record.polygons
  if(!coco&&rawPayload==null&&record.polygons_json!=null)rawPayload=JSON.parse(record.polygons_json)
  if(coco){
    const categories=new Map((data.categories??[]).map(x=>[String(x.id),x]))
    for(const a of data.annotations.filter(x=>sameId(x.image_id,record.id))){
      const cat=categories.get(String(a.category_id)),label=cat?.name??String(a.category_id)
      if(a.segmentation&&!Array.isArray(a.segmentation))out.masks.push({label,data:decodeRLE(a.segmentation,width,height)})
      else for(const p of a.segmentation??[])if(p.length)out.polygons.push({label,points:points(p,3),closed:true})
      if(a.keypoints?.length){
        if(a.keypoints.length%3)throw Error('GT keypoint 배열 오류')
        const visible=[]
        for(let i=0;i<a.keypoints.length;i+=3)if(a.keypoints[i+2]>0){
          const p=points(a.keypoints.slice(i,i+2))[0];visible.push(p)
          out.landmarks.push({label:cat?.keypoints?.[i/3]??label,x:p[0],y:p[1]})
        }
        if(label==='S1_endplate'&&visible.length===2)out.polygons.push({label,points:visible,closed:false})
      }
    }
  }else{
    const polygons=Array.isArray(rawPayload)?rawPayload:(rawPayload?.polygons??[])
    for(const p of polygons)out.polygons.push({label:p.label??'',points:points(p.points,p.shape==='endplate'?2:3),closed:p.shape!=='endplate'})
  }
  const landmarks=coco?(data.landmarks??[]).filter(x=>sameId(x.image_id,record.id)||(data.images.length===1&&x.image_id==null)):(record.landmarks??rawPayload?.landmarks??[])
  for(const p of landmarks){
    if(p.visibility==='absent')continue
    const xy=points([p.x,p.y])[0];out.landmarks.push({label:p.label??'',x:xy[0],y:xy[1]})
  }
  if(missingSize&&options.allowMissingSize){
    const coords=[...out.polygons.flatMap(p=>p.points),...out.landmarks.map(p=>[p.x,p.y])]
    if(coords.some(([x,y])=>x<0||y<0||x>width||y>height)){
      const error=Error('GT 좌표가 현재 영상 범위를 벗어납니다. 원본 영상 크기를 확인하세요.');error.code='GT_SIZE_MISMATCH';throw error
    }
  }
  return out
}

export function groundTruthView(candidates,filename,width,height,options={}){
  let unmatched=false
  for(const candidate of candidates){
    if(!candidate?.data)continue
    try{
      const gt=resolveGroundTruth(candidate.data,filename,width,height,candidate.source,{...options,allowMissingSize:options.allowMissingSize||options.acceptedSizeData===candidate.data})
      if(!gt){unmatched=true;continue}
      return {gt,title:'GT / 참조 라벨',code:'found',message:`${candidate.source} · 윤곽 ${gt.polygons.length+gt.masks.length}개 · 점 ${gt.landmarks.length}개`+(gt.warnings.length?' · '+gt.warnings.join(' · '):'')+(unmatched?' · 선택 JSON에 현재 영상 없음, 다른 라벨 사용':''),sourceData:candidate.data}
    }catch(error){
      const title=error.code==='GT_SIZE_MISSING'?'GT 있음 · 크기 확인 필요':error.code==='GT_SIZE_MISMATCH'?'GT 있음 · 크기 불일치':'GT 읽기 오류'
      return {gt:null,title,code:error.code??'GT_READ_ERROR',message:candidate.source+' · '+error.message,sourceData:candidate.data}
    }
  }
  return {gt:null,title:'GT 없음',code:'missing',message:unmatched?`현재 파일명과 일치하는 GT가 없습니다: ${filename}`:'GT JSON 또는 Annotator 저장 라벨이 필요합니다.',sourceData:null}
}

export function prepareGroundTruth(gt,width,height){
  if(!gt)return null
  // Raster GT is rendered once, not decoded on every zoom event.
  for(const m of gt.masks){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const c=canvas.getContext('2d'),pixels=c.createImageData(width,height)
    for(let i=0;i<m.data.length;i++)if(m.data[i])pixels.data.set([113,226,196,100],i*4)
    c.putImageData(pixels,0,0);m.canvas=canvas;delete m.data
  }
  return gt
}
export function paintGroundTruth(c,gt,scale){
  if(!gt)return
  const color='#71e2c4',font=11/scale;c.lineWidth=1.5/scale;c.strokeStyle=color;c.fillStyle=color;c.font=`${font}px sans-serif`
  const tag=(x,y,text)=>{c.fillStyle='#0b1421db';c.fillRect(x,y-font,c.measureText(text).width+4/scale,font+3/scale);c.fillStyle=color;c.fillText(text,x,y)}
  for(const m of gt.masks)c.drawImage(m.canvas,0,0)
  for(const p of gt.polygons){c.beginPath();p.points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(p.closed)c.closePath();c.stroke();tag(...p.points[0],p.label)}
  for(const p of gt.landmarks){c.beginPath();c.arc(p.x,p.y,2.5/scale,0,2*Math.PI);c.fillStyle=color;c.fill();tag(p.x+4/scale,p.y,p.label)}
}
