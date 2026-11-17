import json
import tempfile
import unittest
from pathlib import Path
from ai_server.saved_export_paths import saved_training_paths,select_fh_v3

class SavedPathsTests(unittest.TestCase):
    def make_run(self,root,name,complete=True):
        p=root/name;p.mkdir(parents=True)
        (p/'config.json').write_text(json.dumps({'version':'v3'}))
        (p/'coarse_best.pt').write_bytes(b'coarse')
        if complete:
            (p/'fine_best.pt').write_bytes(b'fine')
            (p/'selected_threshold.json').write_text('{"threshold":0.5}')
        return p

    def test_no_old_bundle_or_v2_directory_required(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);fh=root/'FH_LAT_v3'
            self.make_run(fh,'run_20261019_120000')
            newest=self.make_run(fh,'run_20261021_120000')
            self.make_run(fh,'run_20261022_120000',False)
            number=root/'number';number.mkdir();(number/'shared_mobilenet_roi_config.json').write_text('{}')
            a=root/'A';(a/'checkpoints').mkdir(parents=True);(a/'config.json').write_text('{"abc_variant":"A"}')
            s1=root/'s1';s1.mkdir()
            cfg=root/'paths.json';cfg.write_text(json.dumps(dict(NUMBER_RUN=str(number),A_RUN=str(a),S1_BUNDLE=str(s1),FH_RUN=str(root/'FH_LAT_v2/run_20260919_120000'))))
            original=cfg.read_bytes();paths=saved_training_paths(cfg)
            self.assertEqual(paths,dict(number=number,a=a,s1=s1,fh=newest))
            self.assertEqual(cfg.read_bytes(),original)
            self.assertFalse(any(root.rglob('manifest.json')))

    def test_explicit_v3_run_is_respected(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);first=self.make_run(root,'run_20261019_120000');self.make_run(root,'run_20261021_120000')
            self.assertEqual(select_fh_v3(dict(FH_RUN='unused',FH_V3_RUN=str(first))),first)

    def test_missing_training_settings_gives_actionable_error(self):
        with tempfile.TemporaryDirectory() as t:
            with self.assertRaisesRegex(FileNotFoundError,'Google Drive 계정'):
                saved_training_paths(Path(t)/'missing.json')

if __name__=='__main__':unittest.main()
