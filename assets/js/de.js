import { state } from './state.js';
import { loadDeForContrast } from './dataLoader.js';
import { renderTable } from './tables.js';
import { renderVolcano, renderMA, numericPValue } from './plots.js';

export function populateContrastSelectors() {
  populateContrastFamilySelect();
  for (const id of ['contrast-select', 'enrichment-contrast-select']) {
    const select = document.getElementById(id);
    if (!select) continue;
    const previous = select.value;
    const familyFilter = id === 'contrast-select' ? document.getElementById('contrast-family-select')?.value || 'all' : 'all';
    const contrasts = state.contrasts.filter((contrast) => familyFilter === 'all' || contrastFamily(contrast) === familyFilter);
    select.replaceChildren(...contrastOptionGroups(contrasts));
    if (contrasts.some((contrast) => contrast.id === previous)) select.value = previous;
    else if (contrasts[0]) select.value = contrasts[0].id;
  }
}

export async function renderCurrentContrast() {
  const select = document.getElementById('contrast-select');
  const contrast = state.contrasts.find((c) => c.id === select?.value) || state.contrasts[0];
  renderContrastTags(contrast);
  renderContrastNote(contrast);
  if (!contrast) {
    renderNoDeRows(null);
    return;
  }
  const rows = await loadDeForContrast(contrast);
  const padj = Number(document.getElementById('padj-threshold')?.value || 0.05);
  const lfc = Number(document.getElementById('lfc-threshold')?.value || 1);
  const showAll = Boolean(document.getElementById('de-show-all-genes')?.checked);
  const volcanoOptions = readVolcanoOptions();
  if (!rows.length) {
    renderNoDeRows(contrast);
    return;
  }
  renderVolcano(rows, padj, lfc, volcanoOptions);
  renderMA(rows, padj, lfc);
  const degRows = rows.filter((row) => isDeg(row, padj, lfc));
  const tableRows = (showAll ? rows : degRows).map((row) => ({
    significance: deTableCategory(row, padj, lfc),
    ...row,
  }));
  const tableStatus = document.getElementById('de-table-status');
  if (tableStatus) {
    tableStatus.textContent = showAll
      ? `Showing all ${rows.length.toLocaleString()} genes. Use the significance column to filter volcano categories.`
      : `Showing ${degRows.length.toLocaleString()} DEG rows passing padj <= ${padj} and |log2FC| >= ${lfc}. Turn on "Show all genes" for the full DE result.`;
  }
  renderTable('de-table', tableRows, { exportName: `${contrast.id}.${showAll ? 'all' : 'deg'}.csv` });
}

function readVolcanoOptions() {
  const capMode = document.getElementById('volcano-cap-mode')?.value || 'auto';
  const manualCap = Number(document.getElementById('volcano-cap-value')?.value || 50);
  return { capMode, manualCap };
}

function renderNoDeRows(contrast) {
  const message = !contrast
    ? 'No DE results are loaded yet. Run DESeq2, import an analysis cache, or provide pipeline DE results before reviewing DE plots or running GSEA.'
    : contrast?.generated
    ? 'No DE result rows are loaded for this inferred contrast. Run DESeq2, import an analysis cache, or provide pipeline DE results before reviewing DE plots or running GSEA.'
    : 'No DE result rows are loaded for this contrast. Import an analysis cache or provide a non-empty pipeline DE result file.';
  for (const id of ['volcano-plot', 'ma-plot']) {
    const plot = document.getElementById(id);
    if (!plot) continue;
    globalThis.Plotly?.purge?.(plot);
    plot.innerHTML = `<p class="note">${message}</p>`;
  }
  const tableStatus = document.getElementById('de-table-status');
  if (tableStatus) tableStatus.textContent = message;
  renderTable('de-table', []);
}

function populateContrastFamilySelect() {
  const select = document.getElementById('contrast-family-select');
  if (!select) return;
  const previous = select.value || 'all';
  const families = Array.from(new Set(state.contrasts.map(contrastFamily).filter(Boolean)));
  const options = [
    ['all', 'All result types'],
    ...families.map((family) => [family, contrastFamilyLabel(family)]),
  ];
  select.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = options.some(([value]) => value === previous) ? previous : 'all';
}

function contrastOptionGroups(contrasts) {
  const grouped = contrasts.reduce((acc, contrast) => {
    const family = contrastFamily(contrast);
    if (!acc.has(family)) acc.set(family, []);
    acc.get(family).push(contrast);
    return acc;
  }, new Map());
  return Array.from(grouped.entries()).map(([family, items]) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = contrastFamilyLabel(family);
    items.forEach((contrast) => {
      const option = document.createElement('option');
      option.value = contrast.id;
      option.textContent = contrast.label || contrast.id;
      optgroup.appendChild(option);
    });
    return optgroup;
  });
}

function renderContrastTags(contrast) {
  const container = document.getElementById('de-contrast-tags');
  if (!container) return;
  if (!contrast) {
    container.innerHTML = '';
    return;
  }
  const tags = [
    contrastFamilyLabel(contrastFamily(contrast)),
    contrast.scope_label ? `scope: ${contrast.scope_label}` : '',
    contrast.sample_count ? `${contrast.sample_count} samples` : '',
    contrast.result_mode === 'lrt' ? 'LRT' : '',
    contrast.full_model || contrast.design || '',
    contrast.reduced_model ? `reduced: ${contrast.reduced_model}` : '',
    contrast.contrast_label || '',
    contrast.coefficient_name ? `coefficient: ${contrast.coefficient_name}` : '',
    contrast.method || '',
  ].filter(Boolean);
  container.innerHTML = tags.map((tag) => `<span class="contrast-tag">${escapeHtml(tag)}</span>`).join('');
}

function renderContrastNote(contrast) {
  const note = document.getElementById('de-result-note');
  if (!note) return;
  if (!contrast) {
    note.textContent = '';
    return;
  }
  if (contrast.result_mode === 'lrt') {
    note.textContent = 'DESeq2 LRT p-values test whether the full model improves over the reduced model. padj <= the threshold means interaction detected; padj above the threshold means no significant interaction detected. The log2FC column is representative and is not the omnibus effect size.';
    return;
  }
  if (contrast.result_family === 'interaction_effect') {
    if (contrast.interaction_output === 'simple_condition_effects') {
      note.textContent = 'Simple condition effects compare condition levels within one modifier level from the full interaction model.';
      return;
    }
    if (contrast.interaction_output === 'simple_modifier_effects') {
      note.textContent = 'Simple modifier effects compare modifier levels within one condition level from the full interaction model.';
      return;
    }
    if (contrast.interaction_output === 'condition_main_at_modifier_reference' || contrast.interaction_output === 'modifier_main_at_condition_reference') {
      note.textContent = 'Reference-level main effects are coefficients at the selected reference level of the other interaction factor.';
      return;
    }
    note.textContent = 'Interaction log2FC is a difference-of-differences: the condition non-reference effect in this modifier level minus the same condition effect in the modifier reference level.';
    return;
  }
  note.textContent = '';
}

function contrastFamily(contrast = {}) {
  if (contrast.result_family) return contrast.result_family;
  if (contrast.question_type?.includes('tissue')) return 'tissue_effect';
  if (contrast.question_type?.includes('direct')) return 'direct_group_comparison';
  if (contrast.method === 'DESeq2 webR') return 'condition_effect';
  if (contrast.generated) return 'browser_generated';
  return 'pipeline_result';
}

function contrastFamilyLabel(family) {
  return {
    pairwise_comparison: 'Pairwise comparisons',
    condition_effect: 'Condition effects',
    tissue_effect: 'Tissue effects',
    adjusted_effect: 'Adjusted effects',
    direct_group_comparison: 'Direct group comparisons (less common)',
    interaction_effect: 'Interaction effects',
    omnibus_test: 'Omnibus tests',
    factor_effect: 'Factor effects',
    browser_generated: 'Browser-generated results',
    pipeline_result: 'Pipeline results',
  }[family] || family || 'Other results';
}

function isDeg(row, padj, lfc) {
  return numericPValue(row.padj) <= padj && Math.abs(Number(row.log2FoldChange)) >= lfc;
}

function deTableCategory(row, padj, lfc) {
  const adjustedP = numericPValue(row.padj);
  const log2fc = Number(row.log2FoldChange);
  if (!Number.isFinite(adjustedP) || adjustedP > padj || !Number.isFinite(log2fc)) return 'not significant';
  if (log2fc >= lfc) return 'upregulated';
  if (log2fc <= -lfc) return 'downregulated';
  return 'padj only';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
