import { state } from './state.js';
import {
  computeDifferentialExpression,
  computePcaFromCounts,
  computeSampleDistanceFromCounts,
  inferContrastsFromSamples,
} from './analysis.js';
import { normalizeQcMetrics } from './qc.js';

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

export function parseCsv(text) {
  return parseDelimited(text, ',');
}

export function parseTsv(text) {
  return parseDelimited(text, '\t');
}

function parseDelimited(text, delimiter) {
  if (!text) return [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = splitDelimitedLine(lines.shift(), delimiter);
  return lines.map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, i) => [header, parseValue(values[i])]));
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

function parseValue(value) {
  if (value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() !== '' ? n : value;
}

export async function loadCoreAssets() {
  state.config = await loadJson('assets/report_config.json', true);
  const dataRoot = state.config.dataRoot || 'assets/data';
  state.counts = parseCsv(await loadText(`${dataRoot}/counts.csv`, true));
  state.samples = await loadSampleMetadata(dataRoot, state.counts);
  state.qc = await loadQcMetrics(dataRoot);
  state.pca = await loadJson(`${dataRoot}/pca.json`, false);
  state.distance = await loadJson(`${dataRoot}/sample_distance_matrix.json`, false);
  state.geneAnnotation = await loadJson(`${dataRoot}/gene_annotation.json`, false) || [];
  state.contrasts = await loadJson(`${dataRoot}/contrast_list.json`, false) || [];
  state.provenance = await loadJson(`${dataRoot}/logs/pipeline_provenance.json`, false);
  state.software = await loadJson(`${dataRoot}/logs/software_versions.json`, false);

  validateSamples(state.samples);
  validateCounts(state.counts);
  if (!state.pca) state.pca = computePcaFromCounts(state.counts, state.samples, state.config);
  if (!state.distance) state.distance = computeSampleDistanceFromCounts(state.counts, state.samples, state.config);
  if (state.contrasts.length === 0) state.contrasts = inferContrastsFromSamples(state.samples, state.config);
  validatePca(state.pca);
  if (state.distance) validateDistance(state.distance);
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
    const rows = await loadSampleFile(`${dataRoot}/${candidate}`, false);
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
    throw new Error('No sample manifest was found, and counts.csv did not include at least two numeric sample columns.');
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

async function loadSampleFile(path, required) {
  if (path.endsWith('.json')) return loadJsonQuiet(path, required);
  const text = await loadTextQuiet(path, required);
  if (text === null) return null;
  return path.endsWith('.tsv') ? parseTsv(text) : parseCsv(text);
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
  let rows = contrast.de_file ? parseCsv(await loadText(`${dataRoot}/${contrast.de_file}`, false)) : [];
  if (rows.length === 0 && contrast.column && contrast.numerator !== undefined && contrast.denominator !== undefined) {
    rows = computeDifferentialExpression(state.counts, state.samples, contrast, state.config);
  }
  state.deResults.set(contrast.id, rows);
  return rows;
}

export async function loadEnrichmentForContrast(contrast) {
  if (!contrast) return [];
  if (state.enrichmentResults.has(contrast.id)) return state.enrichmentResults.get(contrast.id);
  if (!contrast.enrichment_file) return [];
  const dataRoot = state.config.dataRoot || 'assets/data';
  const rows = parseCsv(await loadText(`${dataRoot}/${contrast.enrichment_file}`, false));
  state.enrichmentResults.set(contrast.id, rows);
  return rows;
}

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('sample metadata must contain at least one row.');
  samples.forEach((sample) => {
    if (!sample.sample_id) throw new Error('Every sample must include sample_id.');
  });
}

function validateCounts(counts) {
  if (!Array.isArray(counts) || counts.length === 0) throw new Error('counts.csv must contain at least one gene row.');
  const first = counts[0];
  if (!first.gene_id && !first.gene_symbol && !first.gene_name) throw new Error('counts.csv should include gene_id, gene_symbol, or gene_name.');
  const matched = state.samples.filter((sample) => Object.prototype.hasOwnProperty.call(first, sample.sample_id));
  if (matched.length < 2) throw new Error('counts.csv must include at least two columns matching sample_id values in the sample metadata.');
}

function validatePca(pca) {
  if (!pca || !Array.isArray(pca.samples)) throw new Error('pca.json must include samples array.');
}

function validateDistance(distance) {
  if (!distance || !Array.isArray(distance.sample_ids) || !Array.isArray(distance.matrix)) {
    throw new Error('sample_distance_matrix.json must include sample_ids and matrix arrays.');
  }
}
