import { state, logAnalysis, metadataColumns, createProgressReporter, runWithProgressPulse } from './state.js';
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
  const status = document.getElementById('deseq-status');

  const eligibleColumns = metadataColumns().filter((column) => deseqUniqueValues(column).length >= 2);
  designSelect.disabled = eligibleColumns.length === 0;
  const runButton = document.getElementById('deseq-run');
  if (runButton) runButton.disabled = eligibleColumns.length === 0;
  const previousDesign = designSelect.value;
  designSelect.innerHTML = eligibleColumns.map((column) => `<option value="${deseqEscapeHtml(column)}">${deseqEscapeHtml(column)}</option>`).join('');
  if (eligibleColumns.includes(previousDesign)) {
    designSelect.value = previousDesign;
  } else if (eligibleColumns.includes(state.config?.analysis?.conditionColumn)) {
    designSelect.value = state.config.analysis.conditionColumn;
  } else if (eligibleColumns.includes('condition')) {
    designSelect.value = 'condition';
  }
  updateDeseqAdjustControls();
  if (status && eligibleColumns.length === 0) {
    status.textContent = 'Upload a sample manifest with a grouping column to run DESeq2.';
  } else if (status?.textContent?.startsWith('Upload a sample manifest')) {
    status.textContent = 'DESeq2 uses webR and the configured package snapshot for small exploratory runs.';
  }

  if (!deseqControlsWired) {
    deseqControlsWired = true;
    designSelect.addEventListener('change', () => {
      updateDeseqLevelControls();
      updateDeseqAdjustControls();
    });
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
  const hasLevels = levels.length > 0;

  const configuredReference = state.config?.analysis?.referenceLevel;
  const previousReference = referenceSelect.value;
  referenceSelect.innerHTML = levelOptions;
  numeratorSelect.innerHTML = levelOptions;
  denominatorSelect.innerHTML = levelOptions;
  referenceSelect.disabled = !hasLevels;
  numeratorSelect.disabled = !hasLevels;
  denominatorSelect.disabled = !hasLevels;

  const reference = levels.includes(previousReference)
    ? previousReference
    : (levels.includes(configuredReference) ? configuredReference : levels[0]);
  referenceSelect.value = reference || '';
  denominatorSelect.value = reference || '';
  numeratorSelect.value = levels.find((level) => level !== reference) || levels[0] || '';
}

function updateDeseqAdjustControls() {
  const adjustSelect = document.getElementById('deseq-adjust-columns');
  if (!adjustSelect) return;
  const primary = document.getElementById('deseq-design-column')?.value;
  const previous = new Set(Array.from(adjustSelect.selectedOptions || []).map((option) => option.value));
  const candidates = metadataColumns()
    .filter((column) => column !== primary)
    .filter((column) => deseqUniqueValues(column).length >= 2);
  adjustSelect.innerHTML = candidates.map((column) => {
    const levels = deseqUniqueValues(column).length;
    return `<option value="${deseqEscapeHtml(column)}"${previous.has(column) ? ' selected' : ''}>${deseqEscapeHtml(column)} (${levels})</option>`;
  }).join('');
  adjustSelect.disabled = candidates.length === 0;
}

export async function runDeseq2Analysis() {
  const column = document.getElementById('deseq-design-column')?.value;
  const adjustColumns = deseqSelectedAdjustColumns(column);
  const reference = document.getElementById('deseq-reference-level')?.value;
  const numerator = document.getElementById('deseq-numerator-level')?.value;
  const denominator = document.getElementById('deseq-denominator-level')?.value || reference;
  const status = document.getElementById('deseq-status');
  const runButton = document.getElementById('deseq-run');
  const runButtonLabel = runButton?.textContent || 'Run DESeq2';
  const progress = createProgressReporter('DESeq2', 7);
  if (runButton) {
    runButton.disabled = true;
    runButton.textContent = 'Running DESeq2...';
    runButton.setAttribute('aria-busy', 'true');
  }

  try {
    deseqSetStatus(status, 'Validating DESeq2 contrast and design...');
    await progress.step('Validating contrast and design', 1);
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
    validateDeseqDesign(sampleIds, column, adjustColumns);

    await progress.step(`Using ${sampleIds.length} samples for ${numerator} vs ${denominator}`, 2);
    deseqSetStatus(status, 'Loading DESeq2 package in webR. First run can take a few minutes.');
    await progress.step('Loading DESeq2 package in webR', 3);
    await ensureRPackages(['DESeq2']);

    const modelMessage = `Running DESeq2 in webR for ${state.counts.length} genes and ${sampleIds.length} samples`;
    deseqSetStatus(status, `${modelMessage}. Keep this tab open.`);
    await progress.step(modelMessage, 4);
    const rows = await runWithProgressPulse(
      progress,
      `${modelMessage}; still working`,
      () => deseqRunInWebR(sampleIds, column, adjustColumns, reference, numerator, denominator),
      {
        intervalMs: 10000,
        onPulse: (message) => deseqSetStatus(status, `${message}. Keep this tab open.`),
      },
    );
    if (rows.length === 0) throw new Error('DESeq2 returned no result rows.');

    await progress.step('Registering contrast and updating plots', 5);
    const designLabel = deseqDesignLabel(column, adjustColumns);
    const contrastId = `deseq2_${deseqSlug(numerator)}_vs_${deseqSlug(denominator)}${adjustColumns.length ? `_adj_${deseqSlug(adjustColumns.join('_'))}` : ''}`;
    const contrast = {
      id: contrastId,
      label: `DESeq2 ${numerator} vs ${denominator}${adjustColumns.length ? ' adjusted' : ''}`,
      column,
      numerator,
      denominator,
      adjustColumns,
      design: designLabel,
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
    await progress.step('Rendering DE table and volcano/MA plots', 6);
    await deseqCallbacks.renderCurrentContrast?.();

    logAnalysis(`DESeq2 completed for ${numerator} vs ${denominator} with ${designLabel}: ${rows.length} genes.`);
    deseqSetStatus(status, `DESeq2 complete: ${rows.length} genes. Design ${designLabel}.`);
    await progress.done(`Complete: ${rows.length} genes. Design ${designLabel}`);
  } catch (error) {
    logAnalysis(`DESeq2 failed: ${error.message}`);
    deseqSetStatus(status, `DESeq2 failed: ${error.message}`);
    await progress.fail(`failed: ${error.message}`);
  } finally {
    if (runButton) {
      runButton.disabled = false;
      runButton.textContent = runButtonLabel;
      runButton.removeAttribute('aria-busy');
    }
  }
}

async function deseqRunInWebR(sampleIds, column, adjustColumns, reference, numerator, denominator) {
  const countsCsv = deseqCountsCsv(sampleIds);
  const metadataColumns = [column].concat(adjustColumns);
  const metadataCsv = deseqMetadataCsv(sampleIds, metadataColumns);
  const code = `
suppressPackageStartupMessages(library(DESeq2))
count_text <- ${deseqRString(countsCsv)}
metadata_text <- ${deseqRString(metadataCsv)}
primary_col_raw <- ${deseqRString(column)}
adjust_cols_raw <- c(${adjustColumns.map(deseqRString).join(', ')})
reference_level <- ${deseqRString(reference)}
numerator_level <- ${deseqRString(numerator)}
denominator_level <- ${deseqRString(denominator)}
countData <- read.csv(text = count_text, row.names = 1, check.names = FALSE)
rownames(countData) <- make.unique(rownames(countData))
countData <- as.matrix(round(countData))
storage.mode(countData) <- "integer"
colData <- read.csv(text = metadata_text, row.names = 1, check.names = FALSE, stringsAsFactors = FALSE)
countData <- countData[, rownames(colData), drop = FALSE]
raw_names <- colnames(colData)
safe_names <- make.names(raw_names, unique = TRUE)
colnames(colData) <- safe_names
safe_lookup <- setNames(safe_names, raw_names)
design_col <- unname(safe_lookup[[primary_col_raw]])
adjust_cols <- unname(safe_lookup[adjust_cols_raw])
adjust_cols <- adjust_cols[!is.na(adjust_cols)]
coerce_design_term <- function(value) {
  value <- trimws(as.character(value))
  numeric_value <- suppressWarnings(as.numeric(value))
  if (all(nzchar(value)) && all(is.finite(numeric_value)) && length(unique(numeric_value)) > 2) {
    numeric_value
  } else {
    factor(value)
  }
}
for (adjust_col in adjust_cols) {
  colData[[adjust_col]] <- coerce_design_term(colData[[adjust_col]])
  if (is.factor(colData[[adjust_col]]) && nlevels(colData[[adjust_col]]) < 2) {
    stop(paste("Adjustment factor has fewer than two levels:", adjust_col))
  }
}
colData[[design_col]] <- relevel(factor(trimws(as.character(colData[[design_col]]))), ref = reference_level)
design_terms <- c(adjust_cols, design_col)
design_formula <- reformulate(design_terms)
design_matrix <- model.matrix(design_formula, colData)
if (qr(design_matrix)$rank < ncol(design_matrix)) {
  stop("DESeq2 design is not full rank. Remove confounded covariates or blocking factors.")
}
if (nrow(design_matrix) <= ncol(design_matrix)) {
  stop("DESeq2 design has too many terms for the number of selected samples.")
}
dds <- DESeqDataSetFromMatrix(countData = countData, colData = colData, design = design_formula)
dds <- DESeq(dds, quiet = TRUE)
res <- results(dds, contrast = c(design_col, numerator_level, denominator_level))
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
    method: `DESeq2 webR ${deseqDesignLabel(column, adjustColumns)}`,
  })).sort((a, b) => Number(a.padj || 1) - Number(b.padj || 1));
}

function deseqCountsCsv(sampleIds) {
  const rows = state.counts.map((row, index) => {
    const geneId = row.gene_id || row.gene_symbol || row.gene_name || `gene_${index + 1}`;
    return [geneId].concat(sampleIds.map((sampleId) => Math.round(Math.max(0, Number(row[sampleId]) || 0))));
  });
  return deseqCsv([['gene_id'].concat(sampleIds)].concat(rows));
}

function deseqMetadataCsv(sampleIds, columns) {
  const rows = sampleIds.map((sampleId) => {
    const sample = state.samples.find((item) => item.sample_id === sampleId) || {};
    return [sampleId].concat(columns.map((column) => sample[column] ?? ''));
  });
  return deseqCsv([['sample_id'].concat(columns)].concat(rows));
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

function deseqSelectedAdjustColumns(primaryColumn) {
  const selected = Array.from(document.getElementById('deseq-adjust-columns')?.selectedOptions || [])
    .map((option) => option.value)
    .filter((column) => column && column !== primaryColumn);
  return Array.from(new Set(selected));
}

function validateDeseqDesign(sampleIds, primaryColumn, adjustColumns) {
  const modelTerms = adjustColumns.map((column) => ({
    column,
    values: sampleIds.map((sampleId) => deseqSampleValue(sampleId, column)),
  }));

  modelTerms.forEach((term) => {
    if (term.values.some((value) => value === '')) {
      throw new Error(`Selected adjustment column "${term.column}" has missing values in the selected samples.`);
    }
    if (new Set(term.values).size < 2) {
      throw new Error(`Selected adjustment column "${term.column}" has fewer than two levels in the selected samples.`);
    }
  });

  const approximateCoefficientCount = 1
    + 1
    + modelTerms.reduce((sum, term) => {
      const numericValues = term.values.map(Number);
      const isContinuous = numericValues.every((value) => Number.isFinite(value)) && new Set(numericValues).size > 2;
      return sum + (isContinuous ? 1 : Math.max(1, new Set(term.values).size - 1));
    }, 0);
  if (sampleIds.length <= approximateCoefficientCount) {
    throw new Error(`The DESeq2 design ${deseqDesignLabel(primaryColumn, adjustColumns)} has too many terms for ${sampleIds.length} selected samples.`);
  }
}

function deseqSampleValue(sampleId, column) {
  const value = state.samples.find((sample) => sample.sample_id === sampleId)?.[column];
  return value === undefined || value === null ? '' : String(value);
}

function deseqDesignLabel(primaryColumn, adjustColumns) {
  return `~ ${adjustColumns.concat(primaryColumn).join(' + ')}`;
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
