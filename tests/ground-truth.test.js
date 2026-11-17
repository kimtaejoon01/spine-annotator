import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveGroundTruth,decodeRLE,groundTruthView} from '../public/ai/ground-truth.js'
import {exportToCOCO} from '../public/static/coco.js'
const polygons=[{label:'L5',points:[1,2,8,2,8,6,1,6]},{label:'S1_SUP',shape:'endplate',points:[2,8,9,9]}]
const landmarks=[{label:'HC_LAT',x:5,y:15}]
test('Annotator export roundtrip preserves spine, S1 line and HC for GT display',()=>{
  const data=exportToCOCO({filename:'x.png',width:10,height:20,polygons,landmarks})
  const before=JSON.stringify(data),gt=resolveGroundTruth(data,'x.png',10,20)
  assert.equal(gt.polygons.length,2);assert.equal(gt.polygons[1].closed,false)
  assert.deepEqual(gt.polygons[1].points,[[2,8],[9,9]])
  assert.equal(gt.landmarks.find(p=>p.label==='HC_LAT').y,15)
  assert.equal(JSON.stringify(data),before)
})
test('raw snapshots and multi-image files select by filename; unrelated labels are not shown',()=>{
  const data={items:[{filename:'x.png',image_width:10,image_height:20,polygons,landmarks},{filename:'y.png',image_width:10,image_height:20,polygons:[],landmarks:[]}]}
  assert.equal(resolveGroundTruth(data,'x.png',10,20).polygons.length,2)
  assert.equal(resolveGroundTruth(data,'y.png',10,20).polygons.length,0)
  assert.equal(resolveGroundTruth(data,'z.png',10,20),null)
  assert.throws(()=>resolveGroundTruth(data,'x.png',20,10),/크기/)
  assert.throws(()=>resolveGroundTruth({items:[data.items[0],data.items[0]]},'x.png',10,20),/여러/)
  const unicode={...data.items[0],filename:'folder/척추.png'.normalize('NFD')}
  assert.equal(resolveGroundTruth(unicode,'척추.png',10,20).polygons.length,2)
})
test('COCO RLE uses column major ordering, supports compressed counts and rejects corruption',()=>{
  // COCO counts [2, 2, 1, 1] -> compressed [2,2,1,-1] -> 221O.
  const expected=[0,1,0,0,1,1]
  assert.deepEqual([...decodeRLE({size:[3,2],counts:[2,2,1,1]},2,3)],expected)
  assert.deepEqual([...decodeRLE({size:[3,2],counts:'221O'},2,3)],expected)
  assert.throws(()=>decodeRLE({size:[3,2],counts:[2,2]},2,3))
  assert.throws(()=>decodeRLE({size:[3,2],counts:'P'},2,3))
  const coco={images:[{id:1,file_name:'x.png',width:2,height:3}],categories:[{id:1,name:'FH_LAT'}],annotations:[{image_id:1,category_id:1,segmentation:{size:[3,2],counts:'221O'}}]}
  assert.deepEqual([...resolveGroundTruth(coco,'x.png',2,3).masks[0].data],expected)
})
test('invalid geometry is reported rather than silently showing incomplete GT',()=>{
  assert.throws(()=>resolveGroundTruth({filename:'x.png',width:10,height:20,polygons:[{points:[1,2,3]}]},'x.png',10,20))
})

test('present GT with missing dimensions has a distinct status and explicit coordinate opt-in',()=>{
  const data={filename:'x.png',image_width:null,image_height:null,polygons,landmarks}
  const candidates=[{data,source:'서버 저장 라벨'}]
  let view=groundTruthView(candidates,'x.png',10,20)
  assert.equal(view.code,'GT_SIZE_MISSING');assert.match(view.title,/GT 있음/);assert.equal(view.gt,null)
  view=groundTruthView(candidates,'x.png',10,20,{acceptedSizeData:data})
  assert.equal(view.gt.polygons.length,2);assert.match(view.message,/크기 미기록/)
  assert.equal(groundTruthView(candidates,'x.png',10,20,{acceptedSizeData:{...data}}).code,'GT_SIZE_MISSING')
  const mismatch={...data,image_width:100,image_height:200}
  view=groundTruthView([{data:mismatch,source:'GT'}],'x.png',10,20,{acceptedSizeData:mismatch})
  assert.equal(view.code,'GT_SIZE_MISMATCH');assert.equal(view.gt,null)
  view=groundTruthView(candidates,'x.png',2,2,{acceptedSizeData:data})
  assert.equal(view.code,'GT_SIZE_MISMATCH')
})
test('unrelated selected JSON does not hide the matching Annotator snapshot',()=>{
  const bridge={filename:'x.png',width:10,height:20,polygons,landmarks}
  const view=groundTruthView([{data:{...bridge,filename:'other.png'},source:'other.json'},{data:bridge,source:'Annotator'}],'x.png',10,20)
  assert.equal(view.gt.source,'Annotator');assert.equal(view.gt.polygons.length,2)
  assert.match(view.message,/선택 JSON에 현재 영상 없음/)
})
test('nested saved payload and mixed COCO ID types retain existing annotations',()=>{
  const raw={filename:'x.png',image_width:10,image_height:20,polygons:{polygons,landmarks}}
  assert.equal(resolveGroundTruth(raw,'X.PNG',10,20).landmarks.length,1)
  const stored={...raw,polygons:undefined,polygons_json:JSON.stringify(raw.polygons)}
  assert.equal(resolveGroundTruth(stored,'x.png',10,20).polygons.length,2)
  const coco=exportToCOCO({filename:'x.png',width:10,height:20,polygons,landmarks})
  coco.annotations.forEach(x=>{x.image_id=String(x.image_id);x.category_id=String(x.category_id)})
  assert.equal(resolveGroundTruth(coco,'x.png',10,20).polygons.length,2)
})
