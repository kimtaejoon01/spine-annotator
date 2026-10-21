from pathlib import Path
import os,sys,json,math,time,uuid,re,copy,gc,io,base64,html,hashlib,unicodedata,traceback,zipfile
from datetime import datetime
import numpy as np
import pandas as pd
import cv2,joblib,quickjs
from PIL import Image,ImageDraw,ImageFont,ImageColor
import torch
from torch import nn
from torch.nn import functional as F
from torch.nn.utils.rnn import pad_sequence,pack_padded_sequence,pad_packed_sequence
from torchvision.models import mobilenet_v3_small,MobileNet_V3_Small_Weights,mobilenet_v3_large,MobileNet_V3_Large_Weights
from torchvision.ops import roi_align
import segmentation_models_pytorch as smp
from scipy import ndimage as ndi
from scipy.signal import find_peaks
from scipy.optimize import least_squares
from skimage.segmentation import watershed
from skimage import measure

SOURCE_DIR=Path(__file__).parent/"sources"
SPINE_SOURCE=(SOURCE_DIR/'spine_source.py').read_text(encoding="utf-8")
WATERSHED_SOURCE=(SOURCE_DIR/'watershed_source.py').read_text(encoding="utf-8")
CORNER_SOURCE=(SOURCE_DIR/'corner_source.py').read_text(encoding="utf-8")
FH_SOURCE=(SOURCE_DIR/'fh_source.py').read_text(encoding="utf-8")
FH_V3_SOURCE=(SOURCE_DIR/'fh_v3_source.py').read_text(encoding="utf-8")
S1_SOURCE=(SOURCE_DIR/'s1_source.py').read_text(encoding="utf-8")

# Inference adapters. All model namespaces are isolated to preserve preprocessing/settings.
def normalize_path(path):
    p=Path(path).expanduser()
    if p.exists():return p
    p=p.absolute();out=Path(p.anchor)
    for part in p.parts[1:]:
        q=out/part
        if q.exists():out=q;continue
        found=[x for x in out.iterdir() if unicodedata.normalize('NFC',x.name)==unicodedata.normalize('NFC',part)] if out.is_dir() else []
        if len(found)!=1:raise FileNotFoundError(str(p))
        out=found[0]
    return out

def read_json(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def file_sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(4*1024*1024),b''):h.update(block)
    return h.hexdigest()
def to_jsonable(obj):
    if isinstance(obj,dict):return {str(k):to_jsonable(v) for k,v in obj.items()}
    if isinstance(obj,(list,tuple)):return [to_jsonable(v) for v in obj]
    if isinstance(obj,np.ndarray):return to_jsonable(obj.tolist())
    if isinstance(obj,np.generic):return to_jsonable(obj.item())
    if isinstance(obj,Path):return str(obj)
    if isinstance(obj,float) and not math.isfinite(obj):return None
    return obj

def shared_namespace():
    return dict(np=np,pd=pd,cv2=cv2,math=math,torch=torch,nn=nn,F=F,Image=Image,Path=Path,
        joblib=joblib,json=json,ndi=ndi,find_peaks=find_peaks,watershed=watershed,
        pad_sequence=pad_sequence,pack_padded_sequence=pack_padded_sequence,pad_packed_sequence=pad_packed_sequence,
        mobilenet_v3_small=mobilenet_v3_small,MobileNet_V3_Small_Weights=MobileNet_V3_Small_Weights,
        mobilenet_v3_large=mobilenet_v3_large,MobileNet_V3_Large_Weights=MobileNet_V3_Large_Weights,
        roi_align=roi_align)

class SpineEngine:
    def __init__(self,number_run,a_run,device):
        self.number_run=normalize_path(number_run);self.a_run=normalize_path(a_run)
        cfg=read_json(self.number_run/'shared_mobilenet_roi_config.json')
        acfg=read_json(self.a_run/'config.json')
        if acfg.get('abc_variant')!='A' or acfg.get('task')!='binary':raise ValueError('A binary 분할 모델 폴더가 필요합니다.')
        checkpoints=list((self.a_run/'checkpoints').glob('*_best.pth'))
        if len(checkpoints)!=1:raise ValueError(f'A best checkpoint가 하나여야 합니다: {checkpoints}')
        self.a_checkpoint=checkpoints[0]
        ns=shared_namespace();ns.update(DEVICE=device,USE_AMP=device.type=='cuda',USE_SEQUENCE_CONTEXT_FEATURES=False,
            VITERBI_EPS=1e-8,LEVELS=cfg['levels'],NUM_CLASSES=len(cfg['levels']),FEATURE_NAMES=cfg['feature_names'],
            INDEX_TO_LEVEL={i:v for i,v in enumerate(cfg['levels'])},best_viterbi_penalty=float(cfg['best_viterbi_penalty']),
            IMAGENET_MEAN=np.asarray([.485,.456,.406],np.float32),IMAGENET_STD=np.asarray([.229,.224,.225],np.float32))
        if ns['NUM_CLASSES']!=23:raise ValueError('C2–L5 23개 번호 모델이 필요합니다.')
        for key in ('input_h','input_w','roi_context_scale_x','roi_context_scale_y','roi_output_size'):ns[key.upper()]=cfg[key]
        exec(SPINE_SOURCE,ns)
        ck_path=self.number_run/'shared_mobilenet_roi_best.pt'
        ck=torch.load(ck_path,map_location='cpu',weights_only=False)
        for key in ('levels','feature_names','backbone_name','input_h','input_w','roi_context_scale_x','roi_context_scale_y',
                    'roi_output_size','visual_dim','geom_hidden','fusion_dim','dropout','use_bigru','gru_hidden','gru_layers','best_viterbi_penalty'):
            if key in ck and ck[key]!=cfg[key]:raise ValueError(f'번호 config/checkpoint 불일치: {key}')
        ns['scaler']=joblib.load(self.number_run/'geometry_scaler.joblib')
        if ns['scaler'].n_features_in_!=len(cfg['feature_names']):raise ValueError('geometry scaler 차원 불일치')
        kwargs={k:cfg[k] for k in ('backbone_name','roi_output_size','visual_dim','geom_hidden','fusion_dim','dropout','use_bigru','gru_hidden','gru_layers')}
        model=ns['SharedMobileNetROIClassifier'](geometry_dim=len(cfg['feature_names']),num_classes=23,pretrained=False,**kwargs)
        model.load_state_dict(ck['model_state'],strict=True);self.number_model=model.to(device).eval()
        del ck
        seg=dict(np=np,torch=torch,nn=nn,F=F,cv2=cv2,Image=Image,smp=smp,Path=Path)
        seg.update({k:acfg[v] for k,v in ns['SEG_KEY_MAP'].items()})
        seg.update(ENCODER_WEIGHTS=None,MAX_DYNAMIC_PATCHES=6,USE_AMP=device.type=='cuda',DEVICE=str(device),
            IMAGENET_MEAN=np.array([.485,.456,.406],np.float32),IMAGENET_STD=np.array([.229,.224,.225],np.float32))
        exec(ns['SEGMENTATION_INFERENCE_SOURCE'],seg)
        def image_only(row):
            image=seg['read_gray'](row['image_path']).astype(np.uint8)
            return image,np.zeros_like(image)
        seg['load_full_pair']=image_only
        seg_model,_,_=seg['build_variant_model']('A')
        ck=torch.load(self.a_checkpoint,map_location='cpu',weights_only=False)
        if acfg['v7_use_ema'] and ck.get('ema_state_dict'):
            ema=ck['ema_state_dict'];state={**ema.get('shadow',{}),**ema.get('non_float',{})};weight_source='ema'
        else:state=ck['model_state_dict'];weight_source='raw'
        seg_model.load_state_dict(state,strict=True);self.seg_model=seg_model.to(device).eval()
        del ck,state
        self.ns=ns;self.seg=seg
        ns.update(FRAGMENT_AREA_RATIO=.05,WS_MIN_CHILD_RATIO=.15,WS_PEAK_DISTANCE_RATIO=.5,
            WS_PEAK_HEIGHT_RATIO=.25,WS_PROMINENCE_RATIO=.15,WS_VALLEY_RATIO=.75)
        exec(WATERSHED_SOURCE,ns)
        self.identity=dict(number_run=str(self.number_run),number_checkpoint_sha256=file_sha(ck_path),
            number_config_sha256=file_sha(self.number_run/'shared_mobilenet_roi_config.json'),
            a_run=str(self.a_run),a_checkpoint_sha256=file_sha(self.a_checkpoint),a_weights=weight_source,
            watershed=dict(fragment_area_ratio=.05,min_child_ratio=.15,peak_distance_ratio=.5,peak_height_ratio=.25,
                           prominence_ratio=.15,valley_ratio=.75))
        self.notes=[]
        provenance_path=self.number_run/'comparison_provenance.json'
        if provenance_path.is_file():
            provenance=read_json(provenance_path)
            if provenance.get('checkpoint_sha256') and provenance['checkpoint_sha256']!=self.identity['a_checkpoint_sha256']:
                self.notes.append('선택한 A 모델은 번호 모델 학습 실험에 기록된 A 모델과 다릅니다.')

    def segment(self,path):
        with torch.inference_mode():result=self.seg['predict_full_image'](self.seg_model,{'image_path':str(path)})
        mask=(result['pred']>0).astype(np.uint8)
        polys=self.ns['extract_watershed_polygons'](mask)
        return mask,polys

    def number(self,path,polys):
        with torch.inference_mode():rows=self.ns['predict_levels_from_polygons'](self.number_model,path,polys,view='LAT')
        if {int(r['input_index']) for r in rows}!=set(range(len(polys))) or len(rows)!=len(polys):
            raise ValueError('번호 모델이 윤곽 후보를 누락했습니다.')
        use_vit=bool(polys) and len(polys)<=23 and all(r.get('viterbi_level') is not None for r in rows)
        decoder='viterbi' if use_vit else 'raw'
        reason=None if use_vit else 'no_candidates' if not polys else 'candidate_count_exceeds_23' if len(polys)>23 else 'viterbi_unavailable'
        for row in rows:
            row.update(final_level=row[decoder+'_level'],final_confidence=row.get(decoder+'_confidence'),final_decoder=decoder)
        return rows,decoder,reason

class FemoralEngine:
    def __init__(self,run,device):
        self.run=normalize_path(run);cfg=read_json(self.run/'config.json')
        self.version=cfg.get('version','v2')
        if self.version not in ('v2','v3'):raise ValueError('지원하지 않는 FH 버전: '+str(self.version))
        ns=dict(np=np,torch=torch,nn=nn,F=F,smp=smp,Image=Image,Path=Path,math=math,ndi=ndi,measure=measure,least_squares=least_squares,
                DEVICE=device,COARSE_SIZE=int(cfg['coarse_size']),FINE_SIZE=int(cfg['fine_size']))
        defaults=dict(CROP_TOP_RATIO=.40,ROI_PROPOSAL_THRESHOLD=.20,ROI_MARGIN=1.8,COUNT_CONFIDENCE=.60,
                      MIN_REGION_FRACTION=.0005,ALLOW_SINGLE_CENTER_AS_HC=False)
        if self.version=='v3':defaults.update(TTA_FLIP=True,SUPERIMPOSED_DIST_RATIO=.15,EDGE_FIT_EXCLUDE_PX=2.,MIN_ARC_COVERAGE=.60,NONCIRCULAR_ERR=.12)
        ns.update({k:cfg.get(k,v) for k,v in defaults.items()})
        exec(FH_V3_SOURCE if self.version=='v3' else FH_SOURCE,ns)
        for stage in ('coarse','fine'):
            model=ns['build'](stage,weights=None)
            ck=torch.load(self.run/(stage+'_best.pt'),map_location='cpu',weights_only=False)
            if ck.get('stage') and ck['stage']!=stage:raise ValueError(f'FH {stage} checkpoint 단계 불일치')
            model.load_state_dict(ck['model_state_dict'],strict=True);ns[stage+'_model']=model.eval()
        self.threshold=float(read_json(self.run/'selected_threshold.json')['threshold'])
        if not 0<self.threshold<1:raise ValueError('FH threshold 설정 오류')
        self.ns=ns
        self.identity=dict(run=str(self.run),version=self.version,threshold=self.threshold,
            coarse_sha256=file_sha(self.run/'coarse_best.pt'),fine_sha256=file_sha(self.run/'fine_best.pt'))

    def predict(self,path):
        with torch.inference_mode():result=self.ns['predict_image'](path,self.threshold)
        # Keep existing HC withholding; a failed coarse stage must be visible even if HC was already absent.
        if result['payload']['review_reasons']:result['payload']['status']='review_required'
        return result

class CornerEngine:
    def __init__(self):
        ns=dict(quickjs=quickjs,json=json);exec(CORNER_SOURCE,ns)
        self.ns=ns
        self.identity=dict(commit='b3e7e043f3dc8bd4383bf480edd52a2cd3d54c2f',sha256=hashlib.sha256(ns['ANNOTATOR_JS'].encode()).hexdigest())

    def predict(self,polys,numbering,width,anterior_right):
        by_id={int(r['input_index']):r for r in numbering};candidates=[]
        for i,p in enumerate(polys):
            points=np.asarray(p['points'],float).reshape(-1,2).copy()
            if len(points)<3 or not np.isfinite(points).all():continue
            if not anterior_right:points[:,0]=width-1-points[:,0]
            candidates.append(dict(candidate_index=i,label=by_id[i]['final_level'],points=points.tolist()))
        out=json.loads(self.ns['js_corner_compare'](json.dumps(dict(candidates=candidates,validate=True))))
        if not anterior_right:
            for row in out:
                for method in ('v1','v2'):
                    fit=row[method]
                    for k in ('SA','SP','IA','IP'):
                        if fit.get(k) is not None:fit[k][0]=width-1-fit[k][0]
                    for k in ('supVec','infVec'):
                        if fit.get(k) is not None:fit[k][0]*=-1
                    for k in ('supPts','infPts'):
                        for pt in fit.get(k,[]):pt[0]=width-1-pt[0]
        return out

class S1Engine:
    def __init__(self,bundle,device):
        from .s1_pair import PairSelectionPredictor, resolve_s1_folder
        folder=resolve_s1_folder(normalize_path(bundle))
        ns={};exec(S1_SOURCE,ns)
        if (folder/'selection.json').is_file():
            self.predictor=PairSelectionPredictor(folder,ns['CORE'],device)
            self.identity=self.predictor.identity
        else:
            self.predictor=ns['S1Predictor'](folder,device=str(device))
            self.identity=dict(bundle=str(folder),bundle_sha256=file_sha(folder/'bundle.json'),
                weights_sha256=file_sha(folder/'weights.pt'),settings=read_json(folder/'bundle.json'))
    def predict(self,path,l5):
        with torch.inference_mode():return self.predictor.predict(str(path),np.asarray(l5,float).reshape(-1,2))

class IntegratedPipeline:
    def __init__(self,spine,s1,femoral,corners):
        self.spine=spine;self.s1=s1;self.femoral=femoral;self.corners=corners

    def predict(self,path,anterior_right=True,progress=lambda value,text:None):
        path=Path(path);t=time.perf_counter()
        with Image.open(path) as im:
            if getattr(im,'n_frames',1)!=1:raise ValueError('단일 영상만 지원합니다. 다중 페이지 TIFF는 한 장씩 저장하세요.')
            width,height=im.size
        result=dict(schema_version='spine-unified-ui-1',image=dict(filename=path.name,width=width,height=height,
            sha256=file_sha(path),orientation='original_array_no_exif_rotation'),anterior_right=bool(anterior_right),
            status='processing',errors=[],review_reasons=list(getattr(self.spine,'notes',[])),timings={})
        progress(10,'척추체 분할 및 watershed')
        mask,polys=self.spine.segment(path)
        if mask.shape!=(height,width):raise ValueError('A 마스크와 원본 영상 좌표 크기가 다릅니다.')
        result['timings']['segmentation_seconds']=time.perf_counter()-t;t1=time.perf_counter()
        progress(35,'척추 번호 예측')
        numbering,decoder,reason=self.spine.number(path,polys)
        result['spine']=dict(polygons=to_jsonable(polys),numbering=numbering,decoder=decoder,fallback_reason=reason)
        if reason:result['review_reasons'].append('번호 보정: '+reason)
        labels=[r['final_level'] for r in numbering]
        duplicates=sorted({label for label in labels if labels.count(label)>1})
        if duplicates:result['review_reasons'].append('중복 번호: '+', '.join(duplicates))
        result['timings']['numbering_seconds']=time.perf_counter()-t1;t1=time.perf_counter()
        progress(50,'척추체 v1/v2 꼭지점')
        try:result['spine']['corners']=self.corners.predict(polys,numbering,width,anterior_right)
        except Exception as e:
            result['spine']['corners']=[];result['errors'].append(dict(stage='corners',message=str(e)))
        result['timings']['corners_seconds']=time.perf_counter()-t1;t1=time.perf_counter()
        progress(62,'S1 상종판')
        self.run_s1(result,path,None)
        result['timings']['s1_seconds']=time.perf_counter()-t1;t1=time.perf_counter()
        progress(78,'대퇴골두 분할 및 중심')
        fh_masks=None
        try:
            fh=self.femoral.predict(path)
            if fh['gray'].shape!=(height,width):raise ValueError('FH 영상과 원본 크기가 다릅니다.')
            result['femoral']=to_jsonable(fh['payload']);fh_masks=fh['masks'].astype(np.uint8)
            x0,y0,x1,y1=result['femoral']['roi']
            if fh_masks.shape!=(2,y1-y0,x1-x0):raise ValueError('FH crop/mask 크기 불일치')
            # True segmentation contours, separately from fitted circles.
            contour_list=[]
            for slot,slot_mask in enumerate(fh_masks):
                cs,_=cv2.findContours(slot_mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
                for c in cs:
                    if len(c)>=3:contour_list.append(dict(slot=slot,points=(c.reshape(-1,2)+[x0,y0]).tolist()))
            result['femoral']['segmentation_contours']=contour_list
        except Exception as e:
            result['femoral']=dict(status='failed',instances=[],HC_LAT=None,review_reasons=['추론 실패'],segmentation_contours=[])
            result['errors'].append(dict(stage='femoral',message=str(e)));fh_masks=None
        result['timings']['femoral_seconds']=time.perf_counter()-t1
        result['timings']['total_seconds']=time.perf_counter()-t
        self.refresh_status(result);progress(95,'결과 정리')
        return result,mask,fh_masks

    def run_s1(self,result,path,l5_index=None):
        rows=result['spine']['numbering'];polys=result['spine']['polygons']
        result['errors']=[x for x in result['errors'] if x['stage']!='s1']
        choices=[int(r['input_index']) for r in rows if r['final_level']=='L5']
        manual=l5_index is not None
        if not manual:
            if len(choices)!=1:
                result['s1']=dict(status='needs_l5_selection',points=None,l5_candidates=choices,
                    reason='L5가 없습니다.' if not choices else 'L5 후보가 여러 개입니다.')
                self.refresh_status(result);return
            l5_index=choices[0]
        if not 0<=int(l5_index)<len(polys):raise ValueError('유효하지 않은 L5 후보 선택')
        try:
            pred=self.s1.predict(path,polys[int(l5_index)]['points'])
            points=np.asarray(pred['points'],float)
            if points.shape!=(2,2) or not np.isfinite(points).all():raise ValueError('유효하지 않은 S1 끝점')
            w,h=result['image']['width'],result['image']['height']
            in_bounds=bool((points>=0).all() and (points[:,0]<w).all() and (points[:,1]<h).all())
            result['s1']=dict(**pred,status='predicted' if in_bounds else 'review_required',
                l5_candidate_index=int(l5_index),l5_source='user_selected_prediction' if manual else 'unique_predicted_L5',
                in_bounds=in_bounds)
        except Exception as e:
            result['s1']=dict(status='failed',points=None,l5_candidate_index=int(l5_index))
            result['errors'].append(dict(stage='s1',message=str(e)))
        self.refresh_status(result)

    def refresh_status(self,result):
        pending=(result.get('s1',{}).get('status') not in ('predicted',None)
                 or result.get('femoral',{}).get('status') in ('review_required','failed'))
        corner_review=any(r.get(m,{}).get('quality')=='review' for r in result.get('spine',{}).get('corners',[]) for m in ('v1','v2'))
        result['status']='partial' if result['errors'] else 'review_required' if pending or corner_review or result['review_reasons'] else 'complete'

COLORS = {'spine':'#48e0c6','v1':'#64b5ff','v2':'#bc9cff','s1':'#ffd34d','fh0':'#ff77b7','fh1':'#ff9d61','hc':'#ffffff'}
DEFAULT_LAYERS = dict(spine=True,number=True,corners=True,s1=True,fh_mask=True,fh_circle=True,hc=True)

def display_base(path,max_side=2000):
    # Display normalization only; model-specific preprocessing stays inside each adapter.
    with Image.open(path) as im:
        a=np.asarray(im.convert('L') if im.mode in ('RGB','RGBA','P','CMYK') else im)
    if a.ndim!=2:raise ValueError('2차원 X-ray 영상이 필요합니다.')
    if a.dtype!=np.uint8:
        lo,hi=np.percentile(a,[.5,99.5]);a=np.clip((a.astype(float)-lo)/max(hi-lo,1e-8)*255,0,255).astype(np.uint8)
    im=Image.fromarray(a).convert('RGB')
    if max_side and max(im.size)>max_side:im.thumbnail((max_side,max_side),Image.Resampling.LANCZOS)
    return im

def png_bytes(im):
    stream=io.BytesIO();im.save(stream,format='PNG');return stream.getvalue()

def overlay_image(path,result,layers=None,method='v2',opacity=.20,max_side=2000,base=None):
    layers=DEFAULT_LAYERS if layers is None else layers
    im=(base.copy() if base is not None else display_base(path,max_side)).convert('RGBA')
    w,h=result['image']['width'],result['image']['height'];sx,sy=im.width/w,im.height/h
    def pts(p):return [(float(x)*sx,float(y)*sy) for x,y in np.asarray(p).reshape(-1,2)]
    lw=max(1,round(im.width/330));radius=max(2,round(im.width/200));fs=max(11,round(im.width/42))
    try:font=ImageFont.truetype('DejaVuSans.ttf',fs)
    except OSError:font=ImageFont.load_default()
    fill=Image.new('RGBA',im.size);d=ImageDraw.Draw(fill)
    if layers.get('fh_mask'):
        for c in result.get('femoral',{}).get('segmentation_contours',[]):
            color=ImageColor.getrgb(COLORS['fh'+str(c['slot'])]);d.polygon(pts(c['points']),fill=color+(round(opacity*255),))
    im=Image.alpha_composite(im,fill);d=ImageDraw.Draw(im)
    def line(p,c,closed=False):
        p=pts(p)
        if len(p)>=2:d.line(p+([p[0]] if closed else []),fill=c,width=lw,joint='curve')
    def dot(p,c):
        x,y=pts([p])[0];d.ellipse((x-radius,y-radius,x+radius,y+radius),fill=c,outline='black',width=1)
    def tag(p,text,c):
        x,y=pts([p])[0];box=d.textbbox((0,0),text,font=font);tw,th=box[2],box[3]-box[1]
        x=max(0,min(x,im.width-tw-6));y=max(0,min(y,im.height-th-6))
        d.rectangle((x,y,x+tw+6,y+th+6),fill=(10,15,23,235));d.text((x+3,y+3-box[1]),text,font=font,fill=c)
    spine=result.get('spine',{});by_id={int(r['input_index']):r for r in spine.get('numbering',[])}
    for i,p in enumerate(spine.get('polygons',[])):
        pp=np.asarray(p['points'])
        if layers.get('spine'):line(pp,COLORS['spine'],True)
        if layers.get('number'):
            row=by_id.get(i,{});label=row.get('final_level','?')
            tag([pp[:,0].max()+5,pp[:,1].mean()],f'{i+1}: {label}',COLORS['spine'])
    if layers.get('corners'):
        for r in spine.get('corners',[]):
            c=r.get(method,{})
            for a,b in [('SA','SP'),('IA','IP')]:
                if c.get(a) is not None and c.get(b) is not None:line([c[a],c[b]],COLORS[method])
            for key in ('SA','SP','IA','IP'):
                if c.get(key) is not None:dot(c[key],COLORS[method])
    s1=result.get('s1',{})
    if layers.get('s1') and s1.get('points') is not None:
        line(s1['points'],COLORS['s1'])
        for p in s1['points']:dot(p,COLORS['s1'])
        tag(np.asarray(s1['points']).mean(0)+[10,10],'S1',COLORS['s1'])
    fh=result.get('femoral',{})
    if layers.get('fh_mask'):
        for c in fh.get('segmentation_contours',[]):line(c['points'],COLORS['fh'+str(c['slot'])],True)
    if layers.get('fh_circle'):
        for c in fh.get('instances',[]):
            x,y,r=c['cx'],c['cy'],c['radius'];color=COLORS['fh'+str(c['slot'])]
            d.ellipse(((x-r)*sx,(y-r)*sy,(x+r)*sx,(y+r)*sy),outline=color,width=lw)
            dot([x,y],color);tag([x+r,y],f'FH{c["slot"]+1}',color)
    if layers.get('hc') and fh.get('HC_LAT') is not None:
        p=fh['HC_LAT'];x,y=p['x'],p['y'];line([[x-10,y],[x+10,y]],'white');line([[x,y-10],[x,y+10]],'white');tag([x+10,y+10],'HC','white')
    return im.convert('RGB')

def result_tables(result):
    number=[];corner=[]
    for row in result['spine']['numbering']:
        number.append({'후보':int(row['input_index'])+1,'번호':row['final_level'],'decoder':row['final_decoder'],
            '모델 점수':row.get('final_confidence'),'raw 번호':row.get('raw_level'),'raw 점수':row.get('raw_confidence')})
    for r in result['spine'].get('corners',[]):
        for method in ('v1','v2'):
            fit=r.get(method,{})
            for key in ('SA','SP','IA','IP'):
                p=fit.get(key)
                if p is not None:corner.append({'후보':r['candidate_index']+1,'번호':r['label'],'방법':method,'점':key,
                    'x':p[0],'y':p[1],'quality':fit.get('quality',''),'validation':r.get('validation','')})
    s1=[]
    if result.get('s1',{}).get('points') is not None:
        s1=[dict(point='S1_'+str(i+1),x=p[0],y=p[1]) for i,p in enumerate(result['s1']['points'])]
    fh=[dict(head='FH'+str(c['slot']+1),**c) for c in result.get('femoral',{}).get('instances',[])]
    return dict(numbering=pd.DataFrame(number),corners=pd.DataFrame(corner),s1=pd.DataFrame(s1),femoral=pd.DataFrame(fh))

def export_result(path,result,spine_mask,fh_masks,output_root,models,layers=None,method='v2',opacity=.20):
    root=Path(output_root);root.mkdir(parents=True,exist_ok=True)
    stem=re.sub(r'[^\w.-]+','_',Path(path).stem)[:80] or 'xray'
    folder=root/(datetime.now().strftime('%Y%m%d_%H%M%S')+'_'+stem+'_'+uuid.uuid4().hex[:8]);folder.mkdir(exist_ok=False)
    payload=to_jsonable(copy.deepcopy(result));payload['models']=to_jsonable(models)
    payload['display']=dict(layers=layers or DEFAULT_LAYERS,corner_method=method,mask_opacity=opacity)
    payload['coordinate_system']='original image pixels; origin top-left; x right; y down'
    (folder/'results.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    overlay_image(path,result,layers,method,opacity,max_side=None).save(folder/'overlay.png')
    Image.fromarray((np.asarray(spine_mask)>0).astype(np.uint8)*255).save(folder/'spine_A_binary.png')
    h,w=spine_mask.shape;instances=np.zeros((h,w),np.uint16)
    for i,p in enumerate(result['spine']['polygons']):
        cv2.fillPoly(instances,[np.rint(p['points']).astype(np.int32)],i+1)
    Image.fromarray(instances).save(folder/'spine_watershed_instances.png')
    if fh_masks is not None:
        x0,y0,x1,y1=result['femoral']['roi']
        for slot in range(2):
            full=np.zeros((h,w),np.uint8);full[y0:y1,x0:x1]=fh_masks[slot]*255
            Image.fromarray(full).save(folder/f'femoral_head_{slot+1}_mask.png')
    tables=result_tables(result)
    with pd.ExcelWriter(folder/'coordinates.xlsx',engine='openpyxl') as writer:
        for name,table in tables.items():table.to_excel(writer,sheet_name=name,index=False)
    for name,table in tables.items():table.to_csv(folder/(name+'.csv'),index=False,encoding='utf-8-sig')
    (folder/'README.txt').write_text(
        '원본 영상 좌표: 좌상단 (0,0), x 오른쪽, y 아래쪽.\n'
        'spine_A_binary.png: A 모델 이진 마스크. spine_watershed_instances.png: 파편 제거/watershed 후보, 픽셀값=후보번호(1부터).\n'
        'FH1/FH2는 독립 출력 슬롯이며 좌/우 해부학적 구분이 아닙니다. 마스크와 피팅 원을 별도로 저장합니다.\n'
        'results.json에 raw/최종 번호, v1/v2 꼭지점, S1 끝점, 골두 원/HC, 검토 사유와 모델 식별정보가 있습니다.\n'
        '번호 모델 점수는 보정된 정답 확률이 아닙니다. 정답 라벨 없는 추론이므로 정확도/Dice는 계산하지 않습니다.\n'
        'S1 입력은 예측 L5이며, 원래 S1 노트북의 GT L5 평가와 조건이 다릅니다.\n',encoding='utf-8')
    archive=Path(str(folder)+'.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.iterdir()):z.write(f,f.name)
    return folder,archive
