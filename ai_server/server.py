"""Authenticated single-worker inference service; the same app serves the upload UI."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import copy,hashlib,json,os,secrets,shutil,threading,time,uuid
from fastapi import FastAPI,UploadFile,File,Form,Header,HTTPException,Depends
from fastapi.responses import FileResponse,RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel,Field
from PIL import Image

REPO=Path(__file__).resolve().parent.parent
DEFAULT_ROOTS={
 'number':'/content/drive/MyDrive/spine_A_seed41_newdata_numbering',
 'a':'/content/drive/MyDrive/1. PSB AI /zone3 관련/파인튜닝/결과/ABC_norm_compare_Agn_BCin_unet_resnet34_binary_bs2_seed41_v8',
 's1':'/content/drive/MyDrive/1. PSB AI /zone3 관련/파인튜닝/결과/S1_통합학습',
 'fh':'/content/drive/MyDrive/1. PSB AI /zone3 관련/파인튜닝/FH_LAT_v2'}
Image.MAX_IMAGE_PIXELS=64_000_000

class ModelPaths(BaseModel):
    number:str
    a:str
    s1:str
    fh:str
    device:str='auto'

class S1Choice(BaseModel):
    candidate_index:int=Field(ge=0)

class ExportOptions(BaseModel):
    method:str='v2'
    layers:dict[str,bool]|None=None

class Manager:
    def __init__(self,root,runtime_loader=None):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.config_path=self.root/'models.json';self.pipeline=None;self.identities={};self.runtime=None
        self.jobs={};self.guard=threading.RLock();self.pool=ThreadPoolExecutor(max_workers=1)
        self.runtime_loader=runtime_loader

    def config(self):
        return json.loads(self.config_path.read_text()) if self.config_path.exists() else dict(paths={},roots=DEFAULT_ROOTS)

    def submit(self,kind,action,job_id=None):
        with self.guard:
            if any(j['state'] in ('queued','running') for j in self.jobs.values()):raise HTTPException(409,'다른 분석이 진행 중입니다. 완료 후 다시 실행하세요.')
            if job_id is None:
                job_id=uuid.uuid4().hex
                # Only completed sessions are evicted; model files and exports chosen by users are untouched.
                while len(self.jobs)>=10:
                    old=next(iter(self.jobs));self.jobs.pop(old);shutil.rmtree(self.root/'sessions'/old,ignore_errors=True)
                self.jobs[job_id]=dict(id=job_id,kind=kind,state='queued',progress=0,message='대기 중')
            else:self.jobs[job_id].update(state='queued',progress=0,message='S1 재계산 중')
            def run():
                with self.guard:self.jobs[job_id]['state']='running'
                def progress(n,text):
                    with self.guard:self.jobs[job_id].update(progress=n,message=text)
                try:
                    action(job_id,progress)
                    with self.guard:self.jobs[job_id].update(state='done',progress=100,message='완료')
                except Exception as e:
                    with self.guard:self.jobs[job_id].update(state='failed',message=str(e))
            self.pool.submit(run)
            return dict(id=job_id)

    def job(self,job_id):
        with self.guard:
            if job_id not in self.jobs:raise HTTPException(404,'분석 세션이 없거나 만료되었습니다.')
            return self.jobs[job_id]

    def public_job(self,job_id):
        with self.guard:return copy.deepcopy({k:v for k,v in self.job(job_id).items() if not k.startswith('_')})

    def load(self,paths,progress):
        progress(5,'추론 라이브러리 준비')
        if self.runtime_loader:self.runtime=self.runtime_loader()
        else:
            from . import runtime
            self.runtime=runtime
        rt=self.runtime;torch=rt.torch
        if paths.device not in ('auto','cuda','cpu'):raise ValueError('device는 auto/cuda/cpu 중 하나여야 합니다.')
        device=torch.device(('cuda' if torch.cuda.is_available() else 'cpu') if paths.device=='auto' else paths.device)
        self.pipeline=None
        import gc
        gc.collect()
        if torch.cuda.is_available():torch.cuda.empty_cache()
        progress(15,'A 분할 + 척추 번호 모델 준비');sp=rt.SpineEngine(paths.number,paths.a,device)
        progress(55,'S1 종판 모델 준비');s1=rt.S1Engine(paths.s1,device)
        progress(75,'대퇴골두 모델 준비');fh=rt.FemoralEngine(paths.fh,device);corners=rt.CornerEngine()
        self.pipeline=rt.IntegratedPipeline(sp,s1,fh,corners)
        self.identities=dict(spine=sp.identity,s1=s1.identity,femoral=fh.identity,corners=corners.identity,device=str(device))
        cfg=self.config();cfg['paths']=paths.model_dump();tmp=self.config_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(self.config_path)

    def analyze(self,job_id,progress,source,anterior_right):
        folder=self.root/'sessions'/job_id;folder.mkdir(parents=True,exist_ok=True)
        path=folder/source.name;shutil.move(str(source),path)
        result,mask,fh=self.pipeline.predict(path,anterior_right,progress)
        self.runtime.display_base(path,max_side=2000).save(folder/'preview.png')
        with self.guard:self.jobs[job_id].update(result=self.runtime.to_jsonable(result),_path=path,_mask=mask,_fh=fh,_models=copy.deepcopy(self.identities))

    def shutdown(self):self.pool.shutdown(wait=True)

def create_app(root=None,token=None,runtime_loader=None):
    root=Path(root or os.environ.get('SPINE_AI_DATA',Path.home()/'.spine-annotator-ai'))
    manager=Manager(root,runtime_loader)
    token=token or os.environ.get('SPINE_AI_TOKEN')
    if not token:
        key=root/'connection.key'
        if not key.exists():
            fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(32))
        token=key.read_text().strip()
    @asynccontextmanager
    async def lifespan(app):
        yield
        manager.shutdown()
    app=FastAPI(title='Spine Annotator AI',lifespan=lifespan);app.state.manager=manager;app.state.connection_token=token
    def auth(authorization:str|None=Header(default=None)):
        if not authorization or not secrets.compare_digest(authorization,'Bearer '+token):raise HTTPException(401,'연결 코드를 입력해 주세요.')
    protected=[Depends(auth)]

    @app.get('/api/health',dependencies=protected)
    def health():return dict(ready=manager.pipeline is not None,models=manager.identities,version=1)

    @app.get('/api/models',dependencies=protected)
    def models():
        cfg=manager.config();found={k:[] for k in DEFAULT_ROOTS}
        markers={'number':'shared_mobilenet_roi_config.json','a':'config.json','s1':'bundle.json','fh':'selected_threshold.json'}
        for key,base in cfg.get('roots',DEFAULT_ROOTS).items():
            rootpath=Path(base)
            if not rootpath.is_dir():continue
            for p in rootpath.rglob(markers[key]):
                if key=='a':
                    try:
                        c=json.loads(p.read_text())
                        if c.get('abc_variant')!='A' or c.get('task')!='binary':continue
                    except (OSError,ValueError):continue
                found[key].append(str(p.parent))
        return dict(paths=cfg.get('paths',{}),found=found)

    @app.post('/api/models/load',dependencies=protected)
    def load_models(paths:ModelPaths):
        if not all(getattr(paths,k).strip() for k in DEFAULT_ROOTS):raise HTTPException(400,'모델 폴더 네 개를 지정해 주세요.')
        return manager.submit('load',lambda _id,progress:manager.load(paths,progress))

    @app.post('/api/predict',dependencies=protected)
    async def predict(image:UploadFile=File(...),anterior_right:bool=Form(False)):
        if manager.pipeline is None:raise HTTPException(409,'먼저 모델을 불러오세요.')
        name=Path((image.filename or 'xray.png').replace('\\','/')).name
        if Path(name).suffix.lower() not in {'.png','.jpg','.jpeg','.tif','.tiff','.bmp'}:raise HTTPException(400,'PNG/JPEG/TIFF/BMP 영상이 필요합니다.')
        temp=root/'incoming'/uuid.uuid4().hex;temp.mkdir(parents=True);path=temp/name
        try:
            count=0
            with path.open('wb') as f:
                while data:=await image.read(1024*1024):
                    count+=len(data)
                    if count>32*1024*1024:raise HTTPException(413,'영상은 32 MB 이하로 업로드하세요.')
                    f.write(data)
            with Image.open(path) as im:
                if getattr(im,'n_frames',1)!=1 or im.width*im.height>64_000_000:raise HTTPException(400,'단일 영상, 6400만 픽셀 이하만 지원합니다.')
                im.verify()
            # Retain bytes in a separate location before the incoming folder is cleaned.
            staging=root/'pending'/uuid.uuid4().hex;staging.mkdir(parents=True)
            staged=staging/name;shutil.move(path,staged)
            def action(job_id,progress):
                try:manager.analyze(job_id,progress,staged,anterior_right)
                finally:shutil.rmtree(staging,ignore_errors=True)
            try:return manager.submit('predict',action)
            except Exception:
                shutil.rmtree(staging,ignore_errors=True);raise
        except HTTPException:raise
        except Exception as e:raise HTTPException(400,'영상을 읽을 수 없습니다: '+str(e)) from e
        finally:await image.close();shutil.rmtree(temp,ignore_errors=True)

    @app.get('/api/jobs/{job_id}',dependencies=protected)
    def job(job_id:str):return manager.public_job(job_id)

    @app.get('/api/jobs/{job_id}/preview',dependencies=protected)
    def preview(job_id:str):
        j=manager.job(job_id)
        if j['state']!='done' or '_path' not in j:raise HTTPException(409,'분석이 완료되지 않았습니다.')
        return FileResponse(j['_path'].parent/'preview.png',media_type='image/png')

    @app.post('/api/jobs/{job_id}/s1',dependencies=protected)
    def rerun_s1(job_id:str,choice:S1Choice):
        j=manager.job(job_id)
        if j['state']!='done' or 'result' not in j:raise HTTPException(409,'완료된 분석이 필요합니다.')
        if choice.candidate_index>=len(j['result']['spine']['polygons']):raise HTTPException(400,'L5 후보 번호가 유효하지 않습니다.')
        if j['_models']!=manager.identities:raise HTTPException(409,'모델이 바뀌었습니다. 전체 분석을 다시 실행하세요.')
        def action(_id,progress):
            progress(50,'선택한 L5 후보로 S1 재계산')
            result=copy.deepcopy(j['result']);manager.pipeline.run_s1(result,j['_path'],choice.candidate_index)
            with manager.guard:j['result']=manager.runtime.to_jsonable(result)
        return manager.submit('s1',action,job_id)

    @app.post('/api/jobs/{job_id}/export',dependencies=protected)
    def export(job_id:str,options:ExportOptions):
        j=manager.job(job_id)
        if j['state']!='done' or 'result' not in j:raise HTTPException(409,'완료된 분석이 필요합니다.')
        if options.method not in ('v1','v2'):raise HTTPException(400,'v1/v2 중 선택해 주세요.')
        # Export uses a stable completed result, independent of subsequent model loading.
        folder,archive=manager.runtime.export_result(j['_path'],copy.deepcopy(j['result']),j['_mask'],j['_fh'],
            j['_path'].parent/'exports',j['_models'],layers=options.layers,method=options.method)
        return FileResponse(archive,filename='spine_ai_results.zip',media_type='application/zip')

    @app.get('/')
    def index():return RedirectResponse('/ai/')
    app.mount('/ai',StaticFiles(directory=REPO/'public/ai',html=True),name='ai')
    return app
