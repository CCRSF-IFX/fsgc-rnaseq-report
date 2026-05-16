import { state } from './state.js';

const QC_ALIASES = new Map(Object.entries({
  sample_id: 'sample_id',
  sample_id_: 'sample_id',
  sample: 'sample_id',
  sampleid: 'sample_id',
  sample_yield_mbases: 'sample_yield_mbases',
  percent_of_pf_bases_gte_q30: 'q30_bases_rate',
  percent_pf_bases_gte_q30: 'q30_bases_rate',
  pf_bases_gte_q30: 'q30_bases_rate',
  total_reads_pf: 'total_reads',
  total_reads: 'total_reads',
  total_reads_after_trimming: 'total_reads_after_trimming',
  total_reads_trimmed: 'total_reads_after_trimming',
  percent_total_reads_after_trimming: 'trim_retention_rate',
  total_mapped_reads_trimmed: 'mapped_reads',
  percent_total_mapped_reads_trimmed: 'mapping_rate',
  uniquely_mapped_reads_trimmed: 'uniquely_mapped_reads',
  percent_uniquely_mapped_reads_trimmed: 'unique_mapping_rate',
  percent_non_duplicate_reads_mapped_trimmed: 'nonduplicate_mapped_rate',
  pct_ribosomal_bases: 'rrna_rate',
  pct_coding_bases: 'coding_bases_rate',
  pct_utr_bases: 'utr_bases_rate',
  pct_intronic_bases: 'intronic_bases_rate',
  pct_intergenic_bases: 'intergenic_bases_rate',
  pct_mrna_bases: 'mrna_bases_rate',
  pct_correct_strand_reads: 'correct_strand_reads_rate',
  median_5prime_to_3prime_bias: 'median_5prime_to_3prime_bias',
}));

const RATE_FIELDS = new Set([
  'q30_bases_rate',
  'trim_retention_rate',
  'mapping_rate',
  'unique_mapping_rate',
  'nonduplicate_mapped_rate',
  'duplication_rate',
  'rrna_rate',
  'coding_bases_rate',
  'utr_bases_rate',
  'intronic_bases_rate',
  'intergenic_bases_rate',
  'mrna_bases_rate',
  'correct_strand_reads_rate',
]);

const QC_CANONICAL_FIELDS = new Set([
  'sample_id',
  'sample_yield_mbases',
  'total_reads',
  'total_reads_after_trimming',
  'mapped_reads',
  'uniquely_mapped_reads',
  'median_5prime_to_3prime_bias',
  ...RATE_FIELDS,
]);

export function normalizeQcMetrics(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeQcRow);
}

export function qcStatus(row) {
  const thresholds = state.config?.qcThresholds || {};
  const failures = [];
  const warnings = [];
  for (const [metric, config] of Object.entries(thresholds)) {
    const value = Number(row[metric]);
    if (!Number.isFinite(value)) continue;
    if (config.min_fail !== undefined && value < config.min_fail) failures.push(`${metric} low`);
    if (config.max_fail !== undefined && value > config.max_fail) failures.push(`${metric} high`);
    if (config.min_warn !== undefined && value < config.min_warn) warnings.push(`${metric} low`);
    if (config.max_warn !== undefined && value > config.max_warn) warnings.push(`${metric} high`);
  }
  if (failures.length) return { status: 'fail', reasons: failures };
  if (warnings.length) return { status: 'warn', reasons: warnings };
  return { status: 'ok', reasons: [] };
}

export function qcRowsWithStatus() {
  return state.qc.map((row) => {
    const checked = qcStatus(row);
    return { ...row, status: checked.status, reasons: checked.reasons.join('; ') };
  });
}

export function summarizeQC() {
  const rows = qcRowsWithStatus();
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
  return { rows, counts };
}

export function badge(status) {
  return `<span class="badge ${status}">${status.toUpperCase()}</span>`;
}

function normalizeQcRow(row) {
  const normalized = { ...row };
  Object.entries(row || {}).forEach(([key, value]) => {
    const canonical = canonicalQcKey(key);
    if (!canonical || normalized[canonical] !== undefined) return;
    normalized[canonical] = coerceQcValue(value);
  });

  RATE_FIELDS.forEach((field) => {
    if (normalized[field] !== undefined && normalized[field] !== '') {
      normalized[field] = percentToRate(normalized[field]);
    }
  });

  if (normalized.duplication_rate === undefined && normalized.nonduplicate_mapped_rate !== undefined) {
    normalized.duplication_rate = Math.max(0, 1 - Number(normalized.nonduplicate_mapped_rate));
  }

  return normalized;
}

function canonicalQcKey(key) {
  const normalized = normalizeQcKey(key);
  return QC_ALIASES.get(normalized) || (QC_CANONICAL_FIELDS.has(normalized) ? normalized : null);
}

function normalizeQcKey(key) {
  return String(key)
    .trim()
    .replace(/>=/g, ' gte ')
    .replace(/≤/g, ' lte ')
    .replace(/≥/g, ' gte ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function coerceQcValue(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  if (!text) return '';
  const numeric = Number(text.replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(numeric) ? numeric : value;
}

function percentToRate(value) {
  const numeric = coerceQcValue(value);
  if (!Number.isFinite(numeric)) return value;
  return numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
}
