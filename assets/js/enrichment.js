import { state } from './state.js';
import { loadEnrichmentForContrast } from './dataLoader.js';
import { renderEnrichment } from './plots.js';
import { renderTable } from './tables.js';

export async function renderCurrentEnrichment(options = {}) {
  const select = document.getElementById('enrichment-contrast-select');
  const contrast = state.contrasts.find((c) => c.id === select?.value) || state.contrasts[0];
  if (!contrast) return;
  await loadEnrichmentForContrast(contrast);
  const result = selectGseaResultForContrast(contrast.id, options.resultId);
  const rows = result ? gseaResultRows(result) : [];
  renderEnrichment(rows);
  renderTable('enrichment-table', rows, { limit: 100, exportName: gseaExportName(contrast, result) });
}

export function storeGseaResult(result) {
  if (!result?.result_id || !result?.contrast_id) return null;
  const normalized = {
    ...result,
    rows: gseaResultRows(result),
  };
  state.enrichmentResults.set(normalized.result_id, normalized);
  syncGseaResultSelect(normalized.contrast_id, normalized.result_id);
  return normalized;
}

export function gseaResultsForContrast(contrastId) {
  return Array.from(state.enrichmentResults.entries())
    .map(([key, value]) => normalizeGseaResult(key, value))
    .filter((result) => result.contrast_id === contrastId)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export function gseaResultRows(result) {
  return Array.isArray(result) ? result : (Array.isArray(result?.rows) ? result.rows : []);
}

function selectGseaResultForContrast(contrastId, preferredResultId = '') {
  const results = gseaResultsForContrast(contrastId);
  syncGseaResultSelect(contrastId, preferredResultId);
  const select = document.getElementById('gsea-result-select');
  const selectedId = select?.value || preferredResultId || results[0]?.result_id || '';
  return results.find((result) => result.result_id === selectedId) || results[0] || null;
}

function syncGseaResultSelect(contrastId, preferredResultId = '') {
  const select = document.getElementById('gsea-result-select');
  if (!select) return;
  const results = gseaResultsForContrast(contrastId);
  const previous = preferredResultId || select.value;
  select.innerHTML = results.length
    ? results.map((result) => `<option value="${escapeHtml(result.result_id)}">${escapeHtml(gseaResultLabel(result))}</option>`).join('')
    : '<option value="">No GSEA results yet</option>';
  select.disabled = results.length === 0;
  if (results.some((result) => result.result_id === previous)) select.value = previous;
  else select.value = results[0]?.result_id || '';
}

function normalizeGseaResult(key, value) {
  if (Array.isArray(value)) {
    return {
      result_id: key,
      contrast_id: key,
      label: key,
      source_kind: 'legacy',
      source_id: key,
      source_label: 'Legacy GSEA result',
      rows: value,
    };
  }
  return {
    result_id: value.result_id || key,
    contrast_id: value.contrast_id || key,
    label: value.label || value.source_label || key,
    source_kind: value.source_kind || '',
    source_id: value.source_id || '',
    source_label: value.source_label || value.reference || value.label || key,
    reference: value.reference || '',
    min_size: value.min_size ?? '',
    max_size: value.max_size ?? '',
    created_at: value.created_at || '',
    rows: gseaResultRows(value),
  };
}

function gseaResultLabel(result) {
  const source = result.source_label || result.reference || result.result_id;
  const size = result.min_size && result.max_size ? `, size ${result.min_size}-${result.max_size}` : '';
  return `${source}${size}`;
}

function gseaExportName(contrast, result) {
  const source = slug(result?.source_label || result?.reference || result?.result_id || 'enrichment');
  return `${contrast.id}.${source}.gsea.csv`;
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'gsea';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
