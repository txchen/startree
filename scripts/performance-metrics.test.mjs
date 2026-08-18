import assert from 'node:assert/strict';
import test from 'node:test';

import { percentile75, validatePerformanceResults } from './performance-metrics.mjs';

test('performance acceptance uses the 75th percentile rather than the best run', () => {
  assert.equal(percentile75([80, 20, 100, 40, 60]), 80);
});

test('performance acceptance enforces cold, warm, interaction, and Web Vital targets', () => {
  assert.doesNotThrow(() =>
    validatePerformanceResults({
      coldBrowseMs: [1_400, 1_450, 1_500, 1_300, 1_200],
      warmBrowseMs: [250, 280, 290, 240, 200],
      lcpMs: [1_400, 1_450, 1_500, 1_300, 1_200],
      inpMs: [80, 90, 100, 70, 60],
      cls: [0.01, 0.02, 0.05, 0, 0.03],
      localInteractionMs: [80, 90, 100, 70, 60],
      mutationAckMs: [50],
      mutationCompleteMs: [800],
    }),
  );
  assert.throws(
    () =>
      validatePerformanceResults({
        coldBrowseMs: [2_501],
        warmBrowseMs: [301],
        lcpMs: [1_501],
        inpMs: [101],
        cls: [0.051],
        localInteractionMs: [101],
        mutationAckMs: [101],
        mutationCompleteMs: [1_001],
      }),
    /Performance acceptance failed/,
  );
});
