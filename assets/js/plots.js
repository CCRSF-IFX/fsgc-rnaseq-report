import { state, getSampleById } from './state.js';
import { qcRowsWithStatus } from './qc.js';

function plotLayout(title) {
  return { title, margin: { l: 60, r: 30, b: 60, t: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white' };
}

const PCA_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#475569'];
const PCA_SYMBOLS = ['circle', 'square', 'diamond', 'cross', 'x', 'triangle-up', 'triangle-down', 'star'];
const PCA_SYMBOLS_3D = ['circle', 'square', 'diamond', 'cross', 'x', 'circle-open', 'square-open', 'diamond-open'];
const VOLCANO_DISPLAY_CAP = 50;
const HCLUST_ESM_URL = 'https://esm.sh/ml-hclust@4.0.0?bundle';
const DE_CATEGORIES = [
  { id: 'upregulated', label: 'upregulated', color: '#dc2626', opacity: 0.82 },
  { id: 'downregulated', label: 'downregulated', color: '#2563eb', opacity: 0.82 },
  { id: 'padj_only', label: 'padj only', color: '#7c3aed', opacity: 0.72 },
  { id: 'not_significant', label: 'not significant', color: '#94a3b8', opacity: 0.34 },
];
let hclustModulePromise = null;
let distanceHeatmapRenderId = 0;

export function renderPCA(colorBy = 'condition', pair = 'PC1,PC2', shapeBy = 'none', projection = '2d') {
  const points = state.pca.samples || [];
  const pcKeys = pcaComponentKeys(points);
  const is3d = projection === '3d' && pcKeys.length >= 3;
  const [pairX, pairY] = pair.split(',');
  const xKey = is3d ? pcKeys[0] : (pcKeys.includes(pairX) ? pairX : pcKeys[0] || 'PC1');
  const yKey = is3d ? pcKeys[1] : (pcKeys.includes(pairY) ? pairY : pcKeys[1] || 'PC2');
  const zKey = is3d ? pcKeys[2] : null;
  const colorColumn = colorBy || '';
  const colorLevels = uniqueValues(points.map((point) => pcaGroupValue(point.sample_id, colorColumn)));
  const hasShape = shapeBy && shapeBy !== 'none';
  const shapeLevels = hasShape ? uniqueValues(points.map((point) => sampleMetadata(point.sample_id, shapeBy))) : [''];
  const colorMap = new Map(colorLevels.map((level, index) => [level, PCA_COLORS[index % PCA_COLORS.length]]));
  const symbols = is3d ? PCA_SYMBOLS_3D : PCA_SYMBOLS;
  const symbolMap = new Map(shapeLevels.map((level, index) => [level, symbols[index % symbols.length]]));
  const traces = colorLevels.map((colorLevel, index) => {
    const subset = points.filter((point) => pcaGroupValue(point.sample_id, colorColumn) === colorLevel);
    const trace = {
      x: subset.map((p) => p[xKey]),
      y: subset.map((p) => p[yKey]),
      text: subset.map((p) => pcaHoverText(p, colorColumn, shapeBy)),
      name: colorLevel,
      mode: 'markers',
      type: is3d ? 'scatter3d' : 'scatter',
      legendgroup: 'pca-color',
      legendgrouptitle: index === 0 ? { text: colorColumn || 'Samples' } : undefined,
      marker: {
        size: is3d ? 6 : 13,
        opacity: 0.85,
        color: colorMap.get(colorLevel),
        symbol: hasShape ? subset.map((p) => symbolMap.get(sampleMetadata(p.sample_id, shapeBy))) : 'circle',
        line: { width: 0.5, color: '#ffffff' },
      },
    };
    if (is3d) trace.z = subset.map((p) => p[zKey]);
    return trace;
  });

  if (hasShape) {
    shapeLevels.forEach((shapeLevel, index) => {
      const trace = {
        x: [null],
        y: [null],
        text: [shapeLevel],
        name: shapeLevel,
        mode: 'markers',
        type: is3d ? 'scatter3d' : 'scatter',
        hoverinfo: 'skip',
        legendgroup: 'pca-shape',
        legendgrouptitle: index === 0 ? { text: shapeBy } : undefined,
        marker: {
          size: is3d ? 6 : 13,
          opacity: 0.85,
          color: '#334155',
          symbol: symbolMap.get(shapeLevel),
          line: { width: 0.5, color: '#ffffff' },
        },
      };
      if (is3d) trace.z = [null];
      traces.push(trace);
    });
  }

  const variance = state.pca.variance_explained || {};
  const layout = {
    ...plotLayout(is3d ? 'PCA 3D' : 'PCA'),
    legend: { tracegroupgap: hasShape ? 10 : 0, itemclick: false, itemdoubleclick: false },
  };
  if (is3d) {
    layout.scene = {
      xaxis: { title: `${xKey} (${pct(variance[xKey])})` },
      yaxis: { title: `${yKey} (${pct(variance[yKey])})` },
      zaxis: { title: `${zKey} (${pct(variance[zKey])})` },
    };
  } else {
    layout.xaxis = { title: `${xKey} (${pct(variance[xKey])})` };
    layout.yaxis = { title: `${yKey} (${pct(variance[yKey])})` };
  }
  Plotly.react('pca-plot', traces, layout, { responsive: true });
  renderScree();
}

export function renderScree() {
  const variance = state.pca.variance_explained || {};
  const pcs = Object.keys(variance);
  Plotly.react('scree-plot', [{
    x: pcs,
    y: pcs.map((pc) => variance[pc] * 100),
    type: 'bar',
    marker: { color: '#2563eb', opacity: 0.82 },
    hovertemplate: '%{x}<br>%{y:.1f}%<extra></extra>',
  }], {
    ...plotLayout('Variance explained'),
    margin: { l: 58, r: 20, b: 56, t: 60 },
    xaxis: { title: 'Principal component', automargin: true },
    yaxis: { title: '% variance', rangemode: 'tozero', gridcolor: '#e5e7eb' },
    bargap: 0.28,
    showlegend: false,
  }, { responsive: true });
}

export function renderDistanceHeatmap() {
  if (!state.distance) return;
  const renderId = ++distanceHeatmapRenderId;
  const sampleIds = state.distance.sample_ids || [];
  const matrix = normalizeDistanceMatrix(state.distance.matrix || [], sampleIds.length);
  renderClusteringStatus('Loading hierarchical clustering library...');
  loadHclustModule()
    .then(({ agnes }) => {
      if (renderId !== distanceHeatmapRenderId) return;
      const clustering = clusterDistanceMatrix(agnes, sampleIds, matrix);
      renderClusteredDistanceHeatmap(sampleIds, matrix, clustering);
      const metric = state.distance?.metric || 'sample';
      const transform = state.distance?.transform ? ` after ${state.distance.transform}` : '';
      renderClusteringStatus(`AGNES average-linkage clustering from ${metric} distances${transform}. Dendrograms and heatmap share the same leaf order.`);
    })
    .catch((error) => {
      console.warn('Hierarchical clustering library failed to load.', error);
      if (renderId !== distanceHeatmapRenderId) return;
      renderPlainDistanceHeatmap(sampleIds, matrix);
      renderClusteringStatus(`Could not load the hierarchical clustering library (${error.message}). Showing the distance matrix in the original sample order.`);
    });
}

export function renderQCPlots() {
  const rows = qcRowsWithStatus();
  const plots = document.getElementById('qc-plots');
  if (!plots) return;
  const specs = [
    { id: 'reads-plot', key: 'total_reads', title: 'Total reads (PF)', yaxis: { title: 'reads' } },
    { id: 'mapping-plot', key: 'mapping_rate', title: 'Mapped reads (trimmed)', yaxis: { tickformat: '.0%', range: [0, 1] } },
    { id: 'q30-plot', key: 'q30_bases_rate', title: 'PF bases >= Q30', yaxis: { tickformat: '.0%', range: [0, 1] } },
    { id: 'rrna-plot', key: 'rrna_rate', title: 'Ribosomal bases', yaxis: { tickformat: '.1%' } },
    { id: 'duplication-plot', key: 'duplication_rate', title: 'Duplicate mapped reads', yaxis: { tickformat: '.0%', range: [0, 1] } },
  ].filter((spec) => rows.some((row) => Number.isFinite(Number(row[spec.key]))));

  if (specs.length === 0) {
    plots.innerHTML = '<p class="note">No numeric QC metrics available for plotting.</p>';
    return;
  }

  plots.innerHTML = specs.map((spec) => `<div id="${spec.id}" class="plot"></div>`).join('');
  specs.forEach((spec) => {
    Plotly.react(spec.id, [{
      x: rows.map((r) => r.sample_id),
      y: rows.map((r) => Number(r[spec.key])),
      type: 'bar',
    }], { ...plotLayout(spec.title), yaxis: spec.yaxis }, { responsive: true });
  });
}

export function renderVolcano(rows, padj = 0.05, lfc = 1) {
  const yCap = volcanoDisplayCap(rows, padj);
  const points = rows.map((row) => volcanoPoint(row, padj, lfc, yCap)).filter(Boolean);
  const cappedCount = points.filter((point) => point.capped).length;
  const traces = DE_CATEGORIES.flatMap((category) => {
    const categoryPoints = points.filter((point) => point.category === category.id);
    const uncapped = categoryPoints.filter((point) => !point.capped);
    const capped = categoryPoints.filter((point) => point.capped);
    return [
      volcanoTrace(uncapped, category, false, uncapped.length > 0),
      volcanoTrace(capped, category, true, uncapped.length === 0 && capped.length > 0),
    ].filter(Boolean);
  });
  const layout = plotLayout('Volcano plot');
  Plotly.react('volcano-plot', traces, {
    ...layout,
    xaxis: { title: 'log2 fold change' },
    yaxis: { title: '-log10 adjusted p-value', range: [0, yCap * 1.08] },
    legend: { tracegroupgap: 4 },
    shapes: [
      { type: 'line', x0: -lfc, x1: -lfc, y0: 0, y1: 1, yref: 'paper', line: { color: '#94a3b8', dash: 'dot' } },
      { type: 'line', x0: lfc, x1: lfc, y0: 0, y1: 1, yref: 'paper', line: { color: '#94a3b8', dash: 'dot' } },
      { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: -Math.log10(plotPValue(padj)), y1: -Math.log10(plotPValue(padj)), line: { color: '#94a3b8', dash: 'dot' } },
    ],
    annotations: cappedCount ? [{
      xref: 'paper',
      yref: 'paper',
      x: 0.01,
      y: 0.99,
      xanchor: 'left',
      yanchor: 'top',
      align: 'left',
      showarrow: false,
      font: { size: 12, color: '#475569' },
      bgcolor: 'rgba(255,255,255,0.82)',
      bordercolor: '#cbd5e1',
      borderpad: 4,
      text: `${cappedCount} point${cappedCount === 1 ? '' : 's'} capped at -log10(padj)=${formatNumber(yCap)}`,
    }] : [],
  }, { responsive: true });
}

export function renderMA(rows, padj = 0.05, lfc = 1) {
  const points = rows.map((row) => maPoint(row, padj, lfc)).filter(Boolean);
  const traces = DE_CATEGORIES.map((category) => maTrace(points.filter((point) => point.category === category.id), category)).filter(Boolean);
  Plotly.react('ma-plot', traces, {
    ...plotLayout('MA plot'),
    xaxis: { title: 'baseMean', type: 'log' },
    yaxis: { title: 'log2 fold change' },
    legend: { tracegroupgap: 4 },
  }, { responsive: true });
}

export function renderGeneCounts(geneQuery, options = {}) {
  const query = String(geneQuery || '').trim();
  const plot = document.getElementById('gene-count-plot');
  const status = document.getElementById('count-plot-status');
  if (!plot) return;
  if (!query) {
    clearGeneCountPlot(plot);
    if (status) status.textContent = 'Enter a gene symbol or ID.';
    return;
  }

  const row = state.counts.find((r) => geneCountMatchesQuery(r, query));
  if (!row) {
    clearGeneCountPlot(plot);
    plot.innerHTML = `<p class="note">No counts found for ${escapePlotText(query)}.</p>`;
    if (status) status.textContent = '';
    return;
  }

  const sampleIds = state.samples.map((s) => s.sample_id).filter((sampleId) => Object.prototype.hasOwnProperty.call(row, sampleId));
  if (options.mode === 'box') {
    renderGeneCountBoxPlot(row, sampleIds, options.groupBy || '', options.splitBy || '', status, plot);
  } else {
    renderGeneCountBarPlot(row, sampleIds, status);
  }
}

function renderGeneCountBarPlot(row, sampleIds, status) {
  if (status) status.textContent = '';
  Plotly.react('gene-count-plot', [{
    x: sampleIds,
    y: sampleIds.map((id) => countValue(row, id)),
    type: 'bar',
    marker: { color: '#2563eb' },
    customdata: sampleIds.map((id) => [sampleMetadata(id, 'condition')]),
    hovertemplate: '<b>%{x}</b><br>count: %{y}<br>condition: %{customdata[0]}<extra></extra>',
  }], {
    ...plotLayout(`${geneCountLabel(row)} counts`),
    xaxis: { title: 'Sample' },
    yaxis: { title: 'Count' },
  }, { responsive: true });
}

function renderGeneCountBoxPlot(row, sampleIds, groupColumn, splitColumn, status, plot) {
  if (!groupColumn) {
    clearGeneCountPlot(plot);
    if (status) status.textContent = 'No metadata column with at least two groups is available.';
    return;
  }

  const levels = uniqueValues(sampleIds.map((sampleId) => sampleMetadata(sampleId, groupColumn)));
  if (levels.length < 2) {
    clearGeneCountPlot(plot);
    if (status) status.textContent = `${groupColumn} has fewer than two groups.`;
    return;
  }

  if (splitColumn && splitColumn !== groupColumn) {
    renderGeneCountSplitBoxPlot(row, sampleIds, groupColumn, splitColumn, status, plot);
    return;
  }

  const traces = levels.map((level, index) => {
    const points = sampleIds
      .filter((sampleId) => sampleMetadata(sampleId, groupColumn) === level)
      .map((sampleId) => ({ sampleId, value: countValue(row, sampleId) }))
      .filter((point) => Number.isFinite(point.value));
    if (!points.length) return null;
    const color = PCA_COLORS[index % PCA_COLORS.length];
    return {
      y: points.map((point) => point.value),
      text: points.map((point) => point.sampleId),
      type: 'box',
      name: level,
      boxpoints: 'all',
      jitter: 0.35,
      pointpos: 0,
      marker: { color, size: 8, opacity: 0.78 },
      line: { color },
      hovertemplate: `<b>%{text}</b><br>${escapePlotText(groupColumn)}: ${escapePlotText(level)}<br>count: %{y}<extra></extra>`,
    };
  }).filter(Boolean);

  if (traces.length < 2) {
    clearGeneCountPlot(plot);
    if (status) status.textContent = `${groupColumn} does not have count values in at least two groups.`;
    return;
  }

  if (status) status.textContent = '';
  Plotly.react('gene-count-plot', traces, {
    ...plotLayout(`${geneCountLabel(row)} counts by ${groupColumn}`),
    xaxis: { title: groupColumn },
    yaxis: { title: 'Count' },
    boxmode: 'group',
  }, { responsive: true });
}

function renderGeneCountSplitBoxPlot(row, sampleIds, groupColumn, splitColumn, status, plot) {
  const groupLevels = uniqueValues(sampleIds.map((sampleId) => sampleMetadata(sampleId, groupColumn)));
  const splitLevels = uniqueValues(sampleIds.map((sampleId) => sampleMetadata(sampleId, splitColumn)));
  if (groupLevels.length < 2 || splitLevels.length < 2) {
    clearGeneCountPlot(plot);
    if (status) status.textContent = `${groupColumn} and ${splitColumn} must each have at least two groups.`;
    return;
  }

  const traces = splitLevels.map((splitLevel, index) => {
    const points = sampleIds
      .filter((sampleId) => sampleMetadata(sampleId, splitColumn) === splitLevel)
      .map((sampleId) => ({
        sampleId,
        group: sampleMetadata(sampleId, groupColumn),
        value: countValue(row, sampleId),
      }))
      .filter((point) => Number.isFinite(point.value));
    if (!points.length) return null;
    const color = PCA_COLORS[index % PCA_COLORS.length];
    return {
      x: points.map((point) => point.group),
      y: points.map((point) => point.value),
      text: points.map((point) => point.sampleId),
      type: 'box',
      name: splitLevel,
      boxpoints: 'all',
      jitter: 0.35,
      pointpos: 0,
      marker: { color, size: 8, opacity: 0.78 },
      line: { color },
      hovertemplate: `<b>%{text}</b><br>${escapePlotText(groupColumn)}: %{x}<br>${escapePlotText(splitColumn)}: ${escapePlotText(splitLevel)}<br>count: %{y}<extra></extra>`,
    };
  }).filter(Boolean);

  if (traces.length < 2) {
    clearGeneCountPlot(plot);
    if (status) status.textContent = `${splitColumn} does not have count values in at least two groups.`;
    return;
  }

  if (status) status.textContent = '';
  Plotly.react('gene-count-plot', traces, {
    ...plotLayout(`${geneCountLabel(row)} counts by ${groupColumn}, split by ${splitColumn}`),
    xaxis: { title: groupColumn, categoryorder: 'array', categoryarray: groupLevels },
    yaxis: { title: 'Count' },
    boxmode: 'group',
    legend: { title: { text: splitColumn } },
  }, { responsive: true });
}

export function renderEnrichment(rows) {
  const top = rows.slice().sort((a, b) => Number(a.padj) - Number(b.padj)).slice(0, 15).reverse();
  const termLabels = top.map((row) => row.term_name || row.term_id || 'term');
  const wrappedLabels = termLabels.map((label) => wrapPlotLabel(label, 32));
  const termKeys = top.map((row, index) => `${row.term_id || 'term'}_${index}`);
  const layout = plotLayout('Top enriched terms');
  Plotly.react('enrichment-plot', [{
    x: top.map((r) => -Math.log10(plotPValue(r.padj))),
    y: termKeys,
    type: 'bar',
    orientation: 'h',
    customdata: top.map((r, index) => [termLabels[index], r.term_id || '', r.genes || '']),
    hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Genes: %{customdata[2]}<br>-log10 adjusted p-value: %{x:.3g}<extra></extra>',
  }], {
    ...layout,
    margin: { ...layout.margin, l: enrichmentLeftMargin(wrappedLabels), r: 30 },
    xaxis: { title: '-log10 adjusted p-value', automargin: true },
    yaxis: {
      automargin: true,
      tickmode: 'array',
      tickvals: termKeys,
      ticktext: wrappedLabels,
      categoryorder: 'array',
      categoryarray: termKeys,
    },
  }, { responsive: true });
}

export function renderGseaRunningEnrichment(curve) {
  const plot = document.getElementById('gsea-running-plot');
  if (!plot) return;
  const points = Array.isArray(curve?.points) ? curve.points : [];
  if (!curve || points.length < 2) {
    clearPlot(plot, 'Run browser fgsea to generate pathway-level enrichment plots.');
    return;
  }

  const sortedPoints = points
    .map((point) => ({ rank: Number(point.rank), runningScore: Number(point.runningScore) }))
    .filter((point) => Number.isFinite(point.rank) && Number.isFinite(point.runningScore))
    .sort((a, b) => a.rank - b.rank);
  if (sortedPoints.length < 2) {
    clearPlot(plot, 'No running enrichment-score points are available for this pathway.');
    return;
  }

  const hits = (Array.isArray(curve.hits) ? curve.hits : [])
    .map((hit) => ({
      rank: Number(hit.rank),
      gene: String(hit.gene || ''),
      stat: Number(hit.stat),
    }))
    .filter((hit) => Number.isFinite(hit.rank));
  const scores = sortedPoints.map((point) => point.runningScore);
  const es = Number(curve.enrichmentScore);
  const yMin = Math.min(0, ...scores, Number.isFinite(es) ? es : 0);
  const yMax = Math.max(0, ...scores, Number.isFinite(es) ? es : 0);
  const yRange = Math.max(0.01, yMax - yMin);
  const rugY = yMin - yRange * 0.08;
  const xMax = Number(curve.totalRanks) || Math.max(...sortedPoints.map((point) => point.rank));
  const title = curve.term_name || curve.term_id || 'GSEA enrichment plot';
  const subtitle = [
    Number.isFinite(Number(curve.NES)) ? `NES ${formatNumber(curve.NES)}` : '',
    Number.isFinite(Number(curve.padj)) ? `padj ${formatNumber(curve.padj)}` : '',
    Number.isFinite(Number(curve.size)) ? `size ${curve.size}` : '',
  ].filter(Boolean).join(' · ');

  Plotly.react('gsea-running-plot', [
    {
      x: sortedPoints.map((point) => point.rank),
      y: sortedPoints.map((point) => point.runningScore),
      type: 'scatter',
      mode: 'lines',
      name: 'running ES',
      line: { color: '#22c55e', width: 2.2 },
      hovertemplate: 'rank %{x}<br>running ES %{y:.4f}<extra></extra>',
    },
    {
      x: hits.map((hit) => hit.rank),
      y: hits.map(() => rugY),
      type: 'scatter',
      mode: 'markers',
      name: 'pathway genes',
      text: hits.map((hit) => hit.gene),
      marker: { color: '#111827', symbol: 'line-ns-open', size: 16, line: { width: 1.2 } },
      hovertemplate: '<b>%{text}</b><br>rank %{x}<extra></extra>',
    },
  ], {
    ...plotLayout(title),
    title: { text: subtitle ? `${escapePlotText(title)}<br><sup>${escapePlotText(subtitle)}</sup>` : escapePlotText(title) },
    margin: { l: 68, r: 30, b: 64, t: 72 },
    xaxis: { title: 'rank', range: [1, xMax], zeroline: false },
    yaxis: { title: 'enrichment score', range: [rugY - yRange * 0.04, yMax + yRange * 0.08], zeroline: false },
    showlegend: false,
    shapes: [
      { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: '#ef4444', width: 1 } },
      ...(Number.isFinite(es) ? [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: es, y1: es, line: { color: '#ef4444', dash: 'dash', width: 1 } }] : []),
    ],
  }, { responsive: true });
}

function volcanoDisplayCap(rows, padj) {
  const thresholdY = -Math.log10(plotPValue(padj));
  const rawMax = Math.max(...rows.map((row) => -Math.log10(plotPValue(row.padj))).filter(Number.isFinite), 0);
  const minimumCap = Math.max(10, Math.ceil(thresholdY + 1));
  if (rawMax > VOLCANO_DISPLAY_CAP) return Math.max(VOLCANO_DISPLAY_CAP, minimumCap);
  return Math.max(minimumCap, Math.ceil(rawMax + 1));
}

function clearPlot(plot, message = '') {
  globalThis.Plotly?.purge?.(plot);
  plot.innerHTML = message ? `<p class="note">${escapePlotText(message)}</p>` : '';
}

function volcanoPoint(row, padj, lfc, yCap) {
  const log2fc = Number(row.log2FoldChange);
  const rawY = -Math.log10(plotPValue(row.padj));
  if (!Number.isFinite(log2fc) || !Number.isFinite(rawY)) return null;
  const category = deCategory(row, padj, lfc);
  const capped = rawY > yCap;
  return { row, category, log2fc, rawY, y: capped ? yCap : rawY, capped };
}

function volcanoTrace(points, category, capped, showLegend) {
  if (!points.length) return null;
  return {
    x: points.map((point) => point.log2fc),
    y: points.map((point) => point.y),
    text: points.map((point) => deHoverText(point.row, category.label, point.capped, point.rawY)),
    name: category.label,
    mode: 'markers',
    type: 'scattergl',
    legendgroup: category.id,
    showlegend: showLegend,
    marker: {
      color: category.color,
      opacity: category.opacity,
      size: capped ? 9 : 6,
      symbol: capped ? 'triangle-up' : 'circle',
      line: { width: capped ? 0.8 : 0, color: '#0f172a' },
    },
    hovertemplate: '%{text}<extra></extra>',
  };
}

function maPoint(row, padj, lfc) {
  const baseMean = Number(row.baseMean);
  const log2fc = Number(row.log2FoldChange);
  if (!Number.isFinite(baseMean) || baseMean <= 0 || !Number.isFinite(log2fc)) return null;
  return { row, category: deCategory(row, padj, lfc), baseMean, log2fc };
}

function maTrace(points, category) {
  if (!points.length) return null;
  return {
    x: points.map((point) => point.baseMean),
    y: points.map((point) => point.log2fc),
    text: points.map((point) => deHoverText(point.row, category.label)),
    name: category.label,
    mode: 'markers',
    type: 'scattergl',
    legendgroup: category.id,
    marker: {
      color: category.color,
      opacity: category.opacity,
      size: category.id === 'not_significant' ? 5 : 7,
    },
    hovertemplate: '%{text}<extra></extra>',
  };
}

function deCategory(row, padj, lfc) {
  const adjustedP = Number(row.padj);
  const log2fc = Number(row.log2FoldChange);
  const passesP = Number.isFinite(adjustedP) && adjustedP <= padj;
  if (!passesP || !Number.isFinite(log2fc)) return 'not_significant';
  if (log2fc >= lfc) return 'upregulated';
  if (log2fc <= -lfc) return 'downregulated';
  return 'padj_only';
}

function deHoverText(row, category, capped = false, rawY = null) {
  const label = row.gene_symbol || row.gene_id || 'gene';
  const fields = [
    `<b>${escapePlotText(label)}</b>`,
    `class: ${escapePlotText(category)}`,
    `gene_id: ${escapePlotText(row.gene_id || 'NA')}`,
    `baseMean: ${formatNumber(row.baseMean)}`,
    `log2FC: ${formatNumber(row.log2FoldChange)}`,
    `pvalue: ${formatPValue(row.pvalue)}`,
    `padj: ${formatPValue(row.padj)}`,
  ];
  if (capped && rawY !== null) fields.push(`shown capped; true -log10(padj): ${formatNumber(rawY)}`);
  return fields.join('<br>');
}

function pct(value) {
  return value === undefined ? '' : `${(value * 100).toFixed(1)}%`;
}

function sampleMetadata(sampleId, column) {
  return String(getSampleById(sampleId)?.[column] ?? 'NA');
}

function geneCountMatchesQuery(row, query) {
  const normalized = query.toLowerCase();
  return [row.gene_symbol, row.gene_id, row.gene_name]
    .some((value) => String(value ?? '').toLowerCase() === normalized);
}

function geneCountLabel(row) {
  return row.gene_symbol || row.gene_id || row.gene_name || 'Gene';
}

function countValue(row, sampleId) {
  const value = Number(row[sampleId]);
  return Number.isFinite(value) ? value : null;
}

function clearGeneCountPlot(plot) {
  try {
    globalThis.Plotly?.purge?.(plot);
  } catch (_) {
    // Plotly may not have initialized this container yet.
  }
  plot.innerHTML = '';
}

function pcaGroupValue(sampleId, column) {
  return column ? sampleMetadata(sampleId, column) : 'All samples';
}

function pcaHoverText(point, colorBy, shapeBy) {
  const sample = getSampleById(point.sample_id) || {};
  const fields = Object.entries(sample)
    .filter(([key]) => key !== 'sample_id')
    .map(([key, value]) => `${key}: ${value}`);
  const emphasized = colorBy ? [`${colorBy}: ${sampleMetadata(point.sample_id, colorBy)}`] : [];
  if (shapeBy && shapeBy !== 'none') emphasized.push(`${shapeBy}: ${sampleMetadata(point.sample_id, shapeBy)}`);
  return [point.sample_id].concat(Array.from(new Set(emphasized.concat(fields)))).join('<br>');
}

function uniqueValues(values) {
  return Array.from(new Set(values.map((value) => String(value ?? 'NA'))));
}

function pcaComponentKeys(points) {
  const keys = new Set();
  points.forEach((point) => {
    Object.keys(point).forEach((key) => {
      if (/^PC\d+$/.test(key) && Number.isFinite(Number(point[key]))) keys.add(key);
    });
  });
  return Array.from(keys)
    .filter((key) => points.every((point) => Number.isFinite(Number(point[key]))))
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

function wrapPlotLabel(label, maxLineLength = 32) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    if (!line) {
      line = word;
    } else if ((line.length + word.length + 1) <= maxLineLength) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines.join('<br>') : String(label);
}

function sampleAxisMargin(labels, min, max) {
  const maxLength = Math.max(...labels.map((label) => String(label || '').length), 0);
  return Math.min(max, Math.max(min, maxLength * 8 + 24));
}

function loadHclustModule() {
  if (!hclustModulePromise) hclustModulePromise = import(HCLUST_ESM_URL);
  return hclustModulePromise;
}

function normalizeDistanceMatrix(matrix, size) {
  return Array.from({ length: size }, (_, rowIndex) => (
    Array.from({ length: size }, (_, columnIndex) => {
      if (rowIndex === columnIndex) return 0;
      const value = Number(matrix[rowIndex]?.[columnIndex]);
      const mirrored = Number(matrix[columnIndex]?.[rowIndex]);
      if (Number.isFinite(value)) return value;
      if (Number.isFinite(mirrored)) return mirrored;
      return 0;
    })
  ));
}

function clusterDistanceMatrix(agnes, sampleIds, matrix) {
  if (!agnes || sampleIds.length < 2) return null;
  const tree = agnes(matrix, { method: 'average', isDistanceMatrix: true });
  const leafOrder = [];
  assignClusterPositions(tree, leafOrder);
  return {
    tree,
    leafOrder,
    maxHeight: Math.max(clusterHeight(tree), 1e-9),
  };
}

function assignClusterPositions(node, leafOrder) {
  const children = Array.isArray(node.children) ? node.children : [];
  if (node.isLeaf || children.length === 0) {
    node.plotPosition = leafOrder.length;
    leafOrder.push(node.index);
    return node.plotPosition;
  }
  children.forEach((child) => assignClusterPositions(child, leafOrder));
  node.plotPosition = plotMean(children.map((child) => child.plotPosition));
  return node.plotPosition;
}

function renderClusteredDistanceHeatmap(sampleIds, matrix, clustering) {
  if (!clustering) {
    renderPlainDistanceHeatmap(sampleIds, matrix);
    renderClusteringStatus('Hierarchical clustering requires at least two samples and a valid distance matrix.');
    return;
  }
  const orderedSampleIds = clustering.leafOrder.map((index) => sampleIds[index]);
  const orderedMatrix = orderedDistanceMatrix(matrix, clustering.leafOrder);
  const positions = orderedSampleIds.map((_, index) => index);
  const heatmapTrace = distanceHeatmapTrace(positions, orderedSampleIds, orderedMatrix, true);
  const topDendrogram = dendrogramTrace(clustering.tree, 'top');
  const leftDendrogram = dendrogramTrace(clustering.tree, 'left');
  Plotly.react('distance-heatmap', [topDendrogram, leftDendrogram, heatmapTrace], distanceHeatmapLayout(orderedSampleIds, clustering.maxHeight, true), { responsive: true });
}

function renderPlainDistanceHeatmap(sampleIds, matrix) {
  const positions = sampleIds.map((_, index) => index);
  Plotly.react('distance-heatmap', [distanceHeatmapTrace(positions, sampleIds, matrix, false)], distanceHeatmapLayout(sampleIds, 0, false), { responsive: true });
}

function distanceHeatmapTrace(positions, sampleIds, matrix, clustered) {
  return {
    x: positions,
    y: positions,
    z: matrix,
    customdata: sampleIds.map((rowId) => sampleIds.map((columnId) => [rowId, columnId])),
    type: 'heatmap',
    colorscale: 'Viridis',
    xaxis: clustered ? 'x' : undefined,
    yaxis: clustered ? 'y' : undefined,
    hovertemplate: '<b>%{customdata[0]}</b> vs <b>%{customdata[1]}</b><br>distance: %{z:.4g}<extra></extra>',
    colorbar: {
      title: { text: 'Distance' },
      len: clustered ? 0.74 : 1,
      x: clustered ? 1.02 : 1.02,
      y: clustered ? 0.4 : 0.5,
    },
  };
}

function dendrogramTrace(tree, orientation) {
  const segments = dendrogramSegments(tree, orientation);
  return {
    x: segments.x,
    y: segments.y,
    type: 'scatter',
    mode: 'lines',
    hoverinfo: 'skip',
    xaxis: orientation === 'top' ? 'x2' : 'x3',
    yaxis: orientation === 'top' ? 'y2' : 'y3',
    line: { color: '#2563eb', width: 1.8 },
  };
}

function dendrogramSegments(node, orientation, segments = { x: [], y: [] }) {
  const children = Array.isArray(node?.children) ? node.children : [];
  if (children.length === 0) return segments;
  const first = children[0];
  const last = children[children.length - 1];
  const height = clusterHeight(node);
  children.forEach((child) => {
    if (orientation === 'top') {
      segments.x.push(child.plotPosition, child.plotPosition, null);
      segments.y.push(clusterHeight(child), height, null);
    } else {
      segments.x.push(clusterHeight(child), height, null);
      segments.y.push(child.plotPosition, child.plotPosition, null);
    }
  });
  if (orientation === 'top') {
    segments.x.push(first.plotPosition, last.plotPosition, null);
    segments.y.push(height, height, null);
  } else {
    segments.x.push(height, height, null);
    segments.y.push(first.plotPosition, last.plotPosition, null);
  }
  children.forEach((child) => dendrogramSegments(child, orientation, segments));
  return segments;
}

function orderedDistanceMatrix(matrix, order) {
  return order.map((rowIndex) => order.map((columnIndex) => Number(matrix[rowIndex]?.[columnIndex]) || 0));
}

function distanceHeatmapLayout(sampleIds, maxHeight, clustered) {
  const positions = sampleIds.map((_, index) => index);
  const labelMargin = sampleAxisMargin(sampleIds, 104, 260);
  const bottomMargin = sampleAxisMargin(sampleIds, 92, 180);
  const heatmapX = clustered ? [0.15, 0.86] : [0, 1];
  const heatmapY = clustered ? [0.03, 0.77] : [0, 1];
  const leftDendrogramX = [0.025, 0.145];
  const topDendrogramY = [0.785, 0.985];
  const layout = {
    ...plotLayout(clustered ? 'Sample distance matrix with hierarchical clustering' : 'Sample distance matrix'),
    showlegend: false,
    margin: {
      l: clustered ? 26 : labelMargin,
      r: clustered ? Math.max(150, labelMargin + 58) : 36,
      b: bottomMargin,
      t: clustered ? 30 : 60,
    },
    xaxis: {
      domain: heatmapX,
      tickmode: 'array',
      tickvals: positions,
      ticktext: sampleIds,
      tickangle: 45,
      range: [-0.5, sampleIds.length - 0.5],
      automargin: true,
      showgrid: false,
      zeroline: false,
    },
    yaxis: {
      domain: heatmapY,
      tickmode: 'array',
      tickvals: positions,
      ticktext: sampleIds,
      range: [sampleIds.length - 0.5, -0.5],
      side: clustered ? 'right' : 'left',
      automargin: true,
      showgrid: false,
      zeroline: false,
    },
  };
  if (!clustered) return layout;

  const dendrogramMax = Math.max(maxHeight * 1.05, 1e-9);
  return {
    ...layout,
    xaxis2: {
      domain: heatmapX,
      range: [-0.5, sampleIds.length - 0.5],
      showticklabels: false,
      showgrid: false,
      zeroline: false,
      fixedrange: true,
    },
    yaxis2: {
      domain: topDendrogramY,
      range: [0, dendrogramMax],
      showticklabels: false,
      showgrid: false,
      zeroline: false,
      fixedrange: true,
    },
    xaxis3: {
      domain: leftDendrogramX,
      range: [dendrogramMax, 0],
      showticklabels: false,
      showgrid: false,
      zeroline: false,
      fixedrange: true,
    },
    yaxis3: {
      domain: heatmapY,
      range: [sampleIds.length - 0.5, -0.5],
      showticklabels: false,
      showgrid: false,
      zeroline: false,
      fixedrange: true,
    },
  };
}

function clusterHeight(node) {
  const height = Number(node?.height);
  return Number.isFinite(height) ? height : 0;
}

function plotMean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function renderClusteringStatus(message) {
  const status = document.getElementById('sample-clustering-status');
  if (status) status.textContent = message;
}

function enrichmentLeftMargin(labels) {
  const lineLengths = labels.flatMap((label) => String(label).split('<br>').map((line) => line.length));
  const maxLength = Math.max(12, ...lineLengths);
  return Math.min(320, Math.max(150, maxLength * 7 + 34));
}

function plotPValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(n, 1e-300) : 1;
}

function formatPValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return escapePlotText(value || 'NA');
  if (n === 0) return '0';
  if (Math.abs(n) < 0.001) return n.toExponential(2);
  return n.toPrecision(3);
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return escapePlotText(value || 'NA');
  if (n === 0) return '0';
  if (Math.abs(n) >= 1000 || Math.abs(n) < 0.001) return n.toExponential(2);
  return n.toFixed(Math.abs(n) >= 10 ? 1 : 3).replace(/\.?0+$/, '');
}

function escapePlotText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
