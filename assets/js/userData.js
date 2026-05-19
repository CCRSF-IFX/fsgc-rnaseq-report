import { state, logAnalysis, setStatus } from './state.js';
import {
  computePcaFromCounts,
  computeSampleDistanceFromCounts,
  inferContrastsFromSamples,
  sampleIdsInCounts,
} from './analysis.js';
import {
  normalizeCountMatrixRows,
  normalizeStringRows,
  parseCountMatrix,
  parseCsv,
  parseTsv,
  validateCountMatrix,
} from './dataLoader.js';
import { refreshMetadataSchema } from './metadataSchema.js';

let userDataCallbacks = {};

export function setupUserDataControls(callbacks = {}) {
  userDataCallbacks = callbacks;
  const button = document.getElementById('user-data-apply');
  if (!button || button.dataset.wired === 'true') return;
  button.dataset.wired = 'true';
  button.addEventListener('click', applyUploadedUserData);
}

async function applyUploadedUserData() {
  const countFile = document.getElementById('user-counts-file')?.files?.[0];
  const manifestFile = document.getElementById('user-manifest-file')?.files?.[0];
  const status = document.getElementById('user-data-status');

  try {
    if (!manifestFile) throw new Error('Provide a sample manifest.');

    setUserDataStatus(status, 'Reading uploaded files...');
    const countMatrix = countFile
      ? parseCountMatrix(await countFile.text(), countFile.name)
      : normalizeCountMatrixRows(state.counts);
    const counts = countMatrix.rows;
    const samples = normalizeStringRows(parseSampleManifest(await manifestFile.text(), manifestFile.name));
    validateUploadedData(samples, counts);

    state.samples = samples;
    state.counts = counts;
    state.countMatrixWarnings = countMatrix.warnings || [];
    state.countMatrixInfo = countMatrix.info || null;
    refreshMetadataSchema({ preserveUser: false });
    if (countFile) {
      state.geneAnnotation = counts.map((row, index) => ({
        gene_id: row.gene_id || row.gene_symbol || row.gene_name || `gene_${index + 1}`,
        gene_symbol: row.gene_symbol || row.gene_name || row.gene_id || '',
      }));
      state.geneAnnotationLoaded = true;
      state.qc = [];
    }
    state.pca = computePcaFromCounts(state.counts, state.samples, state.config);
    state.distance = computeSampleDistanceFromCounts(state.counts, state.samples, state.config);
    state.contrasts = inferContrastsFromSamples(state.samples, state.config, state.metadataSchema);
    state.analysisScopes = [];
    state.activeAnalysisScopeId = 'all_samples';
    state.deResults = new Map();
    state.enrichmentResults = new Map();
    state.provenance = {
      ...(state.provenance || {}),
      data_source: 'uploaded in browser',
      counts_file: countFile?.name || 'embedded count matrix',
      sample_manifest: manifestFile.name,
    };

    await userDataCallbacks.refresh?.();
    const matched = sampleIdsInCounts(state.samples, state.counts).length;
    const dataSource = countFile ? 'uploaded count matrix' : 'embedded count matrix';
    const countNote = countMatrixStatusNote(countMatrix);
    const message = `Loaded ${samples.length} metadata rows for ${dataSource}; ${counts.length} genes and ${matched} samples matched count columns.${countNote ? ` ${countNote}` : ''} Run DESeq2 before fgsea.`;
    setUserDataStatus(status, message);
    setStatus('Uploaded data loaded', { tone: countMatrix.warnings?.length ? 'warn' : 'ok' });
    logAnalysis(message);
  } catch (error) {
    setUserDataStatus(status, `Upload failed: ${error.message}`);
    setStatus('Uploaded data failed');
    logAnalysis(`Uploaded data failed: ${error.message}`);
  }
}

function parseSampleManifest(text, filename) {
  if (filename.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.samples;
  }
  return filename.toLowerCase().endsWith('.tsv') || filename.toLowerCase().endsWith('.txt')
    ? parseTsv(text)
    : parseCsv(text);
}

function validateUploadedData(samples, counts) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('The sample manifest must contain at least one row.');
  if (!Array.isArray(counts) || counts.length === 0) throw new Error('The count matrix must contain at least one gene row.');
  samples.forEach((sample) => {
    if (!sample.sample_id) throw new Error('Every sample manifest row must include sample_id.');
  });
  const first = counts[0] || {};
  if (!first.gene_id && !first.gene_symbol && !first.gene_name) {
    throw new Error('The count matrix must include gene_id, gene_symbol, or gene_name.');
  }
  const matched = sampleIdsInCounts(samples, counts);
  if (matched.length < 2) throw new Error('At least two sample_id values must match count matrix columns.');
  validateCountMatrix(counts, matched);
  const metadataColumns = Object.keys(samples[0]).filter((key) => key !== 'sample_id');
  if (!metadataColumns.some((column) => new Set(samples.map((sample) => sample[column]).filter(Boolean)).size >= 2)) {
    throw new Error('The sample manifest needs at least one grouping column with two or more levels for DE analysis.');
  }
}

function setUserDataStatus(element, message) {
  if (element) element.textContent = message;
}

function countMatrixStatusNote(countMatrix) {
  const warnings = countMatrix?.warnings || [];
  if (warnings.length) return `Warning: ${warnings.join(' ')}`;
  const inferred = Number(countMatrix?.info?.inferredGeneSymbols) || 0;
  if (!countMatrix?.info?.hasGeneSymbolColumn && inferred > 0) {
    return `Inferred gene_symbol for ${inferred.toLocaleString()} row(s) from FSGC-style gene_id values.`;
  }
  return '';
}
