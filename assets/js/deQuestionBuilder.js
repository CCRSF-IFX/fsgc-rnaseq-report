import { state, getSampleById } from './state.js';
import { sampleIdsInCounts } from './analysis.js';
import { adjustmentMetadataColumns, analysisFactorColumns, metadataColumnType } from './metadataSchema.js';

export const DESEQ_GROUP_COLUMN = '__rnaseq_report_group';
export const DESEQ_PAIRWISE_QUESTION_TYPE = 'pairwise_comparison';
export const DESEQ_ADDITIVE_QUESTION_TYPE = 'additive_adjusted_effect';
export const DESEQ_ADVANCED_QUESTION_TYPE = 'advanced_analysis';
export const DESEQ_CONDITION_LIKE_COLUMNS = ['condition', 'group', 'treatment', 'phenotype'];

export const DESEQ_QUESTION_TYPES = [
  {
    id: DESEQ_PAIRWISE_QUESTION_TYPE,
    label: 'Pairwise comparison',
    resultFamily: 'pairwise_comparison',
    help: 'Compare two levels of one selected factor with no adjustment variables.',
  },
  {
    id: DESEQ_ADDITIVE_QUESTION_TYPE,
    label: 'Additive covariate analysis',
    resultFamily: 'adjusted_effect',
    help: 'Compare two levels of a primary factor while adjusting or blocking by optional variables.',
  },
  {
    id: DESEQ_ADVANCED_QUESTION_TYPE,
    label: 'Advanced analysis',
    resultFamily: 'advanced',
    help: 'Open combined-group, interaction, and likelihood-ratio workflows.',
  },
];

export const DESEQ_ADVANCED_QUESTION_TYPES = [
  {
    id: 'omnibus_interaction_lrt',
    label: 'Omnibus interaction test (LRT)',
    resultFamily: 'omnibus_test',
    help: 'Recommended first for multi-level interaction questions. Tests whether condition-by-modifier interaction terms improve the model.',
  },
  {
    id: 'pairwise_interaction',
    label: 'Interaction effect',
    resultFamily: 'interaction_effect',
    help: 'Follow-up coefficient workflow. Fit an interaction model using selected reference levels and report each non-reference interaction coefficient.',
  },
  {
    id: 'direct_group_comparison',
    label: 'Direct combined-group comparison (less common)',
    resultFamily: 'direct_group_comparison',
    help: 'Less common special-case workflow. Compare any two combined metadata groups directly when that exact combined contrast is the intended question.',
  },
];

export function readDeseqFormValues(root = document) {
  const questionMode = normalizeQuestionMode(root.getElementById('deseq-question-type')?.value || DESEQ_PAIRWISE_QUESTION_TYPE);
  const advancedQuestionType = normalizeAdvancedQuestionType(root.getElementById('deseq-advanced-question-type')?.value || DESEQ_ADVANCED_QUESTION_TYPES[0].id);
  return {
    questionMode,
    advancedQuestionType,
    questionType: questionMode === DESEQ_ADVANCED_QUESTION_TYPE ? advancedQuestionType : questionMode,
    scopeMode: root.querySelector('input[name="deseq-scope-mode"]:checked')?.value || 'all',
    scopeColumn: root.getElementById('deseq-scope-column')?.value || '',
    scopeLevel: root.getElementById('deseq-scope-level')?.value || '',
    excludedSampleIds: selectedDeseqValues(root, 'deseq-exclude-samples'),
    primaryFactor: root.getElementById('deseq-design-column')?.value || '',
    numerator: root.getElementById('deseq-numerator-level')?.value || '',
    denominator: root.getElementById('deseq-denominator-level')?.value || '',
    adjustColumns: selectedDeseqValues(root, 'deseq-adjust-columns'),
    groupFactors: [
      root.getElementById('deseq-group-factor-a')?.value || '',
      root.getElementById('deseq-group-factor-b')?.value || '',
    ].filter(Boolean),
    groupOne: root.getElementById('deseq-group-one')?.value || '',
    groupTwo: root.getElementById('deseq-group-two')?.value || '',
    interactionConditionFactor: root.getElementById('deseq-interaction-condition')?.value || '',
    interactionModifierFactor: root.getElementById('deseq-interaction-modifier')?.value || '',
    interactionConditionNumerator: root.getElementById('deseq-interaction-condition-numerator')?.value || '',
    interactionConditionDenominator: root.getElementById('deseq-interaction-condition-denominator')?.value || '',
    interactionModifierNumerator: root.getElementById('deseq-interaction-modifier-numerator')?.value || '',
    interactionModifierDenominator: root.getElementById('deseq-interaction-modifier-denominator')?.value || '',
  };
}

export function safeBuildDeseqQuestionSpec(formValues = readDeseqFormValues()) {
  try {
    const spec = buildDeseqQuestionSpec(formValues);
    return { spec, errors: [], warnings: spec.warnings || [] };
  } catch (error) {
    return { spec: null, errors: [error.message], warnings: [] };
  }
}

export function buildDeseqQuestionSpec(formValues = readDeseqFormValues()) {
  const normalizedFormValues = normalizeQuestionFormValues(formValues);
  const question = questionTypeById(normalizedFormValues.questionType);
  const scope = buildAnalysisScope(normalizedFormValues);
  const adjustColumns = uniqueStrings(normalizedFormValues.adjustColumns)
    .filter((column) => adjustmentMetadataColumns().includes(column));

  if (question.id === 'direct_group_comparison') {
    return buildDirectGroupSpec(normalizedFormValues, scope, adjustColumns, question);
  }
  if (question.id === 'pairwise_interaction') {
    return buildPairwiseInteractionSpec(normalizedFormValues, scope, adjustColumns, question);
  }
  if (question.id === 'omnibus_interaction_lrt') {
    return buildOmnibusInteractionLrtSpec(normalizedFormValues, scope, adjustColumns, question);
  }
  return buildFactorContrastSpec(normalizedFormValues, scope, adjustColumns, question);
}

export function registerAnalysisScope(scope) {
  if (!scope?.id) return null;
  const existing = state.analysisScopes.findIndex((item) => item.id === scope.id);
  if (existing >= 0) state.analysisScopes[existing] = scope;
  else state.analysisScopes.push(scope);
  state.activeAnalysisScopeId = scope.id;
  return scope.id;
}

export function sampleIdsForScope(scope) {
  if (!scope) return sampleIdsInCounts(state.samples, state.counts);
  const ids = Array.isArray(scope.sampleIds) && scope.sampleIds.length
    ? scope.sampleIds
    : buildAnalysisScope({ scopeMode: 'all' }).sampleIds;
  return ids.filter((sampleId) => sampleIdsInCounts(state.samples, state.counts).includes(sampleId));
}

export function analysisScopeOptions() {
  const columns = analysisFactorColumns()
    .filter((column) => levelsForColumn(column).length >= 2);
  return columns;
}

export function levelsForColumn(column, sampleIds = sampleIdsInCounts(state.samples, state.counts)) {
  if (!column) return [];
  return Array.from(new Set(sampleIds
    .map((sampleId) => sampleValue(sampleId, column))
    .filter(Boolean)));
}

export function directGroupOptions(groupFactors, sampleIds = sampleIdsInCounts(state.samples, state.counts)) {
  const factors = uniqueStrings(groupFactors).filter(Boolean);
  if (factors.length < 2) return [];
  const seen = new Map();
  sampleIds.forEach((sampleId) => {
    const sample = getSampleById(sampleId);
    const value = combinedGroupValue(sample, factors);
    if (!value || seen.has(value)) return;
    seen.set(value, {
      value,
      label: combinedGroupLabel(sample, factors),
      sampleIds: [],
    });
  });
  sampleIds.forEach((sampleId) => {
    const value = combinedGroupValue(getSampleById(sampleId), factors);
    if (seen.has(value)) seen.get(value).sampleIds.push(sampleId);
  });
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function previewDeseqModel(spec) {
  if (!spec) return [];
  return [
    ['Question', spec.questionLabel],
    ['Sample scope', spec.scope.label],
    ['Selected samples', `${spec.sampleIds.length} / ${sampleIdsInCounts(state.samples, state.counts).length}`],
    ['Full model', spec.fullModel],
    ['Reduced model', spec.reducedModel],
    ['Test', spec.testLabel],
    ['Contrast', spec.contrastLabel],
    ['Interpretation', spec.interpretation],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
}

export function groupBalanceRows(spec) {
  if (!spec?.groupBalance) return [];
  return Object.entries(spec.groupBalance).map(([level, count]) => ({ group: level, samples: count }));
}

function buildFactorContrastSpec(formValues, scope, adjustColumns, question) {
  const primaryFactor = formValues.primaryFactor;
  const numerator = formValues.numerator;
  const denominator = formValues.denominator;
  const effectiveAdjustColumns = question.id === DESEQ_PAIRWISE_QUESTION_TYPE ? [] : adjustColumns;
  if (!primaryFactor) throw new Error('Choose a primary factor.');
  if (!numerator || !denominator || numerator === denominator) {
    throw new Error('Choose two different numerator and denominator levels.');
  }

  const sampleIds = scope.sampleIds.filter((sampleId) => {
    const value = sampleValue(sampleId, primaryFactor);
    return value === numerator || value === denominator;
  });
  const groupBalance = countBy(sampleIds, (sampleId) => sampleValue(sampleId, primaryFactor));
  validateComparedGroups(groupBalance, numerator, denominator);
  validateAdjustColumns(sampleIds, primaryFactor, effectiveAdjustColumns);
  validateModelSize(sampleIds, primaryFactor, effectiveAdjustColumns);

  const fullModel = formulaLabel(effectiveAdjustColumns.concat(primaryFactor));
  const scopeSuffix = scope.id === 'all_samples' ? '' : ` within ${scope.label}`;
  const label = `${numerator} vs ${denominator}${scopeSuffix}`;
  const adjustedSuffix = effectiveAdjustColumns.length ? ` adjusted for ${effectiveAdjustColumns.join(', ')}` : '';

  return {
    questionType: question.id,
    questionLabel: question.label,
    result_family: question.resultFamily,
    resultFamily: question.resultFamily,
    scope,
    scopeId: scope.id,
    sampleIds,
    primaryFactor,
    numerator,
    denominator,
    reference: denominator,
    adjustColumns: effectiveAdjustColumns,
    modelKind: 'factor_contrast',
    resultMode: 'wald_factor_contrast',
    fullModel,
    reducedModel: '',
    contrastLabel: `${numerator} - ${denominator}`,
    label: `${label}${adjustedSuffix}`,
    id: makeContrastId(['deseq2', question.id, primaryFactor, numerator, 'vs', denominator, scope.id, effectiveAdjustColumns.join('_')]),
    groupBalance,
    warnings: factorContrastWarnings(sampleIds, groupBalance, numerator, denominator),
    interpretation: `${numerator} vs ${denominator} for ${primaryFactor}${scope.id === 'all_samples' ? '' : ` using ${scope.label}`} with model ${fullModel}.`,
    metadataColumns: uniqueStrings([primaryFactor].concat(effectiveAdjustColumns)),
    syntheticColumns: {},
  };
}

function buildDirectGroupSpec(formValues, scope, adjustColumns, question) {
  const groupFactors = uniqueStrings(formValues.groupFactors).filter((column) => analysisFactorColumns().includes(column));
  if (groupFactors.length < 2) throw new Error('Choose two metadata factors for the direct group comparison.');
  const groupOne = formValues.groupOne;
  const groupTwo = formValues.groupTwo;
  if (!groupOne || !groupTwo || groupOne === groupTwo) throw new Error('Choose two different combined groups.');

  const groupOptions = directGroupOptions(groupFactors, scope.sampleIds);
  const groupLabelByValue = new Map(groupOptions.map((option) => [option.value, option.label]));
  const groupOneLabel = groupLabelByValue.get(groupOne) || groupOne;
  const groupTwoLabel = groupLabelByValue.get(groupTwo) || groupTwo;
  const syntheticValues = Object.fromEntries(scope.sampleIds.map((sampleId) => [
    sampleId,
    combinedGroupValue(getSampleById(sampleId), groupFactors),
  ]));
  const sampleIds = scope.sampleIds.filter((sampleId) => [groupOne, groupTwo].includes(syntheticValues[sampleId]));
  const groupBalance = countBy(sampleIds, (sampleId) => syntheticValues[sampleId]);
  validateComparedGroups(groupBalance, groupOne, groupTwo);
  validateAdjustColumns(sampleIds, DESEQ_GROUP_COLUMN, adjustColumns);
  validateModelSize(sampleIds, DESEQ_GROUP_COLUMN, adjustColumns);

  const fullModel = formulaLabel(adjustColumns.concat(DESEQ_GROUP_COLUMN));
  return {
    questionType: question.id,
    questionLabel: question.label,
    result_family: question.resultFamily,
    resultFamily: question.resultFamily,
    scope,
    scopeId: scope.id,
    sampleIds,
    primaryFactor: DESEQ_GROUP_COLUMN,
    numerator: groupOne,
    denominator: groupTwo,
    reference: groupTwo,
    adjustColumns,
    modelKind: 'group_factor_contrast',
    resultMode: 'group_factor_contrast',
    groupFactors,
    groupOne,
    groupTwo,
    groupOneLabel,
    groupTwoLabel,
    fullModel,
    reducedModel: '',
    contrastLabel: `${groupOneLabel} - ${groupTwoLabel}`,
    label: `${groupOneLabel} vs ${groupTwoLabel}`,
    id: makeContrastId(['deseq2_direct', groupOne, 'vs', groupTwo, scope.id, adjustColumns.join('_')]),
    groupBalance: Object.fromEntries(Object.entries(groupBalance).map(([key, value]) => [groupLabelByValue.get(key) || key, value])),
    warnings: [
      'Less common workflow: direct group comparisons can mix effects from multiple metadata factors; use only when these combined groups are the intended biological comparison.',
      ...factorContrastWarnings(sampleIds, groupBalance, groupOne, groupTwo),
    ],
    interpretation: `Direct comparison of ${groupOneLabel} vs ${groupTwoLabel} with model ${fullModel}.`,
    metadataColumns: uniqueStrings(adjustColumns),
    syntheticColumns: {
      [DESEQ_GROUP_COLUMN]: syntheticValues,
    },
  };
}

function buildPairwiseInteractionSpec(formValues, scope, adjustColumns, question) {
  const conditionFactor = formValues.interactionConditionFactor;
  const modifierFactor = formValues.interactionModifierFactor;
  const conditionDenominator = formValues.interactionConditionDenominator;
  const modifierDenominator = formValues.interactionModifierDenominator;
  validateInteractionFactors(scope.sampleIds, conditionFactor, modifierFactor);

  const conditionLevels = levelsForColumn(conditionFactor, scope.sampleIds);
  const modifierLevels = levelsForColumn(modifierFactor, scope.sampleIds);
  if (!conditionDenominator || !conditionLevels.includes(conditionDenominator)) {
    throw new Error('Choose the condition reference level for the interaction model.');
  }
  if (!modifierDenominator || !modifierLevels.includes(modifierDenominator)) {
    throw new Error('Choose the modifier reference level for the interaction model.');
  }
  const conditionNonReferenceLevels = conditionLevels.filter((level) => level !== conditionDenominator);
  const modifierNonReferenceLevels = modifierLevels.filter((level) => level !== modifierDenominator);
  if (!conditionNonReferenceLevels.length || !modifierNonReferenceLevels.length) {
    throw new Error('Each interaction factor needs at least one non-reference level.');
  }

  const sampleIds = scope.sampleIds.filter((sampleId) => (
    sampleValue(sampleId, conditionFactor) !== ''
    && sampleValue(sampleId, modifierFactor) !== ''
  ));
  const groupBalance = interactionGroupBalance(sampleIds, conditionFactor, modifierFactor);
  validateCompleteInteractionGrid(groupBalance, conditionLevels, modifierLevels, conditionFactor, modifierFactor);
  validateAdjustColumns(sampleIds, conditionFactor, adjustColumns);
  validateAdjustColumns(sampleIds, modifierFactor, adjustColumns);
  validateInteractionModelSize(sampleIds, conditionFactor, modifierFactor, adjustColumns);

  const fullModel = formulaLabel(adjustColumns.concat([conditionFactor, modifierFactor, `${conditionFactor}:${modifierFactor}`]));
  const contrastCount = conditionNonReferenceLevels.length * modifierNonReferenceLevels.length;
  const contrastLabel = `${conditionFactor}:${modifierFactor} interaction coefficients`;
  const label = `${conditionFactor} by ${modifierFactor} interaction effect`;
  const adjustmentSuffix = adjustColumns.length ? ` adjusted for ${adjustColumns.join(', ')}` : '';
  return {
    questionType: question.id,
    questionLabel: question.label,
    result_family: question.resultFamily,
    resultFamily: question.resultFamily,
    scope,
    scopeId: scope.id,
    sampleIds,
    primaryFactor: conditionFactor,
    numerator: conditionNonReferenceLevels[0],
    denominator: conditionDenominator,
    reference: conditionDenominator,
    conditionFactor,
    modifierFactor,
    conditionNumerator: conditionNonReferenceLevels[0],
    conditionDenominator,
    modifierNumerator: modifierNonReferenceLevels[0],
    modifierDenominator,
    conditionNonReferenceLevels,
    modifierNonReferenceLevels,
    adjustColumns,
    modelKind: 'interaction',
    resultMode: 'wald_interaction_coefficient',
    fullModel,
    reducedModel: '',
    testLabel: 'Wald tests of interaction coefficients',
    testedTerms: [`${conditionFactor}:${modifierFactor}`],
    contrastLabel,
    label: `${label}${adjustmentSuffix}`,
    id: makeContrastId([
      'deseq2_interaction',
      conditionFactor,
      conditionDenominator,
      'ref',
      modifierFactor,
      modifierDenominator,
      'ref',
      scope.id,
      adjustColumns.join('_'),
    ]),
    groupBalance,
    warnings: [
      `This run will create ${contrastCount} interaction result${contrastCount === 1 ? '' : 's'} from the selected reference levels.`,
      ...interactionWarnings(sampleIds, groupBalance),
    ],
    interpretation: `Tests condition-by-modifier interaction coefficients using ${conditionFactor} reference ${conditionDenominator} and ${modifierFactor} reference ${modifierDenominator} with model ${fullModel}.`,
    metadataColumns: uniqueStrings([conditionFactor, modifierFactor].concat(adjustColumns)),
    syntheticColumns: {},
  };
}

function buildOmnibusInteractionLrtSpec(formValues, scope, adjustColumns, question) {
  const conditionFactor = formValues.interactionConditionFactor;
  const modifierFactor = formValues.interactionModifierFactor;
  validateInteractionFactors(scope.sampleIds, conditionFactor, modifierFactor);

  const conditionLevels = levelsForColumn(conditionFactor, scope.sampleIds);
  const modifierLevels = levelsForColumn(modifierFactor, scope.sampleIds);
  const conditionDenominator = conditionLevels.includes(formValues.interactionConditionDenominator)
    ? formValues.interactionConditionDenominator
    : conditionLevels[0];
  const conditionNumerator = conditionLevels.find((level) => level !== conditionDenominator) || conditionLevels[0];
  const modifierDenominator = modifierLevels.includes(formValues.interactionModifierDenominator)
    ? formValues.interactionModifierDenominator
    : modifierLevels[0];
  const modifierNumerator = modifierLevels.find((level) => level !== modifierDenominator) || modifierLevels[0];
  const sampleIds = scope.sampleIds.filter((sampleId) => (
    sampleValue(sampleId, conditionFactor) !== '' && sampleValue(sampleId, modifierFactor) !== ''
  ));
  const groupBalance = interactionGroupBalance(sampleIds, conditionFactor, modifierFactor);
  validateCompleteInteractionGrid(groupBalance, conditionLevels, modifierLevels, conditionFactor, modifierFactor);
  validateAdjustColumns(sampleIds, conditionFactor, adjustColumns);
  validateAdjustColumns(sampleIds, modifierFactor, adjustColumns);
  validateInteractionModelSize(sampleIds, conditionFactor, modifierFactor, adjustColumns);

  const fullModel = formulaLabel(adjustColumns.concat([conditionFactor, modifierFactor, `${conditionFactor}:${modifierFactor}`]));
  const reducedModel = formulaLabel(adjustColumns.concat([conditionFactor, modifierFactor]));
  const contrastLabel = `${conditionFactor}:${modifierFactor} omnibus LRT`;
  return {
    questionType: question.id,
    questionLabel: question.label,
    result_family: question.resultFamily,
    resultFamily: question.resultFamily,
    scope,
    scopeId: scope.id,
    sampleIds,
    primaryFactor: conditionFactor,
    numerator: conditionNumerator,
    denominator: conditionDenominator,
    reference: conditionDenominator,
    conditionFactor,
    modifierFactor,
    conditionNumerator,
    conditionDenominator,
    modifierNumerator,
    modifierDenominator,
    adjustColumns,
    modelKind: 'interaction',
    resultMode: 'lrt',
    fullModel,
    reducedModel,
    testLabel: 'Likelihood-ratio test of all interaction terms',
    testedTerms: [`${conditionFactor}:${modifierFactor}`],
    contrastLabel,
    label: `${conditionFactor} by ${modifierFactor} interaction LRT`,
    id: makeContrastId(['deseq2_lrt', conditionFactor, 'by', modifierFactor, scope.id, adjustColumns.join('_')]),
    groupBalance,
    warnings: [
      'The LRT p-value is an omnibus test for interaction terms. The displayed log2 fold change is representative and should not be interpreted as the tested effect size.',
      ...interactionWarnings(sampleIds, groupBalance),
    ],
    interpretation: `Tests whether adding ${conditionFactor}:${modifierFactor} interaction terms improves ${fullModel} over ${reducedModel}.`,
    metadataColumns: uniqueStrings([conditionFactor, modifierFactor].concat(adjustColumns)),
    syntheticColumns: {},
  };
}

export function buildAnalysisScope(formValues) {
  const matchedSampleIds = sampleIdsInCounts(state.samples, state.counts);
  const excluded = new Set(uniqueStrings(formValues.excludedSampleIds));
  const filters = [];
  let sampleIds = matchedSampleIds.slice();

  if (formValues.scopeMode === 'subset' && formValues.scopeColumn && formValues.scopeLevel) {
    filters.push({ column: formValues.scopeColumn, operator: 'equals', value: formValues.scopeLevel });
    sampleIds = sampleIds.filter((sampleId) => sampleValue(sampleId, formValues.scopeColumn) === formValues.scopeLevel);
  }
  sampleIds = sampleIds.filter((sampleId) => !excluded.has(sampleId));

  const label = filters.length
    ? filters.map((filter) => `${filter.column} = ${filter.value}`).join('; ')
    : 'All samples';
  const exclusionSuffix = excluded.size ? ` excluding ${excluded.size} sample${excluded.size === 1 ? '' : 's'}` : '';
  return {
    id: filters.length || excluded.size ? makeContrastId(['scope', label, Array.from(excluded).join('_')]) : 'all_samples',
    label: `${label}${exclusionSuffix}`,
    filters,
    excludedSampleIds: Array.from(excluded),
    sampleIds,
    createdAt: new Date().toISOString(),
  };
}

function validateComparedGroups(groupBalance, numerator, denominator) {
  if ((groupBalance[numerator] || 0) < 2 || (groupBalance[denominator] || 0) < 2) {
    throw new Error('DESeq2 browser runner requires at least two samples per compared group.');
  }
}

function validateAdjustColumns(sampleIds, primaryColumn, adjustColumns) {
  adjustColumns.forEach((column) => {
    if (column === primaryColumn) throw new Error(`Do not adjust by the primary comparison factor "${column}".`);
    const values = sampleIds.map((sampleId) => sampleValue(sampleId, column));
    if (values.some((value) => value === '')) throw new Error(`Selected adjustment column "${column}" has missing values in selected samples.`);
    if (metadataColumnType(column) === 'continuous') {
      if (values.some((value) => !Number.isFinite(Number(value)))) throw new Error(`Selected continuous adjustment column "${column}" contains non-numeric values.`);
      if (new Set(values).size < 2) throw new Error(`Selected continuous adjustment column "${column}" has no variation in selected samples.`);
      return;
    }
    if (new Set(values).size < 2) throw new Error(`Selected adjustment column "${column}" has fewer than two levels in selected samples.`);
  });
}

function validateModelSize(sampleIds, primaryColumn, adjustColumns) {
  const coefficientCount = 1
    + 1
    + adjustColumns.reduce((sum, column) => {
      if (metadataColumnType(column) === 'continuous') return sum + 1;
      const levels = new Set(sampleIds.map((sampleId) => sampleValue(sampleId, column))).size;
      return sum + Math.max(1, levels - 1);
    }, 0);
  if (sampleIds.length <= coefficientCount) {
    throw new Error(`The DESeq2 design ${formulaLabel(adjustColumns.concat(primaryColumn))} has too many terms for ${sampleIds.length} selected samples.`);
  }
}

function validateInteractionFactors(sampleIds, conditionFactor, modifierFactor) {
  if (!conditionFactor || !modifierFactor) throw new Error('Choose both a condition factor and a modifier factor.');
  if (conditionFactor === modifierFactor) throw new Error('Condition factor and modifier factor must be different columns.');
  const eligible = analysisFactorColumns();
  if (!eligible.includes(conditionFactor) || !eligible.includes(modifierFactor)) {
    throw new Error('Interaction factors must be categorical or ordered metadata columns.');
  }
  if (levelsForColumn(conditionFactor, sampleIds).length < 2) {
    throw new Error(`Interaction condition factor "${conditionFactor}" has fewer than two levels in selected samples.`);
  }
  if (levelsForColumn(modifierFactor, sampleIds).length < 2) {
    throw new Error(`Interaction modifier factor "${modifierFactor}" has fewer than two levels in selected samples.`);
  }
}

function validateInteractionCells(groupBalance, conditionLevels, modifierLevels, conditionFactor, modifierFactor) {
  conditionLevels.forEach((conditionLevel) => {
    modifierLevels.forEach((modifierLevel) => {
      const key = interactionGroupKey(conditionFactor, conditionLevel, modifierFactor, modifierLevel);
      if ((groupBalance[key] || 0) < 2) {
        throw new Error(`DESeq2 interaction analysis requires at least two samples in ${key}.`);
      }
    });
  });
}

function validateCompleteInteractionGrid(groupBalance, conditionLevels, modifierLevels, conditionFactor, modifierFactor) {
  validateInteractionCells(groupBalance, conditionLevels, modifierLevels, conditionFactor, modifierFactor);
}

function validateInteractionModelSize(sampleIds, conditionFactor, modifierFactor, adjustColumns) {
  const conditionLevelCount = levelsForColumn(conditionFactor, sampleIds).length;
  const modifierLevelCount = levelsForColumn(modifierFactor, sampleIds).length;
  const coefficientCount = 1
    + Math.max(1, conditionLevelCount - 1)
    + Math.max(1, modifierLevelCount - 1)
    + Math.max(1, conditionLevelCount - 1) * Math.max(1, modifierLevelCount - 1)
    + adjustColumns.reduce((sum, column) => {
      if (metadataColumnType(column) === 'continuous') return sum + 1;
      const levels = new Set(sampleIds.map((sampleId) => sampleValue(sampleId, column))).size;
      return sum + Math.max(1, levels - 1);
    }, 0);
  if (sampleIds.length <= coefficientCount) {
    throw new Error(`The DESeq2 interaction model has too many terms for ${sampleIds.length} selected samples.`);
  }
}

function factorContrastWarnings(sampleIds, groupBalance, numerator, denominator) {
  const warnings = [];
  if ((groupBalance[numerator] || 0) < 3 || (groupBalance[denominator] || 0) < 3) {
    warnings.push('At least three samples per group is preferred; this browser runner allows two as a minimum.');
  }
  if (sampleIds.length > 120) {
    warnings.push('This is a large browser-side DESeq2 run; keep the tab open and consider using pipeline-generated results for final reporting.');
  }
  return warnings;
}

function interactionWarnings(sampleIds, groupBalance) {
  const warnings = [];
  if (Object.values(groupBalance).some((count) => count < 3)) {
    warnings.push('At least three samples per interaction cell is preferred; this browser runner allows two as a minimum.');
  }
  if (sampleIds.length > 120) {
    warnings.push('This is a large browser-side DESeq2 run; keep the tab open and consider using pipeline-generated results for final reporting.');
  }
  return warnings;
}

function interactionGroupBalance(sampleIds, conditionFactor, modifierFactor) {
  return countBy(sampleIds, (sampleId) => (
    interactionGroupKey(conditionFactor, sampleValue(sampleId, conditionFactor), modifierFactor, sampleValue(sampleId, modifierFactor))
  ));
}

function interactionGroupKey(conditionFactor, conditionLevel, modifierFactor, modifierLevel) {
  return `${conditionFactor}=${conditionLevel}, ${modifierFactor}=${modifierLevel}`;
}

function formulaLabel(terms) {
  const cleanTerms = uniqueStrings(terms).filter(Boolean);
  return `~ ${cleanTerms.length ? cleanTerms.join(' + ') : '1'}`;
}

function questionTypeById(id) {
  return DESEQ_QUESTION_TYPES.concat(DESEQ_ADVANCED_QUESTION_TYPES)
    .find((type) => type.id === id) || DESEQ_QUESTION_TYPES[0];
}

function normalizeQuestionFormValues(formValues) {
  const questionMode = normalizeQuestionMode(formValues.questionMode || formValues.questionType);
  const rawQuestionType = normalizeQuestionType(formValues.questionType);
  const advancedQuestionType = normalizeAdvancedQuestionType(
    formValues.advancedQuestionType || (isAdvancedQuestionType(rawQuestionType) ? rawQuestionType : ''),
  );
  const questionType = questionMode === DESEQ_ADVANCED_QUESTION_TYPE ? advancedQuestionType : rawQuestionType;
  if (questionMode !== DESEQ_ADVANCED_QUESTION_TYPE && questionType !== DESEQ_ADVANCED_QUESTION_TYPE) {
    return {
      ...formValues,
      questionMode,
      advancedQuestionType,
      questionType,
    };
  }
  return {
    ...formValues,
    questionMode: DESEQ_ADVANCED_QUESTION_TYPE,
    advancedQuestionType,
    questionType: advancedQuestionType,
  };
}

export function normalizeQuestionMode(value) {
  const raw = String(value || '').trim();
  if (!raw) return DESEQ_PAIRWISE_QUESTION_TYPE;
  if (raw === 'advanced_interaction_lrt') return DESEQ_ADVANCED_QUESTION_TYPE;
  if (raw === 'condition_within_subset' || raw === 'tissue_within_subset') return DESEQ_PAIRWISE_QUESTION_TYPE;
  if (DESEQ_ADVANCED_QUESTION_TYPES.some((type) => type.id === raw)) return DESEQ_ADVANCED_QUESTION_TYPE;
  return DESEQ_QUESTION_TYPES.some((type) => type.id === raw) ? raw : DESEQ_PAIRWISE_QUESTION_TYPE;
}

export function normalizeAdvancedQuestionType(value) {
  const raw = String(value || '').trim();
  if (raw === 'advanced_interaction_lrt') return 'omnibus_interaction_lrt';
  if (raw === 'condition_within_subset' || raw === 'tissue_within_subset') return DESEQ_ADVANCED_QUESTION_TYPES[0].id;
  return DESEQ_ADVANCED_QUESTION_TYPES.some((type) => type.id === raw)
    ? raw
    : DESEQ_ADVANCED_QUESTION_TYPES[0].id;
}

function normalizeQuestionType(value) {
  const raw = String(value || '').trim();
  if (raw === DESEQ_ADVANCED_QUESTION_TYPE || raw === 'advanced_interaction_lrt') return DESEQ_ADVANCED_QUESTION_TYPE;
  if (raw === 'condition_within_subset' || raw === 'tissue_within_subset') return DESEQ_PAIRWISE_QUESTION_TYPE;
  if (DESEQ_ADVANCED_QUESTION_TYPES.some((type) => type.id === raw)) return raw;
  if (DESEQ_QUESTION_TYPES.some((type) => type.id === raw)) return raw;
  return DESEQ_PAIRWISE_QUESTION_TYPE;
}

function isAdvancedQuestionType(value) {
  return DESEQ_ADVANCED_QUESTION_TYPES.some((type) => type.id === value);
}

function sampleValue(sampleId, column) {
  if (!column) return '';
  const value = getSampleById(sampleId)?.[column];
  return value === undefined || value === null ? '' : String(value);
}

function combinedGroupValue(sample, factors) {
  if (!sample || factors.some((factor) => !String(sample[factor] ?? '').trim())) return '';
  return factors.map((factor) => `${slug(factor)}_${slug(sample[factor])}`).join('__');
}

function combinedGroupLabel(sample, factors) {
  if (!sample) return '';
  return factors.map((factor) => `${factor}=${sample[factor] ?? ''}`).join(', ');
}

function countBy(items, callback) {
  return items.reduce((acc, item) => {
    const key = callback(item);
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function selectedDeseqValues(root, id) {
  const element = root.getElementById(id);
  const values = Array.from(element?.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean);
  if (id !== 'deseq-adjust-columns') return values;
  const dataValues = String(element?.dataset?.selectedValues || '')
    .split('\t')
    .filter(Boolean);
  const checkedValues = Array.from(root.querySelectorAll('#deseq-adjust-list input[type="checkbox"]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
  return uniqueStrings(values.concat(dataValues, checkedValues));
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function makeContrastId(parts) {
  return parts.map(slug).filter(Boolean).join('_') || 'deseq2_result';
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
