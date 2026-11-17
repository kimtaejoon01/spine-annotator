import io,json,hashlib,tempfile,time,threading,types,unittest,zipfile
from pathlib import Path
from PIL import Image
from fastapi.testclient import TestClient
from ai_server.server import create_app

class Pipeline:
    def predict(self,path,anterior_right,progress):
        with Image.open(path) as im:width,height=im.size
        progress(50,'synthetic inference')
        r=dict(schema_version='spine-unified-ui-1',image=dict(filename=Path(path).name,width=width,height=height,
            sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest()),anterior_right=anterior_right,status='complete',errors=[],review_reasons=[],
            timings=dict(total_seconds=.1),spine=dict(polygons=[dict(points=[[10,10],[30,10],[30,30],[10,30]])],
            numbering=[dict(input_index=0,final_level='L5',final_confidence=.9,raw_level='L5')],decoder='viterbi',corners=[]),
            s1=dict(status='predicted',points=[[10,40],[40,42]],l5_candidate_index=0),femoral=dict(instances=[],HC_LAT=None,review_reasons=[]))
        return r,None,None
    def run_s1(self,result,path,index):result['s1'].update(l5_candidate_index=index,l5_source='user_selected_prediction')

def fake_runtime():
    def export(path,result,mask,fh,root,models,**kwargs):
        root.mkdir(parents=True,exist_ok=True);z=root/'result.zip'
        with zipfile.ZipFile(z,'w') as f:f.writestr('result.json',json.dumps(result))
        return root,z
    class Engine:
        identity={'fake':True}
        def __init__(self,*args):pass
    rt=types.SimpleNamespace(to_jsonable=lambda x:x,display_base=lambda path,**k:Image.open(path),export_result=export,
        torch=types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda:False),device=lambda x:x),
        SpineEngine=Engine,S1Engine=Engine,FemoralEngine=Engine,CornerEngine=Engine,IntegratedPipeline=lambda *a:Pipeline())
    return rt

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.app=create_app(self.tmp.name,'test-key',fake_runtime)
        self.client=TestClient(self.app);self.client.__enter__();self.auth={'Authorization':'Bearer test-key'}
        self.manager=self.app.state.manager;self.manager.pipeline=Pipeline();self.manager.runtime=fake_runtime()
        self.raw=io.BytesIO();Image.new('L',(80,180),80).save(self.raw,format='PNG');self.data=self.raw.getvalue()
    def tearDown(self):self.client.__exit__(None,None,None);self.tmp.cleanup()
    def wait(self,id):
        for _ in range(200):
            j=self.client.get('/api/jobs/'+id,headers=self.auth).json()
            if j['state'] in ('done','failed'):return j
            time.sleep(.01)
        self.fail('job timeout')
    def predict(self):
        response=self.client.post('/api/predict',headers=self.auth,files={'image':('case.png',self.data,'image/png')},data={'anterior_right':'false'})
        self.assertEqual(response.status_code,200);return self.wait(response.json()['id'])
    def test_auth_static_and_full_job(self):
        self.assertEqual(self.client.get('/api/health').status_code,401)
        self.assertEqual(self.client.get('/ai/').status_code,200)
        j=self.predict();self.assertEqual(j['state'],'done');r=j['result']
        self.assertEqual(r['image']['filename'],'case.png');self.assertFalse(r['anterior_right'])
        self.assertEqual(r['image']['sha256'],hashlib.sha256(self.data).hexdigest())
        self.assertFalse(any(k.startswith('_') for k in j))
        preview=self.client.get('/api/jobs/'+j['id']+'/preview',headers=self.auth);self.assertEqual(preview.status_code,200)
        self.assertEqual(Image.open(io.BytesIO(preview.content)).size,(80,180))
        z=self.client.post('/api/jobs/'+j['id']+'/export',headers=self.auth,json={'method':'v2'})
        self.assertEqual(z.status_code,200);self.assertTrue(zipfile.is_zipfile(io.BytesIO(z.content)))
    def test_manual_l5_validation_and_changed_model(self):
        j=self.predict();url='/api/jobs/'+j['id']+'/s1'
        self.assertEqual(self.client.post(url,headers=self.auth,json={'candidate_index':1}).status_code,400)
        self.assertEqual(self.client.post(url,headers=self.auth,json={'candidate_index':0}).status_code,200)
        r=self.wait(j['id']);self.assertEqual(r['result']['s1']['l5_source'],'user_selected_prediction')
        self.manager.identities={'changed':True}
        self.assertEqual(self.client.post(url,headers=self.auth,json={'candidate_index':0}).status_code,409)
    def test_busy_model_reload_and_input_failure(self):
        event=threading.Event();job=self.manager.submit('test',lambda *_:event.wait(3))
        try:
            response=self.client.post('/api/models/load',headers=self.auth,json=dict(number='x',a='y',s1='z',fh='w'))
            self.assertEqual(response.status_code,409)
        finally:event.set()
        self.wait(job['id'])
        bad=self.client.post('/api/predict',headers=self.auth,files={'image':('x.png',b'not a png','image/png')})
        self.assertEqual(bad.status_code,400)
        j=self.client.post('/api/models/load',headers=self.auth,json=dict(number='x',a='y',s1='z',fh='w')).json()
        self.assertEqual(self.wait(j['id'])['state'],'done')
        self.assertEqual(self.client.get('/api/models',headers=self.auth).json()['paths']['s1'],'z')

if __name__=='__main__':unittest.main()
