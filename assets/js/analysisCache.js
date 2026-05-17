import { state, logAnalysis, setStatus } from './state.js';

const CACHE_KIND = 'rnaseq-report-analysis-cache';
const CACHE_VERSION = 2;

let cacheControlsWired = false;
let cacheDirty = false;
let cacheCallbacks = {};

export function setupAnalysisCacheControls(callbacks = {}) {
  cacheCallbacks = callbacks;
  updateAnalysisCacheControls();
  if (cacheControlsWired) return;
  cacheControlsWired = true;

  document.getElementById('analysis-cache-export')?.addEventListener('click', exportAnalysisCache);
  document.getElementById('analysis-cache-file')?.addEventListener('change', importAnalysisCacheFromInput);
  globalThis.addEventListener('beforeunload', warnIfAnalysisCacheUnsaved);
}

export function markAnalysisCacheDirty(reason = '') {
  cacheDirty = true;
  updateAnalysisCacheControls();
  setAnalysisCacheStatus('Unsaved browser analysis results are available. Export a cache before closing the tab to reuse DESeq2 and all fgsea result sets later.');
  if (reason) logAnalysis(`Analysis cache has unsaved results: ${reason}`);
}

function markAnalysisCacheClean(message = '') {
  cacheDirty = false;
  updateAnalysisCacheControls();
  if (message) setAnalysisCacheStatus(message);
}

function exportAnalysisCache() {
  const cache = buildAnalysisCache();
  if (!cache.de_results.length && !cache.gsea_results.length) {
    setAnalysisCacheStatus('No DESeq2 or fgsea results are available to export.');
    return;
  }

  const blob = new Blob([`${JSON.stringify(cache, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = analysisCacheFilename(cache);
  a.click();
  URL.revokeObjectURL(url);
  markAnalysisCacheClean(`Exported cache with ${cache.de_results.length} DESeq2 result set(s) and ${cache.gsea_results.length} fgsea result set(s).`);
  logAnalysis('Analysis cache exported.');
}

async function importAnalysisCacheFromInput(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  try {
    const cache = parseAnalysisCache(JSON.parse(await file.text()));
    restoreAnalysisCache(cache);
    markAnalysisCacheClean(`Loaded cache with ${cache.de_results.length} DESeq2 result set(s) and ${cache.gsea_results.length} fgsea result set(s).`);
    logAnalysis(`Analysis cache loaded from ${file.name}.`);
    await refreshImportedAnalysis(cache);
  } catch (error) {
    setAnalysisCacheStatus(`Cache load failed: ${error.message}`);
    logAnalysis(`Analysis cache load failed: ${error.message}`);
  } finally {
    event.target.value = '';
  }
}

function buildAnalysisCache() {
  const contrastIds = new Set([
    ...state.deResults.keys(),
    ...Array.from(state.enrichmentResults.entries()).map(([key, value]) => gseaCacheContrastId(key, value)),
  ]);
  const contrasts = Array.from(contrastIds).map((id) => {
    const contrast = state.contrasts.find((item) => item.id === id) || { id, label: id };
    return plainObject(contrast);
  });

  return {
    cache_kind: CACHE_KIND,
    cache_version: CACHE_VERSION,
    created_at: new Date().toISOString(),
    project_title: state.config?.projectTitle || state.config?.reportTitle || '',
    run_id: state.config?.runId || '',
    data_root: state.config?.dataRoot || 'assets/data',
    contrasts,
    de_results: Array.from(state.deResults.entries()).map(([contrast_id, rows]) => ({
      contrast_id,
      rows: plainRows(rows),
    })),
    gsea_results: Array.from(state.enrichmentResults.entries()).map(([key, value]) => gseaCacheEntry(key, value)),
  };
}

function parseAnalysisCache(value) {
  if (!value || typeof value !== 'object') throw new Error('Cache file is not a JSON object.');
  if (value.cache_kind !== CACHE_KIND) throw new Error('Cache file is not an RNA-seq report analysis cache.');
  const version = Number(value.cache_version);
  if (![1, CACHE_VERSION].includes(version)) {
    throw new Error(`Unsupported cache version: ${value.cache_version || 'unknown'}.`);
  }
  if (!Array.isArray(value.de_results) || !Array.isArray(value.gsea_results)) {
    throw new Error('Cache file must include de_results and gsea_results arrays.');
  }
  return {
    ...value,
    cache_version: version,
    contrasts: Array.isArray(value.contrasts) ? value.contrasts : [],
  };
}

function restoreAnalysisCache(cache) {
  const contrastById = new Map(state.contrasts.map((contrast) => [contrast.id, contrast]));
  cache.contrasts.forEach((contrast) => {
    if (!contrast?.id) return;
    contrastById.set(contrast.id, {
      ...contrastById.get(contrast.id),
      ...plainObject(contrast),
      cached: true,
    });
  });

  cache.de_results.forEach((entry) => {
    if (!entry?.contrast_id || !Array.isArray(entry.rows)) return;
    if (!contrastById.has(entry.contrast_id)) {
      contrastById.set(entry.contrast_id, {
        id: entry.contrast_id,
        label: entry.contrast_id,
        cached: true,
      });
    }
    state.deResults.set(entry.contrast_id, plainRows(entry.rows));
  });

  cache.gsea_results.forEach((entry) => {
    if (!entry?.contrast_id || !Array.isArray(entry.rows)) return;
    if (!contrastById.has(entry.contrast_id)) {
      contrastById.set(entry.contrast_id, {
        id: entry.contrast_id,
        label: entry.contrast_id,
        cached: true,
      });
    }
    const resultId = entry.result_id || gseaCacheResultId(entry);
    state.enrichmentResults.set(resultId, {
      result_id: resultId,
      contrast_id: entry.contrast_id,
      label: entry.label || entry.source_label || entry.reference || entry.contrast_id,
      source_kind: entry.source_kind || (cache.cache_version === 1 ? 'legacy-cache' : ''),
      source_id: entry.source_id || entry.reference || resultId,
      source_label: entry.source_label || entry.reference || 'Cached GSEA result',
      reference: entry.reference || '',
      min_size: entry.min_size ?? '',
      max_size: entry.max_size ?? '',
      created_at: entry.created_at || '',
      rows: plainRows(entry.rows),
    });
  });

  state.contrasts = Array.from(contrastById.values());
}

async function refreshImportedAnalysis(cache) {
  cacheCallbacks.populateContrastSelectors?.();
  cacheCallbacks.renderOverviewMetrics?.();
  cacheCallbacks.renderAnalysisReadiness?.();
  const firstContrastId = cache.de_results[0]?.contrast_id || cache.gsea_results[0]?.contrast_id || '';
  const firstGseaResultId = cache.gsea_results[0]?.result_id || (cache.gsea_results[0] ? gseaCacheResultId(cache.gsea_results[0]) : '');
  for (const id of ['contrast-select', 'enrichment-contrast-select']) {
    const select = document.getElementById(id);
    if (select && firstContrastId) select.value = firstContrastId;
  }
  await cacheCallbacks.renderCurrentContrast?.();
  await cacheCallbacks.renderCurrentEnrichment?.({ resultId: firstGseaResultId });
  setStatus('Analysis cache loaded');
}

function warnIfAnalysisCacheUnsaved(event) {
  if (!cacheDirty || !hasAnalysisCacheResults()) return;
  event.preventDefault();
  event.returnValue = '';
}

function updateAnalysisCacheControls() {
  const exportButton = document.getElementById('analysis-cache-export');
  if (exportButton) exportButton.disabled = !hasAnalysisCacheResults();
}

function hasAnalysisCacheResults() {
  return state.deResults.size > 0 || state.enrichmentResults.size > 0;
}

function setAnalysisCacheStatus(message) {
  const status = document.getElementById('analysis-cache-status');
  if (status) status.textContent = message;
}

function plainRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(plainObject);
}

function plainObject(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, item ?? '']));
}

function gseaCacheEntry(key, value) {
  if (Array.isArray(value)) {
    return {
      result_id: key,
      contrast_id: key,
      source_kind: 'legacy',
      source_id: key,
      source_label: 'Legacy GSEA result',
      rows: plainRows(value),
    };
  }
  return {
    result_id: value.result_id || key,
    contrast_id: value.contrast_id || key,
    label: value.label || '',
    source_kind: value.source_kind || '',
    source_id: value.source_id || '',
    source_label: value.source_label || value.reference || '',
    reference: value.reference || '',
    min_size: value.min_size ?? '',
    max_size: value.max_size ?? '',
    created_at: value.created_at || '',
    rows: plainRows(value.rows),
  };
}

function gseaCacheContrastId(key, value) {
  return Array.isArray(value) ? key : (value?.contrast_id || key);
}

function gseaCacheResultId(entry) {
  return [
    entry.contrast_id,
    entry.source_kind || 'gsea',
    entry.source_id || entry.source_label || entry.reference || 'cached',
    entry.min_size ? `min${entry.min_size}` : '',
    entry.max_size ? `max${entry.max_size}` : '',
  ].map(slug).filter(Boolean).join('__') || `${entry.contrast_id || 'contrast'}__gsea`;
}

function analysisCacheFilename(cache) {
  const label = slug([cache.project_title, cache.run_id].filter(Boolean).join('-')) || 'rnaseq-report';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${label}.analysis-cache.${stamp}.json`;
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
