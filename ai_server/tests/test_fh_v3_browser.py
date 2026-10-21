"""Synthetic operator/adapter tests; no trained checkpoints or GPU required."""
import ast
import asyncio
import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.optimize import least_squares
from skimage import measure
import cv2

ROOT=Path(__file__).resolve().parents[2]
OPS=json.loads((ROOT/'public/ai-web/original_ops.json').read_text())
CFG=dict(COARSE_SIZE=32,FINE_SIZE=32,CROP_TOP_RATIO=.4,ROI_PROPOSAL_THRESHOLD=.2,ROI_MARGIN=1.8,
         COUNT_CONFIDENCE=.6,MIN_REGION_FRACTION=.0005,ALLOW_SINGLE_CENTER_AS_HC=False,
         TTA_FLIP=True,SUPERIMPOSED_DIST_RATIO=.15,EDGE_FIT_EXCLUDE_PX=2.,MIN_ARC_COVERAGE=.6,
         NONCIRCULAR_ERR=.12,threshold=.5,version='v3')

def namespace(code,settings):
    ns=dict(np=np,Image=Image,ndi=ndi,least_squares=least_squares,math=math,measure=measure)
    ns.update(settings);exec(code,ns);return ns

def adapter(version='v3'):
    tree=ast.parse((ROOT/'public/ai-web/pipeline.py').read_text())
    cls=next(x for x in tree.body if isinstance(x,ast.ClassDef) and x.name=='BrowserPipeline')
    ns=dict(np=np,ndi=ndi,cv2=cv2,Path=Path,OPS=OPS,namespace=namespace)
    exec(compile(ast.Module(body=[cls],type_ignores=[]),'pipeline','exec'),ns)
    obj=object.__new__(ns['BrowserPipeline']);obj.meta={'fh':dict(CFG,version=version)}
    obj.fh=namespace(OPS['fh_v3' if version=='v3' else 'fh'],obj.meta['fh'])
    return obj,ns

class FHTests(unittest.TestCase):
    def test_probability_contour_fit_and_superimposed_policy(self):
        s=namespace(OPS['fh_v3'],CFG)
        y,x=np.mgrid[:100,:100];p=(1/(1+np.exp((np.hypot(x-50.3,y-49.7)-20.2)/.7))).astype('float32')
        circles,masks=s['circles_from_slots'](np.stack([p,p]),.5,[10,20,110,120])
        self.assertEqual(len(circles),2)
        np.testing.assert_allclose([circles[0]['cx'],circles[0]['cy'],circles[0]['radius']],[60.3,69.7,20.2],atol=.08)
        result=s['hc_result'](circles,np.array([.01,.01,.98]))
        self.assertTrue(result['superimposed']);self.assertEqual(result['status'],'detected')
        self.assertIsNotNone(result['HC_LAT'])
        self.assertIsNone(s['hc_result'](circles,np.array([.01,.98,.01]))['HC_LAT'])
        one=s['hc_result'](circles[:1],np.array([.01,.98,.01]));self.assertIsNone(one['HC_LAT'])

    def test_flip_slot_alignment_before_resizing_and_count_average(self):
        obj,ns=adapter();calls=[]
        p=np.zeros((1,2,32,32),np.float32);p[:,0,:,3:8]=.9;p[:,1,:,22:29]=.8
        async def infer(stage,**inputs):
            calls.append(inputs['image'])
            if len(calls)==1:return dict(probabilities=p.copy(),count=np.array([[.1,.2,.7]],np.float32))
            return dict(probabilities=p[:,::-1,:,::-1].copy(),count=np.array([[.0,.1,.9]],np.float32))
        ns['infer']=infer
        gray=np.arange(32*32,dtype=np.uint8).reshape(32,32)
        restored,cp=asyncio.run(obj.model_crop('fh_fine',gray,[0,0,32,32],32))
        np.testing.assert_allclose(restored,p[0]);np.testing.assert_allclose(cp,[.05,.15,.8],atol=1e-7)
        np.testing.assert_array_equal(calls[1],calls[0][...,::-1])
        obj.meta['fh']['version']='v2';calls.clear()
        asyncio.run(obj.model_crop('fh_fine',gray,[0,0,32,32],32));self.assertEqual(len(calls),1)

    def test_coarse_full_image_retry_and_double_failure_hc_withholding(self):
        obj,ns=adapter();obj.fh['read_gray']=lambda _:np.zeros((100,60),np.uint8)
        calls=[]
        async def crop(stage,gray,roi,size):
            calls.append((stage,roi))
            h,w=roi[3]-roi[1],roi[2]-roi[0]
            if stage=='fh_fine':return np.zeros((2,h,w)),np.array([1.,0,0])
            p=np.zeros((1,h,w))
            if roi[1]==0:p[0,10:20,20:30]=1
            return p,None
        obj.model_crop=crop
        result,_=asyncio.run(obj.femoral('x.png'))
        self.assertEqual(result['roi_source'],'full_image_retry');self.assertTrue(result['coarse_found'])
        self.assertEqual(calls[0][1],[0,40,60,100]);self.assertEqual(calls[1][1],[0,0,60,100])
        async def empty(stage,gray,roi,size):
            h,w=roi[3]-roi[1],roi[2]-roi[0]
            return np.zeros((2 if stage=='fh_fine' else 1,h,w)),np.array([1.,0,0]) if stage=='fh_fine' else None
        obj.model_crop=empty;result,_=asyncio.run(obj.femoral('x.png'))
        self.assertEqual(result['roi'],[0,40,60,100]);self.assertEqual(result['roi_source'],'fallback_lower_region')
        self.assertIsNone(result['HC_LAT']);self.assertIn('coarse_not_detected_fallback',result['review_reasons'])

    def test_legacy_source_identity_allowed_only_for_v2(self):
        obj,ns=adapter();legacy={k:v for k,v in OPS['source_sha256'].items() if k!='fh_v3_source.py'}
        # Stop immediately after compatibility validation, before unrelated stages initialize.
        for version,hashes,allowed in [('v2',legacy,True),('v3',legacy,False),('v3',OPS['source_sha256'],True),('v2',{},False)]:
            manifest=dict(fh={'version':version},operator_source_sha256=hashes)
            with self.assertRaises(KeyError if allowed else ValueError):ns['BrowserPipeline'](manifest)

class BundleReplacementTests(unittest.TestCase):
    def test_preserved_models_verified_and_copied_without_reexport(self):
        import shutil,time
        from types import SimpleNamespace
        tree=ast.parse((ROOT/'ai_server/export_browser.py').read_text())
        selected=[x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name in ('femoral_settings','replace_femoral_bundle')]
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'old';source.mkdir();dest=Path(tmp)/'new';calls=[]
            sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
            stages=('a','number','s1_coarse','s1_fine','fh_coarse','fh_fine')
            m=dict(schema='spine-browser-bundle-1',validation='pytorch_vs_onnx_cpu_passed; browser_checks_required_on_load',
                   models={},fh={},provenance={},operator_source_sha256={k:v for k,v in OPS['source_sha256'].items() if k!='fh_v3_source.py'})
            for name in stages[:4]:
                d={}
                for suffix,fk,hk,sk in [('.onnx','file','sha256','bytes'),('_check.npz','check_file','check_sha256','check_bytes')]:
                    p=source/(name+suffix);p.write_bytes((name+suffix).encode());d.update({fk:p.name,hk:sha(p),sk:p.stat().st_size})
                m['models'][name]=d
            (source/'manifest.json').write_text(json.dumps(m))
            engine=SimpleNamespace(version='v3',threshold=.5,identity={'version':'v3'},ns=dict(CFG,coarse_model='coarse',fine_model='fine'))
            def export(*args,**kw):calls.append(args[1]);return {'exported':True}
            torch=SimpleNamespace(device=lambda x:x,Generator=lambda:SimpleNamespace(manual_seed=lambda s:s),rand=lambda *a,**k:np.zeros(a[0]))
            ns=dict(Path=Path,json=json,time=time,shutil=shutil,torch=torch,STAGES=stages,FemoralEngine=lambda *a:engine,
                    FHExport=lambda *a:a,export_one=export,file_sha=sha,to_jsonable=lambda x:x,
                    read_json=lambda p:json.loads(p.read_text()),__file__=str(ROOT/'ai_server/export_browser.py'))
            exec(compile(ast.Module(body=selected,type_ignores=[]),'export','exec'),ns)
            fn=ns['replace_femoral_bundle'];fn(source,'fh',dest)
            self.assertEqual(calls,['fh_coarse','fh_fine'])
            new=json.loads((dest/'manifest.json').read_text());self.assertEqual(new['fh']['version'],'v3')
            for p in source.iterdir():
                if p.name!='manifest.json':self.assertEqual(p.read_bytes(),(dest/p.name).read_bytes())
            (source/'a.onnx').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):fn(source,'fh',Path(tmp)/'bad')
            self.assertFalse((Path(tmp)/'bad/manifest.json').exists())

if __name__=='__main__':unittest.main()
