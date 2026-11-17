"""Developer check with random weights, never a clinical model or performance test."""
import sys,ast,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import torch, numpy as np, segmentation_models_pytorch as smp
from pathlib import Path
from ai_server.runtime import shared_namespace,SPINE_SOURCE,S1_SOURCE
from ai_server.export_browser import export_one,NumberExport,AExport,S1CoarseExport,S1FineExport,FHExport
from torch import nn
torch.set_num_threads(2);torch.manual_seed(41)
import argparse
p=argparse.ArgumentParser();p.add_argument('--output',required=True);out=Path(p.parse_args().output);out.mkdir(parents=True,exist_ok=False)
ns=shared_namespace();ns.update(INPUT_H=128,INPUT_W=64,NUM_CLASSES=23,VITERBI_EPS=1e-8,ROI_CONTEXT_SCALE_X=2.8,ROI_CONTEXT_SCALE_Y=3.8)
exec(SPINE_SOURCE,ns)
m=ns['SharedMobileNetROIClassifier'](geometry_dim=21,pretrained=False)
x=torch.rand(1,3,128,64);g=torch.rand(8,21);b=torch.tensor([[0.,float(i*12),63.,float(i*12+30)] for i in range(8)])
wrapped=NumberExport(m).eval()
with torch.inference_mode():torch.testing.assert_close(wrapped(x,b,g),m.eval()(x,[b],[g],[8]).softmax(1),atol=1e-5,rtol=1e-4)
print('Export number',flush=True)
print(export_one(out,'number',wrapped,(x,b,g),['image','boxes','geometry'],['probabilities'],dynamic_axes={'boxes':{0:'candidates'},'geometry':{0:'candidates'},'probabilities':{0:'candidates'}},extra_inputs=tuple((x,b[:1].repeat(n,1),g[:1].repeat(n,1)) for n in (1,23,26)))['parity'],flush=True)
m=smp.Unet(encoder_name='resnet34',encoder_weights=None,in_channels=7,classes=1)
# Reuse the exact A norm replacement.
seg=dict(ns,smp=smp,torch=torch,nn=nn);exec(ns['SEGMENTATION_INFERENCE_SOURCE'],seg)
seg['replace_bn_relu_with_gn_leaky'](m)
print('Export A TTA',flush=True)
print(export_one(out,'a',AExport(m,[.75,1.,1.25]),(torch.rand(1,7,128,64),),['image'],['probabilities'])['parity'],flush=True)
s={};exec(S1_SOURCE,s);s1={};exec(s['CORE'],s1);s1.update(SETTINGS={'feature_pool_hw':[4,2]})
coarse=s1['EndplateNet'](4).eval();fine=s1['EndplateNet'](2,True).eval();old=fine.encoder.conv1;fine.encoder.conv1=nn.Conv2d(4,old.out_channels,old.kernel_size,old.stride,old.padding,bias=False)
print('Export S1',flush=True)
print(export_one(out,'s1_coarse',S1CoarseExport(coarse),(x,),['image'],['context'])['parity'],flush=True)
print(export_one(out,'s1_fine',S1FineExport(fine),(torch.rand(1,4,128,128),torch.rand(1,4096),torch.rand(1,8)),['image','context','position'],['probabilities'])['parity'],flush=True)
print('Export FH',flush=True)
for stage in ('coarse','fine'):
 m=smp.Unet(encoder_name='resnet34',encoder_weights=None,in_channels=3,classes=1 if stage=='coarse' else 2,aux_params=None if stage=='coarse' else dict(pooling='avg',dropout=.2,activation=None,classes=3))
 print(export_one(out,'fh_'+stage,FHExport(m,stage=='fine'),(torch.rand(1,3,128,128),),['image'],['probabilities','count'] if stage=='fine' else ['probabilities'])['parity'],flush=True)
print('All real architectures exported and passed ONNX CPU parity.',flush=True)
