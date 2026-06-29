import fs from 'node:fs'

const patches = [
  'apply-freehand-move-patch.mjs',
  'apply-ai-overlay-patch.mjs',
  'apply-ai-compare-panel-patch.mjs',
  'apply-ai-compare-style-patch.mjs',
  'apply-ai-compare-flicker-fix.mjs',
  'apply-ai-mask-display-threshold-fix.mjs',
  'apply-app-js-syntax-repair.mjs',
  'apply-ai-compare-zoom-patch.mjs',
  'apply-ai-compare-zoom-style-patch.mjs',
  'apply-ai-folder-reconnect-patch.mjs',
  'apply-ai-compare-canvas-render-patch.mjs',
  'apply-ai-compare-mainlike-pan-patch.mjs',
  'apply-ai-compare-main-wheel-quality-patch.mjs',
  'apply-notes-patch.mjs',
  'apply-notes-load-repair.mjs',
  'apply-notes-syntax-fix.mjs',
  'apply-presence-api-compat-patch.mjs',
  'apply-ai-review-page-patch.mjs',
  'apply-ai-review-binary-png-fallback.mjs',
  'apply-ai-review-source-card-quality-patch.mjs',
  'apply-restored-label-scale-refresh-patch.mjs',
  'apply-label-overlay-toggle-patch.mjs',
  'apply-label-name-toggle-only-patch.mjs',
  'apply-mask-fill-visibility-and-notes-fix.mjs',
  'apply-label-visibility-final-fix.mjs',
  'apply-human-label-toggles-correct-final.mjs',
  'apply-visibility-module-refactor.mjs',
  'apply-auth-and-notes-module-refactor.mjs',
  'apply-annotator-ai-methods-repair.mjs',
  // Hard guard: must run after refactors that may remove AI mask methods.
  'apply-hard-ai-image-load-fix.mjs',
  // Manual vertebra relabeling: changing one label cascades below it.
  'apply-cascade-label-reassignment-patch.mjs',
  // Femoral head / hip center labeling.
  'apply-pelvis-labels-patch.mjs',
  'apply-pelvis-label-controls-call-fix.mjs',
  'apply-lat-pelvis-labels-patch.mjs',
  'apply-pelvis-label-behavior-fix.mjs',
  // Sidebar and final pelvis runtime guards.
  'apply-right-sidebar-compact-ui-patch.mjs',
  'apply-right-sidebar-compact-ui-call-fix.mjs',
  'apply-right-sidebar-layout-repair.mjs',
  'apply-pelvis-runtime-final-fix.mjs',
  'apply-pelvis-panel-collapse-hard-fix.mjs',
  // Current-image sagittal alignment measurements.
  'apply-sagittal-measurements-patch.mjs',
  'apply-measurement-debug-overlay-patch.mjs',
  'apply-endplate-edge-estimation-patch.mjs',
  'apply-lat-5point-landmarks-patch.mjs',
  'apply-lat-5point-landmarks-runtime-fix.mjs',
  'apply-right-sidebar-scroll-measure-collapse-fix.mjs',
  'apply-lat-landmark-version-compact-label-fix.mjs',
  'apply-lat-4corner-centroid-mode-patch.mjs',
  'apply-lat-landmark-collapse-delete-key-patch.mjs',
  'apply-ai-compare-helper-dedupe-hard-fix.mjs',
  'apply-landmark-mode-toolbar-patch.mjs',
  // Must run near the end: older build patches can insert duplicate helper functions.
  'apply-generated-js-dedupe.mjs',
  // Must run last: fail the build if critical runtime guards are missing.
  'verify-build-output.mjs',
]

console.log('\n=== Spine Annotator build patches ===')
for (const patch of patches) {
  const path = `scripts/${patch}`
  if (!fs.existsSync(path)) {
    throw new Error(`Missing build patch: ${path}`)
  }
  console.log(`\n--- ${patch} ---`)
  await import(`./${patch}`)
}
console.log('\n=== Build patches complete ===')
