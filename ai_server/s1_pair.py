"""Load saved S1_L5_pair_selection results without training or selecting again.

The checkpoint layout differs from final_bundle, but the reviewed network,
preprocessing and pair decoder in sources/s1_source.py are identical.
"""
from pathlib import Path
import hashlib
import json
import math

PAIR_CODE_SHA = '9555eaf1cabdf9ddc7d9420775388849a6ca1c576c4fdf3b8b48598b7ae29c1a'


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(2**20), b''):
            h.update(block)
    return h.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def resolve_s1_folder(path):
    """Accept an exact result directory or a parent containing one result."""
    root = Path(path)
    if not root.is_dir():
        raise FileNotFoundError('S1 모델 폴더가 없습니다: ' + str(root))
    if (root / 'selection.json').is_file() or (root / 'bundle.json').is_file():
        return root
    if (root / 'final_bundle' / 'bundle.json').is_file():
        return root / 'final_bundle'
    candidates = sorted({p.parent for marker in ('selection.json', 'bundle.json')
                         for p in root.rglob(marker)
                         if marker == 'bundle.json' or p.parent.name.startswith('pair_selection_')})
    if len(candidates) != 1:
        raise ValueError('S1의 pair_selection_... 또는 final_bundle 폴더 한 개를 지정하세요:\n'
                         + '\n'.join(map(str, candidates)))
    return candidates[0]


class PairSelectionPredictor:
    def __init__(self, folder, core, device):
        import numpy as np
        import torch

        folder = Path(folder)
        l5_dir = folder.parent
        run_dir = l5_dir.parent
        paths = dict(selection=folder / 'selection.json', prior=folder / 'train_prior.json',
                     l5=l5_dir / 'best.pt', manifest=l5_dir / 'manifest.json',
                     coarse=run_dir / 'coarse' / 'best.pt',
                     snapshot=run_dir / 'S1_학습설정_데이터스냅샷.json')
        for path in paths.values():
            if not path.is_file():
                raise FileNotFoundError('S1 pair-selection에 필요한 파일이 없습니다: ' + str(path))
        selection = read_json(paths['selection'])
        stored = read_json(paths['prior'])
        identity = selection.get('identity')
        require(isinstance(identity, dict) and identity == stored.get('identity'),
                'S1 selection/train_prior의 모델 식별정보가 다릅니다.')
        require(identity.get('code_sha') == PAIR_CODE_SHA, '지원하지 않는 S1 pair-selection 코드 버전입니다.')
        require(identity.get('checkpoint_sha') == digest(paths['l5']), 'S1 L5 best.pt가 선택 당시와 다릅니다.')
        require(identity.get('manifest_sha') == digest(paths['manifest']), 'S1 L5 manifest가 선택 당시와 다릅니다.')
        pc = identity['settings']
        require(pc.get('version') == 's1_l5_pair_v1', '지원하지 않는 S1 pair-selection 설정입니다.')
        strength = float(selection['strength'])
        require(math.isfinite(strength) and strength >= 0 and strength in pc['strengths']
                and selection.get('selected_on') == 'validation', '검증에서 저장된 S1 선택 강도가 필요합니다.')

        manifest = read_json(paths['manifest'])
        snapshot = read_json(paths['snapshot'])
        l5_ck = torch.load(paths['l5'], map_location='cpu', weights_only=False)
        deps = l5_ck['dependencies']
        require(deps == manifest['dependencies'] and l5_ck['settings'] == manifest['settings'],
                'S1 L5 checkpoint/manifest 설정이 다릅니다.')
        snapshot_sha = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        require(deps['snapshot_sha'] == snapshot_sha, 'S1 학습 스냅샷이 다릅니다.')
        # Match the actual dependency, never whichever global checkpoint is newest.
        globals_ = [p for p in sorted(run_dir.glob('fine_global_*/best.pt')) if digest(p) == deps['global_sha']]
        require(bool(globals_), 'L5 학습에 사용한 S1 fine_global best.pt를 찾지 못했습니다.')
        paths['global'] = globals_[0]
        coarse_ck = torch.load(paths['coarse'], map_location='cpu', weights_only=False)
        global_ck = torch.load(paths['global'], map_location='cpu', weights_only=False)
        require(global_ck.get('stage') == 'fine_global' and global_ck.get('version') == 's1-global-context-v1'
                and coarse_ck.get('stage') == 'coarse', 'S1 coarse/global checkpoint 단계가 다릅니다.')
        require(global_ck['coarse_sha256'] == digest(paths['coarse']), 'S1 coarse checkpoint가 다릅니다.')
        cfg, settings = global_ck['config'], global_ck['settings']
        require(cfg == coarse_ck['config'] == snapshot['config'] == l5_ck['config']
                and settings == l5_ck['context_settings'], 'S1 coarse/global/L5 학습 설정이 다릅니다.')
        require(coarse_ck['run_signature'] == global_ck['parent_run_signature'] == snapshot['run_signature'],
                'S1 coarse/global/snapshot의 데이터 run이 다릅니다.')
        prior = stored['prior']
        refs, weights = np.asarray(prior['features']), np.asarray(prior['weights'])
        scale = np.asarray(prior['scale'])
        require(prior.get('version') == 'l5_pair_prior_v1' and refs.ndim == 2 and refs.shape[1] == 4
                and len(refs) > 0 and weights.shape == (len(refs),) and scale.shape == (4,)
                and np.isfinite(refs).all() and np.isfinite(weights).all() and np.isfinite(scale).all()
                and (weights > 0).all() and (scale > 0).all() and np.isclose(weights.sum(), 1)
                and math.isfinite(prior['bandwidth']) and prior['bandwidth'] > 0,
                'S1 학습 위치 관계 분포가 유효하지 않습니다.')

        ns = {}
        exec(core, ns)
        ns.update(CFG=cfg, SETTINGS=settings, LC=l5_ck['settings'], PC=pc, PRIOR=prior,
                  SELECTION=dict(strength=strength), DEVICE=torch.device(device))
        ns['H'], ns['W'] = map(int, cfg['fine_hw'])
        ns['stride'] = int(cfg['fine_stride'])
        coarse = ns['EndplateNet'](cfg['coarse_stride'])
        coarse.load_state_dict(coarse_ck['model'], strict=True)
        model = ns['EndplateNet'](cfg['fine_stride'], True)
        old = model.encoder.conv1
        model.encoder.conv1 = torch.nn.Conv2d(4, old.out_channels, old.kernel_size, old.stride,
                                             old.padding, bias=False)
        model.load_state_dict(l5_ck['model'], strict=True)
        ns.update(coarse_model=coarse.to(ns['DEVICE']).eval(), model_l5=model.to(ns['DEVICE']).eval())
        self.ns = ns
        self.identity = dict(source_format='s1_l5_pair_selection', pair_dir=str(folder),
                             checkpoint_sha256=identity['checkpoint_sha'], strength=strength,
                             l5_epoch=l5_ck.get('epoch'), pair_code_sha256=PAIR_CODE_SHA,
                             files_sha256={key: digest(path) for key, path in paths.items()})

    def predict(self, image, l5_polygon):
        a = self.ns['read_gray'](image) if isinstance(image, (str, Path)) else image
        return self.ns['predict_s1_pair'](a, l5_polygon)
