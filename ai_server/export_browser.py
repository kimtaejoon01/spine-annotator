"""One-time export on the training machine; the resulting bundle runs in a browser.
python -m ai_server.export_browser --number ... --a ... --s1 ... --fh ... --output ...
No training, no checkpoint modification. Output is a new directory.
"""
from pathlib import Path
import argparse
import json
import time
import shutil
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from .runtime import SpineEngine, S1Engine, FemoralEngine, read_json, file_sha, to_jsonable
from .onnx_export import parity_stats, stable_group_norm_export, a_probability_stats, A_PROBABILITY_POLICY

STAGES = ('a', 'number', 's1_coarse', 's1_fine', 'fh_coarse', 'fh_fine')

class AExport(nn.Module):
    def __init__(self, model, scales):
        super().__init__(); self.model=model; self.scales=scales or [1.]
    def forward(self, image):
        h,w=map(int,image.shape[-2:]); total=None
        for scale in self.scales:
            if abs(scale-1)<1e-6: x=image
            else:
                size=(max(32,round(h*scale/32)*32),max(32,round(w*scale/32)*32))
                x=F.interpolate(image,size=size,mode='bilinear',align_corners=False)
            p=self.model(x).sigmoid()
            if p.shape[-2:] != (h,w): p=F.interpolate(p,size=(h,w),mode='bilinear',align_corners=False)
            total=p if total is None else total+p
        return total/len(self.scales)

class NumberExport(nn.Module):
    """One image, variable candidate count; no padding or packed sequences."""
    def __init__(self,model): super().__init__(); self.model=model
    def forward(self,image,boxes,geometry):
        m=self.model; h,w=image.shape[-2:]; f16,f32=m.extract_feature_maps(image)
        r16=m.roi_pool(f16,[boxes],h,w); r32=m.roi_pool(f32,[boxes],h,w)
        full=f32.mean(dim=(-2,-1)).expand(boxes.shape[0],-1)
        visual=m.visual_encoder(torch.cat([r16,r32,full],1))
        fused=m.fusion(torch.cat([visual,m.geometry_encoder(geometry)],1))
        if m.use_bigru:
            seq,_=m.gru(fused.unsqueeze(0))
            fused=torch.cat([fused,seq.squeeze(0)],1)
        return m.classifier(fused).softmax(1)

class S1CoarseExport(nn.Module):
    def __init__(self,m):super().__init__();self.model=m
    def forward(self,image):return self.model(image)[1]
class S1FineExport(nn.Module):
    def __init__(self,m):super().__init__();self.model=m
    def forward(self,image,context,position):return self.model(image,context,position)[0].sigmoid()
class FHExport(nn.Module):
    def __init__(self,m,fine=False):super().__init__();self.model=m;self.fine=fine
    def forward(self,image):
        out=self.model(image)
        if self.fine:return out[0].sigmoid(),out[1].softmax(1)
        return out.sigmoid()

def export_one(folder,name,model,args,input_names,output_names,dynamic_axes=None,extra_inputs=(),reuse_onnx=None):
    import onnx
    import onnxruntime as ort
    model.cpu().eval();path=folder/(name+'.onnx')
    # Capture native PyTorch outputs before any export-only rewrite.
    cases=[]
    for values in (args,*extra_inputs):
        with torch.inference_mode(): expected=model(*values)
        if not isinstance(expected,tuple):expected=(expected,)
        if len(expected)!=len(output_names):raise ValueError(name+': 출력 개수 불일치')
        cases.append((values,tuple(t.detach().cpu().numpy().copy() for t in expected)))
    strategies=['default']
    if any(isinstance(m,nn.GroupNorm) for m in model.modules()):strategies.append('stable_group_norm')
    if reuse_onnx is not None:
        if name!='a':raise ValueError('기존 ONNX 재사용은 A에만 지원합니다.')
        shutil.copyfile(Path(reuse_onnx),path)
        strategies=['reused_onnx_revalidated']
    attempts=[]
    for strategy in strategies:
        # Legacy export retains dynamic RoiAlign/GRU. The retry emits only
        # standard ONNX arithmetic, preserving the existing browser contract.
        if reuse_onnx is None:
            with stable_group_norm_export(model,strategy=='stable_group_norm') as export_model:
                with torch.inference_mode():
                    torch.onnx.export(export_model,args,str(path),opset_version=17,dynamo=False,
                                      input_names=input_names,output_names=output_names,
                                      dynamic_axes=dynamic_axes,do_constant_folding=True)
        onnx.checker.check_model(str(path),full_check=True)
        graph=onnx.load(str(path),load_external_data=False)
        if any(x.data_location==onnx.TensorProto.EXTERNAL for x in graph.graph.initializer):
            raise RuntimeError('External ONNX data is not supported in this bundle.')
        del graph
        session=ort.InferenceSession(str(path),providers=['CPUExecutionProvider'])
        comparisons=[];passed=True
        for values,expected in cases:
            actual=session.run(output_names,dict(zip(input_names,[x.detach().cpu().numpy() for x in values])))
            reports=[dict(output=n,**parity_stats(a,b,threshold=.5 if name=='a' and n=='probabilities' else None))
                     for n,a,b in zip(output_names,actual,expected)]
            if name=='a':
                for r,a,b in zip(reports,actual,expected):
                    bounded=a_probability_stats(a,b)
                    r.update(elementwise_passed=r['passed'],passed=bounded['passed'],probability_check=bounded)
            passed=passed and all(r['passed'] for r in reports)
            comparisons.append(dict(shapes=[list(v.shape) for v in values],
                                     max_absolute_errors=[r.get('max_absolute_error') for r in reports],outputs=reports))
        del session
        attempts.append(dict(strategy=strategy,passed=passed,comparisons=comparisons))
        if passed:
            print(name+' 수치 비교 통과 ('+strategy+')',flush=True)
            if name=='a':print('A 확률지도 검증: '+json.dumps(reports,ensure_ascii=False),flush=True)
            break
        print(name+' 수치 비교: '+json.dumps(comparisons,ensure_ascii=False),flush=True)
        if strategy!=strategies[-1]:
            print(name+': GroupNorm의 평균 계산을 나누어 다시 변환합니다. 검증 기준은 동일합니다.',flush=True)
    else:
        report=folder/(name+'_export_diagnostics.json')
        report.write_text(json.dumps(dict(model=name,torch_version=torch.__version__,onnx_version=onnx.__version__,
                                         onnxruntime_version=ort.__version__,attempts=attempts),ensure_ascii=False,indent=2),encoding='utf-8')
        raise AssertionError(name+' ONNX 수치 비교 실패. 허용 오차를 넘겨 중단했습니다. 진단 파일: '+str(report))
    # Small per-stage smoke fixture for browser WASM/WebGPU numerical verification.
    fixture=folder/(name+'_check.npz')
    reference=cases[0][1]
    np.savez_compressed(fixture,**{'in_'+n:x.cpu().numpy() for n,x in zip(input_names,args)},
                        **{'out_'+n:x for n,x in zip(output_names,reference)})
    return dict(file=path.name,sha256=file_sha(path),bytes=path.stat().st_size,
                inputs=input_names,outputs=output_names,check_file=fixture.name,
                check_sha256=file_sha(fixture),check_bytes=fixture.stat().st_size,parity=comparisons,
                export_strategy=strategy,export_attempts=attempts,
                numerical_policy=A_PROBABILITY_POLICY if name=='a' else 'elementwise-v1')

def export_bundle(number,a,s1,fh,output,reuse_a_onnx=None):
    if reuse_a_onnx is not None and not Path(reuse_a_onnx).is_file():
        raise FileNotFoundError('재사용할 A ONNX 파일이 없습니다: '+str(reuse_a_onnx))
    output=Path(output).expanduser()
    if output.exists():raise FileExistsError('출력 폴더가 이미 있습니다. 새 폴더를 지정하세요: '+str(output))
    output.mkdir(parents=True)
    rng=torch.Generator().manual_seed(41)
    image=lambda *shape:torch.rand(shape,generator=rng)*2-1
    manifest=dict(schema='spine-browser-bundle-1',created=time.strftime('%Y-%m-%dT%H:%M:%S'),models={},
        operator_source_sha256=read_json(Path(__file__).parents[1]/'public/ai-web/original_ops.json')['source_sha256'])
    write=lambda name,m,args,ins,outs,**kw:export_one(output,name,m,args,ins,outs,**kw)
    device=torch.device('cpu')
    print('A / 번호 모델 불러오기',flush=True)
    spine=SpineEngine(number,a,device);nc=read_json(spine.number_run/'shared_mobilenet_roi_config.json');ac=read_json(spine.a_run/'config.json')
    scaler=spine.ns['scaler']
    # StandardScaler's exact two in-place float32 operations are reproduced in the browser.
    if scaler.__class__.__name__!='StandardScaler':raise ValueError('지원하지 않는 geometry scaler: '+type(scaler).__name__)
    manifest.update(number=nc,a=ac,scaler=dict(mean=None if not scaler.with_mean else scaler.mean_.tolist(),scale=None if not scaler.with_std else scaler.scale_.tolist()),
                    provenance=dict(spine=spine.identity,notes=spine.notes))
    ns=spine.seg;scales=ns['TTA_SCALES'] if ns['TTA_USE_TEST'] else [1.]
    x=image(1,3+ns['y_encoding_channel_count'](),ns['MODEL_HEIGHT'],ns['MODEL_WIDTH'])
    print('A → ONNX / 수치 비교',flush=True)
    manifest['models']['a']=write('a',AExport(spine.seg_model,scales),(x,),['image'],['probabilities'],reuse_onnx=reuse_a_onnx)
    del x
    x=image(1,3,nc['input_h'],nc['input_w']);gdim=len(nc['feature_names'])
    def number_inputs(n):
        y=torch.linspace(0,nc['input_h']-40,n)
        boxes=torch.stack([torch.zeros(n),y,torch.full((n,),float(nc['input_w']-1)),y+39],1)
        return x,boxes,image(n,gdim)
    print('번호 → ONNX / 후보 1, 8, 23, 26개 비교',flush=True)
    m=NumberExport(spine.number_model)
    args=number_inputs(8)
    # Check the wrapper against the original packed-sequence forward too.
    for n in (1,8,23,26):
        v=number_inputs(n)
        with torch.inference_mode():
            original=spine.number_model(v[0],[v[1]],[v[2]],[n]).softmax(1)
            torch.testing.assert_close(m(*v),original,rtol=1e-4,atol=1e-5)
    manifest['models']['number']=write('number',m,args,['image','boxes','geometry'],['probabilities'],
        dynamic_axes={'boxes':{0:'candidates'},'geometry':{0:'candidates'},'probabilities':{0:'candidates'}},
        extra_inputs=tuple(number_inputs(n) for n in (1,23,26)))
    del m,spine,args,x
    print('S1 → ONNX / 수치 비교',flush=True)
    engine=S1Engine(s1,device);ns=engine.predictor.ns
    manifest['s1']={k:to_jsonable(ns[k]) for k in ('CFG','SETTINGS','LC','PC','PRIOR','SELECTION','H','W','stride')}
    manifest['provenance']['s1']=engine.identity
    x=image(1,3,*ns['CFG']['coarse_hw'])
    coarse=S1CoarseExport(ns['coarse_model'])
    manifest['models']['s1_coarse']=write('s1_coarse',coarse,(x,),['image'],['context'])
    with torch.inference_mode():context=coarse(x)
    fine_args=(image(1,4,ns['H'],ns['W']),context,image(1,8))
    manifest['models']['s1_fine']=write('s1_fine',S1FineExport(ns['model_l5']),fine_args,['image','context','position'],['probabilities'])
    del engine,ns,coarse,context,x,fine_args
    print('대퇴골두 → ONNX / 수치 비교',flush=True)
    engine=FemoralEngine(fh,device);ns=engine.ns
    keys=('COARSE_SIZE','FINE_SIZE','CROP_TOP_RATIO','ROI_PROPOSAL_THRESHOLD','ROI_MARGIN','COUNT_CONFIDENCE','MIN_REGION_FRACTION','ALLOW_SINGLE_CENTER_AS_HC')
    manifest['fh']={k:ns[k] for k in keys};manifest['fh']['threshold']=engine.threshold
    manifest['provenance']['fh']=engine.identity
    for stage in ('coarse','fine'):
        name='fh_'+stage;x=image(1,3,ns[stage.upper()+'_SIZE'],ns[stage.upper()+'_SIZE'])
        manifest['models'][name]=write(name,FHExport(ns[stage+'_model'],stage=='fine'),(x,),['image'],['probabilities','count'] if stage=='fine' else ['probabilities'])
    manifest['validation']='pytorch_vs_onnx_cpu_passed; browser_checks_required_on_load'
    # Only a complete, validated conversion gets a manifest accepted by the page.
    (output/'manifest.json').write_text(json.dumps(to_jsonable(manifest),ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print('완료. 브라우저에서 이 폴더를 선택하세요: '+str(output),flush=True)
    return output

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('number','a','s1','fh','output'):p.add_argument('--'+name,required=True)
    p.add_argument('--reuse-a-onnx',default=None)
    export_bundle(**vars(p.parse_args()))
