import test from 'node:test'
import assert from 'node:assert/strict'
import {validateResult,toAnnotations,sameImage} from '../public/ai/result.js'
import {SpineAnnotator} from '../public/static/annotator.js'

function result(labels=['L4','L5']){
  return {schema_version:'spine-unified-ui-1',image:{width:100,height:200,sha256:'abc'},anterior_right:false,
    spine:{polygons:labels.map((_,i)=>({points:[[10,20+i*40],[50,20+i*40],[50,40+i*40],[10,40+i*40]]})),
      numbering:labels.map((l,i)=>({input_index:i,final_level:l})),
      corners:labels.map((l,i)=>({candidate_index:i,label:l,v2:{SA:[10,20+i*40],SP:[50,20+i*40],IA:[10,40+i*40],IP:[50,40+i*40]}}))},
    s1:{status:'predicted',points:[[20,120],[60,125]]},femoral:{HC_LAT:null,annotator_polygons:[]}}
}
test('duplicate levels preserve every polygon, but cannot overwrite label-keyed landmarks',()=>{
  const x=toAnnotations(result(['L5','L5']));assert.equal(x.polygons.filter(p=>p.label==='L5').length,2)
  assert.equal(x.landmarks.filter(p=>p.label.startsWith('L5_')).length,0);assert.equal(x.warnings.length,1)
})
test('S1 anterior/posterior follows selected orientation; withheld HC stays withheld',()=>{
  const r=result();let out=toAnnotations(r)
  assert.equal(out.landmarks.find(p=>p.label==='S1_SUP_ANT').x,20)
  assert.ok(!out.landmarks.some(p=>p.label==='HC_LAT'))
  r.anterior_right=true;r.femoral.HC_LAT={x:30,y:160};out=toAnnotations(r)
  assert.equal(out.landmarks.find(p=>p.label==='S1_SUP_ANT').x,60)
  assert.equal(out.landmarks.find(p=>p.label==='HC_LAT').y,160)
})
test('invalid indices and nonfinite geometry are rejected before touching editor state',()=>{
  const r=result();r.spine.numbering[1].input_index=0;assert.throws(()=>validateResult(r))
  const x=result();x.spine.polygons[0].points[0][0]=NaN;assert.throws(()=>toAnnotations(x))
})
test('same name is insufficient: reject changed image URL, dimensions or byte hash',()=>{
  const e={filename:'a.png',url:'blob:a',width:100,height:200,sha256:'abc'},r=result()
  assert.ok(sameImage(e,e,r));assert.ok(!sameImage(e,{...e,url:'blob:b'},r))
  r.image.sha256='other';assert.ok(!sameImage(e,e,r))
})
test('AI import is a single undo step for polygons, shapes and landmarks',()=>{
  const a=Object.create(SpineAnnotator.prototype)
  a.polygons=[{id:1,label:'FH_LAT',points:[2,3,4,5,6,7],shape:'circle'}];a.landmarks=[{label:'HC_LAT',x:3,y:4}]
  a.getLandmarks=()=>structuredClone(a.landmarks);a.loadLandmarks=x=>{a.landmarks=structuredClone(x)}
  a.renderPolygons=()=>{};a.notifyPolygons=()=>{}
  a.history=[a.snapshot()];a.historyIdx=0
  a.loadPolygons=x=>{a.polygons=structuredClone(x);a.history=[a.snapshot()];a.historyIdx=0}
  const before=a.snapshot();a.applyAiPrediction([{id:2,label:'S1_SUP',points:[1,2,4,5],shape:'endplate'}],[{label:'S1_SUP_ANT',x:1,y:2}])
  assert.equal(a.history.length,2);a.undo();assert.equal(a.snapshot(),before)
  a.redo();assert.equal(a.polygons[0].shape,'endplate');assert.equal(a.landmarks[0].label,'S1_SUP_ANT')
})
