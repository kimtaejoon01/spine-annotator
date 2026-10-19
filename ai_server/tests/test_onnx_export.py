"""Regression for long GroupNorm reductions, using synthetic inputs only."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ai_server.export_browser import export_one
from ai_server.onnx_export import parity_stats, stable_group_norm_export


class ExportParityTests(unittest.TestCase):
    def test_long_reduction_retries_without_changing_reference_or_tolerance(self):
        torch.set_num_threads(2)
        torch.manual_seed(41)
        layer = nn.GroupNorm(8,64).eval()
        model = nn.Sequential(layer)
        x = torch.rand(1,64,256,128) * .1 + 10.
        with torch.inference_mode(): reference=model(x).numpy().copy()
        with tempfile.TemporaryDirectory() as tmp:
            descriptor=export_one(Path(tmp),'gn',model,(x,),['image'],['output'])
            self.assertEqual(descriptor['export_strategy'],'stable_group_norm')
            self.assertFalse(descriptor['export_attempts'][0]['passed'])
            self.assertTrue(descriptor['export_attempts'][1]['passed'])
            stats=descriptor['parity'][0]['outputs'][0]
            self.assertEqual((stats['rtol'],stats['atol']),(2e-3,2e-4))
            with np.load(Path(tmp)/descriptor['check_file']) as fixture:
                np.testing.assert_array_equal(fixture['out_output'],reference)
        self.assertIs(model[0],layer)
        with torch.inference_mode():np.testing.assert_array_equal(model(x).numpy(),reference)

    def test_default_export_is_retained_when_it_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            descriptor=export_one(Path(tmp),'simple',nn.Sigmoid(),(torch.zeros(1,3,4,4),),['image'],['output'])
            self.assertEqual(descriptor['export_strategy'],'default')
            self.assertEqual(len(descriptor['export_attempts']),1)

    def test_wrapping_restores_layers_on_error(self):
        layer=nn.GroupNorm(2,4);model=nn.Sequential(layer)
        with self.assertRaisesRegex(RuntimeError,'synthetic'):
            with stable_group_norm_export(model,True):
                self.assertIsNot(model[0],layer)
                raise RuntimeError('synthetic export failure')
        self.assertIs(model[0],layer)

    def test_diagnostics_do_not_accept_nan_shape_errors_or_outside_tolerance(self):
        self.assertFalse(parity_stats(np.zeros(2),np.zeros(3))['passed'])
        self.assertFalse(parity_stats(np.array([np.nan]),np.array([np.nan]))['passed'])
        self.assertFalse(parity_stats(np.array([.003]),np.array([0.]))['passed'])
        stats=parity_stats(np.array([.501]),np.array([.499]),threshold=.5)
        self.assertFalse(stats['passed']);self.assertEqual(stats['threshold_flip_count'],1)


if __name__=='__main__':unittest.main()
