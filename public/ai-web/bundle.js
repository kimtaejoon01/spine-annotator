export const STAGES=['a','number','s1_coarse','s1_fine','fh_coarse','fh_fine']
export const EXPECTED_IO={a:[['image'],['probabilities']],number:[['image','boxes','geometry'],['probabilities']],s1_coarse:[['image'],['context']],s1_fine:[['image','context','position'],['probabilities']],fh_coarse:[['image'],['probabilities']],fh_fine:[['image'],['probabilities','count']]}
const leaf=n=>typeof n==='string'&&/^[A-Za-z0-9_.-]+$/.test(n)&&!n.startsWith('.')
const hash=n=>typeof n==='string'&&/^[a-f0-9]{64}$/.test(n)
export function validateManifest(m){
  if(m?.schema!=='spine-browser-bundle-1'||m.validation!=='pytorch_vs_onnx_cpu_passed; browser_checks_required_on_load')throw Error('브라우저용으로 변환·검증한 모델 폴더가 필요합니다. .pt/.pth는 직접 실행할 수 없습니다.')
  const names=new Set(['manifest.json']);let total=0
  for(const name of STAGES){
    const d=m.models?.[name],io=EXPECTED_IO[name]
    if(!d||!leaf(d.file)||!d.file.endsWith('.onnx')||!hash(d.sha256)||!leaf(d.check_file)||!d.check_file.endsWith('.npz')||!hash(d.check_sha256))throw Error(name+': 모델 명세 오류')
    if(JSON.stringify(d.inputs)!==JSON.stringify(io[0])||JSON.stringify(d.outputs)!==JSON.stringify(io[1]))throw Error(name+': 입출력 명세 오류')
    for(const [file,bytes] of [[d.file,d.bytes],[d.check_file,d.check_bytes]]){
      if(names.has(file)||!Number.isSafeInteger(bytes)||bytes<1||bytes>600*1024*1024)throw Error(name+': 파일 크기/이름 오류')
      names.add(file);total+=bytes
    }
  }
  if(total>2*1024**3)throw Error('모델 묶음이 2 GB를 넘습니다.')
  const levels=['C2','C3','C4','C5','C6','C7',...Array.from({length:12},(_,i)=>'T'+(i+1)),...Array.from({length:5},(_,i)=>'L'+(i+1))]
  if(JSON.stringify(m.number?.levels)!==JSON.stringify(levels)||!Array.isArray(m.number?.feature_names)||!m.scaler||!m.a||!m.s1||!m.fh||!m.provenance)throw Error('모델 설정이 빠졌거나 C2–L5 번호 체계가 아닙니다.')
  for(const key of ['mean','scale'])if(m.scaler[key]!==null&&(!Array.isArray(m.scaler[key])||m.scaler[key].length!==m.number.feature_names.length||!m.scaler[key].every(Number.isFinite)))throw Error('Geometry 정규화 설정 오류')
  return m
}
export async function readBundle(files){
  const all=Array.from(files),byName=new Map()
  for(const f of all){if(byName.has(f.name))throw Error('파일 이름이 중복됩니다. 변환 결과 폴더 한 개만 선택하세요.');byName.set(f.name,f)}
  const mf=byName.get('manifest.json')
  if(!mf){if(all.some(f=>/\.(pth|pt)$/.test(f.name)))throw Error('.pt/.pth를 브라우저용 모델로 한 번 변환해야 합니다. 모델 준비 안내를 열어 주세요.');throw Error('manifest.json이 없습니다. 변환 결과 폴더를 선택하세요.')}
  if(mf.size>10*1024*1024)throw Error('모델 설정 파일이 너무 큽니다.')
  const manifest=validateManifest(JSON.parse(await mf.text())),selected=[mf]
  for(const name of STAGES){const d=manifest.models[name];for(const [n,bytes] of [[d.file,d.bytes],[d.check_file,d.check_bytes]]){const f=byName.get(n);if(!f||f.size!==bytes)throw Error('모델 파일 누락/크기 불일치: '+n);selected.push(f)}}
  return {manifest,files:selected}
}
export async function sha256(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('')}
