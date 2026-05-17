import { state, getSampleById, metadataColumns } from './state.js';
import { sampleIdsInCounts } from './analysis.js';

const HEATMAP_PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#475569'];
const CANVASXPRESS_ANNOTATION_COLORS = ['#0ab0db', '#fe6969', '#fed385', '#47db0a', '#9e0adb', '#ff7d00', '#ffa2c0', '#a0d7e7'];
const HEATMAP_CUSTOM_GENE_LIMIT = 500;
const CLUSTERGRAMMER_VERSION = '1.19.5';
const CANVASXPRESS_JS = 'https://www.canvasxpress.org/dist/canvasXpress.min.js';
const CANVASXPRESS_CSS = 'https://www.canvasxpress.org/dist/canvasXpress.css';
const CLUSTERGRAMMER_ASSETS = [
  {
    src: 'https://cdn.jsdelivr.net/npm/d3@3.5.17/d3.min.js',
    test: () => globalThis.d3?.version?.startsWith('3.'),
  },
  {
    src: 'https://cdn.jsdelivr.net/npm/jquery@1.11.0/dist/jquery.min.js',
    test: () => Boolean(globalThis.jQuery),
  },
  {
    src: 'https://cdn.jsdelivr.net/npm/underscore@1.8.3/underscore-min.js',
    test: () => Boolean(globalThis._),
  },
  {
    src: 'https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/js/bootstrap.min.js',
    test: () => Boolean(globalThis.jQuery?.fn?.modal),
  },
  {
    src: `https://cdn.jsdelivr.net/npm/clustergrammer@${CLUSTERGRAMMER_VERSION}/clustergrammer.min.js`,
    test: () => Boolean(globalThis.Clustergrammer),
  },
];

let clustergrammerAssetPromise = null;
let canvasXpressAssetPromise = null;
let clustergrammerInstance = null;
let heatmapControlsWired = false;
let canvasXpressControlsWired = false;
let heatmapEngineControlsWired = false;
let heatmapOpacityValue = 1;

function setupHeatmapEngineControls() {
  if (heatmapEngineControlsWired) return;
  heatmapEngineControlsWired = true;
  document.querySelectorAll('[data-heatmap-engine]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveHeatmapEngine(button.dataset.heatmapEngine || 'canvasxpress');
      renderActiveExpressionHeatmap();
    });
  });
  setActiveHeatmapEngine(activeHeatmapEngine());
}

function activeHeatmapEngine() {
  return document.querySelector('[data-heatmap-engine].active')?.dataset.heatmapEngine === 'clustergrammer'
    ? 'clustergrammer'
    : 'canvasxpress';
}

function setActiveHeatmapEngine(engine) {
  const nextEngine = engine === 'clustergrammer' ? 'clustergrammer' : 'canvasxpress';
  document.querySelectorAll('[data-heatmap-engine]').forEach((button) => {
    const isActive = button.dataset.heatmapEngine === nextEngine;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('[data-heatmap-engine-panel]').forEach((panel) => {
    const isActive = panel.dataset.heatmapEnginePanel === nextEngine;
    panel.hidden = !isActive;
    panel.classList.toggle('active', isActive);
  });
}

export function setupExpressionHeatmapControls() {
  setupHeatmapEngineControls();

  const annotationSelect = document.getElementById('heatmap-annotation-column');
  if (annotationSelect) {
    const columns = metadataColumns();
    annotationSelect.innerHTML = ['none'].concat(columns)
      .map((column) => `<option value="${heatmapEscapeHtml(column)}">${heatmapEscapeHtml(column === 'none' ? 'None' : column)}</option>`)
      .join('');
    if (columns.includes('condition')) annotationSelect.value = 'condition';
  }

  if (!heatmapControlsWired) {
    heatmapControlsWired = true;
    document.getElementById('heatmap-render')?.addEventListener('click', renderExpressionHeatmap);
    document.getElementById('heatmap-top-n')?.addEventListener('change', renderExpressionHeatmap);
    document.getElementById('heatmap-gene-mode')?.addEventListener('change', () => {
      syncHeatmapGeneControls();
      if (document.getElementById('heatmap-gene-mode')?.value === 'custom') {
        openHeatmapGeneModal();
        if (heatmapCustomGeneTerms().length > 0) renderExpressionHeatmap();
      } else {
        renderExpressionHeatmap();
      }
    });
    document.getElementById('heatmap-gene-list-open')?.addEventListener('click', openHeatmapGeneModal);
    document.getElementById('heatmap-gene-list-modal-close')?.addEventListener('click', closeHeatmapGeneModal);
    document.getElementById('heatmap-gene-list-cancel')?.addEventListener('click', closeHeatmapGeneModal);
    document.getElementById('heatmap-gene-list-apply')?.addEventListener('click', () => {
      closeHeatmapGeneModal();
      syncHeatmapGeneControls();
      syncCanvasXpressGeneControls();
      renderActiveExpressionHeatmap();
    });
    document.getElementById('heatmap-gene-list-modal')?.addEventListener('click', (event) => {
      if (event.target?.id === 'heatmap-gene-list-modal') closeHeatmapGeneModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && heatmapGeneModalOpen()) closeHeatmapGeneModal();
    });
    document.getElementById('heatmap-gene-list')?.addEventListener('input', () => {
      const status = document.getElementById('heatmap-gene-list-status');
      if (status) status.textContent = '';
      const modalStatus = document.getElementById('heatmap-gene-list-modal-status');
      if (modalStatus) modalStatus.textContent = heatmapGeneListDraftSummary();
      syncHeatmapGeneControls();
      syncCanvasXpressGeneControls();
    });
    document.getElementById('heatmap-annotation-column')?.addEventListener('change', renderExpressionHeatmap);
    document.getElementById('heatmap-scale')?.addEventListener('change', renderExpressionHeatmap);
    document.getElementById('heatmap-row-group-size')?.addEventListener('input', syncHeatmapControlLabels);
    document.getElementById('heatmap-row-group-size')?.addEventListener('change', renderExpressionHeatmap);
    document.getElementById('heatmap-column-group-size')?.addEventListener('input', syncHeatmapControlLabels);
    document.getElementById('heatmap-column-group-size')?.addEventListener('change', renderExpressionHeatmap);
    document.getElementById('heatmap-opacity')?.addEventListener('input', () => {
      syncHeatmapControlLabels();
      heatmapOpacityValue = heatmapFloatControl('heatmap-opacity', 0.1, 1.9, 1);
      applyHeatmapOpacity();
    });
    globalThis.addEventListener?.('resize', resizeExpressionHeatmap);
  }
  syncHeatmapGeneControls();
  syncHeatmapControlLabels();
  const container = document.getElementById('expression-heatmap');
  if (container) container.innerHTML = '<p class="note">Switch to Clustergrammer to render this heatmap.</p>';
  if (document.getElementById('tab-clustering')?.classList.contains('active') && activeHeatmapEngine() === 'clustergrammer') renderExpressionHeatmap();
}

export function setupCanvasXpressHeatmapControls() {
  setupHeatmapEngineControls();
  syncCanvasXpressAnnotationOptions();
  syncCanvasXpressSampleOptions();
  syncCanvasXpressClusteringControls();

  if (!canvasXpressControlsWired) {
    canvasXpressControlsWired = true;
    document.getElementById('canvasxpress-render')?.addEventListener('click', renderCanvasXpressHeatmap);
    document.getElementById('canvasxpress-gene-mode')?.addEventListener('change', () => {
      syncCanvasXpressGeneControls();
      if (document.getElementById('canvasxpress-gene-mode')?.value === 'custom') {
        openHeatmapGeneModal();
        if (heatmapCustomGeneTerms().length > 0 && canvasXpressRendered()) renderCanvasXpressHeatmap();
      } else if (canvasXpressRendered()) {
        renderCanvasXpressHeatmap();
      }
    });
    document.getElementById('canvasxpress-gene-list-open')?.addEventListener('click', openHeatmapGeneModal);
    [
      'canvasxpress-top-n',
      'canvasxpress-annotation-columns',
      'canvasxpress-exclude-samples',
      'canvasxpress-scale',
      'canvasxpress-distance',
      'canvasxpress-linkage',
      'canvasxpress-cluster-rows',
      'canvasxpress-cluster-columns',
      'canvasxpress-show-sample-names',
    ]
      .forEach((id) => document.getElementById(id)?.addEventListener('change', () => {
        syncCanvasXpressClusteringControls();
        if (canvasXpressRendered()) renderCanvasXpressHeatmap();
      }));
  }
  syncCanvasXpressGeneControls();
  syncCanvasXpressClusteringControls();

  const canvas = document.getElementById('canvasxpress-heatmap-canvas');
  if (canvas) {
    canvas.dataset.rendered = 'false';
    const status = document.getElementById('canvasxpress-heatmap-status');
    if (status) status.textContent = 'CanvasXpress expression heatmap is ready.';
  }
}

export async function renderActiveExpressionHeatmap() {
  return activeHeatmapEngine() === 'clustergrammer'
    ? renderExpressionHeatmap()
    : renderCanvasXpressHeatmap();
}

export async function renderCanvasXpressHeatmap() {
  let canvas = document.getElementById('canvasxpress-heatmap-canvas');
  const wrap = document.getElementById('canvasxpress-heatmap-wrap');
  const status = document.getElementById('canvasxpress-heatmap-status');
  if (!wrap) return;
  if (!canvas) canvas = resetCanvasXpressCanvas(wrap, 'canvasxpress-heatmap-canvas');
  const renderButton = document.getElementById('canvasxpress-render');

  const allSampleIds = sampleIdsInCounts(state.samples, state.counts);
  const sampleIds = canvasXpressIncludedSampleIds(allSampleIds);
  if (sampleIds.length < 2) {
    if (status) status.textContent = 'At least two count columns matching sample IDs are required.';
    canvas.dataset.rendered = 'false';
    wrap.innerHTML = '<p class="note">Select at least two samples to render the heatmap.</p>';
    return;
  }

  const topN = heatmapClampedInteger(document.getElementById('canvasxpress-top-n')?.value, 5, 500, 50);
  const scale = document.getElementById('canvasxpress-scale')?.value || 'row';
  const geneMode = document.getElementById('canvasxpress-gene-mode')?.value || 'top';
  const annotationColumns = canvasXpressSelectedValues('canvasxpress-annotation-columns');
  const linkage = document.getElementById('canvasxpress-linkage')?.value || 'average';
  const clusteringDistance = document.getElementById('canvasxpress-distance')?.value || 'euclidianDistance';
  const clusterRows = heatmapCheckboxChecked('canvasxpress-cluster-rows', true);
  const clusterColumns = heatmapCheckboxChecked('canvasxpress-cluster-columns', true);
  const showSampleNames = heatmapCheckboxChecked('canvasxpress-show-sample-names', false);

  const expressionRows = heatmapExpressionRows(sampleIds)
    .filter((row) => row.values.some((value) => value > 0))
    .sort((a, b) => b.variance - a.variance);
  const geneSelection = heatmapSelectedRows(expressionRows, topN, geneMode);
  const rows = geneSelection.rows;
  renderHeatmapGeneStatus(geneSelection, 'canvasxpress-gene-list-status');
  if (rows.length === 0) {
    if (status) status.textContent = geneSelection.emptyMessage || 'No nonzero count rows were available for the CanvasXpress heatmap.';
    renderCanvasXpressColorScale(null);
    renderCanvasXpressAnnotationLegend([], []);
    canvas.dataset.rendered = 'false';
    wrap.innerHTML = `<p class="note">${heatmapEscapeHtml(geneSelection.emptyMessage || 'No nonzero count rows were available for the CanvasXpress heatmap.')}</p>`;
    return;
  }

  const rowLabels = heatmapUniqueLabels(rows.map((row) => row.label || row.id || 'gene'));
  const geneBySampleMatrix = rows.map((row) => (scale === 'row' ? heatmapRowZScore(row.values) : row.values));
  const sampleByGeneMatrix = heatmapTransposeMatrix(geneBySampleMatrix);
  const data = {
    y: {
      vars: sampleIds,
      smps: rowLabels,
      data: sampleByGeneMatrix,
    },
    x: {
      gene_id: rows.map((row) => row.id || ''),
      gene_name: rows.map((row) => row.name || ''),
    },
    z: {
      ...Object.fromEntries(annotationColumns.map((column) => [
        column,
        sampleIds.map((sampleId) => heatmapSampleMetadata(sampleId, column)),
      ])),
    },
  };

  try {
    if (status) status.textContent = `Rendering CanvasXpress heatmap for ${rows.length} gene${rows.length === 1 ? '' : 's'}...`;
    if (renderButton) renderButton.disabled = true;
    const canvasId = canvas.id;
    renderCanvasXpressLoading(wrap, rows.length);
    await heatmapNextFrame();
    await loadCanvasXpressAssets();
    canvas = resetCanvasXpressCanvas(wrap, canvasId);
    canvas.dataset.rendered = 'true';
    const canvasSize = canvasXpressHeatmapSize(wrap, rows.length, sampleIds.length, annotationColumns.length, showSampleNames);
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    const colorSpectrum = canvasXpressColorSpectrum(scale);
    renderCanvasXpressColorScale(scale, colorSpectrum);
    renderCanvasXpressAnnotationLegend(sampleIds, annotationColumns);

    new globalThis.CanvasXpress(canvas.id, data, {
      graphType: 'Heatmap',
      graphOrientation: 'horizontal',
      title: '',
      showTitle: false,
      marginTop: 8,
      marginBottom: 16,
      samplesClustered: clusterRows,
      variablesClustered: clusterColumns,
      clusteringDistance,
      linkage,
      dendrogramHeight: clusterColumns ? 56 : 18,
      showSmpDendrogram: clusterRows,
      showVarDendrogram: clusterColumns,
      varOverlays: annotationColumns,
      showSmpOverlaysLegend: false,
      showVarOverlaysLegend: false,
      varOverlayProperties: Object.fromEntries(annotationColumns.map((column) => [
        column,
        { showLegend: false, showName: true, position: 'top', thickness: 18 },
      ])),
      colors: CANVASXPRESS_ANNOTATION_COLORS,
      colorSpectrum,
      heatmapCellBox: false,
      showHeatmapIndicator: false,
      showColorLegend: false,
      showSampleNames: true,
      showVariableNames: showSampleNames,
      maxSmpStringLen: 18,
      maxVarStringLen: 12,
      maxOverlayStringLen: 22,
      smpTextScaleFontFactor: 0.72,
      varTextScaleFontFactor: 0.64,
      varTextRotate: 45,
      varTextAlign: 'right',
      varTextBaseline: 'middle',
      varTextMargin: 8,
      overlayTextScaleFontFactor: 0.85,
      showNameOverlays: true,
      showValueOverlays: false,
      legendTextScaleFontFactor: 0.78,
      smpTitleLabelPosition: 'right',
      varTitleLabelPosition: 'bottom',
      smpTitle: 'Genes',
      varTitle: showSampleNames ? 'Samples' : false,
    });
    const excluded = allSampleIds.length - sampleIds.length;
    const annotationText = annotationColumns.length ? `; annotations: ${annotationColumns.length}` : '';
    const excludedText = excluded ? `; excluded samples: ${excluded}` : '';
    const clusteringText = canvasXpressClusteringSummary(clusterRows, clusterColumns, linkage, clusteringDistance);
    const labelText = showSampleNames ? '; sample names shown' : '; sample names hidden';
    if (status) status.textContent = `CanvasXpress rendered ${rows.length} gene rows x ${sampleIds.length} sample columns${annotationText}; clustering: ${clusteringText}${excludedText}${labelText}.`;
  } catch (error) {
    canvas.dataset.rendered = 'false';
    renderCanvasXpressColorScale(null);
    renderCanvasXpressAnnotationLegend([], []);
    if (status) status.textContent = `CanvasXpress heatmap failed: ${error.message}`;
  } finally {
    if (renderButton) renderButton.disabled = false;
  }
}

export async function renderExpressionHeatmap() {
  const container = document.getElementById('expression-heatmap');
  if (!container) return;

  const sampleIds = sampleIdsInCounts(state.samples, state.counts);
  if (sampleIds.length < 2) {
    container.innerHTML = '<p class="note">At least two count columns matching sample IDs are required.</p>';
    return;
  }

  const topN = heatmapClampedInteger(document.getElementById('heatmap-top-n')?.value, 5, 500, 50);
  const scale = document.getElementById('heatmap-scale')?.value || 'row';
  const annotationColumn = document.getElementById('heatmap-annotation-column')?.value || 'none';
  const rowGroupLevel = heatmapIntegerControl('heatmap-row-group-size', 1, 10, 5);
  const columnGroupLevel = heatmapIntegerControl('heatmap-column-group-size', 1, 10, 5);
  heatmapOpacityValue = heatmapFloatControl('heatmap-opacity', 0.1, 1.9, 1);

  const expressionRows = heatmapExpressionRows(sampleIds)
    .filter((row) => row.values.some((value) => value > 0))
    .sort((a, b) => b.variance - a.variance);
  const geneSelection = heatmapSelectedRows(expressionRows, topN);
  const rows = geneSelection.rows;
  renderHeatmapGeneStatus(geneSelection);

  if (rows.length === 0) {
    container.innerHTML = `<p class="note">${heatmapEscapeHtml(geneSelection.emptyMessage || 'No nonzero count rows were available for the heatmap.')}</p>`;
    return;
  }

  const matrix = rows.map((row) => (scale === 'row' ? heatmapRowZScore(row.values) : row.values));
  const rowOrder = rows.length <= 250 ? heatmapClusterOrder(matrix) : matrix.map((_, index) => index);
  const columnVectors = sampleIds.map((_, columnIndex) => matrix.map((row) => row[columnIndex]));
  const columnOrder = heatmapClusterOrder(columnVectors);

  const orderedX = columnOrder.map((index) => sampleIds[index]);
  renderHeatmapAnnotation(orderedX, annotationColumn);

  try {
    container.innerHTML = '<h4 class="wait_message">Rendering Clustergrammer heatmap...</h4>';
    container.style.height = `${Math.max(560, Math.min(1100, rows.length * 18 + 260))}px`;
    await loadClustergrammerAssets();

    const networkData = makeClustergrammerNetwork(rows, sampleIds, matrix, rowOrder, columnOrder, annotationColumn, scale);
    clustergrammerInstance = globalThis.Clustergrammer({
      root: '#expression-heatmap',
      network_data: networkData,
      row_label: 'Genes',
      col_label: 'Samples',
      row_order: 'clust',
      col_order: 'clust',
      tile_colors: ['#dc2626', '#2563eb'],
      opacity_scale: 'linear',
      input_domain: scale === 'row' ? 2 : undefined,
      sidebar_width: 260,
      ini_expand: true,
      make_modals: false,
      group_level: { row: rowGroupLevel, col: columnGroupLevel },
      about: geneSelection.about,
      tile_tip_callback: heatmapTileTip,
      row_tip_callback: heatmapNodeTip,
      col_tip_callback: heatmapNodeTip,
    });
    container.querySelector('.wait_message')?.remove();
    finalizeClustergrammerControls();
    restoreClustergrammerSampleLabels(orderedX);
    applyHeatmapOpacity();
  } catch (error) {
    clustergrammerInstance = null;
    container.innerHTML = `<p class="note">Clustergrammer heatmap failed to render: ${heatmapEscapeHtml(error.message)}</p>`;
  }
}

export function resizeExpressionHeatmap() {
  try {
    clustergrammerInstance?.resize_viz?.();
  } catch (_) {
    // Clustergrammer can throw during hidden-tab resizes; the next render will recover.
  }
}

function heatmapExpressionRows(sampleIds) {
  const librarySizes = Object.fromEntries(sampleIds.map((id) => [
    id,
    Math.max(1, state.counts.reduce((sum, row) => sum + heatmapNonnegativeNumber(row[id]), 0)),
  ]));

  return state.counts.map((row, index) => {
    const values = sampleIds.map((id) => Math.log2((heatmapNonnegativeNumber(row[id]) / librarySizes[id]) * 1e6 + 1));
    const aliases = heatmapGeneAliases(row);
    const fallbackId = aliases[0] || `gene_${index + 1}`;
    return {
      key: `row_${index}`,
      id: row.gene_id || fallbackId,
      name: row.gene_name || '',
      label: row.gene_symbol || row.gene_name || row.gene_id || fallbackId,
      aliases,
      values,
      variance: heatmapVariance(values),
    };
  });
}

function heatmapSelectedRows(expressionRows, topN, mode = document.getElementById('heatmap-gene-mode')?.value || 'top') {
  if (mode !== 'custom') {
    const rows = expressionRows.slice(0, topN);
    return {
      mode,
      rows,
      about: `${rows.length} most variable genes from log2(CPM + 1).`,
      emptyMessage: 'No nonzero count rows were available for the heatmap.',
    };
  }

  const terms = heatmapCustomGeneTerms();
  if (terms.length === 0) {
    return {
      mode,
      rows: [],
      terms,
      matchedTermCount: 0,
      missing: [],
      truncated: false,
      about: 'Custom gene heatmap from log2(CPM + 1).',
      emptyMessage: 'Enter at least one gene symbol or ID for the custom heatmap.',
    };
  }

  const selected = heatmapRowsForGeneList(expressionRows, terms);
  return {
    mode,
    ...selected,
    about: `${selected.rows.length} custom genes from log2(CPM + 1).`,
    emptyMessage: selected.missing.length
      ? 'None of the requested genes matched gene_id, gene_symbol, or gene_name in the count matrix.'
      : 'No nonzero count rows matched the custom gene list.',
  };
}

function heatmapRowsForGeneList(rows, terms) {
  const rowByAlias = new Map();
  rows.forEach((row) => {
    row.aliases.forEach((alias) => {
      const key = heatmapNormalizeGene(alias);
      if (!key) return;
      if (!rowByAlias.has(key)) rowByAlias.set(key, []);
      rowByAlias.get(key).push(row);
    });
  });

  const selectedRows = [];
  const selectedKeys = new Set();
  const matchedTerms = new Set();
  const missing = [];
  terms.forEach((term) => {
    const key = heatmapNormalizeGene(term);
    const matches = rowByAlias.get(key) || [];
    if (matches.length === 0) {
      missing.push(term);
      return;
    }
    matchedTerms.add(key);
    matches.forEach((row) => {
      if (selectedKeys.has(row.key)) return;
      selectedKeys.add(row.key);
      selectedRows.push(row);
    });
  });

  return {
    rows: selectedRows.slice(0, HEATMAP_CUSTOM_GENE_LIMIT),
    terms,
    matchedTermCount: matchedTerms.size,
    missing,
    truncated: selectedRows.length > HEATMAP_CUSTOM_GENE_LIMIT,
  };
}

function syncHeatmapGeneControls() {
  const mode = document.getElementById('heatmap-gene-mode')?.value || 'top';
  const topInput = document.getElementById('heatmap-top-n');
  const geneListOpen = document.getElementById('heatmap-gene-list-open');
  const status = document.getElementById('heatmap-gene-list-status');
  const isCustom = mode === 'custom';
  const geneCount = heatmapCustomGeneTerms().length;

  if (topInput) topInput.disabled = isCustom;
  if (geneListOpen) {
    geneListOpen.hidden = !isCustom;
    geneListOpen.textContent = geneCount ? `Edit gene list (${geneCount})` : 'Edit gene list';
  }
  if (!isCustom && status) status.textContent = '';
}

function syncCanvasXpressAnnotationOptions() {
  const select = document.getElementById('canvasxpress-annotation-columns');
  if (!select) return;
  const columns = metadataColumns();
  const selected = new Set(canvasXpressSelectedValues('canvasxpress-annotation-columns'));
  if (selected.size === 0) {
    if (columns.includes('condition')) selected.add('condition');
    if (columns.includes('tissue')) selected.add('tissue');
  }
  const orderedColumns = columns.slice().sort((a, b) => {
    const aSelected = selected.has(a) ? 0 : 1;
    const bSelected = selected.has(b) ? 0 : 1;
    return (aSelected - bSelected) || a.localeCompare(b);
  });
  select.innerHTML = orderedColumns
    .map((column) => `<option value="${heatmapEscapeHtml(column)}"${selected.has(column) ? ' selected' : ''}>${heatmapEscapeHtml(column)}</option>`)
    .join('');
}

function syncCanvasXpressSampleOptions() {
  const select = document.getElementById('canvasxpress-exclude-samples');
  if (!select) return;
  const sampleIds = sampleIdsInCounts(state.samples, state.counts);
  const selected = new Set(canvasXpressSelectedValues('canvasxpress-exclude-samples'));
  select.innerHTML = sampleIds
    .map((sampleId) => {
      const sample = getSampleById(sampleId);
      const title = String(sample?.title || '').trim();
      const titleAttr = title && title !== sampleId ? ` title="${heatmapEscapeHtml(title)}"` : '';
      return `<option value="${heatmapEscapeHtml(sampleId)}"${titleAttr}${selected.has(sampleId) ? ' selected' : ''}>${heatmapEscapeHtml(sampleId)}</option>`;
    })
    .join('');
}

function syncCanvasXpressGeneControls() {
  const mode = document.getElementById('canvasxpress-gene-mode')?.value || 'top';
  const topInput = document.getElementById('canvasxpress-top-n');
  const topField = topInput?.closest('.canvasxpress-field');
  const geneModeGrid = topInput?.closest('.canvasxpress-inline-grid');
  const geneListOpen = document.getElementById('canvasxpress-gene-list-open');
  const status = document.getElementById('canvasxpress-gene-list-status');
  const isCustom = mode === 'custom';
  const geneCount = heatmapCustomGeneTerms().length;

  if (topInput) topInput.disabled = isCustom;
  if (topField) topField.hidden = isCustom;
  if (geneModeGrid) geneModeGrid.classList.toggle('is-custom-mode', isCustom);
  if (geneListOpen) {
    geneListOpen.hidden = !isCustom;
    geneListOpen.textContent = geneCount ? `Edit gene list (${geneCount})` : 'Edit gene list';
  }
  if (!isCustom && status) status.textContent = '';
}

function syncCanvasXpressClusteringControls() {
  const clusterRows = heatmapCheckboxChecked('canvasxpress-cluster-rows', true);
  const clusterColumns = heatmapCheckboxChecked('canvasxpress-cluster-columns', true);
  const enabled = clusterRows || clusterColumns;
  ['canvasxpress-distance', 'canvasxpress-linkage'].forEach((id) => {
    const control = document.getElementById(id);
    if (control) control.disabled = !enabled;
  });
}

function canvasXpressSelectedValues(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return [];
  return Array.from(select.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean);
}

function canvasXpressIncludedSampleIds(allSampleIds) {
  const excluded = new Set(canvasXpressSelectedValues('canvasxpress-exclude-samples'));
  return allSampleIds.filter((sampleId) => !excluded.has(sampleId));
}

function canvasXpressRendered() {
  return document.getElementById('canvasxpress-heatmap-canvas')?.dataset.rendered === 'true';
}

function resetCanvasXpressCanvas(wrap, canvasId) {
  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.id = canvasId;
  canvas.width = 1100;
  canvas.height = 720;
  canvas.dataset.rendered = 'false';
  wrap.appendChild(canvas);
  return canvas;
}

function renderCanvasXpressLoading(wrap, geneCount) {
  wrap.innerHTML = `<div class="canvasxpress-loading">Rendering ${geneCount} gene${geneCount === 1 ? '' : 's'}...</div>`;
}

function canvasXpressHeatmapSize(wrap, geneCount, sampleCount, annotationCount, showSampleNames) {
  const availableWidth = Math.floor(wrap.getBoundingClientRect().width || wrap.clientWidth || 960) - 24;
  const width = Math.max(680, Math.min(1200, Math.max(availableWidth, sampleCount * 22 + annotationCount * 12 + 300)));
  const labelSpace = showSampleNames ? 420 : 330;
  const height = Math.max(620, Math.min(1120, geneCount * 10 + labelSpace));
  return { width, height };
}

function canvasXpressClusteringSummary(clusterRows, clusterColumns, linkage, clusteringDistance) {
  const method = ` (${linkage} linkage, ${canvasXpressDistanceLabel(clusteringDistance)})`;
  if (clusterRows && clusterColumns) return `genes and samples${method}`;
  if (clusterRows) return `genes${method}`;
  if (clusterColumns) return `samples${method}`;
  return 'off';
}

function canvasXpressColorSpectrum(scale) {
  return scale === 'row'
    ? ['#2563eb', '#f8fafc', '#dc2626']
    : ['#eff6ff', '#22c55e', '#7f1d1d'];
}

function renderCanvasXpressColorScale(scale, colorSpectrum = canvasXpressColorSpectrum(scale)) {
  const container = document.getElementById('canvasxpress-color-scale');
  if (!container) return;
  if (!scale) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  const label = scale === 'row' ? 'Row z-score' : 'log2(CPM + 1)';
  const ticks = scale === 'row' ? ['-3', '0', '3'] : ['Low', 'Mid', 'High'];
  container.hidden = false;
  container.innerHTML = `
    <strong>${heatmapEscapeHtml(label)}</strong>
    <span class="canvasxpress-scale-ramp">
      <span class="canvasxpress-scale-gradient" style="background: linear-gradient(90deg, ${colorSpectrum.join(', ')});"></span>
      <span class="canvasxpress-scale-ticks">${ticks.map((tick) => `<span>${heatmapEscapeHtml(tick)}</span>`).join('')}</span>
    </span>`;
}

function renderCanvasXpressAnnotationLegend(sampleIds, annotationColumns) {
  const container = document.getElementById('canvasxpress-annotation-legend');
  if (!container) return;
  if (!sampleIds.length || !annotationColumns.length) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  const sections = annotationColumns.map((column) => {
    const levels = Array.from(new Set(sampleIds.map((sampleId) => heatmapSampleMetadata(sampleId, column))));
    const items = levels.map((level, index) => `
      <span class="canvasxpress-legend-item">
        <span class="canvasxpress-legend-swatch" style="background:${CANVASXPRESS_ANNOTATION_COLORS[index % CANVASXPRESS_ANNOTATION_COLORS.length]}"></span>
        <span>${heatmapEscapeHtml(level)}</span>
      </span>`).join('');
    return `
      <section class="canvasxpress-legend-section">
        <h4>${heatmapEscapeHtml(column)}</h4>
        <div class="canvasxpress-legend-items">${items}</div>
      </section>`;
  }).join('');

  container.hidden = false;
  container.innerHTML = sections;
}

function openHeatmapGeneModal() {
  const modal = document.getElementById('heatmap-gene-list-modal');
  if (!modal) return;
  modal.hidden = false;
  const modalStatus = document.getElementById('heatmap-gene-list-modal-status');
  if (modalStatus) modalStatus.textContent = heatmapGeneListDraftSummary();
  requestAnimationFrame(() => document.getElementById('heatmap-gene-list')?.focus());
}

function closeHeatmapGeneModal() {
  const modal = document.getElementById('heatmap-gene-list-modal');
  if (modal) modal.hidden = true;
}

function heatmapGeneModalOpen() {
  const modal = document.getElementById('heatmap-gene-list-modal');
  return Boolean(modal && !modal.hidden);
}

function heatmapGeneListDraftSummary() {
  const terms = heatmapCustomGeneTerms();
  return terms.length ? `${terms.length} gene${terms.length === 1 ? '' : 's'} entered.` : '';
}

function renderHeatmapGeneStatus(selection, statusId = 'heatmap-gene-list-status') {
  const status = document.getElementById(statusId);
  if (!status) return;
  if (selection.mode !== 'custom') {
    status.textContent = '';
    return;
  }
  if (!selection.terms?.length) {
    status.textContent = '';
    return;
  }

  const parts = [
    `Matched ${selection.matchedTermCount}/${selection.terms.length} requested genes (${selection.rows.length} heatmap rows).`,
  ];
  if (selection.missing?.length) {
    const preview = selection.missing.slice(0, 8).join(', ');
    const suffix = selection.missing.length > 8 ? `, +${selection.missing.length - 8} more` : '';
    parts.push(`Missing: ${preview}${suffix}.`);
  }
  if (selection.truncated) parts.push(`Showing first ${HEATMAP_CUSTOM_GENE_LIMIT} matched rows.`);
  status.textContent = parts.join(' ');
}

function heatmapCustomGeneTerms() {
  const text = document.getElementById('heatmap-gene-list')?.value || '';
  const seen = new Set();
  return text
    .split(/[\s,;]+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => {
      const key = heatmapNormalizeGene(term);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function heatmapGeneAliases(row) {
  return [row.gene_id, row.gene_symbol, row.gene_name]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function heatmapNormalizeGene(value) {
  return String(value ?? '').trim().toLowerCase();
}

function renderHeatmapAnnotation(sampleIds, annotationColumn) {
  const container = document.getElementById('heatmap-annotation-strip');
  if (!container) return;
  if (annotationColumn === 'none') {
    container.innerHTML = '';
    return;
  }

  const values = sampleIds.map((sampleId) => String(getSampleById(sampleId)?.[annotationColumn] ?? 'NA'));
  const levels = Array.from(new Set(values));
  const colors = Object.fromEntries(levels.map((level, index) => [level, HEATMAP_PALETTE[index % HEATMAP_PALETTE.length]]));
  const legend = levels.map((level) => `
    <span class="annotation-legend-item"><span style="background:${colors[level]}"></span>${heatmapEscapeHtml(level)}</span>`).join('');
  container.innerHTML = `
    <div class="annotation-strip">
      <div class="annotation-label">${heatmapEscapeHtml(annotationColumn)}</div>
      <div class="annotation-legend">${legend}</div>
    </div>`;
}

function makeClustergrammerNetwork(rows, sampleIds, matrix, rowOrder, columnOrder, annotationColumn, scale) {
  const rowClusterRanks = heatmapOrderRanks(rowOrder);
  const columnClusterRanks = heatmapOrderRanks(columnOrder);
  const rowGroups = heatmapDendrogramGroups(rowOrder, 'row');
  const columnGroups = heatmapDendrogramGroups(columnOrder, 'col');
  const rowRankVar = heatmapOrderRanks(rows.map((_, index) => index).sort((a, b) => rows[b].variance - rows[a].variance));
  const columnRank = heatmapOrderRanks(sampleIds.map((_, index) => index));
  const annotationInfo = heatmapAnnotationInfo(sampleIds, annotationColumn);
  const rowLabels = heatmapUniqueLabels(rows.map((row) => row.label || row.id || 'gene'));

  return {
    mat: matrix,
    row_nodes: rows.map((row, index) => ({
      name: `Gene: ${rowLabels[index]}`,
      clust: rowClusterRanks[index],
      rank: index,
      rankvar: rowRankVar[index],
      group: rowGroups[index],
      value: row.variance,
      gene_id: row.id,
      scale,
    })),
    col_nodes: sampleIds.map((sampleId, index) => ({
      name: sampleId,
      sample_id: sampleId,
      clust: columnClusterRanks[index],
      rank: columnRank[index],
      rankvar: columnRank[index],
      group: columnGroups[index],
      ...(annotationInfo.nodeFields[index] || {}),
    })),
    cat_colors: annotationInfo.catColors,
  };
}

function heatmapDendrogramGroups(order, prefix) {
  const ranks = heatmapOrderRanks(order);
  const count = order.length;
  return ranks.map((rank) => (
    Array.from({ length: 11 }, (_, level) => {
      const groupSize = heatmapGroupSizeForLevel(level, count);
      return `${prefix}_${level}_${Math.floor(rank / groupSize) + 1}`;
    })
  ));
}

function heatmapGroupSizeForLevel(level, count) {
  if (count <= 1) return 1;
  const normalized = Math.min(10, Math.max(0, Number(level))) / 10;
  return Math.max(1, Math.ceil(1 + normalized * (count - 1)));
}

function finalizeClustergrammerControls() {
  const root = document.getElementById('expression-heatmap');
  if (!root) return;
  root.querySelector('.opacity_slider_container')?.setAttribute('aria-hidden', 'true');
  root.querySelector('.row_slider_group')?.setAttribute('aria-label', 'Row group size');
  root.querySelector('.col_slider_group')?.setAttribute('aria-label', 'Column group size');
  root.querySelector('.row_slider_group')?.setAttribute('role', 'slider');
  root.querySelector('.col_slider_group')?.setAttribute('role', 'slider');
  resizeExpressionHeatmap();
}

function restoreClustergrammerSampleLabels(sampleIds) {
  const labels = sampleIds.map(String).filter(Boolean);
  if (!labels.length) return;

  const applyLabels = () => {
    const root = document.getElementById('expression-heatmap');
    if (!root) return;
    const candidates = Array.from(root.querySelectorAll('svg text'))
      .filter((element) => heatmapLooksLikeSampleLabel(element.textContent, labels))
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter((item) => Number.isFinite(item.box.left) && Number.isFinite(item.box.top));
    if (candidates.length < labels.length) return;

    candidates
      .sort((a, b) => (a.box.left - b.box.left) || (a.box.top - b.box.top))
      .slice(0, labels.length)
      .forEach((item, index) => {
        const label = labels[index];
        item.element.textContent = label;
        item.element.setAttribute('data-full-sample-id', label);
        item.element.setAttribute('aria-label', label);
        item.element.style.textOverflow = 'clip';
        item.element.style.overflow = 'visible';
      });
  };

  requestAnimationFrame(applyLabels);
  setTimeout(applyLabels, 250);
  setTimeout(applyLabels, 1000);
}

function heatmapLooksLikeSampleLabel(value, sampleIds) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (sampleIds.includes(text)) return true;
  const prefix = text.replace(/\.\.$/, '');
  return text.endsWith('..') && sampleIds.some((sampleId) => sampleId.startsWith(prefix));
}

function applyHeatmapOpacity() {
  if (!clustergrammerInstance?.params?.matrix?.opacity_scale || !globalThis.d3) return;
  const matrix = clustergrammerInstance.params.matrix;
  if (!matrix.codex_abs_max_val) matrix.codex_abs_max_val = matrix.abs_max_val || 1;
  const domainMax = Math.max(1e-9, matrix.codex_abs_max_val * (2 - heatmapOpacityValue));
  matrix.opacity_scale.domain([0, domainMax]);
  globalThis.d3.selectAll('#expression-heatmap .tile').style('fill-opacity', (d) => matrix.opacity_scale(Math.abs(d.value)));
}

function syncHeatmapControlLabels() {
  const rowValue = heatmapIntegerControl('heatmap-row-group-size', 1, 10, 5);
  const columnValue = heatmapIntegerControl('heatmap-column-group-size', 1, 10, 5);
  const opacityValue = heatmapFloatControl('heatmap-opacity', 0.1, 1.9, 1);
  const rowOutput = document.getElementById('heatmap-row-group-value');
  const columnOutput = document.getElementById('heatmap-column-group-value');
  const opacityOutput = document.getElementById('heatmap-opacity-value');
  if (rowOutput) rowOutput.textContent = String(rowValue);
  if (columnOutput) columnOutput.textContent = String(columnValue);
  if (opacityOutput) opacityOutput.textContent = opacityValue.toFixed(1);
}

function heatmapAnnotationInfo(sampleIds, annotationColumn) {
  if (annotationColumn === 'none') return { nodeFields: [], catColors: { col: {}, row: {} } };

  const values = sampleIds.map((sampleId) => heatmapSampleMetadata(sampleId, annotationColumn));
  const levels = Array.from(new Set(values));
  const colors = Object.fromEntries(levels.map((level, index) => [
    `${annotationColumn}: ${level}`,
    HEATMAP_PALETTE[index % HEATMAP_PALETTE.length],
  ]));
  return {
    nodeFields: values.map((value, index) => ({
      'cat-0': `${annotationColumn}: ${value}`,
      cat_0_index: index,
    })),
    catColors: {
      col: { 'cat-0': colors },
      row: {},
    },
  };
}

function heatmapSampleMetadata(sampleId, column) {
  return String(getSampleById(sampleId)?.[column] ?? 'NA');
}

function heatmapTransposeMatrix(matrix) {
  if (!matrix.length) return [];
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]));
}

function heatmapOrderRanks(order) {
  const ranks = [];
  order.forEach((index, rank) => { ranks[index] = rank; });
  return ranks;
}

async function loadClustergrammerAssets() {
  if (!clustergrammerAssetPromise) {
    clustergrammerAssetPromise = CLUSTERGRAMMER_ASSETS.reduce(
      (promise, asset) => promise.then(() => (asset.test() ? null : heatmapLoadScript(asset.src))),
      Promise.resolve(),
    );
  }
  await clustergrammerAssetPromise;
  if (!globalThis.Clustergrammer) throw new Error('Clustergrammer failed to load.');
}

async function loadCanvasXpressAssets() {
  if (!canvasXpressAssetPromise) {
    canvasXpressAssetPromise = heatmapLoadStylesheet(CANVASXPRESS_CSS)
      .then(() => (typeof globalThis.CanvasXpress === 'function' ? null : heatmapLoadScript(CANVASXPRESS_JS)));
  }
  await canvasXpressAssetPromise;
  if (typeof globalThis.CanvasXpress !== 'function') throw new Error('CanvasXpress failed to load.');
}

function heatmapLoadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function heatmapLoadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[href="${href}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${href}`)), { once: true });
      if (existing.dataset.loaded === 'true' || existing.sheet) resolve();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => { link.dataset.loaded = 'true'; resolve(); };
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.appendChild(link);
  });
}

function heatmapNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function heatmapTileTip(tileData) {
  const value = heatmapFormatNumber(tileData.value);
  return `${tileData.row_name}<br>${tileData.col_name}<br>value: ${value}`;
}

function heatmapNodeTip(nodeData) {
  return nodeData.name || '';
}

function heatmapClusterOrder(vectors) {
  if (vectors.length <= 2) return vectors.map((_, index) => index);

  const clusters = vectors.map((vector, index) => ({ indices: [index], center: vector.slice(), size: 1 }));
  while (clusters.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestDistance = Infinity;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const distance = heatmapEuclidean(clusters[i].center, clusters[j].center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const left = clusters[bestI];
    const right = clusters[bestJ];
    const merged = {
      indices: heatmapMergeOrder(left.indices, right.indices, vectors),
      center: left.center.map((value, index) => ((value * left.size) + (right.center[index] * right.size)) / (left.size + right.size)),
      size: left.size + right.size,
    };
    clusters.splice(bestJ, 1);
    clusters.splice(bestI, 1, merged);
  }
  return clusters[0].indices;
}

function heatmapMergeOrder(left, right, vectors) {
  const leftEdge = vectors[left[left.length - 1]];
  const rightEdge = vectors[right[0]];
  const flippedRightEdge = vectors[right[right.length - 1]];
  return heatmapEuclidean(leftEdge, rightEdge) <= heatmapEuclidean(leftEdge, flippedRightEdge)
    ? left.concat(right)
    : left.concat(right.slice().reverse());
}

function heatmapRowZScore(values) {
  const avg = heatmapMean(values);
  const sd = Math.sqrt(heatmapVariance(values)) || 1;
  return values.map((value) => (value - avg) / sd);
}

function heatmapVariance(values) {
  if (values.length < 2) return 0;
  const avg = heatmapMean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function heatmapMean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function heatmapEuclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function heatmapNonnegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function heatmapClampedInteger(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function heatmapIntegerControl(id, min, max, fallback) {
  const element = document.getElementById(id);
  return heatmapClampedInteger(element?.value, min, max, fallback);
}

function heatmapFloatControl(id, min, max, fallback) {
  const n = Number.parseFloat(document.getElementById(id)?.value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function heatmapCheckboxChecked(id, fallback) {
  const element = document.getElementById(id);
  return element ? Boolean(element.checked) : fallback;
}

function heatmapFormatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toPrecision(4) : 'NA';
}

function heatmapUniqueLabels(labels) {
  const counts = new Map();
  labels.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1));
  const seen = new Map();
  return labels.map((label) => {
    if (counts.get(label) === 1) return label;
    const next = (seen.get(label) || 0) + 1;
    seen.set(label, next);
    return `${label}_${next}`;
  });
}

function canvasXpressDistanceLabel(value) {
  return {
    euclidianDistance: 'Euclidean distance',
    manhattanDistance: 'Manhattan distance',
    maxDistance: 'maximum distance',
  }[value] || value;
}

function heatmapEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
