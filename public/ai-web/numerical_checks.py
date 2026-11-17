"""Fixed, shared CPU/browser bounds for synthetic A probability-map checks.

These check conversion consistency, not accuracy on real radiographs. Bounds
are app code, never values supplied by a model manifest.
"""
import numpy as np

A_PROBABILITY_POLICY = 'a-probability-v1'


def a_probability_stats(actual, expected):
    actual, expected = np.asarray(actual), np.asarray(expected)
    stats = dict(policy=A_PROBABILITY_POLICY, passed=False)
    if actual.shape != expected.shape or actual.size == 0:
        return dict(stats, reason='shape_mismatch_or_empty')
    if not np.isfinite(actual).all() or not np.isfinite(expected).all():
        return dict(stats, reason='nonfinite_output')
    if actual.min() < 0 or actual.max() > 1 or expected.min() < 0 or expected.max() > 1:
        return dict(stats, reason='outside_probability_range')
    error = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    a, b = actual >= .5, expected >= .5
    flips = int((a != b).sum())
    intersection, union = int((a & b).sum()), int((a | b).sum())
    stats.update(max_absolute_error=float(error.max()), mean_absolute_error=float(error.mean()),
                 p99_absolute_error=float(np.quantile(error, .99)), threshold=.5,
                 threshold_flip_count=flips, threshold_flip_fraction=flips / error.size,
                 foreground_iou=intersection / union if union else 1., elements=int(error.size))
    limits = dict(max_absolute_error=.002, mean_absolute_error=.00001,
                  p99_absolute_error=.0001, threshold_flip_fraction=.00001)
    stats.update(limits=limits, passed=all(stats[k] <= limit for k, limit in limits.items()))
    return stats
