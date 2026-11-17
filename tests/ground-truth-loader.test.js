import test from 'node:test'
import assert from 'node:assert/strict'
import {fetchSavedGroundTruth,createGroundTruthLoader} from '../public/ai/ground-truth-loader.js'

test('standalone image retrieves server GT without a local JSON or editor snapshot',async()=>{
  const calls=[]
  const label={exists:true,filename:'x.png',polygons:[{points:[1,2,3,4,5,6]}]}
  const result=await fetchSavedGroundTruth('x.png',async name=>{calls.push(name);return label},async()=>{throw Error('unneeded listing')})
  assert.deepEqual(calls,['x.png']);assert.equal(result.polygons.length,1)
})
test('server name lookup normalizes Unicode and case but rejects ambiguous matches',async()=>{
  const name='척추.PNG'.normalize('NFD'),calls=[]
  const read=async file=>{calls.push(file);return file===name?{exists:true,filename:name}:{exists:false}}
  const result=await fetchSavedGroundTruth('척추.png',read,async()=>[{filename:name}])
  assert.equal(result.filename,name);assert.equal(calls.length,2)
  await assert.rejects(fetchSavedGroundTruth('folder/x.png',async()=>({exists:false}),async()=>[{filename:'a/X.PNG'},{filename:'b/X.PNG'}]),/여러/)
})
test('lookup failures are not mislabeled as absent GT, and stale image replies are ignored',async()=>{
  const states=[],pending={}
  const loader=createGroundTruthLoader(name=>new Promise((resolve,reject)=>{pending[name]={resolve,reject}}),async()=>[],state=>states.push(state))
  const first=loader.load('a.png'),second=loader.load('b.png')
  pending['b.png'].resolve({exists:true,filename:'b.png'});await second
  pending['a.png'].resolve({exists:true,filename:'a.png'});await first
  assert.equal(states.at(-1).data.filename,'b.png')
  const failed=loader.load('c.png');pending['c.png'].reject(Error('server unavailable'));await failed
  assert.equal(states.at(-1).status,'error');assert.match(states.at(-1).error,/unavailable/)
  const missing=loader.load('d.png');pending['d.png'].resolve({exists:false});await missing
  assert.equal(states.at(-1).status,'missing')
})
