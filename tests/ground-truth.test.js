import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveGroundTruth,decodeRLE} from '../public/ai/ground-truth.js'
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
