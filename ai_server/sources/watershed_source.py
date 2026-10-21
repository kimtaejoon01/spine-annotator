def contours_from_binary(binary,offset=(0,0)):
    contours,_=cv2.findContours(np.asarray(binary,dtype=np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    return [dict(points=c.reshape(-1,2).astype(np.float32)+np.asarray(offset,dtype=np.float32))
            for c in contours if len(c)>=3 and abs(cv2.contourArea(c))>=1.0]

def extract_watershed_polygons(mask):
    binary=(np.asarray(mask)>0).astype(np.uint8)
    if binary.ndim!=2: raise ValueError('2차원 binary mask가 필요합니다.')
    n,labels,stats,_=cv2.connectedComponentsWithStats(binary,connectivity=8)
    if n<=1: return []
    areas=stats[1:,cv2.CC_STAT_AREA].astype(float)
    valid=np.flatnonzero(areas>=max(4.0,areas.max()*.03))
    valid=valid[np.argsort(areas[valid])[-23:]]
    if not len(valid): return []
    ref_area=float(np.median(areas[valid]))
    ref_height=float(np.median(stats[1:][valid,cv2.CC_STAT_HEIGHT]))
    min_area=max(4.0,FRAGMENT_AREA_RATIO*ref_area)
    output=[]
    for component in range(1,n):
        x,y,w,h,area=map(int,stats[component])
        if area<min_area: continue
        local=np.pad((labels[y:y+h,x:x+w]==component).astype(np.uint8),2)
        dist=cv2.distanceTransform(local,cv2.DIST_L2,5)
        smooth=ndi.gaussian_filter(dist,sigma=1.0)
        profile=ndi.gaussian_filter1d(smooth.max(axis=1),sigma=max(1.,.06*ref_height))
        peaks,_=find_peaks(profile,distance=max(3,int(round(WS_PEAK_DISTANCE_RATIO*ref_height))),
                           height=WS_PEAK_HEIGHT_RATIO*profile.max(),
                           prominence=WS_PROMINENCE_RATIO*profile.max())
        # 뚜렷한 골짜기로 나뉘지 않는 인접 peak는 더 높은 하나만 유지.
        kept=[]
        for peak in peaks:
            kept.append(int(peak))
            while len(kept)>=2:
                a,b=kept[-2:]
                if profile[a:b+1].min()<=WS_VALLEY_RATIO*min(profile[a],profile[b]): break
                kept.pop(-1 if profile[a]>=profile[b] else -2)
        children=[local]
        if len(kept)>=2:
            markers=np.zeros(local.shape,np.int32)
            marker_count=0
            for py in kept:
                row=np.where(local[py]>0,smooth[py],-1.)
                px=int(row.argmax())
                if row[px]<0: continue
                marker_count+=1;markers[py,px]=marker_count
            if marker_count>=2:
                separated=watershed(-smooth,markers,mask=local.astype(bool),watershed_line=False)
                pieces=[(separated==i).astype(np.uint8) for i in range(1,marker_count+1)]
                if all(p.sum()>=max(min_area,WS_MIN_CHILD_RATIO*ref_area) for p in pieces):
                    children=pieces
        for child in children:
            output.extend(contours_from_binary(child,offset=(x-2,y-2)))
    output.sort(key=lambda p:float(p['points'][:,1].mean()))
    return output
