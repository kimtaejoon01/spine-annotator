import test from 'node:test'
import assert from 'node:assert/strict'
import {calculateSagittal,intersection,angle} from '../public/ai/sagittal.js'
import {aiMeasurementInput,gtMeasurementInput} from '../public/ai-web/measurement-input.js'
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`)
const rad=d=>d*Math.PI/180
function fixture(){
  const points={HC_LAT:[500+250*Math.sin(rad(20)),700+250*Math.cos(rad(20))],C7_CENTER:[530,200],T1_CENTER:[470,250]}
  function plate(l,k,x,y,d){const u=[50*Math.cos(rad(d)),50*Math.sin(rad(d))];points[l+'_'+k+'_POST']=[x-u[0],y-u[1]];points[l+'_'+k+'_ANT']=[x+u[0],y+u[1]]}
  plate('C2','INF',470,100,-15);plate('C7','INF',530,200,5)
  plate('T4','SUP',450,350,-30);plate('T12','INF',460,500,20)
  plate('L1','SUP',480,550,-20);plate('S1','SUP',500,700,40)
  return {points}
}
const result=(f,options={anteriorRight:true})=>Object.fromEntries(calculateSagittal(f,options).map(m=>[m.id,m]))
test('eight metrics use user-specified levels and S1 needs only its two superior points',()=>{
  const m=result(fixture());assert.ok(Object.values(m).every(x=>x.available))
  close(m.CL.value,20);close(m.TK.value,50);close(m.LL.value,60);close(m.SS.value,40);close(m.PT.value,20);close(m.PI.value,60)
  close(m.PI.value,m.PT.value+m.SS.value)
  assert.equal(m.SVA.unit,'px');assert.ok(m.TPA.value>0)
  const f=fixture();delete f.points.T4_SUP_POST;f.points.T1_SUP_POST=[10,10];assert.equal(result(f).TK.available,false)
})
test('all measurements survive horizontal mirroring with matching anterior direction',()=>{
  const f=fixture(),r=structuredClone(f);for(const p of Object.values(r.points))p[0]=1200-p[0]
  const x=result(f),y=result(r,{anteriorRight:false})
  for(const k of Object.keys(x))close(x[k].value,y[k].value)
})
test('SVA uses S1 posterior point, original pixels and explicit calibration; posterior SVA is signed',()=>{
  const f=fixture(),expected=f.points.C7_CENTER[0]-f.points.S1_SUP_POST[0]
  close(result(f).SVA.value,expected);const m=result(f,{anteriorRight:true,mmPerPixel:.2}).SVA;close(m.value,expected*.2);assert.equal(m.unit,'mm')
  f.points.C7_CENTER[0]=f.points.S1_SUP_POST[0]-10;close(result(f).SVA.value,-10)
  assert.equal(result(f,{anteriorRight:true,mmPerPixel:-1}).SVA.unit,'px')
})
test('pelvic tilt supports negative values, PI and TPA are not folded into acute angles',()=>{
  const f=fixture();f.points.HC_LAT=[500-250*Math.sin(rad(10)),700+250*Math.cos(rad(10))]
  close(result(f).PT.value,-10);close(result(f).PI.value,30)
  f.points.HC_LAT=[500+250*Math.sin(rad(70)),700+250*Math.cos(rad(70))];close(result(f).PI.value,110)
  close(angle([1,0],[-1,1]),135)
})
test('missing, duplicate or coincident landmarks are unavailable, not zero-valued results',()=>{
  const f=fixture();delete f.points.HC_LAT;const m=result(f);assert.equal(m.PT.available,false);assert.equal(m.PI.available,false);assert.equal(m.TPA.available,false);assert.equal(m.LL.available,true)
  f.points.S1_SUP_ANT=f.points.S1_SUP_POST;assert.equal(result(f).LL.available,false)
  const x=fixture();x.errors={C7_INF_ANT:'duplicate'};assert.equal(result(x).CL.reason,'duplicate')
})
test('parallel endplates keep a valid zero angle and no fake intersection',()=>{
  assert.equal(intersection([[0,0],[1,0]],[[0,3],[1,3]]),null)
  assert.deepEqual(intersection([[0,0],[10,0]],[[2,-1],[2,1]]),[2,0])
  const f=fixture();f.points.C7_INF_ANT=[100,200];f.points.C7_INF_POST=[0,200];f.points.C2_INF_ANT=[100,100];f.points.C2_INF_POST=[0,100]
  close(result(f).CL.value,0);assert.equal(result(f).CL.angular.vertex,null)
})
test('GT measured landmarks take precedence over inferred corners, with explicit provenance',()=>{
  const gt={polygons:[{label:'C7',points:[[10,10],[50,10],[50,50],[10,50]]},{label:'S1_SUP',shape:'endplate',points:[[20,100],[60,120]]}],landmarks:[{label:'C7_INF_ANT',x:9,y:49}]}
  const input=gtMeasurementInput(gt,{width:100,anteriorRight:false});assert.deepEqual(input.points.C7_INF_ANT,[9,49]);assert.equal(input.notes.C7_INF_ANT[0],'GT 저장 기준점')
  assert.match(input.notes.C7_INF_POST[0],/추정/);assert.deepEqual(input.points.S1_SUP_POST,[60,120]);assert.deepEqual(input.points.C7_CENTER,[30,30])
  gt.polygons.push(structuredClone(gt.polygons[0]));assert.match(gtMeasurementInput(gt,{width:100}).errors.C7_INF_ANT,/중복/)
})
test('GT uses two explicit circles for HC, never arbitrary segmentation contours or one circle',()=>{
  const circle=cx=>({label:'FH_LAT',shape:'circle',points:Array.from({length:32},(_,i)=>[cx+20*Math.cos(i*Math.PI/16),200+20*Math.sin(i*Math.PI/16)])})
  const gt={polygons:[circle(100),circle(150)],landmarks:[]}
  const p=gtMeasurementInput(gt,{width:300}).points.HC_LAT;close(p[0],125);close(p[1],200)
  delete gt.polygons[0].shape;assert.equal(gtMeasurementInput(gt,{width:300}).points.HC_LAT,undefined)
})
test('AI withheld HC and repeated vertebral numbers remain unavailable for measurement',()=>{
  const r={schema_version:'spine-unified-ui-1',image:{width:100,height:200},anterior_right:false,spine:{polygons:[{points:[[10,10],[50,10],[50,50],[10,50]]}],numbering:[{input_index:0,final_level:'C7'}],corners:[]},s1:{status:'predicted',points:[[20,100],[60,120]]},femoral:{instances:[{cx:30,cy:160,radius:10},{cx:50,cy:160,radius:10}],HC_LAT:null}}
  let input=aiMeasurementInput(r,'v2');assert.equal(input.points.HC_LAT,undefined);assert.match(result(input).PT.reason,/보류/)
  r.spine.polygons.push(structuredClone(r.spine.polygons[0]));r.spine.numbering.push({input_index:1,final_level:'C7'});input=aiMeasurementInput(r,'v2');assert.match(result(input).SVA.reason,/중복/)
})
