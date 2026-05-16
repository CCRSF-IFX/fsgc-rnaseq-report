import { state, logAnalysis, metadataColumns, setStatus } from './state.js';
import { sampleIdsInCounts } from './analysis.js';
import { parseCsv } from './dataLoader.js';
import { ensureRPackages } from './packageManager.js';
import { evalR } from './webrManager.js';

let deseqCallbacks = {};
let deseqControlsWired = false;

export function setupDeseqControls(callbacks = {}) {
  deseqCallbacks = callbacks;
  const designSelect = document.getElementById('deseq-design-column');
  if (!designSelect) return;

  const eligibleColumns = metadataColumns().filter((column) => deseqUniqueValues(column).length >= 2);
  designSelect.innerHTML = eligibleColumns.map((column) => `<option value="${deseqEscapeHtml(column)}">${deseqEscapeHtml(column)}</option>`).join('');
  if (eligibleColumns.includes(state.config?.analysis?.conditionColumn)) {
    designSelect.value = state.config.analysis.conditionColumn;
  } else if (eligibleColumns.includes('condition')) {
    designSelect.value = 'condition';
  }

  if (!deseqControlsWired) {
    deseqControlsWired = true;
    designSelect.addEventListener('change', updateDeseqLevelControls);
    document.getElementById('deseq-reference-level')?.addEventListener('change', updateDeseqLevelControls);
    document.getElementById('deseq-run')?.addEventListener('click', runDeseq2Analysis);
  }
  updateDeseqLevelControls();
}

function updateDeseqLevelControls() {
  const column = document.getElementById('deseq-design-column')?.value;
  const levels = deseqUniqueValues(column);
  const levelOptions = levels.map((level) => `<option value="${deseqEscapeHtml(level)}">${deseqEscapeHtml(level)}</option>`).join('');

  const referenceSelect = document.getElementById('deseq-reference-level');
  const numeratorSelect = document.getElementById('deseq-numerator-level');
  const denominatorSelect = document.getElementById('deseq-denominator-level');
  if (!referenceSelect || !numeratorSelect || !denominatorSelect) return;

  const configuredReference = state.config?.analysis?.referenceLevel;
  const previousReference = referenceSelect.value;
  referenceSelect.innerHTML = levelOptions;
  numeratorSelect.innerHTML = levelOptions;
  denominatorSelect.innerHTML = levelOptions;

  const reference = levels.includes(previousReference)
    ? previousReference
    : (levels.includes(configuredReference) ? configuredReference : levels[0]);
  referenceSelect.value = reference || '';
  denominatorSelect.value = reference || '';
  numeratorSelect.value = levels.find((level) => level !== reference) || levels[0] || '';
}

export async function runDeseq2Analysis() {
  const column = document.getElementById('deseq-design-column')?.value;
  const reference = document.getElementById('deseq-reference-level')?.value;
  const numerator = document.getElementById('deseq-numerator-level')?.value;
  const denominator = document.getElementById('deseq-denominator-level')?.value || reference;
  const status = document.getElementById('deseq-status');

  try {
    if (!column || !numerator || !denominator || numerator === denominator) {
      throw new Error('Choose two different levels for the DESeq2 contrast.');
    }

    const sampleIds = sampleIdsInCounts(state.samples, state.counts)
      .filter((sampleId) => {
        const value = String(state.samples.find((sample) => sample.sample_id === sampleId)?.[column] ?? '');
        return value === numerator || value === denominator;
      });
    if (sampleIds.length < 2) throw new Error('At least two samples are required for this contrast.');
    const numeratorCount = sampleIds.filter((sampleId) => String(state.samples.find((sample) => sample.sample_id === sampleId)?.[column] ?? '') === numerator).length;
    const denominatorCount = sampleIds.filter((sampleId) => String(state.samples.find((sample) => sample.sample_id === sampleId)?.[column] ?? '') === denominator).length;
    if (numeratorCount < 2 || denominatorCount < 2) throw new Error('DESeq2 requires at least two samples per group for this browser runner.');

    deseqSetStatus(status, 'Loading DESeq2 package in webR...');
    setStatus('Running DESeq2 in webR...');
    await ensureRPackages(['DESeq2']);

    deseqSetStatus(status, 'Running DESeq2...');
    const rows = await deseqRunInWebR(sampleIds, column, reference, numerator, denominator);
    if (rows.length === 0) throw new Error('DESeq2 returned no result rows.');

    const contrastId = `deseq2_${deseqSlug(numerator)}_vs_${deseqSlug(denominator)}`;
    const contrast = {
      id: contrastId,
      label: `DESeq2 ${numerator} vs ${denominator}`,
      column,
      numerator,
      denominator,
      generated: true,
      method: 'DESeq2 webR',
    };
    const existingIndex = state.contrasts.findIndex((item) => item.id === contrastId);
    if (existingIndex >= 0) state.contrasts[existingIndex] = contrast;
    else state.contrasts.push(contrast);
    state.deResults.set(contrastId, rows);

    deseqCallbacks.populateContrastSelectors?.();
    const contrastSelect = document.getElementById('contrast-select');
    if (contrastSelect) contrastSelect.value = contrastId;
    await deseqCallbacks.renderCurrentContrast?.();

    logAnalysis(`DESeq2 completed for ${numerator} vs ${denominator}: ${rows.length} genes.`);
    deseqSetStatus(status, `DESeq2 complete: ${rows.length} genes.`);
    setStatus('Report assets loaded');
  } catch (error) {
    logAnalysis(`DESeq2 failed: ${error.message}`);
    deseqSetStatus(status, `DESeq2 failed: ${error.message}`);
    setStatus('DESeq2 failed');
  }
}

async function deseqRunInWebR(sampleIds, column, reference, numerator, denominator) {
  const countsCsv = deseqCountsCsv(sampleIds);
  const metadataCsv = deseqMetadataCsv(sampleIds, column);
  const code = `
suppressPackageStartupMessages(library(DESeq2))
count_text <- ${deseqRString(countsCsv)}
metadata_text <- ${deseqRString(metadataCsv)}
countData <- read.csv(text = count_text, row.names = 1, check.names = FALSE)
rownames(countData) <- make.unique(rownames(countData))
countData <- as.matrix(round(countData))
storage.mode(countData) <- "integer"
colData <- read.csv(text = metadata_text, row.names = 1, check.names = FALSE, stringsAsFactors = FALSE)
colnames(colData) <- make.names(colnames(colData))
design_col <- make.names(${deseqRString(column)})
colData[[design_col]] <- relevel(factor(colData[[design_col]]), ref = ${deseqRString(reference)})
countData <- countData[, rownames(colData), drop = FALSE]
dds <- DESeqDataSetFromMatrix(countData = countData, colData = colData, design = as.formula(paste("~", design_col)))
dds <- DESeq(dds, quiet = TRUE)
res <- results(dds, contrast = c(design_col, ${deseqRString(numerator)}, ${deseqRString(denominator)}))
out <- as.data.frame(res)
out$gene_id <- rownames(out)
out <- out[, c("gene_id", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj")]
names(out)[names(out) == "stat"] <- "statistic"
paste(capture.output(write.csv(out, row.names = FALSE, na = "")), collapse = "\\n")
`;
  const result = await evalR(code);
  const text = deseqResultText(result);
  return parseCsv(text).map((row) => ({
    ...row,
    gene_symbol: state.geneAnnotation.find((gene) => gene.gene_id === row.gene_id)?.gene_symbol || row.gene_symbol || '',
    method: 'DESeq2 webR',
  })).sort((a, b) => Number(a.padj || 1) - Number(b.padj || 1));
}

function deseqCountsCsv(sampleIds) {
  const rows = state.counts.map((row, index) => {
    const geneId = row.gene_id || row.gene_symbol || row.gene_name || `gene_${index + 1}`;
    return [geneId].concat(sampleIds.map((sampleId) => Math.round(Math.max(0, Number(row[sampleId]) || 0))));
  });
  return deseqCsv([['gene_id'].concat(sampleIds)].concat(rows));
}

function deseqMetadataCsv(sampleIds, column) {
  const rows = sampleIds.map((sampleId) => {
    const sample = state.samples.find((item) => item.sample_id === sampleId) || {};
    return [sampleId, sample[column] ?? ''];
  });
  return deseqCsv([['sample_id', column]].concat(rows));
}

function deseqCsv(rows) {
  return rows.map((row) => row.map(deseqCsvEscape).join(',')).join('\n');
}

function deseqCsvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function deseqResultText(result) {
  if (typeof result === 'string') return result;
  if (Array.isArray(result?.values)) return result.values.join('\n');
  if (result?.values?.[0] !== undefined) return String(result.values[0]);
  return String(result ?? '');
}

function deseqUniqueValues(column) {
  if (!column) return [];
  return Array.from(new Set(state.samples.map((sample) => sample[column]).filter((value) => value !== undefined && value !== null && value !== '').map(String)));
}

function deseqSetStatus(element, message) {
  if (element) element.textContent = message;
}

function deseqRString(value) {
  return JSON.stringify(String(value));
}

function deseqSlug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'group';
}

function deseqEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
