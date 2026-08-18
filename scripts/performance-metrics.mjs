export const percentile75 = (values) => {
  if (!values.length) throw new Error('At least one performance sample is required.');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.75) - 1];
};

export const summarizePerformanceResults = (results) => ({
  coldBrowseMsP75: percentile75(results.coldBrowseMs),
  coldBrowseMsMaximum: Math.max(...results.coldBrowseMs),
  warmBrowseMsP75: percentile75(results.warmBrowseMs),
  lcpMsP75: percentile75(results.lcpMs),
  inpMsP75: percentile75(results.inpMs),
  clsP75: percentile75(results.cls),
  localInteractionMsP75: percentile75(results.localInteractionMs),
  mutationAckMsP75: percentile75(results.mutationAckMs),
  mutationCompleteMsP75: percentile75(results.mutationCompleteMs),
});

export const validatePerformanceResults = (results) => {
  const summary = summarizePerformanceResults(results);
  const failures = [
    [results.lcpMs.some((value) => value <= 0), 'LCP was not observed'],
    [results.inpMs.some((value) => value <= 0), 'INP was not observed'],
    [summary.coldBrowseMsP75 > 1_500, 'cold browse p75 exceeds 1,500 ms'],
    [summary.coldBrowseMsMaximum >= 2_500, 'a cold browse reached the 2,500 ms hard ceiling'],
    [summary.warmBrowseMsP75 > 300, 'warm browse p75 exceeds 300 ms'],
    [summary.lcpMsP75 > 1_500, 'LCP p75 exceeds 1,500 ms'],
    [summary.inpMsP75 > 100, 'INP p75 exceeds 100 ms'],
    [summary.clsP75 > 0.05, 'CLS p75 exceeds 0.05'],
    [summary.localInteractionMsP75 > 100, 'local interaction p75 exceeds 100 ms'],
    [summary.mutationAckMsP75 > 100, 'mutation acknowledgement p75 exceeds 100 ms'],
    [summary.mutationCompleteMsP75 > 1_000, 'mutation completion p75 exceeds 1,000 ms'],
  ].filter(([failed]) => failed);
  if (failures.length) {
    throw new Error(
      `Performance acceptance failed: ${failures.map(([, message]) => message).join('; ')}`,
    );
  }
  return summary;
};
