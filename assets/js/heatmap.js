import { state, getSampleById, metadataColumns } from './state.js';
import { sampleIdsInCounts } from './analysis.js';

const HEATMAP_PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#475569'];
const HEATMAP_CUSTOM_GENE_LIMIT = 500;
const CLUSTERGRAMMER_VERSION = '1.19.5';
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
let clustergrammerInstance = null;
let heatmapControlsWired = false;
let heatmapOpacityValue = 1;

export function setupExpressionHeatmapControls() {
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
      renderExpressionHeatmap();
    });
    document.getElementById('heatmap-gene-list')?.addEventListener('input', () => {
      const status = document.getElementById('heatmap-gene-list-status');
      if (status) status.textContent = '';
    });
    document.getElementById('heatmap-gene-list')?.addEventListener('change', renderExpressionHeatmap);
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
  if (container) container.innerHTML = '<p class="note">Open the clustering tab to render the Clustergrammer heatmap.</p>';
  if (document.getElementById('tab-clustering')?.classList.contains('active')) renderExpressionHeatmap();
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
      label: row.gene_symbol || row.gene_name || row.gene_id || fallbackId,
      aliases,
      values,
      variance: heatmapVariance(values),
    };
  });
}

function heatmapSelectedRows(expressionRows, topN) {
  const mode = document.getElementById('heatmap-gene-mode')?.value || 'top';
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
  const geneListLabel = document.getElementById('heatmap-gene-list-label');
  const geneList = document.getElementById('heatmap-gene-list');
  const status = document.getElementById('heatmap-gene-list-status');
  const isCustom = mode === 'custom';

  if (topInput) topInput.disabled = isCustom;
  if (geneListLabel) geneListLabel.hidden = !isCustom;
  if (geneList) geneList.disabled = !isCustom;
  if (!isCustom && status) status.textContent = '';
}

function renderHeatmapGeneStatus(selection) {
  const status = document.getElementById('heatmap-gene-list-status');
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

  const values = sampleIds.map((sampleId) => String(getSampleById(sampleId)?.[annotationColumn] ?? 'NA'));
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

function heatmapEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
