"""Inference functions extracted from FH_LAT_v3_A고정분할_1021_Colab.ipynb.
Training code and private paths are intentionally excluded.
"""

def read_gray(path):
    with Image.open(path) as im:
        im.load()
        if im.mode not in ('L', 'I;16', 'I', 'F'):
            im = im.convert('L')
        a = np.asarray(im)
    if a.dtype != np.uint8:
        a = a.astype(np.float32)
        lo, hi = (float(a.min()), float(a.max()))
        a = ((a - lo) / max(hi - lo, 1e-06) * 255).clip(0, 255).astype(np.uint8)
    return a

def fit_circle_points(x, y):
    """점 집합에 robust 원 피팅. (cx, cy, r, 상대잔차) 또는 None."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    if len(x) < 8:
        return None
    if len(x) > 3000:
        ii = np.linspace(0, len(x) - 1, 3000).astype(int)
        x, y = (x[ii], y[ii])
    A = np.column_stack([2 * x, 2 * y, np.ones(len(x))])
    b = x * x + y * y
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    r = np.sqrt(max(c + cx * cx + cy * cy, 1.0))
    opt = least_squares(lambda p: np.hypot(x - p[0], y - p[1]) - p[2], [cx, cy, r], loss='soft_l1', f_scale=1.0, bounds=([-np.inf, -np.inf, 0.5], [np.inf, np.inf, np.inf]), max_nfev=100)
    cx, cy, r = opt.x
    if not np.isfinite(opt.x).all():
        return None
    residual = np.mean(np.abs(np.hypot(x - cx, y - cy) - r)) / r
    return np.array([cx, cy, r, residual], float)

def fit_circle_boundary(mask):
    """binary 마스크 외곽 픽셀에 원 피팅 (GT 평가용)."""
    mask = np.asarray(mask, bool)
    edge = mask & ~ndi.binary_erosion(mask)
    ys, xs = np.nonzero(edge)
    c = fit_circle_points(xs, ys)
    if c is None or c[2] > 2 * max(mask.shape):
        return None
    return c

def arc_coverage(x, y, cx, cy):
    """피팅 점들이 원 둘레의 몇 %를 덮는지 (가장 큰 각도 공백 기준)."""
    ang = np.sort(np.arctan2(np.asarray(y) - cy, np.asarray(x) - cx))
    if len(ang) < 2:
        return 0.0
    gaps = np.diff(np.concatenate([ang, [ang[0] + 2 * np.pi]]))
    return float(1 - gaps.max() / (2 * np.pi))

def circle_from_prob(prob, threshold, region):
    """확률맵의 서브픽셀 등고선(threshold 레벨)에 원 피팅. crop 경계 근처 점은 제외.
    반환: dict(cx,cy,r,residual,arc_coverage,n_points,edge_excluded_fraction) 또는 None"""
    h, w = prob.shape
    support = ndi.binary_dilation(region, iterations=2)
    masked = np.where(support, prob, 0.0).astype(np.float32)
    contours = measure.find_contours(masked, threshold)
    if not contours:
        return None
    pts = max(contours, key=len)
    y, x = (pts[:, 0], pts[:, 1])
    keep = (x > EDGE_FIT_EXCLUDE_PX) & (x < w - 1 - EDGE_FIT_EXCLUDE_PX) & (y > EDGE_FIT_EXCLUDE_PX) & (y < h - 1 - EDGE_FIT_EXCLUDE_PX)
    excluded = float(1 - keep.mean())
    x, y = (x[keep], y[keep])
    c = fit_circle_points(x, y)
    if c is None or c[2] > 2 * max(h, w):
        return None
    cx, cy, r, res = c
    return dict(cx=float(cx), cy=float(cy), r=float(r), residual=float(res), arc_coverage=arc_coverage(x, y, cx, cy), n_points=int(len(x)), edge_excluded_fraction=excluded)

def largest_region(mask, min_pixels=1):
    labels, n = ndi.label(mask)
    if not n:
        return np.zeros_like(mask, dtype=bool)
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    k = areas.argmax()
    return labels == k if areas[k] >= min_pixels else np.zeros_like(mask, dtype=bool)

def bbox_roi(mask, margin=ROI_MARGIN, min_side_ratio=0.12):
    """마스크 bbox 기반 정사각형 ROI (해당 배열 좌표계). 가장자리는 잘려 비정사각일 수 있음."""
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return [0, 0, w, h]
    cx, cy = ((xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2)
    side = max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1) * margin
    side = max(side, min_side_ratio * min(h, w))
    return [max(0, int(np.floor(cx - side / 2))), max(0, int(np.floor(cy - side / 2))), min(w, int(np.ceil(cx + side / 2 + 1))), min(h, int(np.ceil(cy + side / 2 + 1)))]

def letterbox(gray, masks, size):
    h, w = gray.shape
    scale = min(size / w, size / h)
    nw, nh = (max(1, round(w * scale)), max(1, round(h * scale)))
    px, py = ((size - nw) // 2, (size - nh) // 2)
    img = np.zeros((size, size), np.uint8)
    img[py:py + nh, px:px + nw] = np.asarray(Image.fromarray(gray).resize((nw, nh), Image.Resampling.BILINEAR))
    mm = np.zeros((len(masks), size, size), np.float32)
    for i, m in enumerate(masks):
        mm[i, py:py + nh, px:px + nw] = np.asarray(Image.fromarray(m.astype(np.uint8)).resize((nw, nh), Image.Resampling.NEAREST))
    valid = np.zeros((1, size, size), np.float32)
    valid[:, py:py + nh, px:px + nw] = 1
    return (img, mm, valid, dict(h=h, w=w, nw=nw, nh=nh, px=px, py=py))

def undo_letterbox(prob, info):
    core = np.ascontiguousarray(prob[info['py']:info['py'] + info['nh'], info['px']:info['px'] + info['nw']], dtype=np.float32)
    return np.asarray(Image.fromarray(core).resize((info['w'], info['h']), Image.Resampling.BILINEAR), dtype=np.float32)

def normalize(gray):
    rgb = np.repeat(gray[None], 3, axis=0).astype(np.float32) / 255
    return (rgb - np.array([0.485, 0.456, 0.406], np.float32)[:, None, None]) / np.array([0.229, 0.224, 0.225], np.float32)[:, None, None]

def build(stage, weights='imagenet'):
    aux = None if stage == 'coarse' else dict(pooling='avg', dropout=0.2, activation=None, classes=3)
    return smp.Unet(encoder_name='resnet34', encoder_weights=weights, in_channels=3, classes=1 if stage == 'coarse' else 2, aux_params=aux).to(DEVICE)

@torch.no_grad()
def model_crop(model, gray, roi, size, tta=None):
    """crop → letterbox → 추론 (+flip TTA) → padding 제거 후 crop 원본 크기 확률맵.
    TTA: flip 출력의 슬롯 순서를 원 출력과 soft IoU로 맞춘 뒤 평균 (2-slot 붕괴 방지)."""
    if tta is None:
        tta = TTA_FLIP
    x0, y0, x1, y1 = map(int, roi)
    g = gray[y0:y1, x0:x1]
    img, _, _, info = letterbox(g, [], size)
    x = torch.from_numpy(normalize(img)[None].copy()).to(DEVICE)
    model.eval()

    def run(inp):
        out = model(inp)
        if isinstance(out, tuple):
            return (out[0].sigmoid(), out[1].softmax(1))
        return (out.sigmoid(), None)
    p, cp = run(x)
    if tta:
        pf, cpf = run(x.flip(-1))
        pf = pf.flip(-1)
        if p.shape[1] == 2:
            direct = (p * pf).sum() / ((p + pf - p * pf).sum() + 1e-06)
            sw = pf.flip(1)
            swapped = (p * sw).sum() / ((p + sw - p * sw).sum() + 1e-06)
            if swapped > direct:
                pf = sw
        p = (p + pf) / 2
        if cp is not None:
            cp = (cp + cpf) / 2
    prob = p[0].cpu().numpy()
    count_prob = None if cp is None else cp[0].cpu().numpy()
    restored = np.stack([undo_letterbox(pp, info) for pp in prob])
    return (restored, count_prob)

def coarse_proposal(gray, model, top_ratio=None):
    if top_ratio is None:
        top_ratio = CROP_TOP_RATIO
    h, w = gray.shape
    lower = [0, int(h * top_ratio), w, h]
    p, _ = model_crop(model, gray, lower, COARSE_SIZE)
    binary = p[0] >= ROI_PROPOSAL_THRESHOLD
    lab, n = ndi.label(binary)
    areas = np.bincount(lab.ravel())
    areas[0] = 0
    ids = sorted(range(1, len(areas)), key=lambda i: areas[i], reverse=True)[:2]
    min_area = max(8, int(binary.size * MIN_REGION_FRACTION))
    ids = [i for i in ids if areas[i] >= min_area]
    full = np.zeros((h, w), bool)
    full[lower[1]:] = np.isin(lab, ids) if ids else False
    if not ids:
        return ([0, lower[1], w, h], False)
    return (bbox_roi(full), True)

def propose_roi(gray, model):
    """coarse 제안. 아래 60%에서 미검출이면 전체 영상으로 재시도 (FOV가 다른 영상 대비)."""
    roi, found = coarse_proposal(gray, model)
    if found:
        return (roi, True, 'lower')
    roi2, found2 = coarse_proposal(gray, model, top_ratio=0.0)
    if found2:
        return (roi2, True, 'full_image_retry')
    return (roi, False, 'fallback_lower_region')

def circles_from_slots(prob, threshold, roi):
    circles = []
    clean = []
    x0, y0, x1, y1 = roi
    for slot, p in enumerate(prob):
        region = largest_region(p >= threshold, max(8, int(p.size * MIN_REGION_FRACTION)))
        clean.append(region)
        if not region.any():
            continue
        c = circle_from_prob(p, threshold, region)
        if c is None:
            continue
        if not (0 <= c['cx'] < p.shape[1] and 0 <= c['cy'] < p.shape[0]):
            continue
        ys, xs = np.nonzero(region)
        clipped = bool(xs.min() == 0 or ys.min() == 0 or xs.max() == p.shape[1] - 1 or (ys.max() == p.shape[0] - 1))
        circles.append(dict(slot=slot, cx=float(c['cx'] + x0), cy=float(c['cy'] + y0), radius=float(c['r']), fit_relative_error=c['residual'], arc_coverage=c['arc_coverage'], fit_points=c['n_points'], mean_probability=float(p[region].mean()), touches_crop_edge=clipped))
    return (circles, np.stack(clean))

def hc_result(circles, count_prob):
    reasons = []
    hc = None
    superimposed = False
    expected = int(np.argmax(count_prob))
    confidence = float(np.max(count_prob))
    if expected != len(circles):
        reasons.append('count_mask_disagreement')
    if confidence < COUNT_CONFIDENCE:
        reasons.append('low_count_confidence')
    if any((c['touches_crop_edge'] and c['arc_coverage'] < MIN_ARC_COVERAGE for c in circles)):
        reasons.append('crop_edge')
    if any((c['fit_relative_error'] > NONCIRCULAR_ERR for c in circles)):
        reasons.append('noncircular_mask')
    if len(circles) == 2:
        a, b = circles
        dist = math.hypot(a['cx'] - b['cx'], a['cy'] - b['cy'])
        if dist < SUPERIMPOSED_DIST_RATIO * min(a['radius'], b['radius']):
            superimposed = True
            if expected != 2:
                reasons.append('duplicate_or_superimposed')
        if not reasons:
            hc = dict(x=(a['cx'] + b['cx']) / 2, y=(a['cy'] + b['cy']) / 2, source='midpoint_of_two_instances')
    elif len(circles) == 1:
        reasons.append('single_instance_not_bilateral_midpoint')
        if ALLOW_SINGLE_CENTER_AS_HC and expected == 1 and (len(reasons) == 1):
            hc = dict(x=circles[0]['cx'], y=circles[0]['cy'], source='single_center_user_policy')
    status = 'review_required' if reasons else 'not_detected' if not circles and expected == 0 else 'detected'
    return dict(status=status, HC_LAT=hc, review_reasons=reasons, superimposed=superimposed, annotated_count_prediction=expected, count_probability=count_prob.tolist(), count_probability_is_calibrated=False)

@torch.no_grad()
def infer_probs(image_path):
    """threshold와 무관한 부분: coarse ROI + fine 확률맵. threshold 스윕 시 재사용."""
    gray = read_gray(image_path)
    roi, found, roi_source = propose_roi(gray, coarse_model)
    prob, cp = model_crop(fine_model, gray, roi, FINE_SIZE)
    return dict(image_path=str(image_path), gray=gray, roi=list(map(int, roi)), found=found, roi_source=roi_source, prob=prob, count_prob=cp)

def finalize(inf, threshold):
    circles, masks = circles_from_slots(inf['prob'], threshold, inf['roi'])
    outcome = hc_result(circles, inf['count_prob'])
    if not inf['found']:
        outcome['review_reasons'].append('coarse_not_detected_fallback')
        if outcome['HC_LAT'] is not None:
            outcome['HC_LAT'] = None
        outcome['status'] = 'review_required'
    polygons = []
    for i, c in enumerate(circles):
        a = np.arange(32) * 2 * np.pi / 32
        pts = np.column_stack([c['cx'] + c['radius'] * np.cos(a), c['cy'] + c['radius'] * np.sin(a)])
        polygons.append(dict(id=f'ai_fh_lat_{i + 1}', label='FH_LAT', shape='circle', source='ai_fh_v3', points=pts.ravel().tolist()))
    payload = dict(image=Path(inf['image_path']).name, instances=circles, annotator_polygons=polygons, roi=inf['roi'], coarse_found=inf['found'], roi_source=inf['roi_source'], threshold=threshold, tta_flip=TTA_FLIP, **outcome)
    return dict(payload=payload, gray=inf['gray'], prob=inf['prob'], masks=masks)

def predict_image(image_path, threshold):
    return finalize(infer_probs(image_path), threshold)
