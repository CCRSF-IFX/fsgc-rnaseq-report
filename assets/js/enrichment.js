import { state } from './state.js';
import { loadEnrichmentForContrast } from './dataLoader.js';
import { renderEnrichment, renderGseaRunningEnrichment } from './plots.js';
import { renderTable } from './tables.js';

export async function renderCurrentEnrichment(options = {}) {
  const select = document.getElementById('enrichment-contrast-select');
  const contrast = state.contrasts.find((c) => c.id === select?.value) || state.contrasts[0];
  if (!contrast) return;
  await loadEnrichmentForContrast(contrast);
  const result = selectGseaResultForContrast(contrast.id, options.resultId);
  const rows = result ? gseaResultRows(result) : [];
  renderEnrichment(rows, gseaCurvePlotLimits(result));
  syncGseaPathwaySelect(result, options.pathwayId);
  renderTable('enrichment-table', rows, { limit: 100, exportName: gseaExportName(contrast, result) });
}

export function storeGseaResult(result) {
  if (!result?.result_id || !result?.contrast_id) return null;
  const normalized = {
    ...result,
    rows: gseaResultRows(result),
    enrichment_curves: gseaResultCurves(result),
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

export function gseaResultCurves(result) {
  if (Array.isArray(result?.enrichment_curves)) return normalizeGseaCurves(result.enrichment_curves);
  if (Array.isArray(result?.curves)) return normalizeGseaCurves(result.curves);
  return [];
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

function syncGseaPathwaySelect(result, preferredPathwayId = '') {
  const select = document.getElementById('gsea-pathway-select');
  const status = document.getElementById('gsea-pathway-status');
  if (!select) return;
  const curves = gseaResultCurves(result);
  const previous = preferredPathwayId || select.value;

  select.innerHTML = curves.length
    ? curves.map((curve) => `<option value="${escapeHtml(curve.term_id)}">${escapeHtml(curve.term_name || curve.term_id)}</option>`).join('')
    : '<option value="">No pathway curves available</option>';
  select.disabled = curves.length === 0;

  if (curves.some((curve) => curve.term_id === previous)) select.value = previous;
  else select.value = curves[0]?.term_id || '';

  const renderSelected = () => {
    const selected = curves.find((curve) => curve.term_id === select.value) || curves[0] || null;
    renderGseaRunningEnrichment(selected);
    if (status) {
      status.textContent = selected
        ? `${curves.length} retained running ES plot${curves.length === 1 ? '' : 's'} available for this result.`
        : 'Pathway-level enrichment plots are available for browser fgsea results generated with this report version.';
    }
  };
  select.onchange = renderSelected;
  renderSelected();
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
    curve_limit: value.curve_limit ?? value.top_n_pathway_plots ?? '',
    curve_up_limit: value.curve_up_limit ?? '',
    curve_down_limit: value.curve_down_limit ?? '',
    created_at: value.created_at || '',
    enrichment_curves: gseaResultCurves(value),
    rows: gseaResultRows(value),
  };
}

function normalizeGseaCurves(curves) {
  return curves.map((curve) => ({
    term_id: String(curve.term_id || curve.pathway || '').trim(),
    term_name: curve.term_name || curve.term_id || curve.pathway || '',
    enrichmentScore: curve.enrichmentScore ?? '',
    NES: curve.NES ?? '',
    padj: curve.padj ?? '',
    size: curve.size ?? '',
    totalRanks: curve.totalRanks ?? curve.total_ranks ?? '',
    points: Array.isArray(curve.points)
      ? curve.points.map((point) => ({
        rank: Number(point.rank),
        runningScore: Number(point.runningScore ?? point.running_score),
      })).filter((point) => Number.isFinite(point.rank) && Number.isFinite(point.runningScore))
      : [],
    hits: Array.isArray(curve.hits)
      ? curve.hits.map((hit) => ({
        rank: Number(hit.rank),
        gene: String(hit.gene || ''),
        stat: hit.stat ?? '',
      })).filter((hit) => Number.isFinite(hit.rank))
      : [],
  })).filter((curve) => curve.term_id && curve.points.length);
}

function gseaResultLabel(result) {
  const source = result.source_label || result.reference || result.result_id;
  const size = result.min_size && result.max_size ? `, size ${result.min_size}-${result.max_size}` : '';
  const curveLimit = result.curve_limit ? `, ${gseaCurveLimitLabel(result)}` : '';
  return `${source}${size}${curveLimit}`;
}

function gseaCurvePlotLimits(result) {
  const preset = String(result?.curve_limit || '').trim().toLowerCase();
  if (preset === 'top40') return { upLimit: 20, downLimit: 20 };
  if (preset === 'custom' || preset.startsWith('custom-')) {
    const parsed = preset.match(/^custom-up(\d+)-down(\d+)$/);
    return {
      upLimit: gseaCurveCount(result?.curve_up_limit, parsed ? Number(parsed[1]) : 10),
      downLimit: gseaCurveCount(result?.curve_down_limit, parsed ? Number(parsed[2]) : 10),
    };
  }
  return { upLimit: 10, downLimit: 10 };
}

function gseaCurveLimitLabel(result) {
  const preset = String(result?.curve_limit || '').trim().toLowerCase();
  const limits = gseaCurvePlotLimits(result);
  if (preset === 'top40') return 'top 40 barplot pathways (20 up + 20 down)';
  if (preset === 'custom' || preset.startsWith('custom-')) {
    return `custom running ES plots (${limits.upLimit} up + ${limits.downLimit} down)`;
  }
  if (preset === 'barplot') return 'top 20 barplot pathways (10 up + 10 down)';
  if (/^\d+$/.test(preset)) return `top ${preset} pathway plots`;
  if (preset === 'all') return 'all pathway plots';
  return 'top 20 barplot pathways (10 up + 10 down)';
}

function gseaCurveCount(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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
