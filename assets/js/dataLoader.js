import { state } from './state.js';

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
  if (!text) return [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift());
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, parseValue(values[i])]));
  });
}

function splitCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
    else if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { out.push(current); current = ''; }
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
  state.samples = await loadJson(`${dataRoot}/samples.json`, true);
  state.qc = await loadJson(`${dataRoot}/qc_metrics.json`, true);
  state.pca = await loadJson(`${dataRoot}/pca.json`, true);
  state.distance = await loadJson(`${dataRoot}/sample_distance_matrix.json`, true);
  state.geneAnnotation = await loadJson(`${dataRoot}/gene_annotation.json`, false) || [];
  state.contrasts = await loadJson(`${dataRoot}/contrast_list.json`, false) || [];
  state.provenance = await loadJson(`${dataRoot}/logs/pipeline_provenance.json`, false);
  state.software = await loadJson(`${dataRoot}/logs/software_versions.json`, false);
  state.counts = parseCsv(await loadText(`${dataRoot}/counts.csv`, false));

  validateSamples(state.samples);
  validatePca(state.pca);
  validateDistance(state.distance);
}

export async function loadDeForContrast(contrast) {
  if (!contrast || !contrast.de_file) return [];
  if (state.deResults.has(contrast.id)) return state.deResults.get(contrast.id);
  const dataRoot = state.config.dataRoot || 'assets/data';
  const rows = parseCsv(await loadText(`${dataRoot}/${contrast.de_file}`, false));
  state.deResults.set(contrast.id, rows);
  return rows;
}

export async function loadEnrichmentForContrast(contrast) {
  if (!contrast || !contrast.enrichment_file) return [];
  if (state.enrichmentResults.has(contrast.id)) return state.enrichmentResults.get(contrast.id);
  const dataRoot = state.config.dataRoot || 'assets/data';
  const rows = parseCsv(await loadText(`${dataRoot}/${contrast.enrichment_file}`, false));
  state.enrichmentResults.set(contrast.id, rows);
  return rows;
}

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('samples.json must contain a non-empty array.');
  samples.forEach((sample) => {
    if (!sample.sample_id) throw new Error('Every sample must include sample_id.');
  });
}

function validatePca(pca) {
  if (!pca || !Array.isArray(pca.samples)) throw new Error('pca.json must include samples array.');
}

function validateDistance(distance) {
  if (!distance || !Array.isArray(distance.sample_ids) || !Array.isArray(distance.matrix)) {
    throw new Error('sample_distance_matrix.json must include sample_ids and matrix arrays.');
  }
}
