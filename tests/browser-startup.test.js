import test from 'node:test'
import assert from 'node:assert/strict'
import {restoreSavedModels} from '../public/ai-web/startup.js'
const files=[{name:'manifest.json'}]
function setup(overrides={}){
 const calls=[]
 const args={readSaved:async()=>files,onSaved:f=>calls.push(['saved',f]),canRestore:()=>true,
  select:async f=>{calls.push(['select',f]);return true},load:async()=>{calls.push(['load']);return true},
  onMissing:()=>calls.push(['setup']),onError:e=>calls.push(['error',e.message]),...overrides}
 return {calls,args}
}
test('saved bundle loads once without manual setup; existing validation load is used',async()=>{
 const {args,calls}=setup();assert.equal(await restoreSavedModels(args),'ready')
 assert.deepEqual(calls.map(x=>x[0]),['saved','select','load'])
})
test('first use and missing storage open setup instead of attempting inference',async()=>{
 for(const value of [null,[]]){
  const {args,calls}=setup({readSaved:async()=>value});assert.equal(await restoreSavedModels(args),'missing')
  assert.deepEqual(calls.map(x=>x[0]),['saved','setup'])
 }
 const {args,calls}=setup({readSaved:async()=>{throw Error('storage unavailable')}})
 assert.equal(await restoreSavedModels(args),'failed');assert.deepEqual(calls,[['error','storage unavailable']])
})
test('a user model choice made during slow cache reads is never replaced automatically',async()=>{
 let release,manual=false
 const {args,calls}=setup({readSaved:()=>new Promise(resolve=>{release=resolve}),canRestore:()=>!manual})
 const pending=restoreSavedModels(args);manual=true;release(files)
 assert.equal(await pending,'manual');assert.deepEqual(calls.map(x=>x[0]),['saved'])
})
test('a user model choice during bundle inspection prevents automatic loading',async()=>{
 let manual=false
 const {args,calls}=setup({canRestore:()=>!manual,select:async()=>{manual=true;return true}})
 assert.equal(await restoreSavedModels(args),'manual');assert.ok(!calls.some(x=>x[0]==='load'))
})
test('corrupt stored bundle or model verification failure never reports ready',async()=>{
 const invalid=setup({select:async()=>false});assert.equal(await restoreSavedModels(invalid.args),'invalid')
 assert.deepEqual(invalid.calls.map(x=>x[0]),['saved','setup'])
 const failed=setup({load:async()=>false});assert.equal(await restoreSavedModels(failed.args),'failed')
})
