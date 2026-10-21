"""Copy the reviewed, Torch-free original operators into the browser distribution.
Run after editing ai_server sources. No executable code is accepted from model bundles.
"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'ai_server/sources'
OUT = ROOT / 'public/ai-web'

def constants(path):
    tree = ast.parse(path.read_text())
    out = {}
    for n in tree.body:
        if isinstance(n, ast.Assign):
            try: out[n.targets[0].id] = ast.literal_eval(n.value)
            except (ValueError, TypeError, AttributeError): pass
    return out

def functions(source, names):
    tree = ast.parse(source)
    found = {}
    for n in tree.body:
        if isinstance(n, ast.FunctionDef) and n.name in names:
            n.decorator_list = []
            found[n.name] = ast.unparse(n)
    assert set(found) == set(names), set(names)-set(found)
    return '\n\n'.join(found[n] for n in names)

sp = constants(SRC/'spine_source.py')
s1 = constants(SRC/'s1_source.py')
corner = constants(SRC/'corner_source.py')
ops = {
 'spine': functions((SRC/'spine_source.py').read_text(), ['polygon_basic_geometry','view_features','read_normalized_xray','letterbox_image','context_bbox_from_points','transform_box_to_letterbox','viterbi_decode_monotonic']),
 'seg': functions(sp['SEGMENTATION_INFERENCE_SOURCE'], ['read_gray','resolve_num_patches','compute_fixed_patch_ranges','make_global_y_map','make_y_encoding_channels','make_model_input','make_source_blend_weight']),
 'seg_key_map': sp['SEG_KEY_MAP'],
 'watershed': (SRC/'watershed_source.py').read_text(),
 'fh': functions((SRC/'fh_source.py').read_text(), ['read_gray','fit_circle_boundary','largest_region','bbox_roi','letterbox','undo_letterbox','normalize','circles_from_slots','hc_result']),
 'fh_v3': functions((SRC/'fh_v3_source.py').read_text(), ['read_gray', 'fit_circle_points', 'fit_circle_boundary', 'arc_coverage', 'circle_from_prob', 'largest_region', 'bbox_roi', 'letterbox', 'undo_letterbox', 'normalize', 'circles_from_slots', 'hc_result']),
 's1': functions(s1['CORE'], ['letterbox_geometry','make_letterbox','xy','geom','canonical_pair','l5_coordinates','prior_log_score','heatmap_geometry','spaced_candidates','build_pair_bank','choose_pair','read_gray']),
 'render': functions((ROOT/'ai_server/runtime.py').read_text(), ['to_jsonable','display_base','png_bytes','overlay_image','result_tables','export_result']),
}
ops['source_sha256'] = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SRC.glob('*.py'))}
OUT.mkdir(exist_ok=True)
(OUT/'original_ops.json').write_text(json.dumps(ops, ensure_ascii=False),encoding='utf-8')
(OUT/'corners.js').write_text('// Generated from the fixed original Annotator algorithms.\n'+corner['ANNOTATOR_JS']+'\nexport '+corner['JS_WRAPPER'].lstrip(),encoding='utf-8')
print('Browser operators generated.')
