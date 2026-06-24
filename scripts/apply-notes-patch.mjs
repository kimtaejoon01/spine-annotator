#!/usr/bin/env node

// The original notes patch was too strict when rerun after other build patches.
// Delegate to the idempotent implementation so repeated local builds do not fail.
import './apply-notes-patch-safe.mjs'
