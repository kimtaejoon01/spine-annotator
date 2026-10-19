import test from 'node:test'
import assert from 'node:assert/strict'
import {readBundle,validateManifest,STAGES,EXPECTED_IO,sha256} from '../public/ai-web/bundle.js'
import {cornerCompare} from '../public/ai-web/corners.js'
function bundle(){
 const m={schema:'spine-browser-bundle-1',validation:'pytorch_vs_onnx_cpu_passed; browser_checks_required_on_load',models:{},number:{levels:['C2','C3','C4','C5','C6','C7',...Array.from({length:12},(_,i)=>'T'+(i+1)),...Array.from({length:5},(_,i)=>'L'+(i+1))],feature_names:['cx_norm']},scaler:{mean:[0],scale:[1]},a:{},s1:{},fh:{},provenance:{}}
 const files=[]
 for(const name of STAGES){const [inputs,outputs]=EXPECTED_IO[name];m.models[name]={file:name+'.onnx',sha256:'a'.repeat(64),bytes:4,inputs,outputs,check_file:name+'_check.npz',check_sha256:'b'.repeat(64),check_bytes:4};files.push(new File(['test'],name+'.onnx'),new File(['test'],name+'_check.npz'))}
 return {m,files}
}
test('all six models and their check inputs are required; old checkpoints get actionable errors',async()=>{
 const {m,files}=bundle(),mf=new File([JSON.stringify(m)],'manifest.json')
 assert.equal((await readBundle([mf,...files])).files.length,13)
 await assert.rejects(readBundle([mf,...files.slice(1)]),/누락/)
 await assert.rejects(readBundle([new File(['test'],'best.pth')]),/변환/)
 await assert.rejects(readBundle([mf,...files,new File(['test'],files[0].name)]),/중복/)
})
test('manifest rejects unsupported IO, path escape, corrupt dimensions and unvalidated conversions',()=>{
 for(const mutate of [m=>m.models.a.file='../a.onnx',m=>m.models.number.inputs=['image'],m=>m.scaler.mean=[0,1],m=>m.number.levels.reverse(),m=>m.validation='unchecked',m=>m.models.a.bytes=Infinity]){
  const {m}=bundle();mutate(m);assert.throws(()=>validateManifest(m))
 }
})
test('file identity uses the content SHA256',async()=>assert.equal(await sha256(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'))
test('bounded probability policy applies only to A; unknown policies are rejected',()=>{
 const {m}=bundle();m.models.a.numerical_policy='a-probability-v1';validateManifest(m)
 m.models.number.numerical_policy='a-probability-v1';assert.throws(()=>validateManifest(m),/검증 기준/)
 m.models.number.numerical_policy='elementwise-v1';validateManifest(m)
 m.models.a.numerical_policy='skip';assert.throws(()=>validateManifest(m),/검증 기준/)
})
test('browser corners keep duplicate candidate polygons separate for both methods',()=>{
 const candidates=[0,1].map(i=>({candidate_index:i,label:'L5',points:[[10,10+i*40],[40,10+i*40],[40,30+i*40],[10,30+i*40]]}))
 const out=JSON.parse(cornerCompare(JSON.stringify({candidates,validate:true})))
 assert.equal(out.length,2);assert.equal(out[1].candidate_index,1)
 assert.equal(out[0].validation,'direct_duplicate_or_unsupported_labels')
 for(const m of ['v1','v2']){assert.ok(out[1][m].SA[1]>out[0][m].SA[1]);for(const r of out)for(const p of ['SA','SP','IA','IP'])assert.equal(r[m][p].length,2)}
})
