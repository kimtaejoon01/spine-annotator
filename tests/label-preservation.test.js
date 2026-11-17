import test from 'node:test'
import assert from 'node:assert/strict'
import { SpineAnnotator } from '../public/static/annotator.js'
const poly=(id,label,y,manualLabel=false)=>({id,label,manualLabel,points:[0,y,10,y,10,y+2,0,y+2]})
function annotator(polygons,startLabel='C2') {
  const a=Object.create(SpineAnnotator.prototype)
  Object.assign(a,{polygons,startLabel,renderPolygons(){},pushHistory(){},notifyPolygons(){}})
  return a
}
test('manual skip C7 -> T2 survives adding, editing, and deleting lower polygons',()=>{
 const a=annotator([poly(1,'C7',0),poly(2,'T1',10)])
 a.setLabelForPolygon(2,'T2')
 assert.equal(a.polygons[1].manualLabel,true)
 a.polygons.push(poly(3,null,20));a.relabelAll()
 assert.deepEqual(a.polygons.map(p=>p.label),['C7','T2','T3'])
 a.deletePolygon(3)
 assert.deepEqual(a.polygons.map(p=>p.label),['C7','T2'])
})
test('manual lumbar anchors count toward next label, pelvis excluded',()=>{
 const a=annotator([poly(1,'T12',0,true),poly(2,'L1',10,true),poly(3,'L2',20,true),poly(4,'L3',30,true),poly(5,'L4',40,true),poly(8,'FH_LAT',70,true)])
 a.polygons.push(poly(6,null,50),poly(7,null,60));a.relabelAll()
 assert.deepEqual(a.polygons.map(p=>p.label),['T12','L1','L2','L3','L4','L5','S1','FH_LAT'])
})
test('inserting omitted T1 fills gap without changing T2 or T3',()=>{
 const a=annotator([poly(1,'C7',0),poly(2,'T2',20),poly(3,'T3',30),poly(4,null,10)])
 a.relabelAll();assert.deepEqual(a.polygons.map(p=>p.label),['C7','T1','T2','T3'])
})
test('no room yields unknown instead of rewriting existing annotation',()=>{
 const a=annotator([poly(1,'L4',0),poly(2,'L5',20),poly(3,null,10)])
 a.relabelAll();assert.deepEqual(a.polygons.map(p=>p.label),['L4','?','L5'])
})
test('saved labels without manual flag remain stable; extra labels unaffected',()=>{
 const a=annotator([poly(1,'C7',0),poly(2,'T2',10),poly(3,'S1_SUP',30),poly(4,'FH_LAT',40)])
 a.relabelAll();assert.deepEqual(a.polygons.map(p=>p.label),['C7','T2','S1_SUP','FH_LAT'])
})
test('new empty sequence starts at configured label, overflow is unknown',()=>{
 const a=annotator([poly(1,null,0),poly(2,null,10),poly(3,null,20)],'L5')
 a.relabelAll();assert.deepEqual(a.polygons.map(p=>p.label),['L5','S1','?'])
})
