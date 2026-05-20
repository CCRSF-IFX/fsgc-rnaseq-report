import { state } from './state.js';
import {
  computeDifferentialExpression,
  computePcaFromCounts,
  computeSampleDistanceFromCounts,
  inferContrastsFromSamples,
} from './analysis.js';
import { normalizeQcMetrics } from './qc.js';
import { refreshMetadataSchema } from './metadataSchema.js';

const DE_NUMERIC_COLUMNS = new Set([
  'baseMean',
  'log2FoldChange',
  'lfcSE',
  'stat',
  'statistic',
  'pvalue',
  'padj',
  'mean_numerator',
  'mean_denominator',
]);

const ENRICHMENT_NUMERIC_COLUMNS = new Set([
  'pvalue',
  'padj',
  'ES',
  'NES',
  'size',
  'rank',
  'score',
  'runningScore',
  'nMoreExtreme',
  'log2err',
]);

const QC_NUMERIC_COLUMN_PATTERNS = [
  /^sample_yield/i,
  /^percent/i,
  /^pct_/i,
  /^total_/i,
  /^uniquely_/i,
  /^mapped_/i,
  /^median_/i,
  /^q30_/i,
  /_rate$/i,
  /_reads$/i,
  /_bases$/i,
];

const FSGC_GENE_ID_PATTERN = /^(ENS[A-Z]*G\d+(?:\.\d+)?)_(.+)$/i;

function getEmbeddedAsset(path) {
  const assets = globalThis.REPORT_EMBEDDED_ASSETS;
  return assets && Object.prototype.hasOwnProperty.call(assets, path) ? assets[path] : undefined;
}

export async function loadJson(path, required = false) {
  const embedded = getEmbeddedAsset(path);
  if (embedded !== undefined) {
    try {
      return JSON.parse(embedded);
    } catch (error) {
      if (required) throw new Error(`Required embedded JSON asset failed: ${path}: ${error.message}`);
      console.warn(`Optional embedded JSON asset invalid: ${path}`, error);
      return null;
    }
  }

  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (required) throw new Error(`Required JSON asset failed: ${path}: ${error.message}`);
    console.warn(`Optional JSON asset missing: ${path}`, error);
    return null;
  }
}

export async function loadText(path, required = false) {
  const embedded = getEmbeddedAsset(path);
  if (embedded !== undefined) return embedded;

  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    if (required) throw new Error(`Required text asset failed: ${path}: ${error.message}`);
    console.warn(`Optional text asset missing: ${path}`, error);
    return null;
  }
}

export function parseCsv(text, options = {}) {
  return parseDelimited(text, ',', options);
}

export function parseTsv(text, options = {}) {
  return parseDelimited(text, '\t', options);
}

export function parseDeCsv(text) {
  return parseCsv(text, { numericColumns: DE_NUMERIC_COLUMNS });
}

export function parseEnrichmentCsv(text) {
  return parseCsv(text, { numericColumns: ENRICHMENT_NUMERIC_COLUMNS });
}

export function parseQcCsv(text) {
  return parseCsv(text, { numericColumnPredicate: isKnownQcNumericColumn });
}

export function parseQcTsv(text) {
  return parseTsv(text, { numericColumnPredicate: isKnownQcNumericColumn });
}

export function normalizeStringRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : (Array.isArray(rows?.samples) ? rows.samples : []);
  return sourceRows.map((row) => Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), normalizeStringValue(value)]),
  ));
}

export function parseCountMatrix(text, filename = '') {
  const lower = String(filename || '').toLowerCase();
  const rows = lower.endsWith('.tsv') || lower.endsWith('.txt') ? parseTsv(text) : parseCsv(text);
  return normalizeCountMatrixRows(rows);
}

export function normalizeCountMatrixRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const first = sourceRows[0] || {};
  const columns = Object.keys(first);
  const geneIdColumn = findCountMetadataColumn(columns, ['gene_id']);
  const geneNameColumn = findCountMetadataColumn(columns, ['gene_name']);
  const geneSymbolColumn = findCountMetadataColumn(columns, ['gene_symbol']);
  const explicitIdentifierColumn = geneIdColumn || geneNameColumn || geneSymbolColumn;
  const fallbackIdentifierColumn = explicitIdentifierColumn || columns[0] || '';
  let inferredGeneSymbols = 0;
  let unmatchedIdentifierRows = 0;
  let usedFallbackIdentifierColumn = false;

  const normalizedRows = sourceRows.map((row) => {
    const next = { ...row };
    const currentSymbol = stripWrappingQuotes(geneSymbolColumn ? next[geneSymbolColumn] : next.gene_symbol);
    if (currentSymbol) {
      next.gene_symbol = currentSymbol;
      return next;
    }

    const rawIdentifier = stripWrappingQuotes(
      (geneIdColumn && next[geneIdColumn])
        || (geneNameColumn && next[geneNameColumn])
        || (fallbackIdentifierColumn && next[fallbackIdentifierColumn]),
    );
    const parsed = parseFsgcGeneIdentifier(rawIdentifier);
    if (parsed) {
      if (!explicitIdentifierColumn) usedFallbackIdentifierColumn = true;
      next.gene_id_raw = rawIdentifier;
      next.gene_id = parsed.geneId;
      next.gene_symbol = parsed.geneSymbol;
      inferredGeneSymbols += 1;
    } else {
      if (geneIdColumn && rawIdentifier) next.gene_id = rawIdentifier;
      else if (geneNameColumn && rawIdentifier) next.gene_name = rawIdentifier;
      if (rawIdentifier) unmatchedIdentifierRows += 1;
    }
    return next;
  });

  const warnings = [];
  if (!geneSymbolColumn && sourceRows.length > 0) {
    if (inferredGeneSymbols === 0) {
      warnings.push('No gene_symbol column was found, and gene_id values did not match the FSGC ENSG..._SYMBOL format. DESeq2 can still run, but custom gene lists and GSEA GMT files must use matching identifiers or include a gene_symbol column.');
    } else if (unmatchedIdentifierRows > 0) {
      warnings.push(`Inferred gene_symbol for ${inferredGeneSymbols.toLocaleString()} row(s) from FSGC-style gene_id values, but ${unmatchedIdentifierRows.toLocaleString()} row(s) did not match the ENSG..._SYMBOL format.`);
    }
  }

  return {
    rows: normalizedRows,
    warnings,
    info: {
      hasGeneSymbolColumn: Boolean(geneSymbolColumn),
      inferredGeneSymbols,
      unmatchedIdentifierRows,
      identifierColumn: fallbackIdentifierColumn,
      usedFallbackIdentifierColumn,
    },
  };
}

export function parseCountCell(value) {
  const text = normalizeStringValue(value).replace(/,/g, '');
  if (text === '') return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

export function validateCountMatrix(counts, sampleIds) {
  if (!Array.isArray(counts) || counts.length === 0) throw new Error('Count matrix must contain at least one gene row.');
  const ids = Array.from(new Set((sampleIds || []).filter(Boolean).map(String)));
  if (ids.length < 2) throw new Error('At least two sample columns are required to validate the count matrix.');
  const problems = [];
  counts.forEach((row, rowIndex) => {
    const gene = row.gene_id || row.gene_symbol || row.gene_name || `row ${rowIndex + 1}`;
    ids.forEach((sampleId) => {
      if (!Object.prototype.hasOwnProperty.call(row, sampleId)) return;
      const value = parseCountCell(row[sampleId]);
      if (value === null) {
        problems.push(`${gene}/${sampleId}="${row[sampleId] ?? ''}"`);
      }
    });
  });
  if (problems.length) {
    const preview = problems.slice(0, 5).join('; ');
    const extra = problems.length > 5 ? `; ${problems.length - 5} more` : '';
    throw new Error(`Count matrix has non-numeric, negative, or missing count values: ${preview}${extra}. Fractional expected counts are allowed and rounded for DESeq2.`);
  }
}

function parseDelimited(text, delimiter, options = {}) {
  if (!text) return [];
  const body = stripUtf8Bom(String(text));
  if (!body.trim()) return [];
  const lines = body.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headers = splitDelimitedLine(lines.shift(), delimiter).map(normalizeHeader);
  return lines.map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, i) => [header, parseValue(values[i], header, options)]));
  });
}

function splitDelimitedLine(line, delimiter) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
    else if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) { out.push(current); current = ''; }
    else current += ch;
  }
  out.push(current);
  return out;
}

function parseValue(value, header, options = {}) {
  const text = normalizeStringValue(value);
  if (text === '') return '';
  const numericColumns = options.numericColumns instanceof Set ? options.numericColumns : new Set(options.numericColumns || []);
  const numericPredicate = typeof options.numericColumnPredicate === 'function' ? options.numericColumnPredicate : null;
  if (numericColumns.has(header) || numericPredicate?.(header)) {
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

function normalizeStringValue(value) {
  if (value === undefined || value === null) return '';
  return stripUtf8Bom(String(value)).trim();
}

function stripWrappingQuotes(value) {
  let text = normalizeStringValue(value);
  while (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return text;
}

function findCountMetadataColumn(columns, names) {
  const allowed = new Set(names);
  return columns.find((column) => allowed.has(normalizeCountMetadataColumnName(column))) || '';
}

function normalizeCountMetadataColumnName(column) {
  return String(column || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
}

function parseFsgcGeneIdentifier(value) {
  const text = stripWrappingQuotes(value);
  const match = text.match(FSGC_GENE_ID_PATTERN);
  if (!match) return null;
  const geneSymbol = stripWrappingQuotes(match[2]);
  if (!geneSymbol) return null;
  return {
    geneId: match[1],
    geneSymbol,
  };
}

function normalizeHeader(value, index = 0) {
  const header = normalizeStringValue(value);
  return header || `column_${index + 1}`;
}

function stripUtf8Bom(value) {
  return String(value ?? '').replace(/^\uFEFF/, '');
}

function isKnownQcNumericColumn(column) {
  return QC_NUMERIC_COLUMN_PATTERNS.some((pattern) => pattern.test(String(column || '').trim()));
}

export async function loadCoreAssets() {
  state.config = await loadJson('assets/report_config.json', true);
  const dataRoot = state.config.dataRoot || 'assets/data';
  state.countMatrixWarnings = [];
  state.countMatrixInfo = null;
  state.counts = await loadCountMatrix(dataRoot);
  state.samples = await loadSampleMetadata(dataRoot, state.counts);
  state.qc = await loadQcMetrics(dataRoot);
  state.pca = await loadJson(`${dataRoot}/pca.json`, false);
  state.distance = await loadJson(`${dataRoot}/sample_distance_matrix.json`, false);
  state.geneAnnotation = [];
  state.geneAnnotationLoaded = false;
  state.contrasts = await loadJson(`${dataRoot}/contrast_list.json`, false) || [];
  state.provenance = await loadJson(`${dataRoot}/logs/pipeline_provenance.json`, false);
  state.software = await loadJson(`${dataRoot}/logs/software_versions.json`, false);

  state.samples = normalizeStringRows(state.samples);
  refreshMetadataSchema({ preserveUser: false });
  validateSamples(state.samples);
  validateCounts(state.counts);
  if (!state.pca) state.pca = computePcaFromCounts(state.counts, state.samples, state.config);
  if (!state.distance) state.distance = computeSampleDistanceFromCounts(state.counts, state.samples, state.config);
  if (state.contrasts.length === 0) state.contrasts = inferContrastsFromSamples(state.samples, state.config, state.metadataSchema);
  await loadDefaultAnalysisCache(dataRoot);
  validatePca(state.pca);
  if (state.distance) validateDistance(state.distance);
}

export async function loadGeneAnnotation(required = false) {
  if (state.geneAnnotationLoaded) return state.geneAnnotation;
  const dataRoot = state.config?.dataRoot || 'assets/data';
  state.geneAnnotation = await loadJson(`${dataRoot}/gene_annotation.json`, required) || [];
  state.geneAnnotationLoaded = true;
  return state.geneAnnotation;
}

async function loadSampleMetadata(dataRoot, counts) {
  const configured = state.config.sampleManifest || state.config.samplesFile;
  if (configured) {
    return loadSampleFile(`${dataRoot}/${configured}`, true);
  }

  const candidates = ['samples.json', 'sample_manifest.csv', 'sample_manifest.tsv', 'samples.csv', 'samples.tsv'];
  for (const candidate of candidates) {
    const rows = await loadSampleFile(`${dataRoot}/${candidate}`, false);
    if (rows) return rows;
  }
  return inferSamplesFromCounts(counts);
}

async function loadQcMetrics(dataRoot) {
  const candidates = ['qc_metrics.json', 'qc_metrics.csv', 'qc_metrics.tsv'];
  for (const candidate of candidates) {
    const rows = await loadQcFile(`${dataRoot}/${candidate}`, false);
    if (rows) return normalizeQcMetrics(rows);
  }
  return [];
}

const COUNT_METADATA_COLUMNS = new Set([
  'gene_id',
  'gene_symbol',
  'gene_name',
  'description',
  'gene_description',
  'chromosome',
  'chr',
  'start',
  'end',
  'strand',
  'length',
  'gene_biotype',
  'biotype',
]);

function inferSamplesFromCounts(counts) {
  if (!Array.isArray(counts) || counts.length === 0) return [];
  const sampleIds = Object.keys(counts[0]).filter((column) => isLikelyCountColumn(counts, column));
  if (sampleIds.length < 2) {
    throw new Error('No sample manifest was found, and the count matrix did not include at least two numeric sample columns.');
  }
  return sampleIds.map((sample_id) => ({ sample_id }));
}

function isLikelyCountColumn(counts, column) {
  if (COUNT_METADATA_COLUMNS.has(String(column).trim().toLowerCase())) return false;
  let observed = false;
  for (const row of counts.slice(0, 50)) {
    const value = row[column];
    if (value === '' || value === null || value === undefined) continue;
    observed = true;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
  }
  return observed;
}

async function loadCountMatrix(dataRoot) {
  const configured = state.config.countMatrix || state.config.countsFile;
  if (configured) return loadCountFile(`${dataRoot}/${configured}`, true);

  const candidates = ['counts.csv', 'counts.tsv'];
  for (const candidate of candidates) {
    const rows = await loadCountFile(`${dataRoot}/${candidate}`, false);
    if (rows) return rows;
  }
  throw new Error(`Required count matrix asset failed: ${dataRoot}/counts.csv or ${dataRoot}/counts.tsv was not found.`);
}

async function loadCountFile(path, required) {
  const text = await loadTextQuiet(path, required);
  if (text === null) return null;
  const normalized = parseCountMatrix(text, path);
  state.countMatrixWarnings = normalized.warnings;
  state.countMatrixInfo = normalized.info;
  return normalized.rows;
}

async function loadSampleFile(path, required) {
  if (path.endsWith('.json')) {
    const rows = await loadJsonQuiet(path, required);
    return rows === null ? null : normalizeStringRows(rows);
  }
  const text = await loadTextQuiet(path, required);
  if (text === null) return null;
  return path.endsWith('.tsv') ? parseTsv(text) : parseCsv(text);
}

async function loadQcFile(path, required) {
  if (path.endsWith('.json')) return loadJsonQuiet(path, required);
  const text = await loadTextQuiet(path, required);
  if (text === null) return null;
  return path.endsWith('.tsv') ? parseQcTsv(text) : parseQcCsv(text);
}

async function loadJsonQuiet(path, required = false) {
  const embedded = getEmbeddedAsset(path);
  if (embedded !== undefined) {
    try {
      return JSON.parse(embedded);
    } catch (error) {
      if (required) throw new Error(`Required embedded JSON asset failed: ${path}: ${error.message}`);
      return null;
    }
  }

  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (required) throw new Error(`Required JSON asset failed: ${path}: ${error.message}`);
    return null;
  }
}

async function loadTextQuiet(path, required = false) {
  const embedded = getEmbeddedAsset(path);
  if (embedded !== undefined) return embedded;

  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    if (required) throw new Error(`Required text asset failed: ${path}: ${error.message}`);
    return null;
  }
}

export async function loadDeForContrast(contrast) {
  if (!contrast) return [];
  if (state.deResults.has(contrast.id)) return state.deResults.get(contrast.id);
  const dataRoot = state.config.dataRoot || 'assets/data';
  let rows = contrast.de_file ? parseDeCsv(await loadText(`${dataRoot}/${contrast.de_file}`, false)) : [];
  if (rows.length === 0 && browserFallbackDeEnabled() && contrast.column && contrast.numerator !== undefined && contrast.denominator !== undefined) {
    rows = computeDifferentialExpression(state.counts, state.samples, contrast, state.config);
  }
  state.deResults.set(contrast.id, rows);
  return rows;
}

function browserFallbackDeEnabled() {
  return state.config?.analysis?.enableBrowserFallbackDE === true;
}

export async function loadEnrichmentForContrast(contrast) {
  if (!contrast) return [];
  const cached = enrichmentResultForContrast(contrast.id, 'pipeline');
  if (cached) return enrichmentRows(cached);
  if (!contrast.enrichment_file) return [];
  const dataRoot = state.config.dataRoot || 'assets/data';
  const rows = parseEnrichmentCsv(await loadText(`${dataRoot}/${contrast.enrichment_file}`, false));
  state.enrichmentResults.set(`${contrast.id}::pipeline`, {
    result_id: `${contrast.id}::pipeline`,
    contrast_id: contrast.id,
    label: `${contrast.label || contrast.id} pipeline enrichment`,
    source_kind: 'pipeline',
    source_id: contrast.enrichment_file || 'pipeline',
    source_label: 'Pipeline enrichment',
    rows,
  });
  return rows;
}

function enrichmentResultForContrast(contrastId, sourceKind = '') {
  if (state.enrichmentResults.has(contrastId)) return state.enrichmentResults.get(contrastId);
  return Array.from(state.enrichmentResults.values()).find((entry) => {
    if (Array.isArray(entry)) return false;
    if (entry?.contrast_id !== contrastId) return false;
    return !sourceKind || entry.source_kind === sourceKind;
  });
}

function enrichmentRows(entry) {
  return Array.isArray(entry) ? entry : (entry?.rows || []);
}

async function loadDefaultAnalysisCache(dataRoot) {
  const configured = cleanRelativeAssetPath(state.config?.analysisCacheFile || state.config?.defaultAnalysisCacheFile);
  const candidates = configured ? [configured] : ['analysis_cache.json'];
  for (const candidate of candidates) {
    const cache = await loadJsonQuiet(`${dataRoot}/${candidate}`, false);
    if (!cache) continue;
    restoreDefaultAnalysisCache(cache);
    return;
  }
}

function restoreDefaultAnalysisCache(cache) {
  if (!cache || typeof cache !== 'object') return;
  if (cache.cache_kind && cache.cache_kind !== 'rnaseq-report-analysis-cache') {
    throw new Error('Default analysis cache is not an RNA-seq report analysis cache.');
  }

  restoreDefaultAnalysisScopes(cache.analysis_scopes);
  const contrastById = new Map(state.contrasts.map((contrast) => [contrast.id, contrast]));
  mergeDefaultCacheContrasts(contrastById, cache.contrasts);
  mergeDefaultCacheContrasts(contrastById, cache.de_analyses, { analysis: true });

  (Array.isArray(cache.de_results) ? cache.de_results : []).forEach((entry) => {
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

  (Array.isArray(cache.gsea_results) ? cache.gsea_results : []).forEach((entry) => {
    if (!entry?.contrast_id || !Array.isArray(entry.rows)) return;
    if (!contrastById.has(entry.contrast_id)) {
      contrastById.set(entry.contrast_id, {
        id: entry.contrast_id,
        label: entry.contrast_id,
        cached: true,
      });
    }
    const resultId = entry.result_id || defaultGseaResultId(entry);
    state.enrichmentResults.set(resultId, {
      result_id: resultId,
      contrast_id: entry.contrast_id,
      label: entry.label || entry.source_label || entry.reference || entry.contrast_id,
      source_kind: entry.source_kind || 'analysis-cache',
      source_id: entry.source_id || entry.reference || resultId,
      source_label: entry.source_label || entry.reference || 'Default GSEA result',
      reference: entry.reference || '',
      min_size: entry.min_size ?? '',
      max_size: entry.max_size ?? '',
      curve_limit: entry.curve_limit ?? entry.top_n_pathway_plots ?? '',
      curve_up_limit: entry.curve_up_limit ?? '',
      curve_down_limit: entry.curve_down_limit ?? '',
      created_at: entry.created_at || cache.created_at || '',
      enrichment_curves: plainGseaCurves(entry.enrichment_curves || entry.curves),
      rows: plainRows(entry.rows),
    });
  });

  state.contrasts = Array.from(contrastById.values());
}

function mergeDefaultCacheContrasts(contrastById, contrasts, options = {}) {
  (Array.isArray(contrasts) ? contrasts : []).forEach((contrast) => {
    const id = options.analysis ? contrast?.contrast_id : contrast?.id;
    if (!id) return;
    const normalized = options.analysis ? { ...contrast, id } : contrast;
    contrastById.set(id, {
      ...contrastById.get(id),
      ...plainObject(normalized),
      id,
      cached: true,
    });
  });
}

function restoreDefaultAnalysisScopes(scopes) {
  if (!Array.isArray(scopes) || !scopes.length) return;
  const byId = new Map((state.analysisScopes || []).map((scope) => [scope.id, scope]));
  scopes.forEach((scope) => {
    if (!scope?.id) return;
    byId.set(scope.id, {
      ...plainObject(scope),
      cached: true,
    });
  });
  state.analysisScopes = Array.from(byId.values());
}

function plainRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(plainObject);
}

function plainObject(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, item ?? '']));
}

function plainGseaCurves(curves) {
  return (Array.isArray(curves) ? curves : []).map((curve) => ({
    term_id: curve.term_id || '',
    term_name: curve.term_name || curve.term_id || '',
    enrichmentScore: curve.enrichmentScore ?? '',
    NES: curve.NES ?? '',
    padj: curve.padj ?? '',
    size: curve.size ?? '',
    totalRanks: curve.totalRanks ?? curve.total_ranks ?? '',
    points: plainRows(curve.points),
    hits: plainRows(curve.hits),
  })).filter((curve) => curve.term_id && curve.points.length);
}

function defaultGseaResultId(entry) {
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

function cleanRelativeAssetPath(value) {
  const path = String(value || '').trim().replace(/^\/+/, '');
  if (!path || path.includes('..')) return '';
  return path;
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('sample metadata must contain at least one row.');
  samples.forEach((sample) => {
    if (!sample.sample_id) throw new Error('Every sample must include sample_id.');
  });
}

function validateCounts(counts) {
  if (!Array.isArray(counts) || counts.length === 0) throw new Error('Count matrix must contain at least one gene row.');
  const first = counts[0];
  if (!first.gene_id && !first.gene_symbol && !first.gene_name) throw new Error('Count matrix should include gene_id, gene_symbol, or gene_name.');
  const matched = state.samples.filter((sample) => Object.prototype.hasOwnProperty.call(first, sample.sample_id));
  if (matched.length < 2) throw new Error('Count matrix must include at least two columns matching sample_id values in the sample metadata.');
  validateCountMatrix(counts, matched.map((sample) => sample.sample_id));
}

function validatePca(pca) {
  if (!pca || !Array.isArray(pca.samples)) throw new Error('pca.json must include samples array.');
}

function validateDistance(distance) {
  if (!distance || !Array.isArray(distance.sample_ids) || !Array.isArray(distance.matrix)) {
    throw new Error('sample_distance_matrix.json must include sample_ids and matrix arrays.');
  }
}
