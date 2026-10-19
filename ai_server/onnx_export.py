"""Numerically stable ONNX lowering; original eager predictions stay unchanged."""
from contextlib import contextmanager

import numpy as np
import torch
from torch import nn


class StableGroupNorm(nn.Module):
    """Avoid one very long FP32 reduction in exported InstanceNormalization.

    Shift by a group element, then average spatial/channel axes successively.
    This is the same group mean and biased variance, with the original affine
    parameters and epsilon. Eager calls still use native PyTorch GroupNorm,
    so parity and saved browser references never compare against this rewrite.
    """
    def __init__(self, layer):
        super().__init__()
        self.layer = layer

    def forward(self, x):
        if not torch.onnx.is_in_onnx_export():
            return self.layer(x)
        layer = self.layer
        grouped = x.reshape(x.shape[0], layer.num_groups, x.shape[1] // layer.num_groups, *x.shape[2:])
        anchor = grouped[(slice(None), slice(None)) + (slice(0, 1),) * (grouped.dim() - 2)]

        def mean(value):
            for axis in range(value.dim() - 1, 1, -1):
                value = value.mean(axis, keepdim=True)
            return value

        shifted = grouped - anchor
        centered = shifted - mean(shifted)
        normalized = (centered / torch.sqrt(mean(centered * centered) + layer.eps)).reshape_as(x)
        if layer.affine:
            shape = (1, -1) + (1,) * (x.dim() - 2)
            normalized = normalized * layer.weight.reshape(shape) + layer.bias.reshape(shape)
        return normalized


@contextmanager
def stable_group_norm_export(model, enabled):
    """Temporarily wrap existing layers and always restore original objects."""
    replacements = []
    try:
        if not enabled:
            yield model
            return
        if isinstance(model, nn.GroupNorm):
            yield StableGroupNorm(model)
            return

        def visit(parent):
            for key, child in list(parent.named_children()):
                if isinstance(child, nn.GroupNorm):
                    replacements.append((parent, key, child))
                    parent._modules[key] = StableGroupNorm(child)
                else:
                    visit(child)

        visit(model)
        yield model
    finally:
        for parent, key, child in reversed(replacements):
            parent._modules[key] = child


def parity_stats(actual, expected, *, rtol=2e-3, atol=2e-4, threshold=None):
    """Use the original elementwise bound; diagnostics never relax acceptance."""
    actual, expected = np.asarray(actual), np.asarray(expected)
    stats = dict(actual_shape=list(actual.shape), expected_shape=list(expected.shape), rtol=rtol, atol=atol)
    if actual.shape != expected.shape:
        return dict(stats, passed=False, reason='shape_mismatch')
    if not np.isfinite(actual).all() or not np.isfinite(expected).all():
        return dict(stats, passed=False, reason='nonfinite_output')
    error = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    failures = error > atol + rtol * np.abs(expected.astype(np.float64))
    stats.update(passed=not bool(failures.any()), elements=int(error.size),
                 mismatched_elements=int(failures.sum()), max_absolute_error=float(error.max()),
                 mean_absolute_error=float(error.mean()), p99_absolute_error=float(np.quantile(error, .99)))
    if threshold is not None:
        stats.update(threshold=threshold, threshold_flip_count=int(((actual >= threshold) != (expected >= threshold)).sum()))
    return stats
