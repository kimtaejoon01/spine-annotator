def read_gray(path):
    a = np.asarray(Image.open(path))
    if a.ndim == 3:
        a = np.asarray(Image.open(path).convert('L'))
    if a.dtype != np.uint8:
        a = a.astype(np.float32)
        lo, hi = float(a.min()), float(a.max())
        a = ((a-lo)/max(hi-lo,1e-6)*255).clip(0,255).astype(np.uint8)
    return a

def fit_circle_boundary(mask):
    """마스크 내부 전체가 아니라 외곽 픽셀에 robust 원 피팅. cx,cy,r,상대잔차."""
    mask = np.asarray(mask, bool)
    edge = mask & ~ndi.binary_erosion(mask)
    ys, xs = np.nonzero(edge)
    if len(xs) < 8: return None
    if len(xs)>3000:
        ii = np.linspace(0,len(xs)-1,3000).astype(int); xs,ys=xs[ii],ys[ii]
    x,y=xs.astype(float),ys.astype(float)
    A=np.column_stack([2*x,2*y,np.ones(len(x))]); b=x*x+y*y
    cx,cy,c=np.linalg.lstsq(A,b,rcond=None)[0]
    r=np.sqrt(max(c+cx*cx+cy*cy,1.0))
    opt=least_squares(lambda p: np.hypot(x-p[0],y-p[1])-p[2], [cx,cy,r],
                      loss='soft_l1', f_scale=1.0, bounds=([-np.inf,-np.inf,0.5],[np.inf,np.inf,np.inf]),
                      max_nfev=100)
    cx,cy,r=opt.x
    if not np.isfinite(opt.x).all() or r>2*max(mask.shape): return None
    residual=np.mean(np.abs(np.hypot(x-cx,y-cy)-r))/r
    return np.array([cx,cy,r,residual],float)

def largest_region(mask, min_pixels=1):
    labels,n=ndi.label(mask)
    if not n:return np.zeros_like(mask,dtype=bool)
    areas=np.bincount(labels.ravel());areas[0]=0; k=areas.argmax()
    return labels==k if areas[k]>=min_pixels else np.zeros_like(mask,dtype=bool)

def bbox_roi(mask, margin=ROI_MARGIN):
    """원본 좌표의 ROI; 영상 가장자리에서는 비정사각 crop도 letterbox로 보존."""
    h,w=mask.shape;ys,xs=np.nonzero(mask)
    if len(xs)==0:return [0,int(h*CROP_TOP_RATIO),w,h]
    cx,cy=(xs.min()+xs.max())/2,(ys.min()+ys.max())/2
    side=max(xs.max()-xs.min()+1,ys.max()-ys.min()+1)*margin
    side=max(side,0.12*min(h,w))
    return [max(0,int(np.floor(cx-side/2))), max(0,int(np.floor(cy-side/2))),
            min(w,int(np.ceil(cx+side/2+1))), min(h,int(np.ceil(cy+side/2+1)))]

def letterbox(gray,masks,size):
    h,w=gray.shape;scale=min(size/w,size/h)
    nw,nh=max(1,round(w*scale)),max(1,round(h*scale))
    px,py=(size-nw)//2,(size-nh)//2
    img=np.zeros((size,size),np.uint8)
    img[py:py+nh,px:px+nw]=np.asarray(Image.fromarray(gray).resize((nw,nh),Image.Resampling.BILINEAR))
    mm=np.zeros((len(masks),size,size),np.float32)
    for i,m in enumerate(masks):
        mm[i,py:py+nh,px:px+nw]=np.asarray(Image.fromarray(m.astype(np.uint8)).resize((nw,nh),Image.Resampling.NEAREST))
    valid=np.zeros((1,size,size),np.float32);valid[:,py:py+nh,px:px+nw]=1
    return img,mm,valid,dict(h=h,w=w,nw=nw,nh=nh,px=px,py=py)

def undo_letterbox(prob,info):
    core=prob[info['py']:info['py']+info['nh'],info['px']:info['px']+info['nw']]
    return np.asarray(Image.fromarray(core.astype(np.float32),mode='F').resize((info['w'],info['h']),Image.Resampling.BILINEAR))

def normalize(gray):
    rgb=np.repeat(gray[None],3,axis=0).astype(np.float32)/255
    return (rgb-np.array([.485,.456,.406],np.float32)[:,None,None])/np.array([.229,.224,.225],np.float32)[:,None,None]

def build(stage,weights='imagenet'):
    aux=None if stage=='coarse' else dict(pooling='avg',dropout=.2,activation=None,classes=3)
    return smp.Unet(encoder_name='resnet34',encoder_weights=weights,in_channels=3,
                    classes=1 if stage=='coarse' else 2,aux_params=aux).to(DEVICE)

@torch.no_grad()
def model_crop(model,gray,roi,size):
    x0,y0,x1,y1=map(int,roi);g=gray[y0:y1,x0:x1]
    img,_,_,info=letterbox(g,[],size)
    x=torch.from_numpy(normalize(img)[None].copy()).to(DEVICE)
    model.eval();out=model(x)
    if isinstance(out,tuple):logits,count_logits=out;count_prob=count_logits.softmax(1)[0].cpu().numpy()
    else:logits=out;count_prob=None
    prob=logits.sigmoid()[0].cpu().numpy()
    # padding 제거 후 crop 원본 크기로 복원
    restored=np.stack([undo_letterbox(p,info) for p in prob])
    return restored,count_prob

def coarse_proposal(gray,model):
    h,w=gray.shape;lower=[0,int(h*CROP_TOP_RATIO),w,h]
    p,_=model_crop(model,gray,lower,COARSE_SIZE)
    binary=p[0]>=ROI_PROPOSAL_THRESHOLD
    lab,n=ndi.label(binary);areas=np.bincount(lab.ravel());areas[0]=0
    ids=sorted(range(1,len(areas)),key=lambda i:areas[i],reverse=True)[:2]
    min_area=max(8,int(binary.size*MIN_REGION_FRACTION))
    ids=[i for i in ids if areas[i]>=min_area]
    full=np.zeros((h,w),bool);full[lower[1]:]=np.isin(lab,ids) if ids else False
    return bbox_roi(full),bool(ids)

def circles_from_slots(prob,threshold,roi):
    circles=[];clean=[];x0,y0,x1,y1=roi
    for slot,p in enumerate(prob):
        region=largest_region(p>=threshold,max(8,int(p.size*MIN_REGION_FRACTION)))
        clean.append(region)
        c=fit_circle_boundary(region)
        if c is None:continue
        cx,cy,r,err=c
        if not (0<=cx<p.shape[1] and 0<=cy<p.shape[0]):continue
        ys,xs=np.nonzero(region)
        clipped=bool(xs.min()==0 or ys.min()==0 or xs.max()==p.shape[1]-1 or ys.max()==p.shape[0]-1)
        circles.append(dict(slot=slot,cx=float(cx+x0),cy=float(cy+y0),radius=float(r),
                            fit_relative_error=float(err),mean_probability=float(p[region].mean()),
                            touches_crop_edge=clipped))
    return circles,np.stack(clean)

def hc_result(circles,count_prob):
    reasons=[];hc=None
    expected=int(np.argmax(count_prob));confidence=float(np.max(count_prob))
    if expected!=len(circles):reasons.append('count_mask_disagreement')
    if confidence<COUNT_CONFIDENCE:reasons.append('low_count_confidence')
    if any(c['touches_crop_edge'] for c in circles):reasons.append('crop_edge')
    if any(c['fit_relative_error']>.12 for c in circles):reasons.append('noncircular_mask')
    if len(circles)==2:
        a,b=circles;dist=math.hypot(a['cx']-b['cx'],a['cy']-b['cy'])
        if dist<.15*min(a['radius'],b['radius']):reasons.append('duplicate_or_superimposed')
        if not reasons:hc=dict(x=(a['cx']+b['cx'])/2,y=(a['cy']+b['cy'])/2,source='midpoint_of_two_instances')
    elif len(circles)==1:
        reasons.append('single_instance_not_bilateral_midpoint')
        if ALLOW_SINGLE_CENTER_AS_HC and expected==1 and len(reasons)==1:
            hc=dict(x=circles[0]['cx'],y=circles[0]['cy'],source='single_center_user_policy')
    status='review_required' if reasons else 'not_detected' if not circles and expected==0 else 'detected'
    return dict(status=status,HC_LAT=hc,review_reasons=reasons,
                annotated_count_prediction=expected,count_probability=count_prob.tolist(),
                count_probability_is_calibrated=False)

@torch.no_grad()
def predict_image(image_path,threshold):
    gray=read_gray(image_path);roi,found=coarse_proposal(gray,coarse_model)
    prob,cp=model_crop(fine_model,gray,roi,FINE_SIZE)
    circles,masks=circles_from_slots(prob,threshold,roi)
    outcome=hc_result(circles,cp)
    if not found:
        outcome['review_reasons'].append('coarse_not_detected_fallback')
        if outcome['HC_LAT'] is not None:outcome['HC_LAT']=None;outcome['status']='review_required'
    polygons=[]
    for i,c in enumerate(circles):
        a=np.arange(32)*2*np.pi/32
        pts=np.column_stack([c['cx']+c['radius']*np.cos(a),c['cy']+c['radius']*np.sin(a)])
        polygons.append(dict(id=f'ai_fh_lat_{i+1}',label='FH_LAT',shape='circle',source='ai_fh_v2',points=pts.ravel().tolist()))
    payload=dict(image=Path(image_path).name,instances=circles,annotator_polygons=polygons,
                 roi=list(map(int,roi)),coarse_found=found,threshold=threshold,**outcome)
    return dict(payload=payload,gray=gray,prob=prob,masks=masks)