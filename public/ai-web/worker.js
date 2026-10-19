/* All inference and image data stay in this worker. Only fixed runtime/app assets are fetched. */
const PY_URL='https://cdn.jsdelivr.net/pyodide/v0.28.2/full/'
const ORT_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/'
let py,ortApi,manifest,files,session=null,sessionName=null,busy=false,ready=false
let providers={},verified=new Set(),cornerCompare,bundleModule,activeId=null
self.report_progress=(value,text)=>postMessage({type:'progress',id:activeId,value,text})
const report=self.report_progress
async function release(){if(session){await session.release();session=null;sessionName=null}}
async function getBytes(name,hash){
  const file=files.get(name);if(!file)throw Error('모델 파일 없음: '+name)
  const b=await file.arrayBuffer()
  if(!verified.has(name)){if(await bundleModule.sha256(b)!==hash)throw Error('모델 파일 해시가 다릅니다: '+name);verified.add(name)}
  return new Uint8Array(b)
}
async function getSession(name){
  if(sessionName===name)return session
  await release();const d=manifest.models[name],bytes=await getBytes(d.file,d.sha256)
  let provider=providers[name]||'wasm'
  try{session=await ortApi.InferenceSession.create(bytes,{executionProviders:provider==='webgpu'?['webgpu','wasm']:['wasm'],graphOptimizationLevel:'all'})}
  catch(e){if(provider==='wasm')throw e;providers[name]='wasm';report(0,name+': CPU로 전환');session=await ortApi.InferenceSession.create(bytes,{executionProviders:['wasm']})}
  sessionName=name;return session
}
self.run_model=async(name,inputs)=>{
  const model=await getSession(name),feeds={},outputs={}
  try{
    for(const [key,x] of Object.entries(inputs))feeds[key]=new ortApi.Tensor('float32',new Float32Array(x.data.buffer,x.data.byteOffset,x.data.byteLength/4).slice(),Array.from(x.dims))
    const result=await model.run(feeds)
    try{for(const [key,t] of Object.entries(result))outputs[key]={data:(await t.getData()).slice(),dims:Array.from(t.dims)}}finally{Object.values(result).forEach(t=>t.dispose())}
    return outputs
  }finally{Object.values(feeds).forEach(t=>t.dispose())}
}
self.run_corners=(json,width,anterior)=>{
  const sp=JSON.parse(json),rows=new Map(sp.numbering.map(x=>[x.input_index,x]))
  const candidates=sp.polygons.map((p,i)=>({candidate_index:i,label:rows.get(i).final_level,points:p.points.map(([x,y])=>[anterior?x:width-1-x,y])}))
  const out=JSON.parse(cornerCompare(JSON.stringify({candidates,validate:true})))
  if(!anterior)for(const r of out)for(const m of ['v1','v2']){
    const fit=r[m];for(const k of ['SA','SP','IA','IP'])if(fit[k])fit[k][0]=width-1-fit[k][0]
    for(const k of ['supVec','infVec'])if(fit[k])fit[k][0]*=-1
    for(const k of ['supPts','infPts'])for(const p of fit[k]||[])p[0]=width-1-p[0]
  }
  return JSON.stringify(out)
}
async function init(){
  if(py)return
  if(!self.isSecureContext)throw Error('HTTPS 주소에서 이 페이지를 여세요.')
  report(0,'실행 환경 준비 중 · 첫 실행에는 파일 다운로드가 필요합니다.')
  bundleModule=await import('./bundle.js');({cornerCompare}=await import('./corners.js'))
  importScripts(ORT_URL+'ort.webgpu.min.js',PY_URL+'pyodide.js');ortApi=self.ort
  ortApi.env.wasm.wasmPaths=ORT_URL;ortApi.env.wasm.numThreads=1;ortApi.env.wasm.proxy=false
  py=await loadPyodide({indexURL:PY_URL})
  await py.loadPackage(['numpy','opencv-python','scipy','scikit-image','pillow','pandas'])
  for(const [url,path] of [['./original_ops.json','/original_ops.json'],['./numerical_checks.py','/numerical_checks.py'],['./pipeline.py','/pipeline.py']]){
    const r=await fetch(url);if(!r.ok)throw Error('실행 파일 다운로드 실패: '+url);py.FS.writeFile(path,await r.text())
  }
  await py.runPythonAsync("exec(open('/numerical_checks.py').read()); exec(open('/pipeline.py').read())")
}
async function load(m){
  ready=false;await init();await release()
  const bundle=await bundleModule.readBundle(m.files);manifest=bundle.manifest;files=new Map(bundle.files.map(f=>[f.name,f]));verified=new Set();providers={}
  const gpu=m.device!=='wasm'&&!!navigator.gpu&&!!(await navigator.gpu.requestAdapter().catch(()=>null))
  for(const name of bundleModule.STAGES)providers[name]=gpu?'webgpu':'wasm'
  // GRU and RoiAlign use WASM; no candidate truncation and no arbitrary graph rewrites.
  providers.number='wasm'
  manifest.bundle_sha256=await bundleModule.sha256(await files.get('manifest.json').arrayBuffer())
  const results={}
  for(let i=0;i<bundleModule.STAGES.length;i++){
    const name=bundleModule.STAGES[i],d=manifest.models[name];report(5+85*i/6,`${name} 모델 확인 · ${i+1}/6`)
    py.FS.writeFile('/check.npz',await getBytes(d.check_file,d.check_sha256))
    py.globals.set('check_name',name);py.globals.set('check_desc_json',JSON.stringify(d))
    const check=()=>py.runPythonAsync("await check_model(check_name, '/check.npz', json.loads(check_desc_json))")
    try{results[name]=JSON.parse(await check())}
    catch(e){if(providers[name]==='wasm')throw Error(name+' 모델 출력 검증 실패: '+e.message);providers[name]='wasm';await release();results[name]=JSON.parse(await check())}
    py.FS.unlink('/check.npz');await release()
  }
  manifest.browser_validation={providers,errors:results};py.globals.set('manifest_json',JSON.stringify(manifest))
  await py.runPythonAsync('pipeline = BrowserPipeline(json.loads(manifest_json))')
  ready=true;report(100,'모델 준비 완료');return {providers,manifest:manifest.bundle_sha256}
}
async function handle(m){
  if(m.type==='load')return load(m)
  if(!ready)throw Error('먼저 모델을 불러오세요.')
  if(m.type==='predict'){
    if(!(m.file instanceof Blob)||m.file.size>32*1024*1024)throw Error('32 MB 이하 영상을 선택하세요.')
    const buf=await m.file.arrayBuffer(),hash=await bundleModule.sha256(buf)
    py.FS.writeFile('/input_image',new Uint8Array(buf));py.globals.set('filename',m.file.name);py.globals.set('anterior',!!m.anterior);py.globals.set('input_sha',hash)
    const result=JSON.parse(await py.runPythonAsync("await pipeline.predict('/input_image', filename, anterior, input_sha)"))
    await release();const preview=py.runPython('pipeline.preview()');let bytes
    try{bytes=preview.toJs().slice()}finally{preview.destroy()}
    return {result,preview:new Blob([bytes],{type:'image/png'})}
  }
  if(m.type==='s1'){
    py.globals.set('l5_index',m.index);await py.runPythonAsync('await pipeline.run_s1(l5_index)');await release()
    return {result:JSON.parse(py.runPython('json.dumps(to_jsonable(pipeline.last),ensure_ascii=False)'))}
  }
  if(m.type==='export'){
    report(0,'결과 파일 만들기')
    await py.loadPackage('micropip');await py.runPythonAsync("import micropip\nawait micropip.install('openpyxl==3.1.5')")
    py.globals.set('export_options',JSON.stringify(m.options))
    const path=py.runPython('pipeline.export(json.loads(export_options))'),bytes=py.FS.readFile(path)
    const blob=new Blob([bytes],{type:'application/zip'})
    py.runPython("shutil.rmtree('/export',ignore_errors=True)");return {blob}
  }
  throw Error('지원하지 않는 작업')
}
self.onmessage=async({data:m})=>{
  if(busy){postMessage({type:'error',id:m.id,message:'다른 작업이 실행 중입니다.'});return}
  busy=true;activeId=m.id
  try{postMessage({type:'done',id:m.id,data:await handle(m)})}
  catch(e){await release().catch(()=>{});if(m.type==='load')ready=false;postMessage({type:'error',id:m.id,message:e.message||String(e)})}
  finally{busy=false;activeId=null}
}
