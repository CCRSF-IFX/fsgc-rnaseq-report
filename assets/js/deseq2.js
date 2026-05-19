import { state, logAnalysis, createProgressReporter, runWithProgressPulse } from './state.js';
import { sampleIdsInCounts } from './analysis.js';
import { loadGeneAnnotation, parseDeCsv, parseCountCell } from './dataLoader.js';
import { adjustmentMetadataColumns, analysisFactorColumns, metadataColumnType, metadataTypeOptionLabel } from './metadataSchema.js';
import { ensureRPackages } from './packageManager.js';
import { evalR } from './webrManager.js';
import { markAnalysisCacheDirty } from './analysisCache.js';
import {
  DESEQ_GROUP_COLUMN,
  DESEQ_QUESTION_TYPES,
  analysisScopeOptions,
  buildAnalysisScope,
  buildDeseqQuestionSpec,
  directGroupOptions,
  groupBalanceRows,
  levelsForColumn,
  previewDeseqModel,
  readDeseqFormValues,
  registerAnalysisScope,
  safeBuildDeseqQuestionSpec,
} from './deQuestionBuilder.js';

let deseqCallbacks = {};
let deseqControlsWired = false;

export function setupDeseqControls(callbacks = {}) {
  deseqCallbacks = callbacks;
  const questionSelect = document.getElementById('deseq-question-type');
  const designSelect = document.getElementById('deseq-design-column');
  if (!questionSelect || !designSelect) return;

  populateQuestionTypes();
  populateScopeControls();
  syncDeseqQuestionUi();
  populateFactorControls();
  populateDirectGroupControls();
  updateDeseqAdjustControls();
  populateExcludedSamples();
  renderDeseqPreview();

  if (!deseqControlsWired) {
    deseqControlsWired = true;
    wireDeseqBuilderControls();
    document.getElementById('deseq-run')?.addEventListener('click', runDeseq2Analysis);
  }
}

function wireDeseqBuilderControls() {
  [
    'deseq-question-type',
    'deseq-scope-column',
    'deseq-scope-level',
    'deseq-exclude-samples',
    'deseq-design-column',
    'deseq-numerator-level',
    'deseq-denominator-level',
    'deseq-adjust-columns',
    'deseq-group-factor-a',
    'deseq-group-factor-b',
    'deseq-group-one',
    'deseq-group-two',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', refreshDeseqBuilder);
  });
  document.querySelectorAll('input[name="deseq-scope-mode"]').forEach((radio) => {
    radio.addEventListener('change', refreshDeseqBuilder);
  });
}

function refreshDeseqBuilder(event = null) {
  const changedId = event?.currentTarget?.id || '';
  if (changedId === 'deseq-question-type') {
    syncDeseqQuestionUi();
    populateFactorControls({ preferQuestionDefault: true });
    populateDirectGroupControls({ preferDefaults: true });
  } else if (changedId === 'deseq-scope-column') {
    populateScopeLevels();
    populateFactorControls();
    populateDirectGroupControls();
    updateDeseqAdjustControls();
    populateExcludedSamples();
  } else if (changedId === 'deseq-scope-level' || changedId === 'deseq-exclude-samples' || event?.currentTarget?.name === 'deseq-scope-mode') {
    syncDeseqScopeControls();
    populateFactorControls();
    populateDirectGroupControls();
    updateDeseqAdjustControls();
    populateExcludedSamples();
  } else if (changedId === 'deseq-design-column') {
    updateDeseqLevelControls();
    updateDeseqAdjustControls();
  } else if (changedId === 'deseq-group-factor-a' || changedId === 'deseq-group-factor-b') {
    populateDirectGroupControls();
    updateDeseqAdjustControls();
  }
  renderDeseqPreview();
  deseqCallbacks.renderAnalysisReadiness?.();
}

function populateQuestionTypes() {
  const select = document.getElementById('deseq-question-type');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = DESEQ_QUESTION_TYPES
    .map((type) => `<option value="${deseqEscapeHtml(type.id)}">${deseqEscapeHtml(type.label)}</option>`)
    .join('');
  select.value = DESEQ_QUESTION_TYPES.some((type) => type.id === previous) ? previous : DESEQ_QUESTION_TYPES[0].id;
}

function populateScopeControls() {
  const columnSelect = document.getElementById('deseq-scope-column');
  if (!columnSelect) return;
  const previous = columnSelect.value;
  const columns = analysisScopeOptions();
  columnSelect.innerHTML = columns
    .map((column) => `<option value="${deseqEscapeHtml(column)}">${deseqEscapeHtml(metadataTypeOptionLabel(column))}</option>`)
    .join('');
  columnSelect.disabled = columns.length === 0;
  columnSelect.value = columns.includes(previous)
    ? previous
    : (columns.includes('tissue') ? 'tissue' : (columns.includes('condition') ? 'condition' : columns[0] || ''));
  const subsetRadio = document.querySelector('input[name="deseq-scope-mode"][value="subset"]');
  if (subsetRadio) subsetRadio.disabled = columns.length === 0;
  populateScopeLevels();
  syncDeseqScopeControls();
}

function populateScopeLevels() {
  const levelSelect = document.getElementById('deseq-scope-level');
  if (!levelSelect) return;
  const column = document.getElementById('deseq-scope-column')?.value || '';
  const previous = levelSelect.value;
  const levels = levelsForColumn(column);
  levelSelect.innerHTML = levels.map((level) => `<option value="${deseqEscapeHtml(level)}">${deseqEscapeHtml(level)}</option>`).join('');
  levelSelect.disabled = levels.length === 0;
  levelSelect.value = levels.includes(previous) ? previous : (levels[0] || '');
}

function syncDeseqScopeControls() {
  const subset = document.querySelector('input[name="deseq-scope-mode"]:checked')?.value === 'subset';
  const filter = document.getElementById('deseq-scope-filter');
  if (filter) filter.hidden = !subset;
}

function populateExcludedSamples() {
  const select = document.getElementById('deseq-exclude-samples');
  if (!select) return;
  const previous = new Set(Array.from(select.selectedOptions || []).map((option) => option.value));
  const formValues = readDeseqFormValues();
  const withoutExclusions = buildAnalysisScope({ ...formValues, excludedSampleIds: [] });
  const options = withoutExclusions.sampleIds.map((sampleId) => {
    const sample = state.samples.find((item) => item.sample_id === sampleId) || {};
    const title = sample.title || sample.condition || sample.tissue || '';
    const selected = previous.has(sampleId) ? ' selected' : '';
    return `<option value="${deseqEscapeHtml(sampleId)}"${selected}>${deseqEscapeHtml(title ? `${sampleId} (${title})` : sampleId)}</option>`;
  });
  select.innerHTML = options.join('');
  select.disabled = options.length === 0;
}

function syncDeseqQuestionUi() {
  const questionType = document.getElementById('deseq-question-type')?.value || '';
  const direct = questionType === 'direct_group_comparison';
  const factorControls = document.getElementById('deseq-factor-controls');
  const directControls = document.getElementById('deseq-direct-group-controls');
  if (factorControls) factorControls.hidden = direct;
  if (directControls) directControls.hidden = !direct;
}

function populateFactorControls(options = {}) {
  const designSelect = document.getElementById('deseq-design-column');
  if (!designSelect) return;
  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  const eligibleColumns = analysisFactorColumns().filter((column) => levelsForColumn(column, scope.sampleIds).length >= 2);
  const previous = designSelect.value;
  const forcedColumn = forcedPrimaryFactor(formValues.questionType, eligibleColumns);
  const defaultColumn = defaultPrimaryFactor(formValues.questionType, eligibleColumns);
  designSelect.disabled = eligibleColumns.length === 0;
  designSelect.innerHTML = eligibleColumns
    .map((column) => `<option value="${deseqEscapeHtml(column)}">${deseqEscapeHtml(metadataTypeOptionLabel(column))}</option>`)
    .join('');
  designSelect.value = forcedColumn
    || (!options.preferQuestionDefault && eligibleColumns.includes(previous)
    ? previous
    : defaultColumn);
  updateDeseqLevelControls();
}

function forcedPrimaryFactor(questionType, columns) {
  if (questionType === 'tissue_within_subset' && columns.includes('tissue')) return 'tissue';
  if (questionType === 'condition_within_subset' && columns.includes('condition')) return 'condition';
  return '';
}

function defaultPrimaryFactor(questionType, columns) {
  if (questionType === 'tissue_within_subset' && columns.includes('tissue')) return 'tissue';
  if (columns.includes(state.config?.analysis?.conditionColumn)) return state.config.analysis.conditionColumn;
  if (columns.includes('condition')) return 'condition';
  if (columns.includes('tissue')) return 'tissue';
  return columns[0] || '';
}

function updateDeseqLevelControls() {
  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  const column = document.getElementById('deseq-design-column')?.value;
  const levels = levelsForColumn(column, scope.sampleIds);
  const levelOptions = levels.map((level) => `<option value="${deseqEscapeHtml(level)}">${deseqEscapeHtml(level)}</option>`).join('');

  const numeratorSelect = document.getElementById('deseq-numerator-level');
  const denominatorSelect = document.getElementById('deseq-denominator-level');
  if (!numeratorSelect || !denominatorSelect) return;

  const previousDenominator = denominatorSelect.value;
  const previousNumerator = numeratorSelect.value;
  numeratorSelect.innerHTML = levelOptions;
  denominatorSelect.innerHTML = levelOptions;
  numeratorSelect.disabled = levels.length < 2;
  denominatorSelect.disabled = levels.length < 2;

  const configuredReference = state.config?.analysis?.referenceLevel;
  const denominator = levels.includes(previousDenominator)
    ? previousDenominator
    : (levels.includes(configuredReference) ? configuredReference : (levels.includes('control') ? 'control' : levels[0]));
  denominatorSelect.value = denominator || '';
  numeratorSelect.value = levels.includes(previousNumerator) && previousNumerator !== denominator
    ? previousNumerator
    : (levels.find((level) => level !== denominator) || levels[0] || '');
}

function populateDirectGroupControls(options = {}) {
  const factorA = document.getElementById('deseq-group-factor-a');
  const factorB = document.getElementById('deseq-group-factor-b');
  if (!factorA || !factorB) return;
  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  const columns = analysisFactorColumns().filter((column) => levelsForColumn(column, scope.sampleIds).length >= 2);
  populateSelect(factorA, columns, options.preferDefaults ? (columns.includes('condition') ? 'condition' : columns[0]) : factorA.value, metadataTypeOptionLabel);
  const bDefault = columns.find((column) => column !== factorA.value && column === 'tissue')
    || columns.find((column) => column !== factorA.value)
    || '';
  populateSelect(factorB, columns.filter((column) => column !== factorA.value), options.preferDefaults ? bDefault : factorB.value, metadataTypeOptionLabel);
  populateDirectGroupLevels();
}

function populateDirectGroupLevels() {
  const groupOne = document.getElementById('deseq-group-one');
  const groupTwo = document.getElementById('deseq-group-two');
  if (!groupOne || !groupTwo) return;
  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  const factors = [
    document.getElementById('deseq-group-factor-a')?.value || '',
    document.getElementById('deseq-group-factor-b')?.value || '',
  ].filter(Boolean);
  const groups = directGroupOptions(factors, scope.sampleIds);
  const previousOne = groupOne.value;
  const previousTwo = groupTwo.value;
  const options = groups.map((group) => `<option value="${deseqEscapeHtml(group.value)}">${deseqEscapeHtml(`${group.label} (${group.sampleIds.length})`)}</option>`).join('');
  groupOne.innerHTML = options;
  groupTwo.innerHTML = options;
  groupOne.disabled = groups.length < 2;
  groupTwo.disabled = groups.length < 2;
  groupOne.value = groups.some((group) => group.value === previousOne) ? previousOne : (groups[0]?.value || '');
  groupTwo.value = groups.some((group) => group.value === previousTwo) && previousTwo !== groupOne.value
    ? previousTwo
    : (groups.find((group) => group.value !== groupOne.value)?.value || groups[1]?.value || '');
}

function updateDeseqAdjustControls() {
  const adjustSelect = document.getElementById('deseq-adjust-columns');
  if (!adjustSelect) return;
  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  const direct = formValues.questionType === 'direct_group_comparison';
  const blocked = new Set(direct ? formValues.groupFactors : [document.getElementById('deseq-design-column')?.value || '']);
  const previous = new Set(Array.from(adjustSelect.selectedOptions || []).map((option) => option.value));
  const candidates = adjustmentMetadataColumns()
    .filter((column) => !blocked.has(column))
    .filter((column) => columnVariesInScope(column, scope.sampleIds));
  adjustSelect.innerHTML = candidates.map((column) => {
    const levels = levelsForColumn(column, scope.sampleIds).length;
    const type = metadataColumnType(column);
    const suffix = type === 'continuous' ? 'continuous' : `${levels} levels`;
    return `<option value="${deseqEscapeHtml(column)}"${previous.has(column) ? ' selected' : ''}>${deseqEscapeHtml(column)} (${suffix})</option>`;
  }).join('');
  adjustSelect.disabled = candidates.length === 0;
}

function columnVariesInScope(column, sampleIds) {
  const values = sampleIds
    .map((sampleId) => state.samples.find((sample) => sample.sample_id === sampleId)?.[column])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  if (metadataColumnType(column) === 'continuous') return values.length > 1 && values.every((value) => Number.isFinite(Number(value))) && new Set(values).size > 1;
  return new Set(values).size > 1;
}

function populateSelect(select, values, preferred = '', labeler = (value) => value) {
  const previous = select.value;
  select.innerHTML = values.map((value) => `<option value="${deseqEscapeHtml(value)}">${deseqEscapeHtml(labeler(value))}</option>`).join('');
  select.disabled = values.length === 0;
  select.value = values.includes(preferred)
    ? preferred
    : (values.includes(previous) ? previous : (values[0] || ''));
}

function renderDeseqPreview() {
  const status = document.getElementById('deseq-status');
  const preview = document.getElementById('deseq-model-preview');
  const balance = document.getElementById('deseq-group-balance');
  const scopeStatus = document.getElementById('deseq-scope-status');
  const runButton = document.getElementById('deseq-run');
  const { spec, errors, warnings } = safeBuildDeseqQuestionSpec(readDeseqFormValues());

  if (runButton) runButton.disabled = errors.length > 0;
  if (scopeStatus) {
    const scope = spec?.scope || buildAnalysisScope(readDeseqFormValues());
    scopeStatus.textContent = `${scope.sampleIds.length} matched sample${scope.sampleIds.length === 1 ? '' : 's'} selected from ${sampleIdsInCounts(state.samples, state.counts).length}.`;
  }
  if (!preview) return;

  if (errors.length) {
    preview.innerHTML = `<p class="deseq-error">${deseqEscapeHtml(errors[0])}</p>`;
    if (balance) balance.innerHTML = '';
    if (status) status.textContent = `DESeq2 setup needs attention: ${errors[0]}`;
    return;
  }

  preview.innerHTML = previewDeseqModel(spec).map(([label, value]) => `
    <div class="deseq-preview-row"><span>${deseqEscapeHtml(label)}</span><strong>${deseqEscapeHtml(value)}</strong></div>
  `).join('');
  if (warnings.length) {
    preview.innerHTML += `<ul class="deseq-warning-list">${warnings.map((warning) => `<li>${deseqEscapeHtml(warning)}</li>`).join('')}</ul>`;
  }
  if (balance) {
    const rows = groupBalanceRows(spec);
    balance.innerHTML = rows.length ? `
      <div class="deseq-balance-title">Group balance</div>
      <div class="deseq-balance-grid">
        ${rows.map((row) => `<span>${deseqEscapeHtml(row.group)}</span><strong>${row.samples}</strong>`).join('')}
      </div>` : '';
  }
  if (status && !status.textContent.startsWith('DESeq2 complete') && !status.textContent.startsWith('DESeq2 failed')) {
    status.textContent = 'DESeq2 uses webR and the configured package snapshot. The preview shows the model before execution.';
  }
}

export async function runDeseq2Analysis() {
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
    deseqSetStatus(status, 'Validating DESeq2 question and design...');
    await progress.step('Validating question and design', 1);
    const spec = buildDeseqQuestionSpec(readDeseqFormValues());
    registerAnalysisScope(spec.scope);

    await progress.step(`Using ${spec.sampleIds.length} samples for ${spec.contrastLabel}`, 2);
    deseqSetStatus(status, 'Loading DESeq2 package in webR. First run can take a few minutes.');
    await progress.step('Loading DESeq2 package in webR', 3);
    await ensureRPackages(deseqPackageSet(), { load: ['DESeq2'] });

    const modelMessage = `Running DESeq2 in webR for ${state.counts.length} genes and ${spec.sampleIds.length} samples`;
    deseqSetStatus(status, `${modelMessage}. Keep this tab open.`);
    await progress.step(modelMessage, 4);
    const rows = await runWithProgressPulse(
      progress,
      `${modelMessage}; still working`,
      () => deseqRunInWebR(spec),
      {
        intervalMs: 10000,
        onPulse: (message) => deseqSetStatus(status, `${message}. Keep this tab open.`),
      },
    );
    if (rows.length === 0) throw new Error('DESeq2 returned no result rows.');

    await progress.step('Registering contrast and updating plots', 5);
    const contrast = contrastFromSpec(spec);
    const existingIndex = state.contrasts.findIndex((item) => item.id === contrast.id);
    if (existingIndex >= 0) state.contrasts[existingIndex] = contrast;
    else state.contrasts.push(contrast);
    state.deResults.set(contrast.id, rows);
    markAnalysisCacheDirty(`DESeq2 ${contrast.label}`);

    deseqCallbacks.populateContrastSelectors?.();
    deseqCallbacks.renderOverviewMetrics?.();
    deseqCallbacks.renderAnalysisReadiness?.();
    const contrastSelect = document.getElementById('contrast-select');
    const familySelect = document.getElementById('contrast-family-select');
    if (familySelect) familySelect.value = contrast.result_family || 'all';
    if (contrastSelect) contrastSelect.value = contrast.id;
    await progress.step('Rendering DE table and volcano/MA plots', 6);
    await deseqCallbacks.renderCurrentContrast?.();

    logAnalysis(`DESeq2 completed for ${contrast.label} with ${spec.fullModel}: ${rows.length} genes.`);
    deseqSetStatus(status, `DESeq2 complete: ${rows.length} genes. Model ${spec.fullModel}.`);
    await progress.done(`Complete: ${rows.length} genes. Model ${spec.fullModel}`);
  } catch (error) {
    logAnalysis(`DESeq2 failed: ${error.message}`);
    deseqSetStatus(status, `DESeq2 failed: ${error.message}`);
    await progress.fail(`failed: ${error.message}`);
  } finally {
    if (runButton) {
      runButton.disabled = false;
      runButton.textContent = runButtonLabel;
      runButton.removeAttribute('aria-busy');
      renderDeseqPreview();
    }
  }
}

function contrastFromSpec(spec) {
  return {
    id: spec.id,
    label: spec.label,
    question_type: spec.questionType,
    question_label: spec.questionLabel,
    result_family: spec.resultFamily,
    scope_id: spec.scopeId,
    scope_label: spec.scope.label,
    sample_count: spec.sampleIds.length,
    primary_factor: spec.primaryFactor === DESEQ_GROUP_COLUMN ? '' : spec.primaryFactor,
    column: spec.primaryFactor === DESEQ_GROUP_COLUMN ? '' : spec.primaryFactor,
    numerator: spec.numerator,
    denominator: spec.denominator,
    adjust_columns: spec.adjustColumns,
    adjustColumns: spec.adjustColumns,
    full_model: spec.fullModel,
    reduced_model: spec.reducedModel || '',
    contrast_label: spec.contrastLabel,
    design: spec.fullModel,
    model_kind: spec.modelKind,
    result_mode: spec.resultMode,
    group_factors: spec.groupFactors || [],
    group_one_label: spec.groupOneLabel || '',
    group_two_label: spec.groupTwoLabel || '',
    group_balance: spec.groupBalance,
    warnings: spec.warnings || [],
    generated: true,
    method: 'DESeq2 webR',
  };
}

function deseqPackageSet() {
  return state.config?.webr?.modules?.deseq2?.packages || ['DESeq2'];
}

async function deseqRunInWebR(spec) {
  const countsCsv = deseqCountsCsv(spec.sampleIds);
  const metadataCsv = deseqMetadataCsv(spec);
  const adjustTypeVector = deseqRNamedStringVector(spec.adjustColumns.map((adjustColumn) => [adjustColumn, metadataColumnType(adjustColumn)]));
  const code = `
suppressPackageStartupMessages(library(DESeq2))
count_text <- ${deseqRString(countsCsv)}
metadata_text <- ${deseqRString(metadataCsv)}
primary_col_raw <- ${deseqRString(spec.primaryFactor)}
adjust_cols_raw <- c(${spec.adjustColumns.map(deseqRString).join(', ')})
adjust_types_raw <- ${adjustTypeVector}
reference_level <- ${deseqRString(spec.reference)}
numerator_level <- ${deseqRString(spec.numerator)}
denominator_level <- ${deseqRString(spec.denominator)}
countData <- read.csv(text = count_text, row.names = 1, check.names = FALSE)
rownames(countData) <- make.unique(rownames(countData))
countData <- as.matrix(countData)
countData <- matrix(suppressWarnings(as.numeric(countData)), nrow = nrow(countData), dimnames = dimnames(countData))
if (any(!is.finite(countData)) || any(countData < 0)) {
  stop("Count matrix contains non-numeric, negative, or missing values.")
}
countData <- round(countData)
storage.mode(countData) <- "integer"
colData <- read.csv(text = metadata_text, row.names = 1, check.names = FALSE, stringsAsFactors = FALSE)
countData <- countData[, rownames(colData), drop = FALSE]
raw_names <- colnames(colData)
safe_names <- make.names(raw_names, unique = TRUE)
colnames(colData) <- safe_names
safe_lookup <- setNames(safe_names, raw_names)
design_col <- unname(safe_lookup[[primary_col_raw]])
if (is.na(design_col) || !nzchar(design_col)) {
  stop("Primary design column is missing from metadata.")
}
adjust_cols <- character(0)
for (adjust_col_raw in adjust_cols_raw) {
  adjust_col <- unname(safe_lookup[[adjust_col_raw]])
  if (is.na(adjust_col) || !nzchar(adjust_col)) next
  adjust_type <- adjust_types_raw[[adjust_col_raw]]
  if (is.null(adjust_type) || is.na(adjust_type) || !nzchar(adjust_type)) adjust_type <- "categorical"
  value <- trimws(as.character(colData[[adjust_col]]))
  if (any(!nzchar(value))) {
    stop(paste("Adjustment column has missing values:", adjust_col_raw))
  }
  if (identical(adjust_type, "continuous")) {
    numeric_value <- suppressWarnings(as.numeric(value))
    if (any(!is.finite(numeric_value))) {
      stop(paste("Continuous adjustment column contains non-numeric values:", adjust_col_raw))
    }
    colData[[adjust_col]] <- numeric_value
  } else {
    colData[[adjust_col]] <- factor(value)
  }
  if (is.factor(colData[[adjust_col]]) && nlevels(colData[[adjust_col]]) < 2) {
    stop(paste("Adjustment factor has fewer than two levels:", adjust_col_raw))
  }
  adjust_cols <- c(adjust_cols, adjust_col)
}
primary_value <- trimws(as.character(colData[[design_col]]))
if (any(!nzchar(primary_value))) {
  stop("Primary design column has missing values.")
}
colData[[design_col]] <- relevel(factor(primary_value), ref = reference_level)
if (!all(c(numerator_level, denominator_level) %in% levels(colData[[design_col]]))) {
  stop("Selected numerator or denominator level was not found after subsetting samples.")
}
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
  await loadGeneAnnotation(false);
  const geneSymbols = deseqGeneSymbolLookup();
  return parseDeCsv(text).map((row) => ({
    ...row,
    gene_symbol: row.gene_symbol || geneSymbols.get(deseqGeneKey(row.gene_id)) || '',
    method: `DESeq2 webR ${spec.fullModel}`,
  })).sort((a, b) => deseqSortPValue(a.padj) - deseqSortPValue(b.padj));
}

function deseqSortPValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 1;
}

function deseqCountsCsv(sampleIds) {
  const rows = state.counts.map((row, index) => {
    const geneId = row.gene_id || row.gene_symbol || row.gene_name || `gene_${index + 1}`;
    return [geneId].concat(sampleIds.map((sampleId) => {
      const value = parseCountCell(row[sampleId]);
      if (value === null) throw new Error(`Invalid count value for ${geneId}/${sampleId}: ${row[sampleId] ?? ''}`);
      return value;
    }));
  });
  return deseqCsv([['gene_id'].concat(sampleIds)].concat(rows));
}

function deseqMetadataCsv(spec) {
  const metadataColumns = uniqueStrings(spec.adjustColumns.concat(spec.primaryFactor));
  const rows = spec.sampleIds.map((sampleId) => {
    const sample = state.samples.find((item) => item.sample_id === sampleId) || {};
    return [sampleId].concat(metadataColumns.map((column) => {
      if (spec.syntheticColumns?.[column]) return spec.syntheticColumns[column][sampleId] ?? '';
      return sample[column] ?? '';
    }));
  });
  return deseqCsv([['sample_id'].concat(metadataColumns)].concat(rows));
}

function deseqCsv(rows) {
  return rows.map((row) => row.map(deseqCsvEscape).join(',')).join('\n');
}

function deseqCsvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function deseqGeneSymbolLookup() {
  const lookup = new Map();
  const addGene = (geneId, geneSymbol) => {
    const key = deseqGeneKey(geneId);
    const symbol = deseqGeneLabel(geneSymbol);
    if (key && symbol && !lookup.has(key)) lookup.set(key, symbol);
  };

  (state.geneAnnotation || []).forEach((gene) => {
    addGene(gene.gene_id, gene.gene_symbol || gene.gene_name);
  });
  (state.counts || []).forEach((row) => {
    const geneId = row.gene_id || row.gene_symbol || row.gene_name;
    addGene(geneId, row.gene_symbol || row.gene_name);
  });

  return lookup;
}

function deseqGeneKey(value) {
  return String(value ?? '').trim();
}

function deseqGeneLabel(value) {
  const label = String(value ?? '').trim();
  return label && !['NA', 'N/A', 'NULL', 'NONE'].includes(label.toUpperCase()) ? label : '';
}

function deseqResultText(result) {
  if (typeof result === 'string') return result;
  if (Array.isArray(result?.values)) return result.values.join('\n');
  if (result?.values?.[0] !== undefined) return String(result.values[0]);
  return String(result ?? '');
}

function deseqSetStatus(element, message) {
  if (element) element.textContent = message;
}

function deseqRString(value) {
  return JSON.stringify(String(value));
}

function deseqRNamedStringVector(entries) {
  if (!entries.length) return 'c()';
  return `c(${entries.map(([name, value]) => `${deseqRString(name)} = ${deseqRString(value)}`).join(', ')})`;
}

function deseqEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}
