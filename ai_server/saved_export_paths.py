"""Resolve saved training locations; no prior browser bundle or local PC files."""
import json
import re
import unicodedata
from pathlib import Path


def normalize_path(path):
    path=Path(path).expanduser()
    if path.exists():return path
    path=path.absolute();current=Path(path.anchor)
    for part in path.parts[1:]:
        direct=current/part
        if direct.exists():current=direct;continue
        matches=[p for p in current.iterdir() if unicodedata.normalize('NFC',p.name)==unicodedata.normalize('NFC',part)] if current.is_dir() else []
        if len(matches)!=1:raise FileNotFoundError(str(path))
        current=matches[0]
    return current


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def select_run(path,marker,kind):
    root=normalize_path(path)
    candidates=[root] if (root/marker).is_file() else sorted({p.parent for p in root.rglob(marker)})
    if kind=='A':
        candidates=[p for p in candidates if read_json(p/marker).get('abc_variant')=='A' and (p/'checkpoints').is_dir()]
    if len(candidates)!=1:
        raise ValueError(kind+' 학습 폴더를 하나로 특정할 수 없습니다. 저장된 경로 설정을 확인하세요:\n'+'\n'.join(map(str,candidates)))
    return candidates[0]


def complete_v3(path):
    required=('config.json','coarse_best.pt','fine_best.pt','selected_threshold.json')
    if not all((path/n).is_file() for n in required):return False
    try:
        cfg=read_json(path/'config.json');threshold=read_json(path/'selected_threshold.json')['threshold']
        return cfg.get('version')=='v3' and 0<float(threshold)<1
    except (ValueError,TypeError,KeyError):return False


def select_fh_v3(config):
    explicit=config.get('FH_V3_RUN')
    raw=Path(explicit or config['FH_RUN']).expanduser()
    # A saved v2 location points to its sibling v3 training directory.
    # Derive this before existence checks: the old v2 folder need not still exist.
    if not explicit:
        old=next((p for p in (raw,*raw.parents) if p.name=='FH_LAT_v2'),None)
        if old is not None:raw=old.with_name('FH_LAT_v3')
    root=normalize_path(raw)
    if complete_v3(root):return root
    candidates=[p.parent for p in root.rglob('coarse_best.pt') if complete_v3(p.parent)]
    if not candidates:raise FileNotFoundError('학습이 완료된 FH v3 폴더가 없습니다: '+str(root))
    if len(candidates)==1:return candidates[0]
    # Notebook run names encode their creation time. Skip incomplete runs; do not
    # use checkpoint mtimes, which change when Drive files are copied.
    dated=[p for p in candidates if re.fullmatch(r'run_\d{8}_\d{6}',p.name)]
    if len(dated)!=len(candidates):raise ValueError('FH v3 run 이름이 불명확합니다. 설정 JSON의 FH_V3_RUN에 원하는 폴더를 지정하세요.')
    dated.sort(key=lambda p:p.name)
    if dated[-1].name==dated[-2].name:raise ValueError('같은 날짜의 FH v3 run이 중복됩니다. FH_V3_RUN을 지정하세요.')
    print('완료된 FH v3 run 중 가장 최근 폴더 선택:',dated[-1])
    return dated[-1]


def saved_training_paths(config_path):
    config_path=Path(config_path)
    if not config_path.is_file():
        raise FileNotFoundError('Drive에 저장된 spine_browser_model_paths.json이 없습니다. 이전 학습 때 사용한 Google Drive 계정으로 연결하세요. 원본 학습 가중치와 경로 설정은 필요하며, 이전 브라우저 변환 폴더는 필요하지 않습니다.')
    cfg=read_json(config_path)
    for key in ('NUMBER_RUN','A_RUN','S1_BUNDLE','FH_RUN'):
        if not isinstance(cfg.get(key),str) or not cfg[key].strip():raise ValueError('저장된 경로 설정에 '+key+'가 없습니다.')
    return dict(number=select_run(cfg['NUMBER_RUN'],'shared_mobilenet_roi_config.json','번호'),
                a=select_run(cfg['A_RUN'],'config.json','A'),
                s1=normalize_path(cfg['S1_BUNDLE']),fh=select_fh_v3(cfg))
