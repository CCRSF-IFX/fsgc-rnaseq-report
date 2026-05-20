import { state, logAnalysis, createProgressReporter, runWithProgressPulse } from './state.js';
import { sampleIdsInCounts } from './analysis.js';
import { loadGeneAnnotation, parseDeCsv, parseCountCell } from './dataLoader.js';
import { adjustmentMetadataColumns, analysisFactorColumns, metadataColumnType, metadataTypeOptionLabel } from './metadataSchema.js';
import { ensureRPackages } from './packageManager.js';
import { evalR } from './webrManager.js';
import { markAnalysisCacheDirty } from './analysisCache.js';
import {
  DESEQ_ADVANCED_QUESTION_TYPE,
  DESEQ_ADVANCED_QUESTION_TYPES,
  DESEQ_DEFAULT_INTERACTION_OUTPUTS,
  DESEQ_INTERACTION_OUTPUT_TYPES,
  DESEQ_PAIRWISE_QUESTION_TYPE,
  DESEQ_CONDITION_LIKE_COLUMNS,
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
  normalizeAdvancedQuestionType,
  normalizeQuestionMode,
} from './deQuestionBuilder.js';

let deseqCallbacks = {};
let deseqControlsWired = false;
let deseqPreviewSignature = '';
let deseqPreviewWatcher = null;

export function setupDeseqControls(callbacks = {}) {
  deseqCallbacks = callbacks;
  const questionSelect = document.getElementById('deseq-question-type');
  const designSelect = document.getElementById('deseq-design-column');
  if (!questionSelect || !designSelect) return;

  populateQuestionTypes();
  populateAdvancedQuestionTypes();
  populateScopeControls();
  syncDeseqQuestionUi();
  populateFactorControls();
  populateDirectGroupControls();
  populateInteractionControls();
  updateDeseqAdjustControls();
  populateExcludedSamples();
  renderDeseqPreview();
  startDeseqPreviewWatcher();

  if (!deseqControlsWired) {
    deseqControlsWired = true;
    wireDeseqBuilderControls();
    document.getElementById('deseq-run')?.addEventListener('click', runDeseq2Analysis);
  }
}

function startDeseqPreviewWatcher() {
  if (deseqPreviewWatcher) return;
  deseqPreviewSignature = deseqCurrentFormSignature();
  deseqPreviewWatcher = setInterval(() => {
    const signature = deseqCurrentFormSignature();
    if (signature === deseqPreviewSignature) return;
    deseqPreviewSignature = signature;
    renderDeseqPreview();
    deseqCallbacks.renderAnalysisReadiness?.();
  }, 250);
}

function deseqCurrentFormSignature() {
  try {
    return JSON.stringify(readDeseqFormValues());
  } catch {
    return '';
  }
}

function wireDeseqBuilderControls() {
  [
    'deseq-question-type',
    'deseq-advanced-question-type',
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
    'deseq-interaction-condition',
    'deseq-interaction-modifier',
    'deseq-interaction-condition-numerator',
    'deseq-interaction-condition-denominator',
    'deseq-interaction-modifier-numerator',
    'deseq-interaction-modifier-denominator',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', refreshDeseqBuilder);
  });
  wireMultiSelectRefresh('deseq-exclude-samples');
  wireMultiSelectRefresh('deseq-adjust-columns');
  wireDeseqAdjustChecklist();
  document.querySelectorAll('input[name="deseq-scope-mode"]').forEach((radio) => {
    radio.addEventListener('change', refreshDeseqBuilder);
  });
  document.querySelectorAll('input[name="deseq-interaction-output"]').forEach((checkbox) => {
    checkbox.addEventListener('change', refreshDeseqBuilder);
  });
}

function wireMultiSelectRefresh(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.addEventListener('mousedown', (event) => {
    if (event.target?.tagName !== 'OPTION') return;
    event.preventDefault();
    event.target.selected = !event.target.selected;
    refreshDeseqBuilder(event);
  });
  ['input', 'click', 'keyup', 'mouseup', 'pointerup', 'blur'].forEach((eventName) => {
    select.addEventListener(eventName, (event) => {
      refreshDeseqBuilder(event);
      setTimeout(() => refreshDeseqBuilder(event), 0);
    });
  });
}

function wireDeseqAdjustChecklist() {
  const list = document.getElementById('deseq-adjust-list');
  if (!list) return;
  list.addEventListener('change', (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox') return;
    const select = document.getElementById('deseq-adjust-columns');
    const option = Array.from(select?.options || []).find((item) => item.value === checkbox.value);
    if (option) option.selected = checkbox.checked;
    syncAdjustSelectionDataset(select);
    refreshDeseqBuilder(event);
    setTimeout(renderDeseqPreview, 0);
  });
}


function refreshDeseqBuilder(event = null) {
  const changedId = event?.currentTarget?.id || '';
  if (changedId === 'deseq-question-type' || changedId === 'deseq-advanced-question-type') {
    syncDeseqQuestionUi();
    populateFactorControls({ preferQuestionDefault: true });
    populateDirectGroupControls({ preferDefaults: true });
    populateInteractionControls({ preferDefaults: true });
    updateDeseqAdjustControls();
  } else if (changedId === 'deseq-scope-column') {
    populateScopeLevels();
    populateFactorControls();
    populateDirectGroupControls();
    populateInteractionControls();
    updateDeseqAdjustControls();
    populateExcludedSamples();
  } else if (changedId === 'deseq-scope-level' || changedId === 'deseq-exclude-samples' || event?.currentTarget?.name === 'deseq-scope-mode') {
    syncDeseqScopeControls();
    populateFactorControls();
    populateDirectGroupControls();
    populateInteractionControls();
    updateDeseqAdjustControls();
    populateExcludedSamples();
  } else if (changedId === 'deseq-design-column') {
    updateDeseqLevelControls();
    updateDeseqAdjustControls();
  } else if (changedId === 'deseq-group-factor-a' || changedId === 'deseq-group-factor-b') {
    populateDirectGroupControls();
    updateDeseqAdjustControls();
  } else if (changedId === 'deseq-interaction-condition' || changedId === 'deseq-interaction-modifier') {
    populateInteractionControls();
    updateDeseqAdjustControls();
  } else if (changedId.startsWith('deseq-interaction-')) {
    populateInteractionLevels();
  }
  renderDeseqPreview();
  deseqCallbacks.renderAnalysisReadiness?.();
}

function populateQuestionTypes() {
  const select = document.getElementById('deseq-question-type');
  if (!select) return;
  const previous = normalizeQuestionMode(select.value);
  select.innerHTML = DESEQ_QUESTION_TYPES
    .map((type) => `<option value="${deseqEscapeHtml(type.id)}">${deseqEscapeHtml(type.label)}</option>`)
    .join('');
  select.value = DESEQ_QUESTION_TYPES.some((type) => type.id === previous)
    ? previous
    : DESEQ_QUESTION_TYPES[0].id;
}

function populateAdvancedQuestionTypes() {
  const select = document.getElementById('deseq-advanced-question-type');
  if (!select) return;
  const previous = normalizeAdvancedQuestionType(select.value);
  select.innerHTML = DESEQ_ADVANCED_QUESTION_TYPES
    .map((type) => `<option value="${deseqEscapeHtml(type.id)}">${deseqEscapeHtml(type.label)}</option>`)
    .join('');
  select.value = DESEQ_ADVANCED_QUESTION_TYPES.some((type) => type.id === previous)
    ? previous
    : DESEQ_ADVANCED_QUESTION_TYPES[0].id;
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
  const questionMode = normalizeQuestionMode(document.getElementById('deseq-question-type')?.value || '');
  const questionType = currentEffectiveQuestionType();
  const advanced = questionMode === DESEQ_ADVANCED_QUESTION_TYPE;
  const direct = questionType === 'direct_group_comparison';
  const interaction = questionType === 'pairwise_interaction' || questionType === 'omnibus_interaction_lrt';
  const lrt = questionType === 'omnibus_interaction_lrt';
  const factorControls = document.getElementById('deseq-factor-controls');
  const directControls = document.getElementById('deseq-direct-group-controls');
  const interactionControls = document.getElementById('deseq-interaction-controls');
  const advancedRow = document.getElementById('deseq-advanced-question-row');
  const advancedHelp = document.getElementById('deseq-advanced-question-help');
  const manualFactorGuide = document.getElementById('deseq-manual-factor-guide');
  const interactionConditionLevels = document.getElementById('deseq-interaction-condition-levels');
  const interactionModifierLevels = document.getElementById('deseq-interaction-modifier-levels');
  const interactionConditionNumeratorLabel = document.getElementById('deseq-interaction-condition-numerator-label');
  const interactionModifierNumeratorLabel = document.getElementById('deseq-interaction-modifier-numerator-label');
  const interactionOutputControls = document.getElementById('deseq-interaction-output-controls');
  const interactionHelp = document.getElementById('deseq-interaction-help');
  if (advancedRow) advancedRow.hidden = !advanced;
  if (advancedHelp) advancedHelp.textContent = advancedQuestionHelp(questionType);
  if (factorControls) factorControls.hidden = direct || interaction || advanced;
  if (directControls) directControls.hidden = !direct;
  if (interactionControls) interactionControls.hidden = !advanced || !interaction;
  if (interactionConditionLevels) interactionConditionLevels.hidden = lrt;
  if (interactionModifierLevels) interactionModifierLevels.hidden = lrt;
  if (interactionConditionNumeratorLabel) interactionConditionNumeratorLabel.hidden = questionType === 'pairwise_interaction';
  if (interactionModifierNumeratorLabel) interactionModifierNumeratorLabel.hidden = questionType === 'pairwise_interaction';
  if (interactionOutputControls) interactionOutputControls.hidden = questionType !== 'pairwise_interaction';
  if (interactionHelp) {
    interactionHelp.textContent = lrt
      ? 'Recommended first for multi-level factors. LRT tests whether adding condition-by-modifier interaction terms improves the additive model. Genes with small padj have evidence of interaction.'
      : 'Follow-up after a significant or biologically interesting LRT. Interaction effect creates one DE result for each non-reference interaction coefficient.';
  }
  if (manualFactorGuide) {
    const missingConditionLike = questionType === DESEQ_PAIRWISE_QUESTION_TYPE && !hasConditionLikeColumn();
    manualFactorGuide.hidden = !missingConditionLike || direct || interaction || advanced;
  }
}

function advancedQuestionHelp(questionType) {
  if (questionType === 'omnibus_interaction_lrt') {
    return 'Recommended first for multi-level factors. Use LRT to ask whether the condition response changes across the modifier levels; then follow up significant genes with Interaction effect.';
  }
  if (questionType === 'pairwise_interaction') {
    return 'Follow-up workflow. Choose reference levels and the app will create separate coefficient-level results for each non-reference interaction effect.';
  }
  if (questionType === 'direct_group_comparison') {
    return 'Less common special case. Use direct combined groups only when comparing two exact combined groups is the intended biological question.';
  }
  return 'Recommended flow: run Omnibus interaction LRT first to screen for interaction, then use Interaction effect for coefficient-level follow-up. Direct combined-group comparison is less common.';
}

function currentEffectiveQuestionType() {
  const questionMode = normalizeQuestionMode(document.getElementById('deseq-question-type')?.value || '');
  if (questionMode !== DESEQ_ADVANCED_QUESTION_TYPE) return questionMode;
  return normalizeAdvancedQuestionType(document.getElementById('deseq-advanced-question-type')?.value || DESEQ_ADVANCED_QUESTION_TYPES[0].id);
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
  const needsManualPrimaryFactor = formValues.questionType === DESEQ_PAIRWISE_QUESTION_TYPE && !conditionLikeColumnFor(eligibleColumns);
  designSelect.disabled = eligibleColumns.length === 0;
  const placeholder = needsManualPrimaryFactor ? '<option value="">Choose primary factor...</option>' : '';
  designSelect.innerHTML = placeholder + eligibleColumns
    .map((column) => `<option value="${deseqEscapeHtml(column)}">${deseqEscapeHtml(metadataTypeOptionLabel(column))}</option>`)
    .join('');
  let selectedColumn = defaultColumn;
  if (!options.preferQuestionDefault && eligibleColumns.includes(previous)) selectedColumn = previous;
  if (needsManualPrimaryFactor && (options.preferQuestionDefault || !eligibleColumns.includes(previous))) selectedColumn = '';
  if (forcedColumn) selectedColumn = forcedColumn;
  designSelect.value = selectedColumn;
  updateDeseqLevelControls();
}

function forcedPrimaryFactor(questionType, columns) {
  return '';
}

function defaultPrimaryFactor(questionType, columns) {
  if (columns.includes(state.config?.analysis?.conditionColumn)) return state.config.analysis.conditionColumn;
  const conditionLike = conditionLikeColumnFor(columns);
  if (conditionLike) return conditionLike;
  if (columns.includes('tissue')) return 'tissue';
  return columns[0] || '';
}

function hasConditionLikeColumn() {
  return Boolean(conditionLikeColumnFor(analysisFactorColumns()));
}

function conditionLikeColumnFor(columns) {
  return columns.find((column) => DESEQ_CONDITION_LIKE_COLUMNS.includes(column.toLowerCase()));
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

function populateInteractionControls(options = {}) {
  const conditionSelect = document.getElementById('deseq-interaction-condition');
  const modifierSelect = document.getElementById('deseq-interaction-modifier');
  if (!conditionSelect || !modifierSelect) return;
  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  const columns = analysisFactorColumns().filter((column) => levelsForColumn(column, scope.sampleIds).length >= 2);
  const previousCondition = conditionSelect.value;
  const defaultCondition = defaultInteractionCondition(columns);
  populateSelect(
    conditionSelect,
    columns,
    options.preferDefaults ? defaultCondition : previousCondition,
    metadataTypeOptionLabel,
  );

  const modifierColumns = columns.filter((column) => column !== conditionSelect.value);
  const previousModifier = modifierSelect.value;
  const defaultModifier = defaultInteractionModifier(modifierColumns);
  populateSelect(
    modifierSelect,
    modifierColumns,
    options.preferDefaults ? defaultModifier : previousModifier,
    metadataTypeOptionLabel,
  );
  populateInteractionLevels();
}

function defaultInteractionCondition(columns) {
  if (columns.includes(state.config?.analysis?.conditionColumn)) return state.config.analysis.conditionColumn;
  if (columns.includes('condition')) return 'condition';
  if (columns.includes('treatment')) return 'treatment';
  return columns[0] || '';
}

function defaultInteractionModifier(columns) {
  if (columns.includes('tissue')) return 'tissue';
  if (columns.includes('genotype')) return 'genotype';
  if (columns.includes('sex')) return 'sex';
  return columns[0] || '';
}

function populateInteractionLevels() {
  const conditionNumerator = document.getElementById('deseq-interaction-condition-numerator');
  const conditionDenominator = document.getElementById('deseq-interaction-condition-denominator');
  const modifierNumerator = document.getElementById('deseq-interaction-modifier-numerator');
  const modifierDenominator = document.getElementById('deseq-interaction-modifier-denominator');
  if (!conditionNumerator || !conditionDenominator || !modifierNumerator || !modifierDenominator) return;

  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  const conditionColumn = document.getElementById('deseq-interaction-condition')?.value || '';
  const modifierColumn = document.getElementById('deseq-interaction-modifier')?.value || '';
  const conditionLevels = levelsForColumn(conditionColumn, scope.sampleIds);
  const modifierLevels = levelsForColumn(modifierColumn, scope.sampleIds);
  populateLevelPair(conditionNumerator, conditionDenominator, conditionLevels, state.config?.analysis?.referenceLevel);
  populateLevelPair(modifierNumerator, modifierDenominator, modifierLevels, '');
}

function populateLevelPair(numeratorSelect, denominatorSelect, levels, preferredDenominator = '') {
  const previousNumerator = numeratorSelect.value;
  const previousDenominator = denominatorSelect.value;
  const levelOptions = levels.map((level) => `<option value="${deseqEscapeHtml(level)}">${deseqEscapeHtml(level)}</option>`).join('');
  numeratorSelect.innerHTML = levelOptions;
  denominatorSelect.innerHTML = levelOptions;
  numeratorSelect.disabled = levels.length < 2;
  denominatorSelect.disabled = levels.length < 2;
  const denominator = levels.includes(previousDenominator)
    ? previousDenominator
    : (levels.includes(preferredDenominator) ? preferredDenominator : (levels.includes('control') ? 'control' : levels[0]));
  denominatorSelect.value = denominator || '';
  numeratorSelect.value = levels.includes(previousNumerator) && previousNumerator !== denominator
    ? previousNumerator
    : (levels.find((level) => level !== denominator) || levels[0] || '');
}

function updateDeseqAdjustControls() {
  const adjustSelect = document.getElementById('deseq-adjust-columns');
  if (!adjustSelect) return;
  const formValues = readDeseqFormValues();
  const scope = buildAnalysisScope(formValues);
  if (formValues.questionType === DESEQ_PAIRWISE_QUESTION_TYPE) {
    adjustSelect.innerHTML = '';
    adjustSelect.disabled = true;
    syncAdjustSelectionDataset(adjustSelect);
    renderDeseqAdjustChecklist(
      [],
      new Set(),
      scope.sampleIds,
      'Pairwise comparison uses model ~ primary factor. Choose Additive covariate analysis when you need batch, subject, paired-sample, or numeric covariate adjustment.',
    );
    return;
  }
  const direct = formValues.questionType === 'direct_group_comparison';
  const interaction = formValues.questionType === 'pairwise_interaction' || formValues.questionType === 'omnibus_interaction_lrt';
  const blocked = new Set(direct
    ? formValues.groupFactors
    : (interaction
      ? [formValues.interactionConditionFactor, formValues.interactionModifierFactor]
      : [document.getElementById('deseq-design-column')?.value || '']));
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
  syncAdjustSelectionDataset(adjustSelect);
  renderDeseqAdjustChecklist(candidates, previous, scope.sampleIds);
}

function syncAdjustSelectionDataset(select) {
  if (!select) return;
  select.dataset.selectedValues = Array.from(select.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean)
    .join('\t');
}

function renderDeseqAdjustChecklist(candidates, selectedValuesSet, sampleIds, emptyMessage = '') {
  const list = document.getElementById('deseq-adjust-list');
  if (!list) return;
  if (!candidates.length) {
    list.innerHTML = `<p class="empty-note">${deseqEscapeHtml(emptyMessage || 'No eligible adjustment variables for the selected model and sample scope.')}</p>`;
    return;
  }
  list.innerHTML = candidates.map((column) => {
    const levels = levelsForColumn(column, sampleIds).length;
    const type = metadataColumnType(column);
    const suffix = type === 'continuous' ? 'continuous' : `${levels} levels`;
    const checked = selectedValuesSet.has(column) ? ' checked' : '';
    return `<label class="check-label"><input type="checkbox" value="${deseqEscapeHtml(column)}"${checked} /> ${deseqEscapeHtml(column)} <span class="muted">(${deseqEscapeHtml(suffix)})</span></label>`;
  }).join('');
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
    const registered = registerDeseqResultRows(spec, rows);
    const contrast = registered[0].contrast;
    markAnalysisCacheDirty(`DESeq2 ${registered.map((item) => item.contrast.label).join('; ')}`);

    deseqCallbacks.populateContrastSelectors?.();
    deseqCallbacks.renderOverviewMetrics?.();
    deseqCallbacks.renderAnalysisReadiness?.();
    const contrastSelect = document.getElementById('contrast-select');
    const familySelect = document.getElementById('contrast-family-select');
    if (familySelect) familySelect.value = contrast.result_family || 'all';
    if (contrastSelect) contrastSelect.value = contrast.id;
    await progress.step('Rendering DE table and volcano/MA plots', 6);
    await deseqCallbacks.renderCurrentContrast?.();

    const resultSummary = registered.length === 1
      ? `${registered[0].rows.length} genes`
      : `${registered.length} interaction result sets`;
    logAnalysis(`DESeq2 completed for ${registered.map((item) => item.contrast.label).join('; ')} with ${spec.fullModel}: ${resultSummary}.`);
    deseqSetStatus(status, `DESeq2 complete: ${resultSummary}. Model ${spec.fullModel}.`);
    await progress.done(`Complete: ${resultSummary}. Model ${spec.fullModel}`);
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

function registerDeseqResultRows(spec, rows) {
  const resultSets = spec.resultMode === 'wald_interaction_coefficient'
    ? interactionResultSets(spec, rows)
    : [{ spec, rows }];
  resultSets.forEach((resultSet) => {
    const contrast = contrastFromSpec(resultSet.spec);
    const existingIndex = state.contrasts.findIndex((item) => item.id === contrast.id);
    if (existingIndex >= 0) state.contrasts[existingIndex] = contrast;
    else state.contrasts.push(contrast);
    state.deResults.set(contrast.id, resultSet.rows);
    resultSet.contrast = contrast;
  });
  return resultSets;
}

function interactionResultSets(spec, rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.interaction_result_id || row.coefficient_name || row.interaction_label || 'interaction';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return Array.from(grouped.entries()).map(([resultId, coefficientRows]) => {
    const first = coefficientRows[0] || {};
    const coefficientName = first.coefficient_name || resultId;
    const conditionNumerator = first.condition_numerator || spec.conditionNumerator;
    const conditionDenominator = first.condition_denominator || spec.conditionDenominator;
    const modifierNumerator = first.modifier_numerator || spec.modifierNumerator;
    const modifierDenominator = first.modifier_denominator || spec.modifierDenominator;
    const interactionOutput = first.interaction_output || 'interaction_coefficients';
    const interactionOutputLabel = first.interaction_output_label || interactionOutputLabelFor(interactionOutput);
    const label = first.interaction_label || interactionResultLabel(spec, interactionOutput, conditionNumerator, conditionDenominator, modifierNumerator, modifierDenominator);
    const primaryFactor = interactionOutput.includes('modifier') ? spec.modifierFactor : spec.conditionFactor;
    const numerator = interactionOutput.includes('modifier') ? modifierNumerator : conditionNumerator;
    const denominator = interactionOutput.includes('modifier') ? modifierDenominator : conditionDenominator;
    const coefficientSpec = {
      ...spec,
      id: makeDeseqResultId([
        spec.id,
        resultId,
      ]),
      label,
      questionLabel: `${spec.questionLabel}: ${interactionOutputLabel}`,
      contrastLabel: label,
      primaryFactor,
      numerator,
      denominator,
      conditionNumerator,
      conditionDenominator,
      modifierNumerator,
      modifierDenominator,
      coefficientName,
      interactionOutput,
      interactionOutputLabel,
      interactionResultId: resultId,
      interpretation: interactionResultInterpretation(spec, interactionOutput, conditionNumerator, conditionDenominator, modifierNumerator, modifierDenominator),
    };
    return { spec: coefficientSpec, rows: coefficientRows };
  });
}

function interactionOutputLabelFor(output) {
  return DESEQ_INTERACTION_OUTPUT_TYPES.find((type) => type.id === output)?.label || output;
}

function interactionResultLabel(spec, output, conditionNumerator, conditionDenominator, modifierNumerator, modifierDenominator) {
  if (output === 'condition_main_at_modifier_reference') {
    return `${conditionNumerator} vs ${conditionDenominator} at ${spec.modifierFactor} reference ${modifierDenominator}`;
  }
  if (output === 'modifier_main_at_condition_reference') {
    return `${modifierNumerator} vs ${modifierDenominator} at ${spec.conditionFactor} reference ${conditionDenominator}`;
  }
  if (output === 'simple_condition_effects') {
    return `${conditionNumerator} vs ${conditionDenominator} within ${spec.modifierFactor}=${modifierNumerator}`;
  }
  if (output === 'simple_modifier_effects') {
    return `${modifierNumerator} vs ${modifierDenominator} within ${spec.conditionFactor}=${conditionNumerator}`;
  }
  return `(${conditionNumerator} - ${conditionDenominator}) interaction at ${modifierNumerator} vs ${modifierDenominator}`;
}

function interactionResultInterpretation(spec, output, conditionNumerator, conditionDenominator, modifierNumerator, modifierDenominator) {
  if (output === 'condition_main_at_modifier_reference') {
    return `Condition effect ${conditionNumerator} vs ${conditionDenominator} at ${spec.modifierFactor} reference ${modifierDenominator}, using model ${spec.fullModel}.`;
  }
  if (output === 'modifier_main_at_condition_reference') {
    return `Modifier effect ${modifierNumerator} vs ${modifierDenominator} at ${spec.conditionFactor} reference ${conditionDenominator}, using model ${spec.fullModel}.`;
  }
  if (output === 'simple_condition_effects') {
    return `Condition effect ${conditionNumerator} vs ${conditionDenominator} within ${spec.modifierFactor}=${modifierNumerator}, using model ${spec.fullModel}.`;
  }
  if (output === 'simple_modifier_effects') {
    return `Modifier effect ${modifierNumerator} vs ${modifierDenominator} within ${spec.conditionFactor}=${conditionNumerator}, using model ${spec.fullModel}.`;
  }
  return `Interaction coefficient for ${conditionNumerator} vs ${conditionDenominator} at ${spec.modifierFactor}=${modifierNumerator} relative to ${modifierDenominator}, using model ${spec.fullModel}.`;
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
    test_label: spec.testLabel || '',
    condition_factor: spec.conditionFactor || '',
    modifier_factor: spec.modifierFactor || '',
    condition_numerator: spec.conditionNumerator || '',
    condition_denominator: spec.conditionDenominator || '',
    modifier_numerator: spec.modifierNumerator || '',
    modifier_denominator: spec.modifierDenominator || '',
    interaction_output: spec.interactionOutput || '',
    interaction_output_label: spec.interactionOutputLabel || '',
    interaction_result_id: spec.interactionResultId || '',
    interaction_outputs: spec.interactionOutputs || [],
    tested_terms: spec.testedTerms || [],
    coefficient_name: spec.coefficientName || '',
    group_factors: spec.groupFactors || [],
    group_one_label: spec.groupOneLabel || '',
    group_two_label: spec.groupTwoLabel || '',
    group_balance: spec.groupBalance,
    warnings: spec.warnings || [],
    generated: true,
    method: 'DESeq2 webR',
  };
}

function makeDeseqResultId(parts) {
  return parts
    .map((part) => String(part || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('__');
}

function deseqPackageSet() {
  return state.config?.webr?.modules?.deseq2?.packages || ['DESeq2'];
}

async function deseqRunInWebR(spec) {
  const countsCsv = deseqCountsCsv(spec.sampleIds);
  const metadataCsv = deseqMetadataCsv(spec);
  const adjustTypeVector = deseqRNamedStringVector(spec.adjustColumns.map((adjustColumn) => [adjustColumn, metadataColumnType(adjustColumn)]));
  const interactionOutputs = Array.isArray(spec.interactionOutputs) && spec.interactionOutputs.length
    ? spec.interactionOutputs
    : DESEQ_DEFAULT_INTERACTION_OUTPUTS;
  const code = `
suppressPackageStartupMessages(library(DESeq2))
count_text <- ${deseqRString(countsCsv)}
metadata_text <- ${deseqRString(metadataCsv)}
result_mode <- ${deseqRString(spec.resultMode)}
interaction_outputs_raw <- c(${interactionOutputs.map(deseqRString).join(', ')})
primary_col_raw <- ${deseqRString(spec.primaryFactor)}
condition_col_raw <- ${deseqRString(spec.conditionFactor || '')}
modifier_col_raw <- ${deseqRString(spec.modifierFactor || '')}
adjust_cols_raw <- c(${spec.adjustColumns.map(deseqRString).join(', ')})
adjust_types_raw <- ${adjustTypeVector}
reference_level <- ${deseqRString(spec.reference)}
numerator_level <- ${deseqRString(spec.numerator)}
denominator_level <- ${deseqRString(spec.denominator)}
condition_numerator_level <- ${deseqRString(spec.conditionNumerator || spec.numerator || '')}
condition_denominator_level <- ${deseqRString(spec.conditionDenominator || spec.denominator || '')}
modifier_numerator_level <- ${deseqRString(spec.modifierNumerator || '')}
modifier_denominator_level <- ${deseqRString(spec.modifierDenominator || '')}
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
lookup_column <- function(raw_col, label) {
  if (is.null(raw_col) || is.na(raw_col) || !nzchar(raw_col)) {
    stop(paste(label, "was not specified."))
  }
  safe_col <- unname(safe_lookup[[raw_col]])
  if (is.null(safe_col) || is.na(safe_col) || !nzchar(safe_col)) {
    stop(paste(label, "is missing from metadata:", raw_col))
  }
  safe_col
}
prepare_factor <- function(raw_col, label, reference = "") {
  safe_col <- lookup_column(raw_col, label)
  value <- trimws(as.character(colData[[safe_col]]))
  if (any(!nzchar(value))) {
    stop(paste(label, "has missing values."))
  }
  factor_value <- factor(value)
  if (nlevels(factor_value) < 2) {
    stop(paste(label, "has fewer than two levels after subsetting samples."))
  }
  if (nzchar(reference)) {
    if (!reference %in% levels(factor_value)) {
      stop(paste(label, "reference level was not found after subsetting samples:", reference))
    }
    factor_value <- relevel(factor_value, ref = reference)
  }
  colData[[safe_col]] <<- factor_value
  safe_col
}
normalize_name <- function(x) gsub("[^[:alnum:]]+", "", tolower(as.character(x)))
contains_part <- function(name, part) {
  part <- normalize_name(part)
  nzchar(part) && grepl(part, normalize_name(name), fixed = TRUE)
}
find_interaction_coef <- function(result_names, condition_col, condition_level, modifier_col, modifier_level) {
  interaction_names <- result_names[grepl(":", result_names, fixed = TRUE) | grepl("\\\\.", result_names)]
  target_parts <- c(condition_col, condition_level, modifier_col, modifier_level)
  hits <- interaction_names[vapply(interaction_names, function(name) {
    all(vapply(target_parts, function(part) contains_part(name, part), logical(1)))
  }, logical(1))]
  if (!length(hits)) {
    level_parts <- c(condition_level, modifier_level)
    hits <- interaction_names[vapply(interaction_names, function(name) {
      all(vapply(level_parts, function(part) contains_part(name, part), logical(1)))
    }, logical(1))]
  }
  if (!length(hits)) {
    stop(paste("Could not find the requested interaction coefficient. Available coefficients:", paste(result_names, collapse = ", ")))
  }
  hits[[1]]
}
find_main_coef <- function(result_names, factor_col, level) {
  main_names <- result_names[!(grepl(":", result_names, fixed = TRUE) | grepl("\\\\.", result_names))]
  target_parts <- c(factor_col, level)
  hits <- main_names[vapply(main_names, function(name) {
    all(vapply(target_parts, function(part) contains_part(name, part), logical(1)))
  }, logical(1))]
  if (!length(hits)) {
    level_part <- level
    hits <- main_names[vapply(main_names, function(name) contains_part(name, level_part), logical(1))]
  }
  if (!length(hits)) {
    stop(paste("Could not find the requested main-effect coefficient. Available coefficients:", paste(result_names, collapse = ", ")))
  }
  hits[[1]]
}
extract_result <- function(dds, add_coefs, subtract_coefs = character(0)) {
  add_coefs <- unique(add_coefs[nzchar(add_coefs)])
  subtract_coefs <- unique(subtract_coefs[nzchar(subtract_coefs)])
  if (!length(subtract_coefs) && length(add_coefs) == 1) {
    return(results(dds, name = add_coefs[[1]]))
  }
  available <- resultsNames(dds)
  missing <- setdiff(c(add_coefs, subtract_coefs), available)
  if (length(missing)) {
    stop(paste("Requested coefficient(s) were not found:", paste(missing, collapse = ", ")))
  }
  contrast_vector <- setNames(rep(0, length(available)), available)
  contrast_vector[add_coefs] <- contrast_vector[add_coefs] + 1
  contrast_vector[subtract_coefs] <- contrast_vector[subtract_coefs] - 1
  results(dds, contrast = contrast_vector)
}
decorate_result <- function(res, output, output_label, result_id, result_label, coefficient_name,
                            condition_numerator = "", condition_denominator = "",
                            modifier_numerator = "", modifier_denominator = "") {
  current_out <- as.data.frame(res)
  current_out$gene_id <- rownames(current_out)
  current_out$interaction_output <- output
  current_out$interaction_output_label <- output_label
  current_out$interaction_result_id <- result_id
  current_out$interaction_label <- result_label
  current_out$coefficient_name <- coefficient_name
  current_out$condition_numerator <- condition_numerator
  current_out$condition_denominator <- condition_denominator
  current_out$modifier_numerator <- modifier_numerator
  current_out$modifier_denominator <- modifier_denominator
  current_out
}
valid_interaction_outputs <- c(
  "interaction_coefficients",
  "condition_main_at_modifier_reference",
  "modifier_main_at_condition_reference",
  "simple_condition_effects",
  "simple_modifier_effects"
)
interaction_outputs <- unique(interaction_outputs_raw[interaction_outputs_raw %in% valid_interaction_outputs])
if (!length(interaction_outputs)) interaction_outputs <- "interaction_coefficients"
adjust_cols <- character(0)
for (adjust_col_raw in adjust_cols_raw) {
  adjust_col <- unname(safe_lookup[[adjust_col_raw]])
  if (is.null(adjust_col) || is.na(adjust_col) || !nzchar(adjust_col)) next
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

tested_terms <- character(0)
coefficient_name <- ""
reduced_formula_label <- ""
out <- NULL
if (identical(result_mode, "wald_interaction_coefficient")) {
  condition_col <- prepare_factor(condition_col_raw, "Condition factor", condition_denominator_level)
  modifier_col <- prepare_factor(modifier_col_raw, "Modifier factor", modifier_denominator_level)
  tested_terms <- paste(condition_col, modifier_col, sep = ":")
  design_terms <- c(adjust_cols, condition_col, modifier_col, tested_terms)
  design_formula <- reformulate(design_terms)
  design_matrix <- model.matrix(design_formula, colData)
  if (qr(design_matrix)$rank < ncol(design_matrix)) {
    stop("DESeq2 interaction design is not full rank. Remove confounded covariates or blocking factors.")
  }
  if (nrow(design_matrix) <= ncol(design_matrix)) {
    stop("DESeq2 interaction design has too many terms for the number of selected samples.")
  }
  dds <- DESeqDataSetFromMatrix(countData = countData, colData = colData, design = design_formula)
  dds <- DESeq(dds, quiet = TRUE)
  condition_nonref_levels <- setdiff(levels(colData[[condition_col]]), condition_denominator_level)
  modifier_nonref_levels <- setdiff(levels(colData[[modifier_col]]), modifier_denominator_level)
  if (!length(condition_nonref_levels) || !length(modifier_nonref_levels)) {
    stop("Interaction factors need at least one non-reference level each.")
  }
  interaction_tables <- list()
  coefficient_names <- character(0)
  condition_main_coefs <- setNames(
    vapply(condition_nonref_levels, function(level) find_main_coef(resultsNames(dds), condition_col, level), character(1)),
    condition_nonref_levels
  )
  modifier_main_coefs <- setNames(
    vapply(modifier_nonref_levels, function(level) find_main_coef(resultsNames(dds), modifier_col, level), character(1)),
    modifier_nonref_levels
  )
  interaction_coef <- function(condition_level, modifier_level) {
    find_interaction_coef(resultsNames(dds), condition_col, condition_level, modifier_col, modifier_level)
  }
  add_interaction_table <- function(res, output, output_label, result_id, result_label, coefficient,
                                    condition_level = "", condition_reference = "",
                                    modifier_level = "", modifier_reference = "") {
    interaction_tables[[length(interaction_tables) + 1]] <<- decorate_result(
      res,
      output,
      output_label,
      result_id,
      result_label,
      coefficient,
      condition_level,
      condition_reference,
      modifier_level,
      modifier_reference
    )
    coefficient_names <<- c(coefficient_names, coefficient)
  }
  for (condition_level in condition_nonref_levels) {
    for (modifier_level in modifier_nonref_levels) {
      current_coef <- interaction_coef(condition_level, modifier_level)
      if ("interaction_coefficients" %in% interaction_outputs) {
        current_res <- results(dds, name = current_coef)
        add_interaction_table(
          current_res,
          "interaction_coefficients",
          "Interaction coefficients",
          paste("interaction", condition_level, condition_denominator_level, modifier_level, modifier_denominator_level, sep = "__"),
          paste0("(", condition_level, " - ", condition_denominator_level, ") interaction at ", modifier_level, " vs ", modifier_denominator_level),
          current_coef,
          condition_level,
          condition_denominator_level,
          modifier_level,
          modifier_denominator_level
        )
      }
    }
  }
  if ("condition_main_at_modifier_reference" %in% interaction_outputs) {
    for (condition_level in condition_nonref_levels) {
      current_coef <- condition_main_coefs[[condition_level]]
      current_res <- results(dds, name = current_coef)
      add_interaction_table(
        current_res,
        "condition_main_at_modifier_reference",
        "Condition main effect at modifier reference",
        paste("condition_main_at_modifier_reference", condition_level, condition_denominator_level, modifier_denominator_level, sep = "__"),
        paste0(condition_level, " vs ", condition_denominator_level, " at ", modifier_col_raw, " reference ", modifier_denominator_level),
        current_coef,
        condition_level,
        condition_denominator_level,
        modifier_denominator_level,
        modifier_denominator_level
      )
    }
  }
  if ("modifier_main_at_condition_reference" %in% interaction_outputs) {
    for (modifier_level in modifier_nonref_levels) {
      current_coef <- modifier_main_coefs[[modifier_level]]
      current_res <- results(dds, name = current_coef)
      add_interaction_table(
        current_res,
        "modifier_main_at_condition_reference",
        "Modifier main effect at condition reference",
        paste("modifier_main_at_condition_reference", modifier_level, modifier_denominator_level, condition_denominator_level, sep = "__"),
        paste0(modifier_level, " vs ", modifier_denominator_level, " at ", condition_col_raw, " reference ", condition_denominator_level),
        current_coef,
        condition_denominator_level,
        condition_denominator_level,
        modifier_level,
        modifier_denominator_level
      )
    }
  }
  if ("simple_condition_effects" %in% interaction_outputs) {
    for (condition_level in condition_nonref_levels) {
      main_coef <- condition_main_coefs[[condition_level]]
      reference_res <- results(dds, name = main_coef)
      add_interaction_table(
        reference_res,
        "simple_condition_effects",
        "Condition effect within each modifier level",
        paste("simple_condition", condition_level, condition_denominator_level, modifier_denominator_level, sep = "__"),
        paste0(condition_level, " vs ", condition_denominator_level, " within ", modifier_col_raw, "=", modifier_denominator_level),
        main_coef,
        condition_level,
        condition_denominator_level,
        modifier_denominator_level,
        modifier_denominator_level
      )
      for (modifier_level in modifier_nonref_levels) {
        current_coef <- interaction_coef(condition_level, modifier_level)
        current_res <- extract_result(dds, c(main_coef, current_coef))
        add_interaction_table(
          current_res,
          "simple_condition_effects",
          "Condition effect within each modifier level",
          paste("simple_condition", condition_level, condition_denominator_level, modifier_level, sep = "__"),
          paste0(condition_level, " vs ", condition_denominator_level, " within ", modifier_col_raw, "=", modifier_level),
          paste(c(main_coef, current_coef), collapse = " + "),
          condition_level,
          condition_denominator_level,
          modifier_level,
          modifier_denominator_level
        )
      }
    }
  }
  if ("simple_modifier_effects" %in% interaction_outputs) {
    for (modifier_level in modifier_nonref_levels) {
      main_coef <- modifier_main_coefs[[modifier_level]]
      reference_res <- results(dds, name = main_coef)
      add_interaction_table(
        reference_res,
        "simple_modifier_effects",
        "Modifier effect within each condition level",
        paste("simple_modifier", modifier_level, modifier_denominator_level, condition_denominator_level, sep = "__"),
        paste0(modifier_level, " vs ", modifier_denominator_level, " within ", condition_col_raw, "=", condition_denominator_level),
        main_coef,
        condition_denominator_level,
        condition_denominator_level,
        modifier_level,
        modifier_denominator_level
      )
      for (condition_level in condition_nonref_levels) {
        current_coef <- interaction_coef(condition_level, modifier_level)
        current_res <- extract_result(dds, c(main_coef, current_coef))
        add_interaction_table(
          current_res,
          "simple_modifier_effects",
          "Modifier effect within each condition level",
          paste("simple_modifier", modifier_level, modifier_denominator_level, condition_level, sep = "__"),
          paste0(modifier_level, " vs ", modifier_denominator_level, " within ", condition_col_raw, "=", condition_level),
          paste(c(main_coef, current_coef), collapse = " + "),
          condition_level,
          condition_denominator_level,
          modifier_level,
          modifier_denominator_level
        )
      }
    }
  }
  coefficient_name <- paste(coefficient_names, collapse = ";")
  out <- do.call(rbind, interaction_tables)
} else if (identical(result_mode, "lrt")) {
  condition_col <- prepare_factor(condition_col_raw, "Condition factor", condition_denominator_level)
  modifier_col <- prepare_factor(modifier_col_raw, "Modifier factor", modifier_denominator_level)
  tested_terms <- paste(condition_col, modifier_col, sep = ":")
  design_terms <- c(adjust_cols, condition_col, modifier_col, tested_terms)
  reduced_terms <- c(adjust_cols, condition_col, modifier_col)
  design_formula <- reformulate(design_terms)
  reduced_formula <- reformulate(reduced_terms)
  reduced_formula_label <- paste(deparse(reduced_formula), collapse = " ")
  design_matrix <- model.matrix(design_formula, colData)
  if (qr(design_matrix)$rank < ncol(design_matrix)) {
    stop("DESeq2 LRT full design is not full rank. Remove confounded covariates or blocking factors.")
  }
  if (nrow(design_matrix) <= ncol(design_matrix)) {
    stop("DESeq2 LRT design has too many terms for the number of selected samples.")
  }
  dds <- DESeqDataSetFromMatrix(countData = countData, colData = colData, design = design_formula)
  dds <- DESeq(dds, test = "LRT", reduced = reduced_formula, quiet = TRUE)
  coefficient_name <- paste("LRT", paste(deparse(design_formula), collapse = " "), "vs", reduced_formula_label)
  res <- results(dds)
} else {
  design_col <- prepare_factor(primary_col_raw, "Primary design column", reference_level)
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
  coefficient_name <- paste(design_col, numerator_level, "vs", denominator_level, sep = "_")
  tested_terms <- design_col
  res <- results(dds, contrast = c(design_col, numerator_level, denominator_level))
}
if (is.null(out)) {
  out <- as.data.frame(res)
  out$gene_id <- rownames(out)
}
names(out)[names(out) == "stat"] <- "statistic"
if (!"result_mode" %in% names(out)) out$result_mode <- result_mode
if (!"coefficient_name" %in% names(out)) out$coefficient_name <- coefficient_name
if (!"tested_terms" %in% names(out)) out$tested_terms <- paste(tested_terms, collapse = ";")
if (!"full_model" %in% names(out)) out$full_model <- paste(deparse(design_formula), collapse = " ")
if (!"reduced_model" %in% names(out)) out$reduced_model <- reduced_formula_label
if (!"condition_numerator" %in% names(out)) out$condition_numerator <- ""
if (!"condition_denominator" %in% names(out)) out$condition_denominator <- ""
if (!"modifier_numerator" %in% names(out)) out$modifier_numerator <- ""
if (!"modifier_denominator" %in% names(out)) out$modifier_denominator <- ""
if (!"interaction_output" %in% names(out)) out$interaction_output <- ""
if (!"interaction_output_label" %in% names(out)) out$interaction_output_label <- ""
if (!"interaction_result_id" %in% names(out)) out$interaction_result_id <- ""
if (!"interaction_label" %in% names(out)) out$interaction_label <- ""
wanted_cols <- c("gene_id", "baseMean", "log2FoldChange", "lfcSE", "statistic", "pvalue", "padj", "result_mode", "coefficient_name", "tested_terms", "full_model", "reduced_model", "condition_numerator", "condition_denominator", "modifier_numerator", "modifier_denominator", "interaction_output", "interaction_output_label", "interaction_result_id", "interaction_label")
missing_cols <- setdiff(wanted_cols, names(out))
for (missing_col in missing_cols) out[[missing_col]] <- NA
out <- out[, wanted_cols]
paste(capture.output(write.csv(out, row.names = FALSE, na = "")), collapse = "\\n")
`;
  const result = await evalR(code);
  const text = deseqResultText(result);
  await loadGeneAnnotation(false);
  const geneSymbols = deseqGeneSymbolLookup();
  const rows = parseDeCsv(text).map((row) => ({
    ...row,
    gene_symbol: row.gene_symbol || geneSymbols.get(deseqGeneKey(row.gene_id)) || '',
    method: deseqResultMethod(spec),
  })).sort((a, b) => deseqSortPValue(a.padj) - deseqSortPValue(b.padj));
  if (!spec.coefficientName && rows[0]?.coefficient_name) spec.coefficientName = rows[0].coefficient_name;
  return rows;
}

function deseqResultMethod(spec) {
  if (spec.resultMode === 'lrt') return `DESeq2 webR LRT ${spec.fullModel} vs ${spec.reducedModel}`;
  if (spec.resultMode === 'wald_interaction_coefficient') return `DESeq2 webR interaction ${spec.fullModel}`;
  return `DESeq2 webR ${spec.fullModel}`;
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
  const metadataColumns = uniqueStrings(
    (spec.metadataColumns || [])
      .concat(spec.adjustColumns || [])
      .concat(spec.primaryFactor || [])
      .concat(Object.keys(spec.syntheticColumns || {})),
  );
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
