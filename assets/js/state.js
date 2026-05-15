export const state = {
  config: null,
  samples: [],
  qc: [],
  pca: null,
  distance: null,
  counts: [],
  geneAnnotation: [],
  contrasts: [],
  deResults: new Map(),
  enrichmentResults: new Map(),
  provenance: null,
  software: null,
  loadedTabs: new Set(),
};

export function setStatus(message) {
  const el = document.getElementById('status-bar');
  if (el) el.textContent = message;
}

export function logAnalysis(message) {
  const el = document.getElementById('analysis-log');
  const stamp = new Date().toLocaleTimeString();
  if (el) el.textContent += `[${stamp}] ${message}\n`;
}

export function getSampleById(sampleId) {
  return state.samples.find((sample) => sample.sample_id === sampleId);
}

export function metadataColumns() {
  const protectedKeys = new Set(['sample_id']);
  const keys = new Set();
  state.samples.forEach((sample) => Object.keys(sample).forEach((key) => {
    if (!protectedKeys.has(key)) keys.add(key);
  }));
  return Array.from(keys).sort();
}
