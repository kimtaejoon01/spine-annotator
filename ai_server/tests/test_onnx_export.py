"""Regression for long GroupNorm reductions, using synthetic inputs only."""
import tempfile
import unittest
from unittest.mock import patch
import ast
import asyncio
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ai_server.export_browser import export_one
from ai_server.onnx_export import parity_stats, stable_group_norm_export, a_probability_stats, A_PROBABILITY_POLICY


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

    def test_a_policy_bounds_sparse_residuals_and_rejects_larger_changes(self):
        expected=np.full(1_000_000,.1,dtype=np.float32)
        actual=expected.copy();actual[:600]+=.00136
        expected[600:604]=.4999;actual[600:604]=.5001
        self.assertFalse(parity_stats(actual,expected)['passed'])
        self.assertTrue(a_probability_stats(actual,expected)['passed'])
        for change in ('max','mean','p99','flips','range','nan','shape'):
            a=expected.copy();b=expected.copy()
            if change=='max':a[0]+=.003
            if change=='mean':a[:500_000]+=.00003
            if change=='p99':a[:20_000]+=.0002
            if change=='flips':a[:11]=.5001;b[:11]=.4999
            if change=='range':a[0]=-1e-9;b[0]=0
            if change=='nan':a[0]=np.nan
            if change=='shape':a=a[:-1]
            with self.subTest(change=change):self.assertFalse(a_probability_stats(a,b)['passed'])

    def test_reuse_rechecks_current_model_without_export_and_keeps_native_fixture(self):
        x=torch.zeros(1,1,4,4)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);old=root/'old';old.mkdir()
            original=export_one(old,'a',nn.Sigmoid(),(x,),['image'],['probabilities'])
            source=old/original['file'];before=source.read_bytes()
            fresh=root/'fresh';fresh.mkdir()
            with patch('torch.onnx.export',side_effect=AssertionError('must not retrace')):
                result=export_one(fresh,'a',nn.Sigmoid(),(x,),['image'],['probabilities'],reuse_onnx=source)
            self.assertEqual(result['numerical_policy'],A_PROBABILITY_POLICY)
            self.assertEqual(result['export_strategy'],'reused_onnx_revalidated')
            self.assertEqual(source.read_bytes(),before)
            with np.load(fresh/result['check_file']) as fixture:
                np.testing.assert_array_equal(fixture['out_probabilities'],torch.sigmoid(x).numpy())
            bad=root/'bad';bad.mkdir()
            with patch('torch.onnx.export',side_effect=AssertionError('must not retrace')):
                with self.assertRaisesRegex(AssertionError,'ONNX'):
                    export_one(bad,'a',nn.Identity(),(x,),['image'],['probabilities'],reuse_onnx=source)
            self.assertFalse((bad/'a_check.npz').exists())

    def test_browser_uses_same_a_policy_and_preserves_other_stage_checks(self):
        # Execute the actual browser validator with a mocked inference boundary.
        source=Path(__file__).parents[2]/'public/ai-web/pipeline.py'
        node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='check_model')
        actual=np.full(1_000_000,.1,dtype=np.float32);expected=actual.copy();actual[:600]+=.00136
        async def infer(*args,**kwargs):return {'probabilities':actual}
        scope=dict(np=np,json=json,infer=infer,a_probability_stats=a_probability_stats,A_PROBABILITY_POLICY=A_PROBABILITY_POLICY)
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),scope)
        descriptor=dict(inputs=['image'],outputs=['probabilities'],numerical_policy=A_PROBABILITY_POLICY)
        with tempfile.TemporaryDirectory() as tmp:
            fixture=Path(tmp)/'check.npz';np.savez(fixture,in_image=np.zeros(1),out_probabilities=expected)
            result=json.loads(asyncio.run(scope['check_model']('a',fixture,descriptor)))
            self.assertEqual(result['probabilities'],a_probability_stats(actual,expected))
            with self.assertRaises(AssertionError):asyncio.run(scope['check_model']('number',fixture,descriptor))


if __name__=='__main__':unittest.main()
