# 원본 모델 구조와 전처리, 학습된 가중치 로더
def polygon_basic_geometry(points, image_w, image_h):
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    x = pts[:, 0]
    y = pts[:, 1]

    x0, x1 = float(x.min()), float(x.max())
    y0, y1 = float(y.min()), float(y.max())
    bw = max(x1 - x0, 1e-6)
    bh = max(y1 - y0, 1e-6)

    # contour moments centroid; degenerate fallback는 vertex mean
    m = cv2.moments(pts)
    if abs(m['m00']) > 1e-6:
        cx = float(m['m10'] / m['m00'])
        cy = float(m['m01'] / m['m00'])
    else:
        cx = float(x.mean())
        cy = float(y.mean())

    area = float(abs(cv2.contourArea(pts)))
    perimeter = float(cv2.arcLength(pts, True))
    bbox_area = bw * bh
    fill_ratio = area / max(bbox_area, 1e-6)

    rect = cv2.minAreaRect(pts)
    (_, _), (rw, rh), angle_deg = rect
    rw = float(max(rw, 1e-6))
    rh = float(max(rh, 1e-6))
    long_side = max(rw, rh)
    short_side = min(rw, rh)

    # 180도 주기 방향성 -> sin(2theta), cos(2theta)
    theta = math.radians(float(angle_deg))
    diag = max(math.hypot(image_w, image_h), 1e-6)

    features = {
        'cx_norm': cx / image_w,
        'cy_norm': cy / image_h,
        'left_norm': x0 / image_w,
        'right_norm': x1 / image_w,
        'top_norm': y0 / image_h,
        'bottom_norm': y1 / image_h,
        'bbox_w_norm': bw / image_w,
        'bbox_h_norm': bh / image_h,
        'bbox_area_norm': bbox_area / (image_w * image_h),
        'poly_area_norm': area / (image_w * image_h),
        'fill_ratio': fill_ratio,
        'log_aspect': math.log((bw + 1e-6) / (bh + 1e-6)),
        'perimeter_norm': perimeter / diag,
        'minrect_long_norm': long_side / diag,
        'minrect_short_norm': short_side / diag,
        'orient_sin2': math.sin(2.0 * theta),
        'orient_cos2': math.cos(2.0 * theta),
        'cx_from_center': (cx - image_w * 0.5) / image_w,
    }
    return features, {'cx': cx, 'cy': cy, 'area': area, 'bbox_w': bw, 'bbox_h': bh}

def view_features(view):
    view = str(view or 'UNKNOWN').upper()
    return {
        'view_LAT': 1.0 if view == 'LAT' else 0.0,
        'view_AP': 1.0 if view == 'AP' else 0.0,
        'view_UNKNOWN': 1.0 if view not in {'LAT', 'AP'} else 0.0,
    }
def read_normalized_xray(image_path):
    image = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise FileNotFoundError(image_path)

    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    image = image.astype(np.float32)
    low, high = np.percentile(image, [1, 99])
    if high <= low:
        low = float(image.min())
        high = float(image.max())

    return np.clip(
        (image - low) / max(high - low, 1e-6),
        0,
        1,
    ).astype(np.float32)

def letterbox_image(image, target_h=INPUT_H, target_w=INPUT_W):
    h, w = image.shape
    scale = min(target_w / float(w), target_h / float(h))

    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))

    resized = cv2.resize(
        image,
        (new_w, new_h),
        interpolation=cv2.INTER_LINEAR,
    )

    canvas = np.zeros((target_h, target_w), dtype=np.float32)
    pad_x = (target_w - new_w) // 2
    pad_y = (target_h - new_h) // 2
    canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized

    return canvas, {
        'scale': float(scale),
        'pad_x': int(pad_x),
        'pad_y': int(pad_y),
        'orig_h': int(h),
        'orig_w': int(w),
    }

def context_bbox_from_points(points, image_w, image_h):
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)

    cx = 0.5 * (x0 + x1)
    cy = 0.5 * (y0 + y1)
    bw = max(float(x1 - x0), 1.0)
    bh = max(float(y1 - y0), 1.0)

    half_w = 0.5 * bw * ROI_CONTEXT_SCALE_X
    half_h = 0.5 * bh * ROI_CONTEXT_SCALE_Y

    out = np.asarray([
        max(0.0, cx - half_w),
        max(0.0, cy - half_h),
        min(float(image_w - 1), cx + half_w),
        min(float(image_h - 1), cy + half_h),
    ], dtype=np.float32)

    out[2] = max(out[2], out[0] + 1.0)
    out[3] = max(out[3], out[1] + 1.0)
    return out

def transform_box_to_letterbox(box, transform):
    x0, y0, x1, y1 = map(float, box)
    s = transform['scale']
    px = transform['pad_x']
    py = transform['pad_y']

    return np.asarray([
        x0 * s + px,
        y0 * s + py,
        x1 * s + px,
        y1 * s + py,
    ], dtype=np.float32)
def build_mobilenet(backbone_name, pretrained=True):
    if backbone_name == 'mobilenet_v3_small':
        weights = MobileNet_V3_Small_Weights.DEFAULT if pretrained else None
        try:
            return mobilenet_v3_small(weights=weights)
        except Exception as exc:
            print('WARNING: pretrained MobileNetV3-Small load failed:', repr(exc))
            print('Fallback: weights=None')
            return mobilenet_v3_small(weights=None)

    if backbone_name == 'mobilenet_v3_large':
        weights = MobileNet_V3_Large_Weights.DEFAULT if pretrained else None
        try:
            return mobilenet_v3_large(weights=weights)
        except Exception as exc:
            print('WARNING: pretrained MobileNetV3-Large load failed:', repr(exc))
            print('Fallback: weights=None')
            return mobilenet_v3_large(weights=None)

    raise ValueError(f'Unsupported backbone: {backbone_name}')

class SharedMobileNetROIClassifier(nn.Module):
    def __init__(
        self,
        geometry_dim,
        num_classes=23,
        backbone_name='mobilenet_v3_small',
        pretrained=True,
        roi_output_size=5,
        visual_dim=256,
        geom_hidden=64,
        fusion_dim=256,
        dropout=0.15,
        use_bigru=True,
        gru_hidden=96,
        gru_layers=1,
    ):
        super().__init__()

        base = build_mobilenet(backbone_name, pretrained=pretrained)
        self.backbone = base.features
        self.roi_output_size = int(roi_output_size)
        self.use_bigru = bool(use_bigru)

        c16, c32 = self._infer_feature_channels()

        # local stride16 + local stride32 + image-global stride32
        visual_input_dim = c16 + c32 + c32

        self.visual_encoder = nn.Sequential(
            nn.Linear(visual_input_dim, visual_dim),
            nn.LayerNorm(visual_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        self.geometry_encoder = nn.Sequential(
            nn.Linear(geometry_dim, geom_hidden),
            nn.LayerNorm(geom_hidden),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(geom_hidden, geom_hidden),
            nn.GELU(),
        )

        self.fusion = nn.Sequential(
            nn.Linear(visual_dim + geom_hidden, fusion_dim),
            nn.LayerNorm(fusion_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        if self.use_bigru:
            self.gru = nn.GRU(
                input_size=fusion_dim,
                hidden_size=gru_hidden,
                num_layers=gru_layers,
                batch_first=True,
                bidirectional=True,
                dropout=(dropout if gru_layers > 1 else 0.0),
            )
            classifier_input_dim = fusion_dim + 2 * gru_hidden
        else:
            self.gru = None
            classifier_input_dim = fusion_dim

        self.classifier = nn.Sequential(
            nn.Linear(classifier_input_dim, 192),
            nn.LayerNorm(192),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(192, num_classes),
        )

    @torch.no_grad()
    def _infer_feature_channels(self):
        was_training = self.backbone.training
        self.backbone.eval()

        x = torch.zeros(1, 3, 256, 128)
        input_h = x.shape[-2]
        f16 = None
        f32 = None

        for layer in self.backbone:
            x = layer(x)
            stride = input_h / float(x.shape[-2])
            if stride <= 16.5:
                f16 = x
            f32 = x

        if was_training:
            self.backbone.train()

        if f16 is None or f32 is None:
            raise RuntimeError('MobileNet feature stage detection failed.')

        print('feature channels stride16 / final:', f16.shape[1], f32.shape[1])
        return int(f16.shape[1]), int(f32.shape[1])

    def extract_feature_maps(self, images):
        x = images
        input_h = images.shape[-2]
        f16 = None
        f32 = None

        for layer in self.backbone:
            x = layer(x)
            stride = input_h / float(x.shape[-2])
            if stride <= 16.5:
                f16 = x
            f32 = x

        return f16, f32

    @staticmethod
    def scale_boxes_to_feature(boxes_list, feature, input_h, input_w):
        feat_h, feat_w = feature.shape[-2:]
        sx = feat_w / float(input_w)
        sy = feat_h / float(input_h)

        scaled = []
        for boxes in boxes_list:
            b = boxes.clone()
            b[:, [0, 2]] *= sx
            b[:, [1, 3]] *= sy
            scaled.append(b)
        return scaled

    def roi_pool(self, feature, boxes_list, input_h, input_w):
        scaled_boxes = self.scale_boxes_to_feature(
            boxes_list,
            feature,
            input_h,
            input_w,
        )

        roi = roi_align(
            feature,
            scaled_boxes,
            output_size=(self.roi_output_size, self.roi_output_size),
            spatial_scale=1.0,
            sampling_ratio=2,
            aligned=True,
        )
        return roi.mean(dim=(-2, -1))

    def forward(self, images, boxes_list, geom_list, lengths):
        input_h, input_w = images.shape[-2:]
        f16, f32 = self.extract_feature_maps(images)

        roi16 = self.roi_pool(
            f16,
            boxes_list,
            input_h,
            input_w,
        )
        roi32 = self.roi_pool(
            f32,
            boxes_list,
            input_h,
            input_w,
        )

        # global feature is computed once per image then repeated per ROI.
        global_by_image = F.adaptive_avg_pool2d(f32, 1).flatten(1)
        global_flat = torch.cat([
            global_by_image[i:i + 1].expand(int(lengths[i]), -1)
            for i in range(len(lengths))
        ], dim=0)

        visual = self.visual_encoder(
            torch.cat([roi16, roi32, global_flat], dim=1)
        )

        geom_flat = torch.cat(geom_list, dim=0)
        geom = self.geometry_encoder(geom_flat)

        fused_flat = self.fusion(
            torch.cat([visual, geom], dim=1)
        )

        if self.use_bigru:
            seqs = list(torch.split(
                fused_flat,
                [int(x) for x in lengths],
                dim=0,
            ))
            padded = pad_sequence(
                seqs,
                batch_first=True,
            )
            packed = pack_padded_sequence(
                padded,
                [int(x) for x in lengths],
                batch_first=True,
                enforce_sorted=False,
            )
            packed_out, _ = self.gru(packed)
            gru_padded, _ = pad_packed_sequence(
                packed_out,
                batch_first=True,
            )
            gru_flat = torch.cat([
                gru_padded[i, :int(lengths[i])]
                for i in range(len(lengths))
            ], dim=0)

            classifier_input = torch.cat(
                [fused_flat, gru_flat],
                dim=1,
            )
        else:
            classifier_input = fused_flat

        return self.classifier(classifier_input)
def viterbi_decode_monotonic(
    probabilities,
    skip_penalty=0.0,
    eps=VITERBI_EPS,
):
    probs = np.asarray(probabilities, dtype=np.float64)

    if probs.ndim != 2 or probs.shape[1] != NUM_CLASSES:
        raise ValueError(
            f'prob shape must be (N,{NUM_CLASSES}), got {probs.shape}'
        )

    n = probs.shape[0]
    if n == 0:
        return np.asarray([], dtype=np.int64)
    if n > NUM_CLASSES:
        raise ValueError(
            f'candidate 수 {n} > class 수 {NUM_CLASSES}. '
            'false positive candidate filtering이 먼저 필요합니다.'
        )

    emission = np.log(np.clip(probs, eps, 1.0))
    neg_inf = -1e30
    dp = np.full((n, NUM_CLASSES), neg_inf, dtype=np.float64)
    back = np.full((n, NUM_CLASSES), -1, dtype=np.int64)

    # first candidate can start at any level
    dp[0] = emission[0]

    for i in range(1, n):
        for current in range(NUM_CLASSES):
            prev_states = np.arange(current)
            if len(prev_states) == 0:
                continue

            jumps = current - prev_states
            penalties = np.maximum(jumps - 1, 0) * float(skip_penalty)
            scores = dp[i - 1, prev_states] - penalties

            best_local = int(np.argmax(scores))
            best_prev = int(prev_states[best_local])

            dp[i, current] = scores[best_local] + emission[i, current]
            back[i, current] = best_prev

    last = int(np.argmax(dp[-1]))
    path = [last]

    for i in range(n - 1, 0, -1):
        last = int(back[i, last])
        if last < 0:
            raise RuntimeError('Viterbi backtrace failed')
        path.append(last)

    return np.asarray(path[::-1], dtype=np.int64)
@torch.no_grad()
def predict_levels_from_polygons(
    model,
    image_path,
    polygons,
    view='LAT',
    skip_penalty=None,
):
    skip_penalty = (
        best_viterbi_penalty
        if skip_penalty is None
        else float(skip_penalty)
    )

    image = read_normalized_xray(image_path)
    orig_h, orig_w = image.shape
    image_lb, transform = letterbox_image(image)

    rgb = np.repeat(image_lb[..., None], 3, axis=2)
    rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD
    image_tensor = torch.from_numpy(
        np.transpose(rgb, (2, 0, 1)).astype(np.float32)
    )[None].to(DEVICE)

    candidates = []
    for input_index, raw_polygon in enumerate(polygons):
        points = np.asarray(
            raw_polygon.get('points', []),
            dtype=np.float32,
        )

        if points.size < 6 or points.size % 2 != 0:
            continue
        points = points.reshape(-1, 2)
        if not np.isfinite(points).all():
            continue
        if abs(cv2.contourArea(points)) < 1.0:
            continue

        f, aux = polygon_basic_geometry(
            points,
            float(orig_w),
            float(orig_h),
        )
        f.update(view_features(view))

        if USE_SEQUENCE_CONTEXT_FEATURES:
            raise NotImplementedError(
                'Inference helper는 USE_SEQUENCE_CONTEXT_FEATURES=False 기본 설정용입니다.'
            )

        feature_raw = np.asarray(
            [f[name] for name in FEATURE_NAMES],
            dtype=np.float32,
        )
        feature_scaled = scaler.transform(
            feature_raw[None]
        )[0].astype(np.float32)

        box_orig = context_bbox_from_points(
            points,
            float(orig_w),
            float(orig_h),
        )
        box_lb = transform_box_to_letterbox(
            box_orig,
            transform,
        )

        candidates.append({
            'input_index': int(input_index),
            'cy': float(aux['cy']),
            'box': box_lb,
            'geom': feature_scaled,
        })

    candidates.sort(key=lambda x: x['cy'])

    if not candidates:
        return []
    boxes = torch.tensor(
        np.stack([x['box'] for x in candidates]),
        dtype=torch.float32,
        device=DEVICE,
    )
    geom = torch.tensor(
        np.stack([x['geom'] for x in candidates]),
        dtype=torch.float32,
        device=DEVICE,
    )

    model.eval()
    with torch.amp.autocast(
        device_type='cuda',
        enabled=(USE_AMP and DEVICE.type == 'cuda'),
    ):
        logits = model(
            image_tensor,
            [boxes],
            [geom],
            [len(candidates)],
        )

    prob = torch.softmax(
        logits.float(),
        dim=1,
    ).cpu().numpy()

    raw_pred = prob.argmax(axis=1)
    viterbi_pred = (viterbi_decode_monotonic(prob, skip_penalty=skip_penalty)
                    if len(candidates) <= NUM_CLASSES else None)

    results = []
    for i, candidate in enumerate(candidates):
        results.append({
            'input_index': int(candidate['input_index']),
            'cy': float(candidate['cy']),
            'raw_level': INDEX_TO_LEVEL[int(raw_pred[i])],
            'raw_confidence': float(prob[i, raw_pred[i]]),
            'viterbi_level': (INDEX_TO_LEVEL[int(viterbi_pred[i])] if viterbi_pred is not None else None),
            'viterbi_confidence': (float(prob[i, viterbi_pred[i]]) if viterbi_pred is not None else None),
        })

    return results
SEGMENTATION_INFERENCE_SOURCE = r'''
def read_gray(path):
    return np.array(Image.open(path).convert('L'))

def resolve_num_patches(full_height, full_width):
    """v7: aspect ratio에 따라 patch 개수 결정."""
    if not USE_DYNAMIC_NUM_PATCHES:
        return int(NUM_PATCHES)
    ratio = float(full_height) / max(float(full_width), 1.0)
    chosen = int(NUM_PATCHES)
    for threshold, count in DYNAMIC_PATCH_BINS:
        if ratio >= threshold:
            chosen = int(count)
    return int(max(2, min(chosen, MAX_DYNAMIC_PATCHES)))

def compute_fixed_patch_ranges(full_height, full_width=None):
    n_patches = int(NUM_PATCHES) if full_width is None else resolve_num_patches(full_height, full_width)
    crop_h = int(round(full_height * CROP_RATIO))
    crop_h = max(1, min(crop_h, full_height))
    max_start = full_height - crop_h
    if n_patches <= 1:
        return [(0, 0, int(crop_h))]
    starts = np.rint(np.linspace(0, max_start, n_patches)).astype(int)
    starts[0] = 0
    starts[-1] = max_start
    return [(i, int(y0), int(y0 + crop_h)) for i, y0 in enumerate(starts)]

def make_global_y_map(y0, y1, full_h):
    """linear y in [0, 1], shape (MODEL_HEIGHT, MODEL_WIDTH)."""
    source_y = np.linspace(float(y0), float(y1 - 1), MODEL_HEIGHT, dtype=np.float32)
    source_y /= max(float(full_h - 1), 1.0)
    source_y = np.clip(source_y, 0.0, 1.0)
    return np.repeat(source_y[:, None], MODEL_WIDTH, axis=1)

def make_y_encoding_channels(y_map):
    """v7: Y_ENCODING에 따라 (K, H, W) 채널 스택을 반환.

    - 'linear': 1채널, y in [-1, 1].
    - 'sincos': len(Y_SINCOS_FREQS) * 2 채널. sin(2π k y), cos(2π k y).
    """
    if Y_ENCODING == 'linear':
        return (y_map.astype(np.float32) * 2.0 - 1.0)[None]
    if Y_ENCODING == 'sincos':
        y = y_map.astype(np.float32)
        channels = []
        for freq in Y_SINCOS_FREQS:
            theta = 2.0 * np.pi * float(freq) * y
            channels.append(np.sin(theta))
            channels.append(np.cos(theta))
        return np.stack(channels, axis=0)
    raise ValueError(f'Unknown Y_ENCODING: {Y_ENCODING}')

def y_encoding_channel_count():
    if not USE_GLOBAL_Y_CHANNEL:
        return 0
    if Y_ENCODING == 'linear':
        return 1
    if Y_ENCODING == 'sincos':
        return 2 * len(Y_SINCOS_FREQS)
    raise ValueError(f'Unknown Y_ENCODING: {Y_ENCODING}')

def make_model_input(image_gray, y_map):
    rgb = np.stack([image_gray, image_gray, image_gray], axis=-1).astype(np.float32) / 255.0
    if USE_IMAGENET_NORMALIZATION:
        rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD
    rgb_chw = np.transpose(rgb, (2, 0, 1))  # (3, H, W)

    parts = [rgb_chw]
    if USE_GLOBAL_Y_CHANNEL:
        # v7: linear 또는 sincos 인코딩. shape (K, H, W)
        parts.append(make_y_encoding_channels(y_map))
    return np.concatenate(parts, axis=0).astype(np.float32)

def build_base_model():
    classes = 1 if TASK_RESOLVED == 'binary' else NUM_CLASSES
    # v7: sincos 인코딩이면 y 채널 수가 늘어난다.
    in_channels = 3 + y_encoding_channel_count()
    kwargs = dict(
        encoder_name=ENCODER,
        encoder_weights=ENCODER_WEIGHTS,
        in_channels=in_channels,
        classes=classes,
    )
    if MODEL_NAME.lower() == 'unet':
        return smp.Unet(**kwargs)
    if MODEL_NAME.lower() == 'unetplusplus':
        return smp.UnetPlusPlus(**kwargs)
    raise ValueError(f'Unsupported MODEL_NAME: {MODEL_NAME}')

def choose_group_count(num_channels: int, preferred_groups: int = 8):
    """num_channels를 나눌 수 있는 preferred_groups 이하의 가장 큰 group 수."""
    groups = min(int(preferred_groups), int(num_channels))
    while groups > 1 and num_channels % groups != 0:
        groups -= 1
    return max(groups, 1)

def replace_bn_relu_with_gn_leaky(
    module: nn.Module,
    preferred_groups: int = 8,
    negative_slope: float = 0.01,
    copy_affine: bool = True,
):
    """module 내부의 BatchNorm2d -> GroupNorm, ReLU -> LeakyReLU."""
    replaced = {'batchnorm_to_groupnorm': 0, 'relu_to_leakyrelu': 0}

    for name, child in list(module.named_children()):
        if isinstance(child, nn.BatchNorm2d):
            groups = choose_group_count(
                child.num_features,
                preferred_groups=preferred_groups,
            )
            new_norm = nn.GroupNorm(
                num_groups=groups,
                num_channels=child.num_features,
                eps=child.eps,
                affine=True,
            )

            # BN의 학습 가능한 gamma/beta는 GroupNorm에 그대로 복사합니다.
            # BN running mean/variance는 GroupNorm에서 사용하지 않습니다.
            if copy_affine and child.affine:
                with torch.no_grad():
                    new_norm.weight.copy_(child.weight)
                    new_norm.bias.copy_(child.bias)

            setattr(module, name, new_norm)
            replaced['batchnorm_to_groupnorm'] += 1

        elif isinstance(child, nn.ReLU):
            setattr(
                module,
                name,
                nn.LeakyReLU(
                    negative_slope=negative_slope,
                    inplace=child.inplace,
                ),
            )
            replaced['relu_to_leakyrelu'] += 1

        else:
            child_counts = replace_bn_relu_with_gn_leaky(
                child,
                preferred_groups=preferred_groups,
                negative_slope=negative_slope,
                copy_affine=copy_affine,
            )
            for key, value in child_counts.items():
                replaced[key] += value

    return replaced

def count_norm_activation_layers(module: nn.Module):
    counts = {
        'BatchNorm2d': 0,
        'InstanceNorm2d': 0,
        'GroupNorm': 0,
        'ReLU': 0,
        'LeakyReLU': 0,
    }
    for layer in module.modules():
        if isinstance(layer, nn.BatchNorm2d):
            counts['BatchNorm2d'] += 1
        elif isinstance(layer, nn.InstanceNorm2d):
            counts['InstanceNorm2d'] += 1
        elif isinstance(layer, nn.GroupNorm):
            counts['GroupNorm'] += 1
        elif isinstance(layer, nn.LeakyReLU):
            counts['LeakyReLU'] += 1
        elif isinstance(layer, nn.ReLU):
            counts['ReLU'] += 1
    return counts

def build_variant_model(variant_key: str):
    """
    A: encoder GN+Leaky / decoder GN+Leaky
    B: encoder IN+Leaky / decoder BN+ReLU
    C: encoder IN+Leaky / decoder IN+Leaky
    """
    variant_key = variant_key.upper()
    model = build_base_model()

    if variant_key == 'A':
        # GroupNorm은 batch 크기와 무관합니다.
        # encoder와 decoder 전체를 GN + LeakyReLU로 통일합니다.
        replaced = replace_bn_relu_with_gn_leaky(
            model,
            preferred_groups=8,
            negative_slope=0.01,
            copy_affine=GN_COPY_AFFINE,
        )
    elif variant_key == 'B':
        replaced = replace_bn_relu_with_in_leaky(
            model.encoder,
            copy_affine=IN_COPY_AFFINE,
        )
    elif variant_key == 'C':
        replaced = replace_bn_relu_with_in_leaky(
            model,
            copy_affine=IN_COPY_AFFINE,
        )
    else:
        raise ValueError(f'Unknown variant: {variant_key}')

    layer_counts = {
        'encoder': count_norm_activation_layers(model.encoder),
        'decoder': count_norm_activation_layers(model.decoder),
        'whole_model': count_norm_activation_layers(model),
    }
    return model, replaced, layer_counts

def make_inference_input(full_image, y0, y1):
    patch = cv2.resize(
        np.asarray(full_image[y0:y1, :]),
        (MODEL_WIDTH, MODEL_HEIGHT),
        interpolation=cv2.INTER_LINEAR,
    )
    y_map = make_global_y_map(y0, y1, full_image.shape[0])
    return torch.from_numpy(make_model_input(patch, y_map))

def make_source_blend_weight(ranges, patch_idx, full_width):
    _, y0, y1 = ranges[patch_idx]
    crop_h = y1 - y0
    weight_y = np.ones(crop_h, dtype=np.float32)

    if patch_idx > 0:
        prev_y1 = ranges[patch_idx - 1][2]
        overlap_top = max(0, prev_y1 - y0)
        if overlap_top > 0:
            weight_y[:overlap_top] = np.linspace(
                1e-3, 1.0, overlap_top, dtype=np.float32
            )

    if patch_idx < len(ranges) - 1:
        next_y0 = ranges[patch_idx + 1][1]
        overlap_bottom = max(0, y1 - next_y0)
        if overlap_bottom > 0:
            weight_y[-overlap_bottom:] = np.minimum(
                weight_y[-overlap_bottom:],
                np.linspace(1.0, 1e-3, overlap_bottom, dtype=np.float32),
            )

    return np.repeat(weight_y[:, None], full_width, axis=1)[None]

@torch.no_grad()
def forward_probs_with_tta(model, batch_x, scales):
    """batch_x: (B, C, H, W). scales가 (1.0,)이면 단일 forward.

    반환: probs (B, out_channels, H, W) — 원본 크기.
    """
    if not scales:
        scales = (1.0,)
    H, W = batch_x.shape[-2], batch_x.shape[-1]
    accum = None
    count = 0
    for scale in scales:
        if abs(scale - 1.0) < 1e-6:
            x = batch_x
        else:
            new_h = int(round(H * scale / 32.0)) * 32
            new_w = int(round(W * scale / 32.0)) * 32
            new_h = max(32, new_h)
            new_w = max(32, new_w)
            x = F.interpolate(batch_x, size=(new_h, new_w), mode='bilinear', align_corners=False)

        with torch.amp.autocast('cuda', enabled=(USE_AMP and DEVICE == 'cuda')):
            logits = model(x)
            probs = torch.sigmoid(logits) if TASK_RESOLVED == 'binary' else torch.softmax(logits, dim=1)
        if probs.shape[-2:] != (H, W):
            probs = F.interpolate(probs.float(), size=(H, W), mode='bilinear', align_corners=False)
        probs = probs.float()
        accum = probs if accum is None else (accum + probs)
        count += 1
    return accum / max(count, 1)

def predict_full_image(model, row, use_tta=None):
    model.eval()
    full_image, full_mask = load_full_pair(row)
    full_h, full_w = full_image.shape
    # v7: dynamic patch 수 반영
    ranges = compute_fixed_patch_ranges(full_h, full_w)
    out_channels = 1 if TASK_RESOLVED == 'binary' else NUM_CLASSES

    # v7: TTA 활성 여부 결정. 명시 안 됐으면 test에서만 TTA 사용.
    if use_tta is None:
        use_tta = TTA_USE_TEST
    scales = TTA_SCALES if use_tta else (1.0,)

    inputs = [make_inference_input(full_image, y0, y1) for _, y0, y1 in ranges]
    model_probs = []

    for start in range(0, len(inputs), INFER_BATCH_SIZE):
        batch_x = torch.stack(inputs[start:start + INFER_BATCH_SIZE]).to(
            DEVICE, non_blocking=True
        )
        probs = forward_probs_with_tta(model, batch_x, scales)
        model_probs.extend(probs.cpu().numpy())

    probability_sum = np.zeros((out_channels, full_h, full_w), dtype=np.float32)
    weight_sum = np.zeros((1, full_h, full_w), dtype=np.float32)

    for patch_idx, ((_, y0, y1), patch_prob) in enumerate(zip(ranges, model_probs)):
        crop_h = y1 - y0
        source_prob = np.stack([
            cv2.resize(
                patch_prob[c],
                (full_w, crop_h),
                interpolation=cv2.INTER_LINEAR,
            )
            for c in range(out_channels)
        ], axis=0)

        if TASK_RESOLVED == 'multiclass':
            source_prob /= np.clip(source_prob.sum(axis=0, keepdims=True), 1e-7, None)

        weight = make_source_blend_weight(ranges, patch_idx, full_w)
        probability_sum[:, y0:y1, :] += source_prob * weight
        weight_sum[:, y0:y1, :] += weight

    probability = probability_sum / np.clip(weight_sum, 1e-7, None)
    if TASK_RESOLVED == 'binary':
        # v6: 겹침 blend 후 확률 범위를 [0, 1]로 clip.
        probability = np.clip(probability, 0.0, 1.0)
        prediction = (probability[0] >= 0.5).astype(np.uint8)
    else:
        # v6: 가중 blend 후 클래스 확률 합이 1이 되도록 재정규화.
        # CE 계산 및 argmax 안정성 확보.
        probability = np.clip(probability, 0.0, None)
        probability /= np.clip(
            probability.sum(axis=0, keepdims=True), 1e-7, None
        )
        prediction = np.argmax(probability, axis=0).astype(np.int64)

    return {
        'image': np.asarray(full_image),
        'mask': np.asarray(full_mask),
        'prob': probability,
        'pred': prediction,
        'ranges': ranges,
    }
'''
SEG_KEY_MAP = {
 'MODEL_NAME':'model_name', 'ENCODER':'encoder', 'TASK_RESOLVED':'task', 'NUM_CLASSES':'num_classes',
 'NUM_PATCHES':'num_patches', 'CROP_RATIO':'crop_ratio', 'IGNORE_RATIO':'ignore_ratio',
 'MODEL_WIDTH':'model_width', 'MODEL_HEIGHT':'model_height',
 'USE_GLOBAL_Y_CHANNEL':'use_global_y_channel', 'USE_IMAGENET_NORMALIZATION':'use_imagenet_normalization',
 'INFER_BATCH_SIZE':'infer_batch_size', 'Y_ENCODING':'v7_y_encoding', 'Y_SINCOS_FREQS':'v7_y_sincos_freqs',
 'USE_DYNAMIC_NUM_PATCHES':'v7_use_dynamic_num_patches', 'DYNAMIC_PATCH_BINS':'v7_dynamic_patch_bins',
 'TTA_SCALES':'v7_tta_scales', 'TTA_USE_TEST':'v7_tta_use_test', 'GN_COPY_AFFINE':'v6_gn_copy_affine',
}
