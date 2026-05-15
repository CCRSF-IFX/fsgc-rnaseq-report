import { state } from './state.js';

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
