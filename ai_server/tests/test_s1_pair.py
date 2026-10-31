"""Synthetic checkpoint restoration checks; these do not measure trained accuracy."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from ai_server.s1_pair import PairSelectionPredictor, PAIR_CODE_SHA, digest, resolve_s1_folder
from ai_server.sources.s1_source import CORE


class PairRestoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        torch.manual_seed(41)
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.run_dir = root / 'run_synthetic'
        cls.l5 = cls.run_dir / 'fine_l5_synthetic'
        cls.pair = cls.l5 / 'pair_selection_synthetic'
        cls.global_dir = cls.run_dir / 'fine_global_synthetic'
        for p in (cls.pair, cls.global_dir, cls.run_dir / 'coarse'):
            p.mkdir(parents=True, exist_ok=True)
        cfg = dict(coarse_hw=[128,64], fine_hw=[64,64], coarse_stride=4, fine_stride=2)
        settings = dict(feature_pool_hw=[4,2])
        lc = dict(down_factor=.5, side_factor=3.)
        pc = dict(version='s1_l5_pair_v1', candidates_per_endpoint=16, nms_l5_fraction=.08,
                  strengths=[0., .1, .25, .5, 1., 2.])
        prior = dict(version='l5_pair_prior_v1', features=[[-.5,.3,.5,.4],[-.5,.4,.5,.3]],
                     weights=[.5,.5], scale=[.2]*4, bandwidth=.5, df=4, penalty_cap=20.)
        snapshot = dict(config=cfg, run_signature='synthetic')
        (cls.run_dir / 'S1_학습설정_데이터스냅샷.json').write_text(json.dumps(snapshot))
        ns = {}; exec(CORE, ns)
        ns.update(CFG=cfg, SETTINGS=settings, LC=lc, PC=pc, PRIOR=prior,
                  SELECTION=dict(strength=.25), DEVICE=torch.device('cpu'), H=64,W=64,stride=2)
        coarse = ns['EndplateNet'](4).eval()
        global_model = ns['EndplateNet'](2, True).eval()
        coarse_path = cls.run_dir / 'coarse' / 'best.pt'
        torch.save(dict(stage='coarse', config=cfg, run_signature='synthetic', model=coarse.state_dict()), coarse_path)
        global_path = cls.global_dir / 'best.pt'
        torch.save(dict(stage='fine_global', version='s1-global-context-v1', config=cfg, settings=settings,
                        parent_run_signature='synthetic', coarse_sha256=digest(coarse_path),
                        model=global_model.state_dict()), global_path)
        deps = dict(global_sha=digest(global_path), snapshot_sha=hashlib.sha256(
            json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest())
        model = copy.deepcopy(global_model)
        old = model.encoder.conv1
        model.encoder.conv1 = torch.nn.Conv2d(4,old.out_channels,old.kernel_size,old.stride,old.padding,bias=False)
        torch.save(dict(config=cfg, context_settings=settings, settings=lc, dependencies=deps,
                        model=model.state_dict(), epoch=1), cls.l5 / 'best.pt')
        (cls.l5 / 'manifest.json').write_text(json.dumps(dict(dependencies=deps, settings=lc, cases=[])))
        identity = dict(code_sha=PAIR_CODE_SHA, settings=pc, checkpoint_sha=digest(cls.l5/'best.pt'),
                        manifest_sha=digest(cls.l5/'manifest.json'))
        cls.selection = dict(identity=identity, strength=.25, selected_on='validation')
        (cls.pair/'train_prior.json').write_text(json.dumps(dict(identity=identity, prior=prior)))
        (cls.pair/'selection.json').write_text(json.dumps(cls.selection))
        ns.update(coarse_model=coarse, model_l5=model.eval())
        cls.reference = ns

    @classmethod
    def tearDownClass(cls):
        cls.reference = None
        cls.tmp.cleanup()

    def test_saved_pair_matches_original_prediction(self):
        predictor = PairSelectionPredictor(self.pair, CORE, 'cpu')
        image = np.random.default_rng(41).random((160,80)).astype('float32')
        l5 = np.array([[25,90],[50,88],[51,109],[24,111]],float)
        expected = self.reference['predict_s1_pair'](image,l5)
        actual = predictor.predict(image,l5)
        self.assertEqual(actual['strength'],.25)
        self.assertEqual(actual['selected_pair'],expected['selected_pair'])
        np.testing.assert_array_equal(actual['points'],expected['points'])
        np.testing.assert_array_equal(actual['original_points'],expected['original_points'])
        self.assertEqual(predictor.identity['l5_epoch'],1)
        # The adapter passed to ONNX export uses the same restored namespace.
        from ai_server.runtime import S1Engine
        engine = S1Engine(self.pair,torch.device('cpu'))
        self.assertEqual(engine.identity['source_format'],'s1_l5_pair_selection')
        np.testing.assert_array_equal(engine.predictor.predict(image,l5)['points'],expected['points'])

    def test_exact_pair_and_ambiguous_parent(self):
        self.assertEqual(resolve_s1_folder(self.pair),self.pair)
        self.assertEqual(resolve_s1_folder(self.run_dir),self.pair)
        other=self.l5/'pair_selection_other';other.mkdir()
        try:
            (other/'selection.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'한 개'):
                resolve_s1_folder(self.run_dir)
            self.assertEqual(resolve_s1_folder(self.pair),self.pair)
        finally:
            (other/'selection.json').unlink();other.rmdir()

    def test_modified_manifest_is_rejected(self):
        path=self.l5/'manifest.json';original=path.read_bytes()
        try:
            path.write_bytes(original+b'\n')
            with self.assertRaisesRegex(ValueError,'manifest'):
                PairSelectionPredictor(self.pair,CORE,'cpu')
        finally:path.write_bytes(original)

    def test_missing_selection_is_not_recomputed(self):
        path=self.pair/'selection.json';original=path.read_bytes()
        try:
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                PairSelectionPredictor(self.pair,CORE,'cpu')
        finally:path.write_bytes(original)

    def test_saved_zero_strength_is_preserved(self):
        path=self.pair/'selection.json';original=path.read_bytes()
        try:
            selection=copy.deepcopy(self.selection);selection['strength']=0.
            path.write_text(json.dumps(selection))
            predictor=PairSelectionPredictor(self.pair,CORE,'cpu')
            self.assertEqual(predictor.ns['SELECTION']['strength'],0.)
        finally:path.write_bytes(original)


if __name__ == '__main__':
    unittest.main()
