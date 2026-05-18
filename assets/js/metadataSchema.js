import { state, metadataColumns } from './state.js';

export const METADATA_TYPES = ['categorical', 'continuous', 'ordered', 'identifier'];

const TYPE_LABELS = {
  categorical: 'Categorical',
  continuous: 'Continuous',
  ordered: 'Ordered',
  identifier: 'Identifier',
};

const IDENTIFIER_NAMES = new Set([
  'sample_id',
  'sampleid',
  'sample',
  'donor_id',
  'donorid',
  'pair_id',
  'pairid',
  'patient_id',
  'patientid',
  'subject_id',
  'subjectid',
  'individual_id',
  'individualid',
  'participant_id',
  'participantid',
]);

const CATEGORICAL_NAMES = new Set([
  'condition',
  'group',
  'treatment',
  'batch',
  'subject',
  'sex',
  'gender',
  'tissue',
  'cell_type',
  'celltype',
  'genotype',
  'phenotype',
  'disease',
  'replicate',
  'library',
  'lane',
]);

const CONTINUOUS_NAMES = new Set([
  'time',
  'dose',
  'rin',
  'age',
  'concentration',
  'duration',
  'weight',
  'score',
]);

const ORDERED_NAMES = new Set([
  'timepoint',
  'time_point',
  'timepoint_label',
  'stage',
  'day',
  'week',
]);

export function refreshMetadataSchema(options = {}) {
  state.metadataSchema = inferMetadataSchema(state.samples, state.metadataSchema, options);
  return state.metadataSchema;
}

export function inferMetadataSchema(samples, previous = {}, options = {}) {
  const preserveUser = options.preserveUser !== false;
  const columns = metadataSchemaColumns(samples);
  return Object.fromEntries(columns.map((column) => {
    const prior = previous?.[column];
    const inferred = inferMetadataColumn(samples, column);
    const useUser = preserveUser && prior?.source === 'user' && METADATA_TYPES.includes(prior.type);
    const useCache = preserveUser && prior?.source === 'cache' && METADATA_TYPES.includes(prior.type);
    const type = useUser ? prior.type : (useCache ? prior.type : inferred.type);
    return [column, {
      column,
      type,
      inferredType: inferred.type,
      source: useUser ? 'user' : (useCache ? 'cache' : 'inferred'),
      reason: inferred.reason,
      levels: inferred.levels,
      missing: inferred.missing,
      nonMissing: inferred.nonMissing,
      unique: inferred.unique,
    }];
  }));
}

export function setMetadataColumnType(column, type) {
  if (!METADATA_TYPES.includes(type)) return;
  const current = state.metadataSchema?.[column] || inferMetadataColumn(state.samples, column);
  state.metadataSchema = {
    ...(state.metadataSchema || {}),
    [column]: {
      ...current,
      column,
      type,
      source: 'user',
      inferredType: current.inferredType || current.type || type,
    },
  };
}

export function metadataSchemaRows() {
  refreshMetadataSchema();
  return metadataSchemaColumns(state.samples).map((column) => {
    const schema = state.metadataSchema[column] || inferMetadataColumn(state.samples, column);
    return {
      ...schema,
      typeLabel: metadataTypeLabel(schema.type),
      inferredLabel: metadataTypeLabel(schema.inferredType || schema.type),
      valuePreview: metadataValuePreview(schema.levels),
    };
  });
}

export function metadataColumnType(column) {
  if (!column) return '';
  refreshMetadataSchema();
  return state.metadataSchema?.[column]?.type || inferMetadataColumn(state.samples, column).type;
}

export function analysisFactorColumns() {
  return metadataColumnsByType(['categorical', 'ordered']);
}

export function adjustmentMetadataColumns() {
  return metadataColumnsByType(['categorical', 'ordered', 'continuous']);
}

export function discreteMetadataColumns() {
  return metadataColumnsByType(['categorical', 'ordered']);
}

export function metadataTypeLabel(type) {
  return TYPE_LABELS[type] || type || '';
}

export function metadataTypeOptionLabel(column) {
  const type = metadataColumnType(column);
  return type ? `${column} (${metadataTypeLabel(type).toLowerCase()})` : column;
}

export function metadataSchemaForCache() {
  refreshMetadataSchema();
  return Object.fromEntries(Object.entries(state.metadataSchema || {}).map(([column, schema]) => [column, {
    type: schema.type,
    inferredType: schema.inferredType || '',
    source: schema.source || '',
  }]));
}

export function restoreMetadataSchemaFromCache(schema = {}) {
  state.metadataSchema = Object.fromEntries(Object.entries(schema || {})
    .filter(([, entry]) => METADATA_TYPES.includes(entry?.type))
    .map(([column, entry]) => [column, {
      column,
      type: entry.type,
      inferredType: entry.inferredType || '',
      source: 'cache',
    }]));
  refreshMetadataSchema({ preserveUser: true });
}

function metadataColumnsByType(types) {
  const allowed = new Set(types);
  refreshMetadataSchema();
  return metadataColumns().filter((column) => allowed.has(state.metadataSchema?.[column]?.type));
}

function metadataSchemaColumns(samples) {
  const keys = new Set(['sample_id']);
  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    Object.keys(sample || {}).forEach((key) => keys.add(key));
  });
  return Array.from(keys).filter(Boolean).sort((a, b) => {
    if (a === 'sample_id') return -1;
    if (b === 'sample_id') return 1;
    return a.localeCompare(b);
  });
}

function inferMetadataColumn(samples, column) {
  const values = (Array.isArray(samples) ? samples : [])
    .map((sample) => sample?.[column])
    .map((value) => String(value ?? '').trim());
  const nonMissingValues = values.filter((value) => value !== '');
  const levels = Array.from(new Set(nonMissingValues));
  const name = normalizeColumnName(column);
  const stats = {
    levels,
    missing: values.length - nonMissingValues.length,
    nonMissing: nonMissingValues.length,
    unique: levels.length,
  };

  if (IDENTIFIER_NAMES.has(name) || /(^|_)id$/.test(name)) {
    return { type: 'identifier', reason: 'identifier-like column name', ...stats };
  }
  if (looksOrderedTimepoint(levels) || ORDERED_NAMES.has(name)) {
    return { type: 'ordered', reason: 'ordered/timepoint-like values', ...stats };
  }
  if (CONTINUOUS_NAMES.has(name) && valuesAreNumeric(nonMissingValues)) {
    return { type: 'continuous', reason: 'numeric values with continuous column name', ...stats };
  }
  if (CATEGORICAL_NAMES.has(name)) {
    return { type: 'categorical', reason: 'known grouping column name', ...stats };
  }
  if (levels.length <= Math.max(12, Math.ceil(Math.sqrt(Math.max(1, nonMissingValues.length))))) {
    return { type: 'categorical', reason: 'limited number of repeated values', ...stats };
  }
  return { type: 'identifier', reason: 'mostly unique sample-level values', ...stats };
}

function normalizeColumnName(column) {
  return String(column || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
}

function valuesAreNumeric(values) {
  return values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
}

function looksOrderedTimepoint(levels) {
  if (levels.length < 2) return false;
  return levels.every((value) => /^\s*\d+(?:\.\d+)?\s*(?:m|min|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks)\s*$/i.test(value));
}

function metadataValuePreview(levels = []) {
  const preview = levels.slice(0, 5).join(', ');
  const extra = levels.length > 5 ? `, +${levels.length - 5} more` : '';
  return `${preview}${extra}`;
}
