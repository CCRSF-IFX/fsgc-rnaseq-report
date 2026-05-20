import { state, logAnalysis, setStatus, yieldToBrowser } from './state.js';
import { sampleIdsInCounts } from './analysis.js';
import { gseaResultCurves } from './enrichment.js';
import { metadataSchemaForCache, restoreMetadataSchemaFromCache } from './metadataSchema.js';

const CACHE_KIND = 'rnaseq-report-analysis-cache';
const CACHE_VERSION = 6;
const CACHE_CLOSE_GUIDE = 'If the browser says "Changes you made may not be saved.", stay on this page and export your analysis cache before closing. Open Methods & Export, click Export cache, and save the .analysis-cache JSON file.';

let cacheControlsWired = false;
let cacheDirty = false;
let cacheCallbacks = {};
let cacheBusy = false;

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
  setAnalysisCacheStatus(`${CACHE_CLOSE_GUIDE} Reopen the report later and use Load cache to restore the saved results.`);
  if (reason) logAnalysis(`Analysis cache has unsaved results: ${reason}`);
}

function markAnalysisCacheClean(message = '') {
  cacheDirty = false;
  updateAnalysisCacheControls();
  if (message) setAnalysisCacheStatus(message);
}

async function exportAnalysisCache() {
  setAnalysisCacheBusy(true);
  try {
    setAnalysisCacheProgress('Preparing export', 'Collecting results', 0.12);
    setStatus('Analysis cache: preparing export', { busy: true, progress: 0.12 });
    await yieldToBrowser();

    const cache = buildAnalysisCache();
    if (!cache.de_results.length && !cache.gsea_results.length) {
      hideAnalysisCacheProgress();
      setAnalysisCacheStatus('No DESeq2 or fgsea results are available to export.');
      return;
    }

    setAnalysisCacheProgress('Preparing export', 'Serializing JSON', 0.48);
    setStatus('Analysis cache: serializing JSON', { busy: true, progress: 0.48 });
    await yieldToBrowser();
    const payload = `${JSON.stringify(cache, null, 2)}\n`;

    const filename = analysisCacheFilename(cache);
    setAnalysisCacheProgress('Preparing export', `${formatBytes(payload.length)} ready`, 0.82);
    setStatus('Analysis cache: preparing download', { busy: true, progress: 0.82 });
    await yieldToBrowser();
    downloadTextFile(filename, payload, 'application/json');

    const metadataNote = cache.sample_metadata?.rows?.length
      ? ` and ${cache.sample_metadata.rows.length} sample metadata row(s)`
      : '';
    setAnalysisCacheProgress('Cache exported', filename, 1, 'ok');
    markAnalysisCacheClean(`Exported cache with ${cache.de_results.length} DESeq2 result set(s), ${cache.gsea_results.length} fgsea result set(s)${metadataNote}.`);
    setStatus('Analysis cache exported', { tone: 'ok', progress: 1 });
    logAnalysis(`Analysis cache exported to ${filename}.`);
  } catch (error) {
    setAnalysisCacheProgress('Export failed', error.message, 1, 'fail');
    setAnalysisCacheStatus(`Cache export failed: ${error.message}`);
    setStatus('Analysis cache export failed', { tone: 'fail' });
    logAnalysis(`Analysis cache export failed: ${error.message}`);
  } finally {
    setAnalysisCacheBusy(false);
  }
}

async function importAnalysisCacheFromInput(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  setAnalysisCacheBusy(true);
  try {
    setAnalysisCacheProgress('Loading cache', `Reading ${file.name}`, 0.1);
    setStatus('Analysis cache: reading file', { busy: true, progress: 0.1 });
    const text = await readCacheFileText(file);

    setAnalysisCacheProgress('Loading cache', 'Parsing JSON', 0.62);
    setStatus('Analysis cache: parsing JSON', { busy: true, progress: 0.62 });
    await yieldToBrowser();
    const cache = parseAnalysisCache(JSON.parse(text));

    setAnalysisCacheProgress('Loading cache', 'Restoring results', 0.78);
    setStatus('Analysis cache: restoring results', { busy: true, progress: 0.78 });
    await yieldToBrowser();
    const restored = restoreAnalysisCache(cache);
    const metadataNote = restored.sampleMetadata
      ? ` and ${restored.sampleMetadataRows} sample metadata row(s)`
      : '';
    markAnalysisCacheClean(`Loaded cache with ${cache.de_results.length} DESeq2 result set(s), ${cache.gsea_results.length} fgsea result set(s)${metadataNote}.`);
    logAnalysis(`Analysis cache loaded from ${file.name}.`);
    setAnalysisCacheProgress('Cache loaded', file.name, 1, 'ok');
    await refreshImportedAnalysis(cache, restored);
  } catch (error) {
    setAnalysisCacheProgress('Load failed', error.message, 1, 'fail');
    setAnalysisCacheStatus(`Cache load failed: ${error.message}`);
    setStatus('Analysis cache load failed', { tone: 'fail' });
    logAnalysis(`Analysis cache load failed: ${error.message}`);
  } finally {
    setAnalysisCacheBusy(false);
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
    sample_metadata: sampleMetadataCacheEntry(),
    analysis_scopes: plainRows(state.analysisScopes || []),
    contrasts,
    de_analyses: contrasts.map(deAnalysisCacheEntry).filter(Boolean),
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
  if (![1, 2, 3, 4, 5, CACHE_VERSION].includes(version)) {
    throw new Error(`Unsupported cache version: ${value.cache_version || 'unknown'}.`);
  }
  if (!Array.isArray(value.de_results) || !Array.isArray(value.gsea_results)) {
    throw new Error('Cache file must include de_results and gsea_results arrays.');
  }
  return {
    ...value,
    cache_version: version,
    contrasts: Array.isArray(value.contrasts) ? value.contrasts : [],
    analysis_scopes: Array.isArray(value.analysis_scopes) ? value.analysis_scopes : [],
    de_analyses: Array.isArray(value.de_analyses) ? value.de_analyses : [],
    sample_metadata: parseSampleMetadataCache(value.sample_metadata),
  };
}

function restoreAnalysisCache(cache) {
  const restored = restoreCachedSampleMetadata(cache.sample_metadata);
  restoreAnalysisScopes(cache.analysis_scopes);
  const contrastById = new Map(state.contrasts.map((contrast) => [contrast.id, contrast]));
  cache.contrasts.forEach((contrast) => {
    if (!contrast?.id) return;
    contrastById.set(contrast.id, {
      ...contrastById.get(contrast.id),
      ...plainObject(contrast),
      cached: true,
    });
  });
  cache.de_analyses.forEach((analysis) => {
    const id = analysis?.contrast_id;
    if (!id) return;
    contrastById.set(id, {
      ...contrastById.get(id),
      ...plainObject(analysis),
      id,
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
      curve_limit: entry.curve_limit ?? entry.top_n_pathway_plots ?? '',
      curve_up_limit: entry.curve_up_limit ?? '',
      curve_down_limit: entry.curve_down_limit ?? '',
      created_at: entry.created_at || '',
      enrichment_curves: plainGseaCurves(entry.enrichment_curves || entry.curves),
      rows: plainRows(entry.rows),
    });
  });

  state.contrasts = Array.from(contrastById.values());
  return restored;
}

function restoreAnalysisScopes(scopes = []) {
  if (!Array.isArray(scopes) || !scopes.length) return;
  const byId = new Map((state.analysisScopes || []).map((scope) => [scope.id, scope]));
  scopes.forEach((scope) => {
    if (!scope?.id) return;
    byId.set(scope.id, {
      ...scope,
      cached: true,
    });
  });
  state.analysisScopes = Array.from(byId.values());
}

async function refreshImportedAnalysis(cache, restored = {}) {
  if (restored.sampleMetadata && cacheCallbacks.refresh) {
    await cacheCallbacks.refresh();
  } else {
    cacheCallbacks.populateContrastSelectors?.();
    cacheCallbacks.renderOverviewMetrics?.();
    cacheCallbacks.renderAnalysisReadiness?.();
  }
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
  event.returnValue = CACHE_CLOSE_GUIDE;
  setAnalysisCacheStatus(CACHE_CLOSE_GUIDE);
}

function updateAnalysisCacheControls() {
  const exportButton = document.getElementById('analysis-cache-export');
  if (exportButton) exportButton.disabled = cacheBusy || !hasAnalysisCacheResults();
  const cacheInput = document.getElementById('analysis-cache-file');
  if (cacheInput) cacheInput.disabled = cacheBusy;
  const guide = document.getElementById('analysis-cache-guide');
  if (guide) guide.classList.toggle('is-unsaved', cacheDirty && hasAnalysisCacheResults());
}

function hasAnalysisCacheResults() {
  return state.deResults.size > 0 || state.enrichmentResults.size > 0;
}

function setAnalysisCacheStatus(message) {
  const status = document.getElementById('analysis-cache-status');
  if (status) status.textContent = message;
}

function setAnalysisCacheBusy(busy) {
  cacheBusy = Boolean(busy);
  updateAnalysisCacheControls();
}

function setAnalysisCacheProgress(title, detail, progress = null, tone = '') {
  const container = document.getElementById('analysis-cache-progress');
  if (!container) return;
  const titleEl = document.getElementById('analysis-cache-progress-title');
  const detailEl = document.getElementById('analysis-cache-progress-detail');
  const fill = document.getElementById('analysis-cache-progress-fill');
  container.hidden = false;
  container.className = `operation-progress ${tone || ''}`.trim();
  const value = Number(progress);
  const hasProgress = Number.isFinite(value);
  container.classList.toggle('is-indeterminate', !hasProgress);
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail || '';
  if (fill) fill.style.width = hasProgress ? `${Math.max(0, Math.min(100, value * 100)).toFixed(0)}%` : '';
}

function hideAnalysisCacheProgress() {
  const container = document.getElementById('analysis-cache-progress');
  if (container) container.hidden = true;
}

function downloadTextFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readCacheFileText(file) {
  if (!file.stream || !globalThis.TextDecoder) {
    const text = await file.text();
    setAnalysisCacheProgress('Loading cache', `${formatBytes(text.length)} read`, 0.55);
    return text;
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let received = 0;
  const total = Math.max(1, Number(file.size) || 1);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
    received += value.length || 0;
    setAnalysisCacheProgress('Loading cache', `${formatBytes(received)} of ${formatBytes(total)}`, Math.min(0.55, 0.1 + (received / total) * 0.45));
    await yieldToBrowser();
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

function plainRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(plainObject);
}

function plainObject(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, item ?? '']));
}

function deAnalysisCacheEntry(contrast) {
  if (!contrast?.id) return null;
  const hasPhaseOneMetadata = [
    'question_type',
    'scope_id',
    'full_model',
    'contrast_label',
    'sample_count',
    'group_balance',
  ].some((key) => contrast[key] !== undefined && contrast[key] !== '');
  if (!hasPhaseOneMetadata) return null;
  return {
    contrast_id: contrast.id,
    question_type: contrast.question_type || '',
    question_label: contrast.question_label || '',
    result_family: contrast.result_family || '',
    scope_id: contrast.scope_id || '',
    scope_label: contrast.scope_label || '',
    full_model: contrast.full_model || contrast.design || '',
    reduced_model: contrast.reduced_model || '',
    contrast_label: contrast.contrast_label || '',
    sample_count: contrast.sample_count || '',
    primary_factor: contrast.primary_factor || contrast.column || '',
    numerator: contrast.numerator || '',
    denominator: contrast.denominator || '',
    adjust_columns: contrast.adjust_columns || contrast.adjustColumns || [],
    model_kind: contrast.model_kind || '',
    result_mode: contrast.result_mode || '',
    test_label: contrast.test_label || '',
    condition_factor: contrast.condition_factor || '',
    modifier_factor: contrast.modifier_factor || '',
    condition_numerator: contrast.condition_numerator || '',
    condition_denominator: contrast.condition_denominator || '',
    modifier_numerator: contrast.modifier_numerator || '',
    modifier_denominator: contrast.modifier_denominator || '',
    tested_terms: contrast.tested_terms || [],
    coefficient_name: contrast.coefficient_name || '',
    group_factors: contrast.group_factors || [],
    group_balance: contrast.group_balance || {},
    method: contrast.method || '',
  };
}

function sampleMetadataCacheEntry() {
  const rows = plainRows(state.samples);
  if (!rows.length || !hasMetadataColumns(rows)) return null;
  return {
    source: state.provenance?.sample_manifest || state.provenance?.samples_file || 'current report sample metadata',
    schema: metadataSchemaForCache(),
    rows,
  };
}

function hasMetadataColumns(rows) {
  return rows.some((row) => Object.keys(row).some((key) => key !== 'sample_id' && String(row[key] ?? '').trim() !== ''));
}

function parseSampleMetadataCache(value) {
  const rows = Array.isArray(value) ? value : value?.rows;
  if (!Array.isArray(rows) || !rows.length) return null;
  const normalizedRows = plainRows(rows).filter((row) => String(row.sample_id || '').trim());
  if (!normalizedRows.length) return null;
  return {
    source: typeof value?.source === 'string' ? value.source : 'analysis cache',
    schema: value?.schema && typeof value.schema === 'object' ? value.schema : {},
    rows: normalizedRows,
  };
}

function restoreCachedSampleMetadata(sampleMetadata) {
  if (!sampleMetadata?.rows?.length) return { sampleMetadata: false, sampleMetadataRows: 0 };
  const matched = sampleIdsInCounts(sampleMetadata.rows, state.counts);
  if (state.counts.length && matched.length < 2) {
    logAnalysis('Analysis cache includes sample metadata, but fewer than two sample IDs match the current count matrix; keeping current sample metadata.');
    return { sampleMetadata: false, sampleMetadataRows: 0 };
  }
  state.samples = sampleMetadata.rows;
  restoreMetadataSchemaFromCache(sampleMetadata.schema || {});
  state.provenance = {
    ...(state.provenance || {}),
    sample_manifest: sampleMetadata.source || 'analysis cache',
    sample_metadata_source: 'analysis cache',
  };
  logAnalysis(`Analysis cache restored ${sampleMetadata.rows.length} sample metadata row(s).`);
  return { sampleMetadata: true, sampleMetadataRows: sampleMetadata.rows.length };
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
    curve_limit: value.curve_limit ?? value.top_n_pathway_plots ?? '',
    curve_up_limit: value.curve_up_limit ?? '',
    curve_down_limit: value.curve_down_limit ?? '',
    created_at: value.created_at || '',
    enrichment_curves: plainGseaCurves(gseaResultCurves(value)),
    rows: plainRows(value.rows),
  };
}

function plainGseaCurves(curves) {
  return (Array.isArray(curves) ? curves : []).map((curve) => ({
    term_id: curve.term_id || '',
    term_name: curve.term_name || curve.term_id || '',
    enrichmentScore: curve.enrichmentScore ?? '',
    NES: curve.NES ?? '',
    padj: curve.padj ?? '',
    size: curve.size ?? '',
    totalRanks: curve.totalRanks ?? '',
    points: plainRows(curve.points),
    hits: plainRows(curve.hits),
  })).filter((curve) => curve.term_id && curve.points.length);
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
    entry.curve_limit ? `plots${entry.curve_limit}` : '',
    entry.curve_up_limit ? `up${entry.curve_up_limit}` : '',
    entry.curve_down_limit ? `down${entry.curve_down_limit}` : '',
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

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value.toFixed(0)} B`;
  const units = ['KB', 'MB', 'GB'];
  let current = value / 1024;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current >= 10 ? current.toFixed(1) : current.toFixed(2)} ${units[unitIndex]}`;
}
